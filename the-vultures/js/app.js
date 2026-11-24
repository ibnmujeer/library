(function () {
  "use strict";

  var BOOK = window.AWWFY_BOOK;
  var APP = document.getElementById("app");
  var SVG_NS = "http://www.w3.org/2000/svg";

  var THEME_KEY = "awwfy-theme";
  var READER_KEY = "awwfy-reader";
  var PROGRESS_KEY = "awwfy-" + BOOK.slug + "-progress";

  var SIZES = [17, 19, 21, 24, 28];
  var HAS_SPEECH = typeof window.speechSynthesis !== "undefined" && typeof window.SpeechSynthesisUtterance !== "undefined";
  var HAS_FULLSCREEN = !!(document.documentElement && document.documentElement.requestFullscreen);

  var state = {
    screen: "start",
    chapterId: null,
    chapterData: null,
    originalData: null,
    page: 0,
    totalPages: 1,
    step: 0,
    firstTurnDone: false,
    barsHidden: false,
    topOnly: true,
    openPanel: null,
    readingAloud: false,
    speechIndex: -1,
    endFired: false,
    paraNodes: [],
    paraWords: [],
    totalWords: 0,
    activeWordBtn: null,
    lastRealBookBtn: null
  };

  /* ---------- storage helpers ---------- */
  function readJSON(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      if (!raw) return fallback;
      var parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : fallback;
    } catch (e) {
      return fallback;
    }
  }

  function writeJSON(key, val) {
    try {
      localStorage.setItem(key, JSON.stringify(val));
    } catch (e) {}
  }

  function getSettings() {
    var def = { size: 21, font: "classic", line: 1.6, speed: "normal" };
    var saved = readJSON(READER_KEY, null);
    if (!saved) return def;
    return {
      size: SIZES.indexOf(saved.size) !== -1 ? saved.size : def.size,
      font: saved.font === "simple" ? "simple" : "classic",
      line: [1.4, 1.6, 1.9].indexOf(saved.line) !== -1 ? saved.line : def.line,
      speed: saved.speed === "slow" ? "slow" : "normal"
    };
  }

  function saveSettings(s) {
    writeJSON(READER_KEY, s);
  }

  function getProgress() {
    var def = { read: [], lastChapter: null, lastPara: 0 };
    var saved = readJSON(PROGRESS_KEY, null);
    if (!saved) return def;
    return {
      read: Array.isArray(saved.read) ? saved.read : [],
      lastChapter: typeof saved.lastChapter === "string" ? saved.lastChapter : null,
      lastPara: typeof saved.lastPara === "number" && saved.lastPara >= 0 ? saved.lastPara : 0
    };
  }

  function saveProgress(p) {
    writeJSON(PROGRESS_KEY, p);
  }

  /* ---------- theme ---------- */
  function getTheme() {
    var attr = document.documentElement.getAttribute("data-theme");
    if (attr === "light" || attr === "dark" || attr === "sepia") return attr;
    if (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) {
      return "dark";
    }
    return "light";
  }

  function setTheme(theme) {
    if (theme !== "light" && theme !== "dark" && theme !== "sepia") return;
    document.documentElement.setAttribute("data-theme", theme);
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch (e) {}
    updateThemeButtons();
  }

  function toggleTheme() {
    var cur = getTheme();
    setTheme(cur === "dark" ? "light" : "dark");
  }

  /* ---------- DOM and SVG helpers ---------- */
  function el(tag, attrs, text) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === "className") node.className = attrs[k];
        else if (k === "disabled") node.disabled = !!attrs[k];
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function makeSvg(paths) {
    var svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "2");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
    svg.setAttribute("aria-hidden", "true");
    paths.forEach(function (def) {
      var child = document.createElementNS(SVG_NS, def[0]);
      var attrs = def[1];
      Object.keys(attrs).forEach(function (k) {
        child.setAttribute(k, attrs[k]);
      });
      svg.appendChild(child);
    });
    return svg;
  }

  var ICONS = {
    moon: function () {
      return makeSvg([["path", { d: "M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" }]]);
    },
    sun: function () {
      return makeSvg([
        ["circle", { cx: "12", cy: "12", r: "4" }],
        ["path", { d: "M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" }]
      ]);
    },
    back: function () {
      return makeSvg([["path", { d: "M15 18l-6-6 6-6" }]]);
    },
    next: function () {
      return makeSvg([["path", { d: "M9 18l6-6-6-6" }]]);
    },
    contents: function () {
      return makeSvg([
        ["path", { d: "M4 6h16M4 12h16M4 18h10" }]
      ]);
    },
    aa: function () {
      return makeSvg([
        ["path", { d: "M3 18l5-12 5 12M5 14h6" }],
        ["path", { d: "M15 18v-6a3 3 0 0 1 6 0v6M15 15h6" }]
      ]);
    },
    speak: function () {
      return makeSvg([
        ["polygon", { points: "11 5 6 9 2 9 2 15 6 15 11 19 11 5" }],
        ["path", { d: "M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" }]
      ]);
    },
    stop: function () {
      return makeSvg([
        ["rect", { x: "6", y: "6", width: "12", height: "12", rx: "2" }]
      ]);
    },
    fullscreen: function () {
      return makeSvg([
        ["path", { d: "M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3" }]
      ]);
    },
    exitFullscreen: function () {
      return makeSvg([
        ["path", { d: "M8 3v3a2 2 0 0 1-2 2H3M21 8h-3a2 2 0 0 1-2-2V3M3 16h3a2 2 0 0 1 2 2v3M16 21v-3a2 2 0 0 1 2-2h3" }]
      ]);
    }
  };

  function makeThemeButton() {
    var btn = el("button", { type: "button", className: "btn btn-icon js-theme-btn" });
    btn.addEventListener("click", toggleTheme);
    renderThemeBtn(btn);
    return btn;
  }

  function renderThemeBtn(btn) {
    var dark = getTheme() === "dark";
    btn.textContent = "";
    btn.appendChild(dark ? ICONS.sun() : ICONS.moon());
    btn.setAttribute("aria-label", dark ? "Switch to light mode" : "Switch to dark mode");
  }

  function updateThemeButtons() {
    var btns = document.querySelectorAll(".js-theme-btn");
    for (var i = 0; i < btns.length; i++) renderThemeBtn(btns[i]);
    var themeSegs = document.querySelectorAll("[data-set-theme]");
    var cur = getTheme();
    for (var j = 0; j < themeSegs.length; j++) {
      themeSegs[j].setAttribute("aria-pressed", themeSegs[j].getAttribute("data-set-theme") === cur ? "true" : "false");
    }
  }

  /* ---------- meaning box (.pop) ---------- */
  var popBox = null;
  var popWordEl = null;
  var popMeaningEl = null;
  var popHearBtn = null;

  function ensurePopBox() {
    if (popBox) return popBox;
    popBox = el("div", { className: "pop hidden", role: "dialog", "aria-label": "Word meaning" });
    popWordEl = el("p", { className: "pop-word" });
    popMeaningEl = el("p", { className: "pop-meaning" });
    popBox.appendChild(popWordEl);
    popBox.appendChild(popMeaningEl);
    if (HAS_SPEECH) {
      popHearBtn = el("button", { type: "button", className: "btn" }, "Hear it");
      popHearBtn.addEventListener("click", function (e) {
        e.stopPropagation();
        if (!state.activeWordBtn) return;
        speakWordAndMeaning(state.activeWordBtn.textContent, state.activeWordBtn.getAttribute("data-meaning") || "");
      });
      popBox.appendChild(popHearBtn);
    }
    document.body.appendChild(popBox);
    return popBox;
  }

  function speakWordAndMeaning(word, meaning) {
    if (!HAS_SPEECH) return;
    stopReadAloud();
    try {
      window.speechSynthesis.cancel();
      var u1 = new SpeechSynthesisUtterance(word);
      u1.lang = "en-GB";
      u1.rate = 0.85;
      var u2 = new SpeechSynthesisUtterance(meaning);
      u2.lang = "en-GB";
      u2.rate = 0.9;
      window.speechSynthesis.speak(u1);
      window.speechSynthesis.speak(u2);
    } catch (e) {}
  }

  function openMeaningBox(wordBtn) {
    ensurePopBox();
    if (state.activeWordBtn === wordBtn && !popBox.classList.contains("hidden")) {
      closeMeaningBox(false);
      return;
    }
    var allWords = document.querySelectorAll(".word[aria-expanded='true']");
    for (var i = 0; i < allWords.length; i++) {
      allWords[i].setAttribute("aria-expanded", "false");
    }
    state.activeWordBtn = wordBtn;
    wordBtn.setAttribute("aria-expanded", "true");
    popWordEl.textContent = wordBtn.textContent;
    popMeaningEl.textContent = wordBtn.getAttribute("data-meaning") || "";
    popBox.classList.remove("hidden");

    var rect = wordBtn.getBoundingClientRect();
    var boxW = popBox.offsetWidth;
    var boxH = popBox.offsetHeight;
    var left = rect.left;
    if (left + boxW > window.innerWidth - 16) left = window.innerWidth - 16 - boxW;
    if (left < 16) left = 16;
    var top = rect.bottom + 8;
    if (top + boxH > window.innerHeight - 16) top = rect.top - 8 - boxH;
    if (top < 16) top = 16;
    popBox.style.left = Math.round(left) + "px";
    popBox.style.top = Math.round(top) + "px";
  }

  function closeMeaningBox(returnFocus) {
    if (!popBox || popBox.classList.contains("hidden")) return;
    popBox.classList.add("hidden");
    var prev = state.activeWordBtn;
    if (prev) {
      prev.setAttribute("aria-expanded", "false");
      state.activeWordBtn = null;
      if (returnFocus) prev.focus();
    }
  }

  /* ---------- script loader (no fetch) ---------- */
  function loadScript(src, onLoad, onError) {
    var existing = document.querySelector('script[data-dynamic-src="' + src + '"]');
    if (existing) {
      onLoad();
      return;
    }
    var s = document.createElement("script");
    s.src = src;
    s.setAttribute("data-dynamic-src", src);
    s.onload = function () { onLoad(); };
    s.onerror = function () {
      if (s.parentNode) s.parentNode.removeChild(s);
      onError();
    };
    document.body.appendChild(s);
  }

  /* ---------- helpers ---------- */
  function getChapterMeta(id) {
    for (var i = 0; i < BOOK.chapters.length; i++) {
      if (BOOK.chapters[i].id === id) return BOOK.chapters[i];
    }
    return null;
  }

  function getChapterIndex(id) {
    for (var i = 0; i < BOOK.chapters.length; i++) {
      if (BOOK.chapters[i].id === id) return i;
    }
    return -1;
  }

  function getReadyChapters() {
    return BOOK.chapters.filter(function (c) { return c.ready; });
  }

  function chapterDisplayNum(id) {
    var n = parseInt(id, 10);
    return isNaN(n) ? id : String(n);
  }

  function stripMarkers(text) {
    return text.replace(/\[\[([^|\]]+)\|([^\]]+)\]\]/g, "$1");
  }

  function countWords(text) {
    var clean = stripMarkers(text).trim();
    if (!clean) return 0;
    return clean.split(/\s+/).length;
  }

  function buildParagraphNode(text) {
    var p = document.createElement("p");
    var re = /\[\[([^|\]]+)\|([^\]]+)\]\]/g;
    var lastIndex = 0;
    var match;
    while ((match = re.exec(text)) !== null) {
      if (match.index > lastIndex) {
        p.appendChild(document.createTextNode(text.slice(lastIndex, match.index)));
      }
      var btn = el("button", {
        type: "button",
        className: "word",
        "aria-expanded": "false",
        "data-meaning": match[2]
      }, match[1]);
      btn.addEventListener("click", function (e) {
        e.stopPropagation();
        openMeaningBox(this);
      });
      p.appendChild(btn);
      lastIndex = re.lastIndex;
    }
    if (lastIndex < text.length) {
      p.appendChild(document.createTextNode(text.slice(lastIndex)));
    }
    return p;
  }

  function makeImageFigure(cls, src, alt, w, h) {
    var fig = el("figure", { className: cls });
    var img = el("img", { src: src, alt: alt, width: String(w), height: String(h) });
    img.addEventListener("error", function () {
      fig.textContent = "";
      fig.appendChild(el("div", { className: "pic-missing" }, alt));
    });
    fig.appendChild(img);
    return fig;
  }

  /* ---------- SCREEN 1: START ---------- */
  function renderStart() {
    cleanupReader();
    state.screen = "start";
    APP.textContent = "";

    var topbar = el("header", { className: "topbar" });
    topbar.appendChild(el("div", { className: "topbar-title" }, BOOK.title));
    topbar.appendChild(makeThemeButton());
    APP.appendChild(topbar);

    var page = el("main", { className: "page" });
    page.appendChild(makeImageFigure("cover-pic", BOOK.cover.image, BOOK.cover.alt, 1024, 768));
    page.appendChild(el("h1", { className: "start-title" }, BOOK.title));

    var credit = el("p", { className: "start-credit" }, "Retold from " + BOOK.title + " by " + BOOK.author + " (" + BOOK.year + ").");
    if (BOOK.translator) {
      credit.appendChild(document.createElement("br"));
      credit.appendChild(document.createTextNode("Translated by " + BOOK.translator + "."));
    }
    page.appendChild(credit);

    var prog = getProgress();
    var ready = getReadyChapters();
    var resumeMeta = prog.lastChapter ? getChapterMeta(prog.lastChapter) : null;
    if (!resumeMeta || !resumeMeta.ready) resumeMeta = null;

    var btnRow = el("div", { className: "btn-row" });
    var primaryLabel = resumeMeta ? "Continue: Chapter " + chapterDisplayNum(resumeMeta.id) : "Start reading";
    var startBtn = el("button", { type: "button", className: "btn btn-primary" }, primaryLabel);
    startBtn.addEventListener("click", function () {
      if (resumeMeta) {
        openChapter(resumeMeta.id, { targetPara: prog.lastPara });
      } else if (ready.length > 0) {
        openChapter(ready[0].id, { page: 0 });
      }
    });
    btnRow.appendChild(startBtn);

    var allBtn = el("button", { type: "button", className: "btn" }, "All chapters");
    allBtn.addEventListener("click", renderMenu);
    btnRow.appendChild(allBtn);
    page.appendChild(btnRow);

    page.appendChild(el("p", { className: "start-level" }, "Reading level: " + BOOK.level));
    page.appendChild(el("p", { className: "start-note" }, "Your place is saved on this device only."));

    var moreWrap = el("p", { className: "more-wrap" });
    moreWrap.appendChild(el("a", { className: "more-link", href: "https://awwfy.com/reader/" }, "More books in the Awwfy Reader"));
    page.appendChild(moreWrap);

    APP.appendChild(page);
    window.scrollTo(0, 0);
  }

  /* ---------- SCREEN 2: CHAPTER MENU ---------- */
  function buildChapterList(currentId, onSelect) {
    var prog = getProgress();
    var list = el("div", { className: "chapter-list" });
    BOOK.chapters.forEach(function (ch) {
      var isRead = prog.read.indexOf(ch.id) !== -1;
      var statusText = !ch.ready ? "Coming soon" : (isRead ? "Read" : "Start");
      var statusCls = "chapter-status" + (isRead ? " is-read" : (ch.ready ? " is-start" : ""));
      var row = el("button", {
        type: "button",
        className: "chapter-row",
        disabled: !ch.ready,
        "aria-current": currentId === ch.id ? "true" : null
      });
      row.appendChild(el("span", { className: "chapter-num" }, chapterDisplayNum(ch.id)));
      row.appendChild(el("span", { className: "chapter-row-title" }, ch.title));
      row.appendChild(el("span", { className: statusCls }, statusText));
      if (ch.ready) {
        row.addEventListener("click", function () { onSelect(ch.id); });
      }
      list.appendChild(row);
    });
    return list;
  }

  function renderMenu() {
    cleanupReader();
    state.screen = "menu";
    APP.textContent = "";

    var topbar = el("header", { className: "topbar" });
    var backBtn = el("button", { type: "button", className: "btn" }, "Back");
    backBtn.addEventListener("click", renderStart);
    topbar.appendChild(backBtn);
    topbar.appendChild(el("div", { className: "topbar-title" }, "Chapters"));
    topbar.appendChild(makeThemeButton());
    APP.appendChild(topbar);

    var page = el("main", { className: "page" });
    var prog = getProgress();
    var readCount = BOOK.chapters.filter(function (c) {
      return c.ready && prog.read.indexOf(c.id) !== -1;
    }).length;
    page.appendChild(el("p", { className: "progress-line" }, readCount + " of " + BOOK.chapters.length + " chapters read"));
    page.appendChild(buildChapterList(null, function (id) {
      openChapter(id, { page: 0 });
    }));

    APP.appendChild(page);
    window.scrollTo(0, 0);
  }

  /* ---------- SCREEN 3: READING SCREEN ---------- */
  var readerRefs = null;
  var resizeTimer = null;

  function cleanupReader() {
    stopReadAloud();
    closeMeaningBox(false);
    closeOriginalPanel(false);
    if (resizeTimer) {
      clearTimeout(resizeTimer);
      resizeTimer = null;
    }
    readerRefs = null;
    state.openPanel = null;
    state.paraNodes = [];
    state.paraWords = [];
  }

  function applyReaderSettings(readerEl, settings) {
    readerEl.style.setProperty("--read-size", settings.size + "px");
    readerEl.style.setProperty("--read-font", settings.font === "simple" ? "var(--font)" : "var(--serif)");
    readerEl.style.setProperty("--read-line", String(settings.line));
  }

  function openChapter(id, opts) {
    cleanupReader();
    state.screen = "reader";
    state.chapterId = id;
    state.chapterData = null;
    state.originalData = null;
    state.page = 0;
    state.totalPages = 1;
    state.firstTurnDone = false;
    state.barsHidden = false;
    state.topOnly = true;
    state.openPanel = null;
    opts = opts || {};

    var meta = getChapterMeta(id);
    APP.textContent = "";

    var reader = el("div", { className: "reader top-only" });
    var settings = getSettings();
    applyReaderSettings(reader, settings);

    /* 1. reader-top */
    var rTop = el("div", { className: "reader-top" });
    var backBtn = el("button", { type: "button", className: "btn btn-icon reader-back", "aria-label": "Chapters" });
    backBtn.appendChild(ICONS.back());
    backBtn.appendChild(el("span", { className: "reader-back-label" }, "Chapters"));
    backBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      renderMenu();
    });
    rTop.appendChild(backBtn);

    var topTitle = el("div", { className: "topbar-title" }, meta ? meta.title : "Chapter");
    rTop.appendChild(topTitle);

    var contentsBtn = el("button", { type: "button", className: "btn btn-icon", "aria-label": "Contents" });
    contentsBtn.appendChild(ICONS.contents());
    contentsBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      togglePanel("contents");
    });
    rTop.appendChild(contentsBtn);

    var aaBtn = el("button", { type: "button", className: "btn btn-icon", "aria-label": "Text settings" });
    aaBtn.appendChild(ICONS.aa());
    aaBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      togglePanel("aa");
    });
    rTop.appendChild(aaBtn);

    var readBtn = null;
    if (HAS_SPEECH) {
      readBtn = el("button", { type: "button", className: "btn btn-icon", "aria-label": "Read to me" });
      readBtn.appendChild(ICONS.speak());
      readBtn.addEventListener("click", function (e) {
        e.stopPropagation();
        if (state.readingAloud) stopReadAloud();
        else startReadAloud();
      });
      rTop.appendChild(readBtn);
    }

    var fsBtn = null;
    if (HAS_FULLSCREEN) {
      fsBtn = el("button", { type: "button", className: "btn btn-icon", "aria-label": "Full screen" });
      fsBtn.appendChild(ICONS.fullscreen());
      fsBtn.addEventListener("click", function (e) {
        e.stopPropagation();
        toggleFullscreen();
      });
      rTop.appendChild(fsBtn);
    }
    reader.appendChild(rTop);

    /* 2. run-head */
    var runHead = el("p", { className: "run-head" }, BOOK.title + " | " + (meta ? meta.title : ""));
    reader.appendChild(runHead);

    /* 3. viewport + flow */
    var viewport = el("div", { className: "viewport" });
    var loadingBox = el("div", { className: "reader-msg" }, "Loading...");
    viewport.appendChild(loadingBox);
    reader.appendChild(viewport);

    /* 4. page-status */
    var pageStatus = el("div", { className: "page-status" });
    var prevBtn = el("button", { type: "button", className: "btn btn-icon page-btn", "aria-label": "Previous page" });
    prevBtn.appendChild(ICONS.back());
    prevBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      turnPage(-1);
    });
    var pageMeta = el("div", { className: "page-meta" });
    var pageNumEl = el("span", null, "Page 1 of 1");
    var timeLeftEl = el("span", null, "");
    pageMeta.appendChild(pageNumEl);
    pageMeta.appendChild(timeLeftEl);

    var nextBtn = el("button", { type: "button", className: "btn btn-icon page-btn", "aria-label": "Next page" });
    nextBtn.appendChild(ICONS.next());
    nextBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      turnPage(1);
    });

    pageStatus.appendChild(prevBtn);
    pageStatus.appendChild(pageMeta);
    pageStatus.appendChild(nextBtn);
    reader.appendChild(pageStatus);

    /* 5. reader-bottom */
    var rBottom = el("div", { className: "reader-bottom" });
    var scrub = el("input", { type: "range", className: "scrub", "aria-label": "Page", min: "1", max: "1", value: "1" });
    scrub.addEventListener("input", function () {
      var target = parseInt(scrub.value, 10) - 1;
      if (!isNaN(target)) {
        stopReadAloud();
        goToPage(target, false);
      }
    });
    rBottom.appendChild(scrub);

    var bottomRow = el("div", { className: "bottom-row" });
    var chPosEl = el("span", null, "Chapter " + chapterDisplayNum(id) + " of " + BOOK.chapters.length);
    var pctEl = el("span", null, "0% of book");
    bottomRow.appendChild(chPosEl);
    bottomRow.appendChild(pctEl);
    rBottom.appendChild(bottomRow);
    reader.appendChild(rBottom);

    /* panels container */
    var panelHost = el("div");
    reader.appendChild(panelHost);

    APP.appendChild(reader);

    readerRefs = {
      reader: reader,
      viewport: viewport,
      flow: null,
      runHead: runHead,
      topTitle: topTitle,
      pageNumEl: pageNumEl,
      timeLeftEl: timeLeftEl,
      prevBtn: prevBtn,
      nextBtn: nextBtn,
      scrub: scrub,
      chPosEl: chPosEl,
      pctEl: pctEl,
      readBtn: readBtn,
      fsBtn: fsBtn,
      panelHost: panelHost,
      realBookBtn: null
    };

    attachReaderGestures(reader);

    /* Load chapter script */
    var chSrc = "js/chapters/ch" + id + ".js";
    loadScript(chSrc, function () {
      if (state.screen !== "reader" || state.chapterId !== id) return;
      var data = window.AWWFY_CHAPTERS && window.AWWFY_CHAPTERS[id];
      if (!data) {
        showLoadError(viewport);
        return;
      }
      state.chapterData = data;
      renderChapterFlow(data, opts);
    }, function () {
      if (state.screen !== "reader" || state.chapterId !== id) return;
      showLoadError(viewport);
    });

    /* Load original script in parallel */
    var origSrc = "js/originals/ch" + id + ".js";
    loadScript(origSrc, function () {
      if (state.screen !== "reader" || state.chapterId !== id) return;
      if (window.AWWFY_ORIGINALS && window.AWWFY_ORIGINALS[id]) {
        state.originalData = window.AWWFY_ORIGINALS[id];
        if (readerRefs && readerRefs.realBookBtn) {
          readerRefs.realBookBtn.classList.remove("hidden");
        }
      }
    }, function () {
      if (readerRefs && readerRefs.realBookBtn) {
        readerRefs.realBookBtn.classList.add("hidden");
      }
    });
  }

  function showLoadError(viewport) {
    viewport.textContent = "";
    var box = el("div", { className: "reader-msg" });
    box.appendChild(el("p", null, "This chapter could not open. Please go back and try again."));
    var btn = el("button", { type: "button", className: "btn" }, "Back");
    btn.addEventListener("click", renderMenu);
    box.appendChild(btn);
    viewport.appendChild(box);
  }

  function renderChapterFlow(data, opts) {
    if (!readerRefs) return;
    var viewport = readerRefs.viewport;
    viewport.textContent = "";

    readerRefs.topTitle.textContent = data.title;
    readerRefs.runHead.textContent = BOOK.title + " | " + data.title;

    var flow = el("div", { className: "flow" });

    /* Exact L3 order inside .flow */
    var labelText = "Chapter " + chapterDisplayNum(data.id);
    flow.appendChild(el("p", { className: "label" }, labelText));
    flow.appendChild(el("h1", { className: "chapter-title" }, data.title));

    var hookEl = el("p", { className: "hook" }, data.hook);
    flow.appendChild(hookEl);

    var picFig = null;
    var img = null;
    var imgDone = false;
    function onImgSettled() {
      if (imgDone) return;
      imgDone = true;
      scheduleInitialLayout(opts);
    }
    if (data.image) {
      picFig = el("figure", { className: "story-pic" });
      img = el("img", { src: data.image, alt: data.alt, width: "1024", height: "768" });
      img.addEventListener("load", onImgSettled);
      img.addEventListener("error", function () {
        picFig.textContent = "";
        picFig.appendChild(el("div", { className: "pic-missing" }, data.alt));
        onImgSettled();
      });
      picFig.appendChild(img);
      flow.appendChild(picFig);
    }

    state.paraNodes = [hookEl];
    state.paraWords = [countWords(data.hook)];
    state.totalWords = state.paraWords[0];

    data.paragraphs.forEach(function (paraText) {
      var pNode = buildParagraphNode(paraText);
      flow.appendChild(pNode);
      state.paraNodes.push(pNode);
      var w = countWords(paraText);
      state.paraWords.push(w);
      state.totalWords += w;
    });

    /* End of chapter page */
    var endDiv = el("div", { className: "chapter-end" });
    endDiv.appendChild(el("p", { className: "end-title" }, "End of Chapter " + chapterDisplayNum(data.id)));

    var nextMeta = getAdjacentReadyChapter(data.id, 1);
    if (nextMeta) {
      var nextChBtn = el("button", { type: "button", className: "btn btn-primary" }, "Next chapter");
      nextChBtn.addEventListener("click", function (e) {
        e.stopPropagation();
        openChapter(nextMeta.id, { page: 0 });
      });
      endDiv.appendChild(nextChBtn);
    }

    var allChBtn = el("button", { type: "button", className: "btn" }, "All chapters");
    allChBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      renderMenu();
    });
    endDiv.appendChild(allChBtn);

    var realBtn = el("button", {
      type: "button",
      className: "btn" + (state.originalData ? "" : " hidden")
    }, "Read the real book");
    realBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      state.lastRealBookBtn = realBtn;
      openOriginalPanel();
    });
    endDiv.appendChild(realBtn);
    readerRefs.realBookBtn = realBtn;

    flow.appendChild(endDiv);
    viewport.appendChild(flow);
    readerRefs.flow = flow;

    if (!img) {
      onImgSettled();
    } else if (img.complete) {
      if (img.naturalWidth === 0) {
        picFig.textContent = "";
        picFig.appendChild(el("div", { className: "pic-missing" }, data.alt));
      }
      onImgSettled();
    }
  }

  function scheduleInitialLayout(opts) {
    function run() {
      if (!readerRefs || !readerRefs.flow) return;
      computePages();
      var startPage = 0;
      if (opts && opts.lastPage) {
        startPage = state.totalPages - 1;
      } else if (opts && typeof opts.targetPara === "number" && opts.targetPara > 0) {
        startPage = pageForParaIndex(opts.targetPara);
      } else if (opts && typeof opts.page === "number") {
        startPage = opts.page;
      }
      goToPage(startPage, false);
    }
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(function () {
        requestAnimationFrame(run);
      });
    } else {
      requestAnimationFrame(run);
    }
  }

  /* ---------- pagination ---------- */
  function computePages() {
    if (!readerRefs || !readerRefs.flow || !readerRefs.viewport) return;
    var flow = readerRefs.flow;
    var viewport = readerRefs.viewport;
    var gap = parseFloat(getComputedStyle(flow).columnGap) || 0;
    var step = viewport.clientWidth + gap;
    if (step <= 0) return;
    state.step = step;
    state.totalPages = Math.max(1, Math.round((flow.scrollWidth + gap) / step));
    readerRefs.scrub.max = String(state.totalPages);
  }

  function getFirstVisibleParaIndex() {
    if (!state.step || !state.paraNodes.length) return 0;
    for (var i = 0; i < state.paraNodes.length; i++) {
      var pPage = Math.floor(state.paraNodes[i].offsetLeft / state.step);
      if (pPage >= state.page) return i;
    }
    return state.paraNodes.length - 1;
  }

  function pageForParaIndex(idx) {
    if (!state.step || !state.paraNodes.length) return 0;
    var clamped = Math.max(0, Math.min(idx, state.paraNodes.length - 1));
    var p = state.paraNodes[clamped];
    var pg = Math.floor(p.offsetLeft / state.step);
    return Math.max(0, Math.min(pg, state.totalPages - 1));
  }

  function relayoutKeepingPlace() {
    if (!readerRefs || !readerRefs.flow) return;
    var anchorPara = getFirstVisibleParaIndex();
    var wasEnd = state.page >= state.totalPages - 1;
    computePages();
    var nextPage = wasEnd ? state.totalPages - 1 : pageForParaIndex(anchorPara);
    goToPage(nextPage, false);
  }

  function goToPage(index, isUserTurn) {
    if (!readerRefs || !readerRefs.flow) return;
    closeMeaningBox(false);
    var clamped = Math.max(0, Math.min(index, state.totalPages - 1));
    state.page = clamped;
    readerRefs.flow.style.transform = "translateX(" + (-clamped * state.step) + "px)";

    if (isUserTurn && !state.firstTurnDone) {
      state.firstTurnDone = true;
      state.topOnly = false;
      state.barsHidden = true;
      readerRefs.reader.classList.remove("top-only");
      readerRefs.reader.classList.add("bars-hidden");
    }

    updateStatusAndProgress();
  }

  function getAdjacentReadyChapter(id, dir) {
    var idx = getChapterIndex(id);
    if (idx === -1) return null;
    for (var i = idx + dir; i >= 0 && i < BOOK.chapters.length; i += dir) {
      if (BOOK.chapters[i].ready) return BOOK.chapters[i];
    }
    return null;
  }

  function turnPage(dir) {
    if (!readerRefs || !readerRefs.flow) return;
    stopReadAloud();
    var target = state.page + dir;
    if (target >= state.totalPages) {
      var nextCh = getAdjacentReadyChapter(state.chapterId, 1);
      if (nextCh) openChapter(nextCh.id, { page: 0 });
      return;
    }
    if (target < 0) {
      var prevCh = getAdjacentReadyChapter(state.chapterId, -1);
      if (prevCh) openChapter(prevCh.id, { lastPage: true });
      return;
    }
    goToPage(target, true);
  }

  function updateStatusAndProgress() {
    if (!readerRefs) return;
    var isLastPage = state.page >= state.totalPages - 1;
    readerRefs.pageNumEl.textContent = "Page " + (state.page + 1) + " of " + state.totalPages;
    readerRefs.scrub.value = String(state.page + 1);

    var prevCh = getAdjacentReadyChapter(state.chapterId, -1);
    var nextCh = getAdjacentReadyChapter(state.chapterId, 1);
    readerRefs.prevBtn.disabled = state.page === 0 && !prevCh;
    readerRefs.nextBtn.disabled = isLastPage && !nextCh;

    if (isLastPage) {
      readerRefs.timeLeftEl.textContent = "End of chapter";
    } else {
      var wordsAfter = 0;
      for (var i = 0; i < state.paraNodes.length; i++) {
        var pPage = Math.floor(state.paraNodes[i].offsetLeft / state.step);
        if (pPage > state.page) wordsAfter += state.paraWords[i];
      }
      var mins = Math.max(1, Math.ceil(wordsAfter / 120));
      readerRefs.timeLeftEl.textContent = "About " + mins + " min left in chapter";
    }

    var prog = getProgress();
    prog.lastChapter = state.chapterId;
    prog.lastPara = getFirstVisibleParaIndex();

    if (isLastPage) {
      if (prog.read.indexOf(state.chapterId) === -1) {
        prog.read.push(state.chapterId);
      }
      var lastBookChapter = BOOK.chapters[BOOK.chapters.length - 1];
      if (!state.endFired && lastBookChapter && state.chapterId === lastBookChapter.id) {
        state.endFired = true;
        setTimeout(function () {
          if (window.awwfyEnd) window.awwfyEnd();
        }, 2500);
      }
    }
    saveProgress(prog);

    var ready = getReadyChapters();
    var readyCount = Math.max(1, ready.length);
    var readBefore = prog.read.filter(function (rid) {
      return rid !== state.chapterId && ready.some(function (c) { return c.id === rid; });
    }).length;
    var frac = state.totalPages <= 1 ? 1 : (state.page + 1) / state.totalPages;
    var pct = Math.min(100, Math.round(((readBefore + frac) / readyCount) * 100));
    readerRefs.pctEl.textContent = pct + "% of book";
  }

  /* ---------- bars and gestures ---------- */
  function toggleBars() {
    if (!readerRefs) return;
    if (state.barsHidden || state.topOnly) {
      state.barsHidden = false;
      state.topOnly = false;
      readerRefs.reader.classList.remove("bars-hidden");
      readerRefs.reader.classList.remove("top-only");
    } else {
      state.barsHidden = true;
      readerRefs.reader.classList.add("bars-hidden");
    }
  }

  function isInteractiveTarget(target) {
    if (!target || !target.closest) return false;
    return !!target.closest("button, a, input, .word, .panel, .pop, .original, .reader-top, .reader-bottom");
  }

  function attachReaderGestures(reader) {
    var downX = 0;
    var downY = 0;
    var tracking = false;

    reader.addEventListener("pointerdown", function (e) {
      if (e.button !== undefined && e.button !== 0) return;
      if (isInteractiveTarget(e.target)) {
        tracking = false;
        return;
      }
      downX = e.clientX;
      downY = e.clientY;
      tracking = true;
    });

    reader.addEventListener("pointerup", function (e) {
      if (!tracking) return;
      tracking = false;

      if (popBox && !popBox.classList.contains("hidden")) {
        closeMeaningBox(false);
        return;
      }
      if (state.openPanel) {
        closePanel();
        return;
      }

      var sel = window.getSelection ? window.getSelection().toString() : "";
      if (sel && sel.trim().length > 0) return;

      var dx = e.clientX - downX;
      var dy = e.clientY - downY;

      if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) {
        if (dx < 0) turnPage(1);
        else turnPage(-1);
        return;
      }

      if (Math.abs(dx) <= 12 && Math.abs(dy) <= 12) {
        var rect = reader.getBoundingClientRect();
        var ratio = (e.clientX - rect.left) / rect.width;
        if (ratio < 0.3) turnPage(-1);
        else if (ratio > 0.7) turnPage(1);
        else toggleBars();
      }
    });
  }

  /* ---------- panels (Aa and Contents) ---------- */
  function closePanel() {
    if (!readerRefs) return;
    readerRefs.panelHost.textContent = "";
    state.openPanel = null;
  }

  function togglePanel(name) {
    closeMeaningBox(false);
    if (state.openPanel === name) {
      closePanel();
      return;
    }
    state.openPanel = name;
    if (name === "aa") renderAaPanel();
    else if (name === "contents") renderContentsPanel();
  }

  function renderAaPanel() {
    if (!readerRefs) return;
    var host = readerRefs.panelHost;
    host.textContent = "";
    var s = getSettings();

    var panel = el("div", { className: "panel", role: "dialog", "aria-label": "Text settings" });
    var head = el("div", { className: "panel-head" });
    head.appendChild(el("h2", null, "Text"));
    var doneBtn = el("button", { type: "button", className: "btn" }, "Done");
    doneBtn.addEventListener("click", closePanel);
    head.appendChild(doneBtn);
    panel.appendChild(head);

    /* Text size */
    var sizeRow = el("div", { className: "set-row" });
    sizeRow.appendChild(el("p", { className: "set-label" }, "Text size"));
    var sizeSeg = el("div", { className: "seg" });
    SIZES.forEach(function (px, idx) {
      var b = el("button", {
        type: "button",
        className: "btn",
        "aria-label": "Text size " + (idx + 1),
        "aria-pressed": s.size === px ? "true" : "false"
      }, "A");
      b.style.fontSize = (14 + idx * 3) + "px";
      b.addEventListener("click", function () {
        var cur = getSettings();
        cur.size = px;
        saveSettings(cur);
        applyReaderSettings(readerRefs.reader, cur);
        updateSegPressed(sizeSeg, b);
        relayoutKeepingPlace();
      });
      sizeSeg.appendChild(b);
    });
    sizeRow.appendChild(sizeSeg);
    panel.appendChild(sizeRow);

    /* Font */
    var fontRow = el("div", { className: "set-row" });
    fontRow.appendChild(el("p", { className: "set-label" }, "Font"));
    var fontSeg = el("div", { className: "seg" });
    [["classic", "Classic"], ["simple", "Simple"]].forEach(function (pair) {
      var b = el("button", {
        type: "button",
        className: "btn",
        "aria-pressed": s.font === pair[0] ? "true" : "false"
      }, pair[1]);
      b.addEventListener("click", function () {
        var cur = getSettings();
        cur.font = pair[0];
        saveSettings(cur);
        applyReaderSettings(readerRefs.reader, cur);
        updateSegPressed(fontSeg, b);
        relayoutKeepingPlace();
      });
      fontSeg.appendChild(b);
    });
    fontRow.appendChild(fontSeg);
    panel.appendChild(fontRow);

    /* Line spacing */
    var lineRow = el("div", { className: "set-row" });
    lineRow.appendChild(el("p", { className: "set-label" }, "Line spacing"));
    var lineSeg = el("div", { className: "seg" });
    [[1.4, "Close"], [1.6, "Normal"], [1.9, "Wide"]].forEach(function (pair) {
      var b = el("button", {
        type: "button",
        className: "btn",
        "aria-pressed": s.line === pair[0] ? "true" : "false"
      }, pair[1]);
      b.addEventListener("click", function () {
        var cur = getSettings();
        cur.line = pair[0];
        saveSettings(cur);
        applyReaderSettings(readerRefs.reader, cur);
        updateSegPressed(lineSeg, b);
        relayoutKeepingPlace();
      });
      lineSeg.appendChild(b);
    });
    lineRow.appendChild(lineSeg);
    panel.appendChild(lineRow);

    /* Page colour */
    var themeRow = el("div", { className: "set-row" });
    themeRow.appendChild(el("p", { className: "set-label" }, "Page colour"));
    var themeSeg = el("div", { className: "seg" });
    var curTheme = getTheme();
    [["light", "White"], ["sepia", "Sepia"], ["dark", "Dark"]].forEach(function (pair) {
      var b = el("button", {
        type: "button",
        className: "btn",
        "data-set-theme": pair[0],
        "aria-pressed": curTheme === pair[0] ? "true" : "false"
      }, pair[1]);
      b.addEventListener("click", function () {
        setTheme(pair[0]);
      });
      themeSeg.appendChild(b);
    });
    themeRow.appendChild(themeSeg);
    panel.appendChild(themeRow);

    /* Reading voice */
    if (HAS_SPEECH) {
      var voiceRow = el("div", { className: "set-row" });
      voiceRow.appendChild(el("p", { className: "set-label" }, "Reading voice"));
      var voiceSeg = el("div", { className: "seg" });
      [["slow", "Slow"], ["normal", "Normal"]].forEach(function (pair) {
        var b = el("button", {
          type: "button",
          className: "btn",
          "aria-pressed": s.speed === pair[0] ? "true" : "false"
        }, pair[1]);
        b.addEventListener("click", function () {
          var cur = getSettings();
          cur.speed = pair[0];
          saveSettings(cur);
          updateSegPressed(voiceSeg, b);
        });
        voiceSeg.appendChild(b);
      });
      voiceRow.appendChild(voiceSeg);
      panel.appendChild(voiceRow);
    }

    host.appendChild(panel);
  }

  function updateSegPressed(seg, activeBtn) {
    var btns = seg.querySelectorAll("button");
    for (var i = 0; i < btns.length; i++) {
      btns[i].setAttribute("aria-pressed", btns[i] === activeBtn ? "true" : "false");
    }
  }

  function renderContentsPanel() {
    if (!readerRefs) return;
    var host = readerRefs.panelHost;
    host.textContent = "";

    var panel = el("div", { className: "panel", role: "dialog", "aria-label": "Chapters" });
    var head = el("div", { className: "panel-head" });
    head.appendChild(el("h2", null, "Chapters"));
    var doneBtn = el("button", { type: "button", className: "btn" }, "Done");
    doneBtn.addEventListener("click", closePanel);
    head.appendChild(doneBtn);
    panel.appendChild(head);

    panel.appendChild(buildChapterList(state.chapterId, function (id) {
      closePanel();
      if (id !== state.chapterId) openChapter(id, { page: 0 });
    }));

    var foot = el("div", { className: "panel-foot" });
    var startBtn = el("button", { type: "button", className: "btn" }, "Back to start");
    startBtn.addEventListener("click", renderStart);
    foot.appendChild(startBtn);
    foot.appendChild(el("a", { className: "btn", href: "https://awwfy.com/reader/" }, "More books"));
    panel.appendChild(foot);

    host.appendChild(panel);
  }

  /* ---------- full screen ---------- */
  function toggleFullscreen() {
    if (!HAS_FULLSCREEN) return;
    try {
      if (document.fullscreenElement) {
        document.exitFullscreen();
      } else {
        document.documentElement.requestFullscreen();
      }
    } catch (e) {}
  }

  function updateFullscreenBtn() {
    if (!readerRefs || !readerRefs.fsBtn) return;
    var isFs = !!document.fullscreenElement;
    readerRefs.fsBtn.textContent = "";
    readerRefs.fsBtn.appendChild(isFs ? ICONS.exitFullscreen() : ICONS.fullscreen());
    readerRefs.fsBtn.setAttribute("aria-label", isFs ? "Exit full screen" : "Full screen");
  }

  /* ---------- read aloud ---------- */
  function clearReadHighlight() {
    for (var i = 0; i < state.paraNodes.length; i++) {
      state.paraNodes[i].classList.remove("reading");
    }
  }

  function stopReadAloud() {
    state.readingAloud = false;
    state.speechIndex = -1;
    clearReadHighlight();
    if (HAS_SPEECH) {
      try { window.speechSynthesis.cancel(); } catch (e) {}
    }
    if (readerRefs && readerRefs.readBtn) {
      readerRefs.readBtn.textContent = "";
      readerRefs.readBtn.appendChild(ICONS.speak());
      readerRefs.readBtn.setAttribute("aria-label", "Read to me");
    }
  }

  function startReadAloud() {
    if (!HAS_SPEECH || !state.chapterData || !state.paraNodes.length) return;
    closeMeaningBox(false);
    closePanel();
    stopReadAloud();
    state.readingAloud = true;
    if (readerRefs && readerRefs.readBtn) {
      readerRefs.readBtn.textContent = "";
      readerRefs.readBtn.appendChild(ICONS.stop());
      readerRefs.readBtn.setAttribute("aria-label", "Stop reading");
    }
    speakParaAt(getFirstVisibleParaIndex());
  }

  function speakParaAt(idx) {
    if (!state.readingAloud || !state.chapterData) return;
    if (idx >= state.paraNodes.length) {
      stopReadAloud();
      return;
    }
    state.speechIndex = idx;
    clearReadHighlight();
    var node = state.paraNodes[idx];
    node.classList.add("reading");

    var pPage = pageForParaIndex(idx);
    if (pPage !== state.page) {
      goToPage(pPage, false);
    }

    var text = idx === 0 ? state.chapterData.hook : stripMarkers(state.chapterData.paragraphs[idx - 1]);
    var settings = getSettings();
    try {
      var utter = new SpeechSynthesisUtterance(text);
      utter.lang = "en-GB";
      utter.rate = settings.speed === "slow" ? 0.75 : 0.9;
      utter.onend = function () {
        if (state.readingAloud && state.speechIndex === idx) {
          speakParaAt(idx + 1);
        }
      };
      utter.onerror = function () {
        if (state.readingAloud) stopReadAloud();
      };
      window.speechSynthesis.speak(utter);
    } catch (e) {
      stopReadAloud();
    }
  }

  /* ---------- original text panel ---------- */
  var originalPanel = null;

  function openOriginalPanel() {
    if (!state.originalData) return;
    closeMeaningBox(false);
    closePanel();
    stopReadAloud();
    closeOriginalPanel(false);

    originalPanel = el("div", { className: "original", role: "dialog", "aria-label": "Original text" });
    var inner = el("div", { className: "original-inner" });
    var closeBtn = el("button", { type: "button", className: "btn" }, "Close");
    closeBtn.addEventListener("click", function () {
      closeOriginalPanel(true);
    });
    inner.appendChild(closeBtn);
    inner.appendChild(el("p", { className: "original-note" }, "This is the original text from " + BOOK.year + ". Some words are old."));
    inner.appendChild(el("div", { className: "original-body" }, state.originalData.text));
    originalPanel.appendChild(inner);
    document.body.appendChild(originalPanel);
    closeBtn.focus();
  }

  function closeOriginalPanel(returnFocus) {
    if (!originalPanel) return;
    if (originalPanel.parentNode) originalPanel.parentNode.removeChild(originalPanel);
    originalPanel = null;
    if (returnFocus && state.lastRealBookBtn) {
      state.lastRealBookBtn.focus();
    }
  }

  /* ---------- global events ---------- */
  document.addEventListener("click", function (e) {
    if (popBox && !popBox.classList.contains("hidden")) {
      if (!popBox.contains(e.target) && !(e.target.closest && e.target.closest(".word"))) {
        closeMeaningBox(false);
      }
    }
  });

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") {
      if (popBox && !popBox.classList.contains("hidden")) {
        e.preventDefault();
        closeMeaningBox(true);
        return;
      }
      if (state.openPanel) {
        e.preventDefault();
        closePanel();
        return;
      }
      if (originalPanel) {
        e.preventDefault();
        closeOriginalPanel(true);
        return;
      }
    }

    if (state.screen !== "reader" || originalPanel || state.openPanel) return;

    var active = document.activeElement;
    if (active && active.tagName === "INPUT") return;

    if (e.key === "ArrowRight" || e.key === "PageDown") {
      e.preventDefault();
      turnPage(1);
    } else if (e.key === "ArrowLeft" || e.key === "PageUp") {
      e.preventDefault();
      turnPage(-1);
    } else if (e.key === " " && (!active || (active.tagName !== "BUTTON" && active.tagName !== "A"))) {
      e.preventDefault();
      turnPage(1);
    }
  });

  window.addEventListener("resize", function () {
    closeMeaningBox(false);
    if (state.screen !== "reader") return;
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(relayoutKeepingPlace, 80);
  });

  window.addEventListener("orientationchange", function () {
    closeMeaningBox(false);
    if (state.screen !== "reader") return;
    setTimeout(relayoutKeepingPlace, 120);
  });

  document.addEventListener("fullscreenchange", function () {
    updateFullscreenBtn();
    if (state.screen === "reader") {
      setTimeout(relayoutKeepingPlace, 120);
    }
  });

  /* ---------- start ---------- */
  renderStart();
})();
