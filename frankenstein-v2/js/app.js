(function () {
  "use strict";

  var book = window.AWWFY_BOOK;
  var app = document.getElementById("app");
  if (!book || !app) {
    return;
  }

  var PROGRESS_KEY = "awwfy-" + book.slug + "-progress";
  var THEME_KEY = "awwfy-theme";
  var STUDIO_URL = "https://awwfy.com";
  var WORD_MARKER_RE = /\[\[([^|\]]+)\|([^\]]+)\]\]/g;

  var state = {
    screen: "start",
    chapterId: null,
    readingActive: false,
    speechToken: 0,
    activeWordBtn: null,
    observer: null,
    originalPanel: null,
    originalTrigger: null
  };

  /* ---------- reduced motion & speech ---------- */
  function prefersReducedMotion() {
    return Boolean(
      window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches
    );
  }

  function hasSpeech() {
    return typeof window.speechSynthesis !== "undefined" && typeof window.SpeechSynthesisUtterance !== "undefined";
  }

  /* ---------- theme ---------- */
  function getCurrentTheme() {
    var attr = document.documentElement.getAttribute("data-theme");
    if (attr === "light" || attr === "dark") {
      return attr;
    }
    if (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) {
      return "dark";
    }
    return "light";
  }

  function createThemeIcon(theme) {
    var span = document.createElement("span");
    span.setAttribute("aria-hidden", "true");
    span.style.display = "inline-flex";
    if (theme === "dark") {
      span.innerHTML =
        '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"></circle><line x1="12" y1="2" x2="12" y2="4"></line><line x1="12" y1="20" x2="12" y2="22"></line><line x1="4.93" y1="4.93" x2="6.34" y2="6.34"></line><line x1="17.66" y1="17.66" x2="19.07" y2="19.07"></line><line x1="2" y1="12" x2="4" y2="12"></line><line x1="20" y1="12" x2="22" y2="12"></line><line x1="6.34" y1="17.66" x2="4.93" y2="19.07"></line><line x1="19.07" y1="4.93" x2="17.66" y2="6.34"></line></svg>';
    } else {
      span.innerHTML =
        '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>';
    }
    return span;
  }

  function updateThemeButton(btn) {
    var current = getCurrentTheme();
    btn.textContent = "";
    btn.appendChild(createThemeIcon(current));
    btn.setAttribute(
      "aria-label",
      current === "dark" ? "Switch to light mode" : "Switch to dark mode"
    );
  }

  function toggleTheme(btn) {
    var next = getCurrentTheme() === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch (e) {
      // Ignore storage failures safely
    }
    updateThemeButton(btn);
  }

  function makeThemeButton() {
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn btn-icon";
    updateThemeButton(btn);
    btn.addEventListener("click", function () {
      toggleTheme(btn);
    });
    return btn;
  }

  /* ---------- progress ---------- */
  function loadProgress() {
    var fallback = { read: [], last: null };
    try {
      var raw = localStorage.getItem(PROGRESS_KEY);
      if (!raw) {
        return fallback;
      }
      var parsed = JSON.parse(raw);
      return {
        read: Array.isArray(parsed.read) ? parsed.read : [],
        last: typeof parsed.last === "string" ? parsed.last : null
      };
    } catch (e) {
      return fallback;
    }
  }

  function saveProgress(data) {
    try {
      localStorage.setItem(PROGRESS_KEY, JSON.stringify(data));
    } catch (e) {
      // Ignore storage failures safely
    }
  }

  function markChapterRead(id) {
    var prog = loadProgress();
    if (prog.read.indexOf(id) === -1) {
      prog.read.push(id);
      saveProgress(prog);
    }
  }

  function setLastChapter(id) {
    var prog = loadProgress();
    prog.last = id;
    saveProgress(prog);
  }

  function isChapterRead(prog, id) {
    return prog.read.indexOf(id) !== -1;
  }

  /* ---------- dynamic script loader (file:// safe, no fetch) ---------- */
  function loadScriptOnce(src, onSuccess, onError) {
    var existing = document.querySelector('script[data-dynamic-src="' + src + '"]');
    if (existing) {
      if (existing.getAttribute("data-loaded") === "1") {
        onSuccess();
      } else if (existing.getAttribute("data-loaded") === "err") {
        onError();
      } else {
        existing.addEventListener("load", onSuccess, { once: true });
        existing.addEventListener("error", onError, { once: true });
      }
      return;
    }
    var script = document.createElement("script");
    script.src = src;
    script.charset = "UTF-8";
    script.setAttribute("data-dynamic-src", src);
    script.addEventListener(
      "load",
      function () {
        script.setAttribute("data-loaded", "1");
        onSuccess();
      },
      { once: true }
    );
    script.addEventListener(
      "error",
      function () {
        script.setAttribute("data-loaded", "err");
        onError();
      },
      { once: true }
    );
    document.head.appendChild(script);
  }

  /* ---------- meaning box (.pop) ---------- */
  var pop = document.createElement("div");
  pop.className = "pop";
  pop.setAttribute("role", "dialog");
  pop.setAttribute("aria-label", "Word meaning");
  pop.hidden = true;

  var popWord = document.createElement("p");
  popWord.className = "pop-word";
  var popMeaning = document.createElement("p");
  popMeaning.className = "pop-meaning";
  var popHearBtn = document.createElement("button");
  popHearBtn.type = "button";
  popHearBtn.className = "btn";
  popHearBtn.textContent = "Hear it";

  pop.appendChild(popWord);
  pop.appendChild(popMeaning);
  pop.appendChild(popHearBtn);
  document.body.appendChild(pop);

  popHearBtn.addEventListener("click", function () {
    if (!hasSpeech() || !state.activeWordBtn) {
      return;
    }
    stopReadAloud();
    var wordText = state.activeWordBtn.textContent || "";
    var meaningText = state.activeWordBtn.getAttribute("data-meaning") || "";
    try {
      window.speechSynthesis.cancel();
      var u1 = new SpeechSynthesisUtterance(wordText);
      u1.lang = "en-GB";
      u1.rate = 0.9;
      var u2 = new SpeechSynthesisUtterance(meaningText);
      u2.lang = "en-GB";
      u2.rate = 0.9;
      window.speechSynthesis.speak(u1);
      window.speechSynthesis.speak(u2);
    } catch (e) {
      // Ignore speech failures
    }
  });

  function closeMeaningBox(restoreFocus) {
    var prevBtn = state.activeWordBtn;
    var buttons = document.querySelectorAll('.word[aria-expanded="true"]');
    for (var i = 0; i < buttons.length; i++) {
      buttons[i].setAttribute("aria-expanded", "false");
    }
    state.activeWordBtn = null;
    pop.hidden = true;
    if (restoreFocus && prevBtn && document.body.contains(prevBtn)) {
      prevBtn.focus();
    }
  }

  function positionMeaningBox(wordBtn) {
    var rect = wordBtn.getBoundingClientRect();
    pop.hidden = false;
    var boxW = pop.offsetWidth;
    var boxH = pop.offsetHeight;

    var left = rect.left + window.scrollX;
    if (left + boxW > window.scrollX + window.innerWidth - 16) {
      left = window.scrollX + window.innerWidth - 16 - boxW;
    }
    if (left < window.scrollX + 16) {
      left = window.scrollX + 16;
    }

    var top = rect.bottom + window.scrollY + 8;
    if (rect.bottom + 8 + boxH > window.innerHeight - 16) {
      top = rect.top + window.scrollY - 8 - boxH;
    }

    pop.style.left = left + "px";
    pop.style.top = top + "px";
  }

  function openMeaningBox(wordBtn) {
    if (state.activeWordBtn === wordBtn && !pop.hidden) {
      closeMeaningBox(false);
      return;
    }
    closeMeaningBox(false);
    wordBtn.setAttribute("aria-expanded", "true");
    state.activeWordBtn = wordBtn;
    popWord.textContent = wordBtn.textContent || "";
    popMeaning.textContent = wordBtn.getAttribute("data-meaning") || "";
    popHearBtn.hidden = !hasSpeech();
    positionMeaningBox(wordBtn);
  }

  document.addEventListener("click", function (event) {
    if (pop.hidden) {
      return;
    }
    var target = event.target;
    if (pop.contains(target)) {
      return;
    }
    if (target && target.closest && target.closest(".word")) {
      return;
    }
    closeMeaningBox(false);
  });

  window.addEventListener("resize", function () {
    if (!pop.hidden) {
      closeMeaningBox(false);
    }
  });

  /* ---------- read aloud ---------- */
  function clearReadingHighlight() {
    var highlighted = document.querySelectorAll(".reading");
    for (var i = 0; i < highlighted.length; i++) {
      highlighted[i].classList.remove("reading");
    }
  }

  function stopReadAloud() {
    state.speechToken += 1;
    state.readingActive = false;
    clearReadingHighlight();
    if (hasSpeech()) {
      try {
        window.speechSynthesis.cancel();
      } catch (e) {
        // Ignore speech cancel error
      }
    }
    var btn = document.getElementById("read-to-me-btn");
    if (btn) {
      btn.textContent = "Read to me";
    }
  }

  function plainTextFromElement(el) {
    return (el.textContent || "").trim();
  }

  function startReadAloud(btn) {
    if (!hasSpeech()) {
      return;
    }
    if (state.readingActive) {
      stopReadAloud();
      return;
    }

    var blocks = [];
    var hookEl = document.querySelector(".hook");
    if (hookEl) {
      blocks.push(hookEl);
    }
    var paraEls = document.querySelectorAll(".story p");
    for (var i = 0; i < paraEls.length; i++) {
      blocks.push(paraEls[i]);
    }
    if (!blocks.length) {
      return;
    }

    try {
      window.speechSynthesis.cancel();
    } catch (e) {
      // Ignore
    }

    state.readingActive = true;
    state.speechToken += 1;
    var token = state.speechToken;
    btn.textContent = "Stop";

    var index = 0;
    function speakNext() {
      if (!state.readingActive || token !== state.speechToken) {
        return;
      }
      if (index >= blocks.length) {
        stopReadAloud();
        return;
      }
      clearReadingHighlight();
      var el = blocks[index];
      var text = plainTextFromElement(el);
      if (!text) {
        index += 1;
        speakNext();
        return;
      }
      el.classList.add("reading");
      el.scrollIntoView({
        block: "center",
        behavior: prefersReducedMotion() ? "auto" : "smooth"
      });

      var utt = new SpeechSynthesisUtterance(text);
      utt.lang = "en-GB";
      utt.rate = 0.9;
      utt.onend = function () {
        if (!state.readingActive || token !== state.speechToken) {
          return;
        }
        index += 1;
        speakNext();
      };
      utt.onerror = function () {
        if (token === state.speechToken) {
          stopReadAloud();
        }
      };
      try {
        window.speechSynthesis.speak(utt);
      } catch (e) {
        stopReadAloud();
      }
    }

    speakNext();
  }

  /* ---------- original text panel ---------- */
  function closeOriginalPanel() {
    if (state.originalPanel && state.originalPanel.parentNode) {
      state.originalPanel.parentNode.removeChild(state.originalPanel);
    }
    state.originalPanel = null;
    if (state.originalTrigger && document.body.contains(state.originalTrigger)) {
      state.originalTrigger.focus();
    }
    state.originalTrigger = null;
  }

  function openOriginalPanel(originalData, triggerBtn) {
    closeOriginalPanel();
    closeMeaningBox(false);
    stopReadAloud();

    state.originalTrigger = triggerBtn;

    var panel = document.createElement("div");
    panel.className = "original";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "true");
    panel.setAttribute("aria-label", "Original book text");

    var inner = document.createElement("div");
    inner.className = "original-inner";

    var closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "btn";
    closeBtn.textContent = "Close";
    closeBtn.addEventListener("click", closeOriginalPanel);

    var note = document.createElement("p");
    note.className = "original-note";
    note.textContent = "This is the original text from " + book.year + ". Some words are old.";

    var heading = document.createElement("h2");
    heading.className = "original-title";
    heading.textContent = originalData.title || "";

    var body = document.createElement("div");
    body.className = "original-text";
    body.textContent = originalData.text || "";

    inner.appendChild(closeBtn);
    inner.appendChild(note);
    inner.appendChild(heading);
    inner.appendChild(body);
    panel.appendChild(inner);

    document.body.appendChild(panel);
    state.originalPanel = panel;
    closeBtn.focus();
  }

  document.addEventListener("keydown", function (event) {
    if (event.key !== "Escape") {
      return;
    }
    if (state.originalPanel) {
      event.preventDefault();
      closeOriginalPanel();
      return;
    }
    if (!pop.hidden) {
      event.preventDefault();
      closeMeaningBox(true);
    }
  });

  /* ---------- helpers ---------- */
  function createTopBar(leftBtn, titleText, rightButtons) {
    var header = document.createElement("header");
    header.className = "topbar";

    if (leftBtn) {
      header.appendChild(leftBtn);
    }

    var title = document.createElement("span");
    title.className = "topbar-title";
    title.textContent = titleText;
    header.appendChild(title);

    if (rightButtons) {
      for (var i = 0; i < rightButtons.length; i++) {
        header.appendChild(rightButtons[i]);
      }
    }
    header.appendChild(makeThemeButton());
    return header;
  }

  function makeButton(label, cls, onClick) {
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = cls ? "btn " + cls : "btn";
    btn.textContent = label;
    btn.addEventListener("click", onClick);
    return btn;
  }

  function createPictureElement(src, alt, wrapperClass, width, height) {
    var figure = document.createElement("figure");
    figure.className = wrapperClass;

    var img = document.createElement("img");
    img.src = src;
    img.alt = alt;
    img.width = width;
    img.height = height;
    img.addEventListener("error", function () {
      var missing = document.createElement("div");
      missing.className = "pic-missing";
      missing.textContent = alt;
      figure.textContent = "";
      figure.appendChild(missing);
    });

    figure.appendChild(img);
    return figure;
  }

  function buildParagraphElement(rawText) {
    var p = document.createElement("p");
    WORD_MARKER_RE.lastIndex = 0;
    var lastIdx = 0;
    var match;

    while ((match = WORD_MARKER_RE.exec(rawText)) !== null) {
      if (match.index > lastIdx) {
        p.appendChild(document.createTextNode(rawText.slice(lastIdx, match.index)));
      }
      var wordBtn = document.createElement("button");
      wordBtn.type = "button";
      wordBtn.className = "word";
      wordBtn.setAttribute("aria-expanded", "false");
      wordBtn.setAttribute("data-meaning", match[2]);
      wordBtn.textContent = match[1];
      wordBtn.addEventListener("click", function (ev) {
        ev.stopPropagation();
        openMeaningBox(this);
      });
      p.appendChild(wordBtn);
      lastIdx = WORD_MARKER_RE.lastIndex;
    }

    if (lastIdx < rawText.length) {
      p.appendChild(document.createTextNode(rawText.slice(lastIdx)));
    }
    return p;
  }

  function cleanupChapterState() {
    stopReadAloud();
    closeMeaningBox(false);
    closeOriginalPanel();
    if (state.observer) {
      state.observer.disconnect();
      state.observer = null;
    }
  }

  function findReadyChapters() {
    var list = [];
    for (var i = 0; i < book.chapters.length; i++) {
      if (book.chapters[i].ready) {
        list.push(book.chapters[i]);
      }
    }
    return list;
  }

  function findChapterMeta(id) {
    for (var i = 0; i < book.chapters.length; i++) {
      if (book.chapters[i].id === id) {
        return book.chapters[i];
      }
    }
    return null;
  }

  /* ---------- SCREEN 1: START ---------- */
  function renderStart() {
    cleanupChapterState();
    state.screen = "start";
    state.chapterId = null;

    var prog = loadProgress();
    var ready = findReadyChapters();
    var continueChapter = null;

    if (prog.last) {
      var lastMeta = findChapterMeta(prog.last);
      if (lastMeta && lastMeta.ready) {
        continueChapter = lastMeta;
      }
    }
    if (!continueChapter && prog.read.length > 0 && ready.length > 0) {
      for (var i = 0; i < ready.length; i++) {
        if (!isChapterRead(prog, ready[i].id)) {
          continueChapter = ready[i];
          break;
        }
      }
      if (!continueChapter) {
        continueChapter = ready[ready.length - 1];
      }
    }

    var fragment = document.createDocumentFragment();
    fragment.appendChild(createTopBar(null, book.title, null));

    var main = document.createElement("main");
    main.className = "page";

    if (book.cover && book.cover.image) {
      main.appendChild(
        createPictureElement(book.cover.image, book.cover.alt || book.title, "cover-pic", 1024, 768)
      );
    }

    var h1 = document.createElement("h1");
    h1.className = "start-title";
    h1.textContent = book.title;
    main.appendChild(h1);

    var credit = document.createElement("p");
    credit.className = "credit";
    credit.appendChild(
      document.createTextNode(
        "Retold from " + book.title + " by " + book.author + " (" + book.year + ")."
      )
    );
    if (book.extraCredit && book.extraCredit.toLowerCase() !== "none") {
      credit.appendChild(document.createElement("br"));
      credit.appendChild(document.createTextNode(book.extraCredit));
    }
    main.appendChild(credit);

    var actions = document.createElement("div");
    actions.className = "start-actions";

    if (continueChapter) {
      actions.appendChild(
        makeButton(
          "Continue: Chapter " + Number(continueChapter.id),
          "btn-primary",
          function () {
            openChapter(continueChapter.id);
          }
        )
      );
    } else if (ready.length > 0) {
      actions.appendChild(
        makeButton("Start reading", "btn-primary", function () {
          openChapter(ready[0].id);
        })
      );
    }

    actions.appendChild(
      makeButton("All chapters", "", renderMenu)
    );
    main.appendChild(actions);

    var studioWrap = document.createElement("p");
    studioWrap.className = "studio-link-wrap";
    var studioLink = document.createElement("a");
    studioLink.className = "studio-link";
    studioLink.href = STUDIO_URL;
    studioLink.textContent = "Awwfy Studios";
    studioLink.target = "_blank";
    studioLink.rel = "noopener noreferrer";
    studioWrap.appendChild(studioLink);
    main.appendChild(studioWrap);

    fragment.appendChild(main);
    app.textContent = "";
    app.appendChild(fragment);
    window.scrollTo(0, 0);
  }

  /* ---------- SCREEN 2: CHAPTER MENU ---------- */
  function renderMenu() {
    cleanupChapterState();
    state.screen = "menu";
    state.chapterId = null;

    var prog = loadProgress();
    var readyCount = 0;
    var readReadyCount = 0;
    for (var i = 0; i < book.chapters.length; i++) {
      var ch = book.chapters[i];
      if (ch.ready) {
        readyCount += 1;
        if (isChapterRead(prog, ch.id)) {
          readReadyCount += 1;
        }
      }
    }

    var fragment = document.createDocumentFragment();
    var backBtn = makeButton("Back", "", renderStart);
    fragment.appendChild(createTopBar(backBtn, "Chapters", null));

    var main = document.createElement("main");
    main.className = "page";

    var progressLine = document.createElement("p");
    progressLine.className = "menu-progress";
    progressLine.textContent =
      readReadyCount + " of " + book.chapters.length + " chapters read";
    main.appendChild(progressLine);

    var list = document.createElement("div");
    list.className = "menu-list";

    for (var j = 0; j < book.chapters.length; j++) {
      (function (item) {
        var row = document.createElement("button");
        row.type = "button";
        row.className = "menu-row";

        var num = document.createElement("span");
        num.className = "menu-num";
        num.textContent = String(Number(item.id));

        var title = document.createElement("span");
        title.className = "menu-title";
        title.textContent = item.title;

        var status = document.createElement("span");
        status.className = "menu-status";

        if (!item.ready) {
          row.disabled = true;
          status.classList.add("is-soon");
          status.textContent = "Coming soon";
        } else if (isChapterRead(prog, item.id)) {
          status.classList.add("is-read");
          status.textContent = "Read";
        } else {
          status.textContent = "Start";
        }

        row.appendChild(num);
        row.appendChild(title);
        row.appendChild(status);

        if (item.ready) {
          row.addEventListener("click", function () {
            openChapter(item.id);
          });
        }
        list.appendChild(row);
      })(book.chapters[j]);
    }

    main.appendChild(list);
    fragment.appendChild(main);
    app.textContent = "";
    app.appendChild(fragment);
    window.scrollTo(0, 0);
  }

  /* ---------- SCREEN 3: CHAPTER PAGE ---------- */
  function renderChapterError(titleText) {
    var fragment = document.createDocumentFragment();
    var menuBtn = makeButton("Menu", "", renderMenu);
    fragment.appendChild(createTopBar(menuBtn, titleText || book.title, null));

    var main = document.createElement("main");
    main.className = "page";

    var msg = document.createElement("p");
    msg.className = "status-msg";
    msg.textContent = "This chapter could not open. Please go back and try again.";
    main.appendChild(msg);

    main.appendChild(makeButton("Back", "", renderMenu));
    fragment.appendChild(main);
    app.textContent = "";
    app.appendChild(fragment);
  }

  function renderChapterContent(id, chapter, originalData) {
    var meta = findChapterMeta(id);
    var chapterTitle = chapter.title || (meta ? meta.title : "Chapter " + Number(id));

    var rightButtons = [];
    if (hasSpeech()) {
      var readBtn = makeButton("Read to me", "", function () {
        startReadAloud(readBtn);
      });
      readBtn.id = "read-to-me-btn";
      rightButtons.push(readBtn);
    }

    var fragment = document.createDocumentFragment();
    var menuBtn = makeButton("Menu", "", renderMenu);
    fragment.appendChild(createTopBar(menuBtn, chapterTitle, rightButtons));

    var main = document.createElement("main");
    main.className = "page";

    var label = document.createElement("p");
    label.className = "label";
    label.textContent = "Chapter " + Number(id);
    main.appendChild(label);

    var h1 = document.createElement("h1");
    h1.className = "chapter-title";
    h1.textContent = chapterTitle;
    main.appendChild(h1);

    var hook = document.createElement("p");
    hook.className = "hook";
    hook.textContent = chapter.hook || "";
    main.appendChild(hook);

    var story = document.createElement("div");
    story.className = "story";
    story.appendChild(
      createPictureElement(chapter.image, chapter.alt || chapterTitle, "story-pic", 1024, 768)
    );

    var paragraphs = Array.isArray(chapter.paragraphs) ? chapter.paragraphs : [];
    for (var i = 0; i < paragraphs.length; i++) {
      story.appendChild(buildParagraphElement(paragraphs[i]));
    }
    main.appendChild(story);

    var endBox = document.createElement("div");
    endBox.className = "chapter-end";

    var currentIndex = -1;
    for (var k = 0; k < book.chapters.length; k++) {
      if (book.chapters[k].id === id) {
        currentIndex = k;
        break;
      }
    }
    var nextMeta = currentIndex >= 0 && currentIndex + 1 < book.chapters.length
      ? book.chapters[currentIndex + 1]
      : null;

    if (nextMeta && nextMeta.ready) {
      endBox.appendChild(
        makeButton("Next chapter", "btn-primary", function () {
          markChapterRead(id);
          openChapter(nextMeta.id);
        })
      );
    }

    endBox.appendChild(makeButton("All chapters", "", renderMenu));

    if (book.showOriginal && originalData) {
      var origBtn = makeButton("Read the real book", "", function () {
        openOriginalPanel(originalData, origBtn);
      });
      endBox.appendChild(origBtn);
    }

    main.appendChild(endBox);
    fragment.appendChild(main);

    app.textContent = "";
    app.appendChild(fragment);
    window.scrollTo(0, 0);

    setLastChapter(id);

    if ("IntersectionObserver" in window) {
      state.observer = new IntersectionObserver(
        function (entries) {
          for (var idx = 0; idx < entries.length; idx++) {
            if (entries[idx].isIntersecting) {
              markChapterRead(id);
              if (state.observer) {
                state.observer.disconnect();
                state.observer = null;
              }
              break;
            }
          }
        },
        { threshold: 0.1 }
      );
      state.observer.observe(endBox);
    }
  }

  function openChapter(id) {
    cleanupChapterState();
    state.screen = "chapter";
    state.chapterId = id;

    var meta = findChapterMeta(id);
    var headerTitle = meta ? meta.title : "Chapter " + Number(id);

    var loadingFrag = document.createDocumentFragment();
    loadingFrag.appendChild(createTopBar(makeButton("Menu", "", renderMenu), headerTitle, null));
    var loadingMain = document.createElement("main");
    loadingMain.className = "page";
    var loadingMsg = document.createElement("p");
    loadingMsg.className = "status-msg";
    loadingMsg.textContent = "Loading...";
    loadingMain.appendChild(loadingMsg);
    loadingFrag.appendChild(loadingMain);
    app.textContent = "";
    app.appendChild(loadingFrag);

    var chapterDone = false;
    var originalDone = !book.showOriginal;
    var chapterFailed = false;

    function maybeFinish() {
      if (!chapterDone || !originalDone) {
        return;
      }
      if (state.screen !== "chapter" || state.chapterId !== id) {
        return;
      }
      var chaptersObj = window.AWWFY_CHAPTERS || {};
      var chapterData = chaptersObj[id];
      if (chapterFailed || !chapterData) {
        renderChapterError(headerTitle);
        return;
      }
      var originalsObj = window.AWWFY_ORIGINALS || {};
      var originalData = book.showOriginal ? originalsObj[id] || null : null;
      renderChapterContent(id, chapterData, originalData);
    }

    var chaptersObj = window.AWWFY_CHAPTERS || {};
    if (chaptersObj[id]) {
      chapterDone = true;
    } else {
      loadScriptOnce(
        "js/chapters/ch" + id + ".js",
        function () {
          chapterDone = true;
          maybeFinish();
        },
        function () {
          chapterFailed = true;
          chapterDone = true;
          maybeFinish();
        }
      );
    }

    if (book.showOriginal) {
      var originalsObj = window.AWWFY_ORIGINALS || {};
      if (originalsObj[id]) {
        originalDone = true;
      } else {
        loadScriptOnce(
          "js/originals/ch" + id + ".js",
          function () {
            originalDone = true;
            maybeFinish();
          },
          function () {
            originalDone = true;
            maybeFinish();
          }
        );
      }
    }

    maybeFinish();
  }

  renderStart();
})();
