"use strict";
(() => {
  const $ = selector => document.querySelector(selector);
  const book = window.AWWFY_BOOK;
  const reader = $(".reader"), flow = $(".flow"), viewport = $(".viewport");
  const panel = $(".panel"), pop = $(".pop"), slider = $(".scrub");
  const progressKey = "awwfy-" + book.slug + "-progress";
  const synth = window.speechSynthesis;
  const dark = matchMedia("(prefers-color-scheme: dark)");
  const ready = book.chapters.filter(c => c.ready);
  function read(key) { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } }
  function save(key, value) { try { localStorage.setItem(key, value); } catch {} }
  const progress = read(progressKey) || {};
  if (!Array.isArray(progress.read)) progress.read = [];
  const settings = Object.assign({size:21, font:"Classic", line:1.6, speed:0.9}, read("awwfy-reader"));
  let chapter = null, page = 0, pages = 1, step = 1, blocks = [], anchor = -1;
  let activeWord, panelOpener, speaking = false, speechToken = 0, loadToken = 0;
  let finished = false, layoutFrame, readyToPage = false, wordEnds = [];
  const paths = {
    leave:"M15 5l-7 7 7 7",prev:"M15 5l-7 7 7 7",next:"M9 5l7 7-7 7",
    contents:"M4 6h2m3 0h11M4 12h2m3 0h11M4 18h2m3 0h11",
    settings:"M2 19l6-15 6 15M4 14h8m3 1c0-5 6-5 6 0v4m0-4c-7-3-7 7 0 3",
    voice:"M3 9h4l5-4v14l-5-4H3zM15 8q5 4 0 8m3-11q8 7 0 14",
    stop:"M6 6h12v12H6z",full:"M3 9V3h6m6 0h6v6m0 6v6h-6m-6 0H3v-6",
    moon:"M20 15A9 9 0 0 1 9 4a9 9 0 1 0 11 11z",
    sun:"M16 12a4 4 0 1 1-8 0 4 4 0 1 1 8 0zM12 2v2m0 16v2M2 12h2m16 0h2M5 5l2 2m10 10 2 2M5 19l2-2M17 7l2-2"
  };
  function icon(id, key, label) {
    const btn = $("#"+id);
    btn.innerHTML = '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="'+paths[key]+'"/></svg>';
    if (label) btn.setAttribute("aria-label", label);
  }
  for (const id of ["leave","prev","next","contents","settings","voice","full"]) icon(id,id);
  function element(tag, cls, text) {
    const el = document.createElement(tag);
    if (cls) el.className = cls;
    if (text !== undefined) el.textContent = text;
    return el;
  }
  function button(text, fn, cls="btn") {
    const el = element("button",cls,text);
    el.type = "button"; el.onclick = fn;
    return el;
  }
  function colour() { return document.documentElement.dataset.theme || (dark.matches ? "dark":"light"); }
  function themeIcon() {
    const night = colour() === "dark";
    icon("theme",night?"sun":"moon",night?"Switch to light mode":"Switch to dark mode");
  }
  function setTheme(t) { document.documentElement.dataset.theme=t; save("awwfy-theme",t); themeIcon(); }
  $("#theme").onclick = () => setTheme(colour()==="dark"?"light":"dark");
  dark.addEventListener("change", themeIcon); themeIcon();
  function stop() {
    ++speechToken; speaking=false;
    synth?.cancel(); flow.querySelector(".reading")?.classList.remove("reading");
    icon("voice","voice","Read to me");
  }
  function closeWord(focus=false) {
    if (!activeWord) return;
    activeWord.setAttribute("aria-expanded","false");
    if (focus) activeWord.focus({preventScroll:true});
    activeWord=null; pop.hidden=true;
  }
  function closePanel(focus=false) {
    panel.hidden=true;
    if (focus) panelOpener?.focus({preventScroll:true});
  }
  function rows(container) {
    container.replaceChildren();
    book.chapters.forEach(c=>{
      const row=button("",()=>open(c),"row");
      const done=progress.read.includes(c.id);
      row.append(element("span","circle",Number(c.id)),element("span","row-title",c.title),
        element("span","state"+(done?" is-read":""),c.ready?(done?"Read":"Start"):"Coming soon"));
      row.disabled=!c.ready;
      if (chapter?.id===c.id) row.setAttribute("aria-current","true");
      container.append(row);
    });
  }
  function screen(name) {
    ++loadToken; readyToPage=false; stop(); closeWord(); closePanel(); chapter=null;
    reader.hidden=true; $(".topbar").hidden=false;
    $("#start").hidden=name!=="start"; $("#menu").hidden=name!=="menu"; $("#back").hidden=name!=="menu";
    $("#bar-title").textContent=name==="menu"?"Chapters":book.title;
    const last=ready.find(c=>c.id===progress.last);
    $("#begin").textContent=last?"Continue: Chapter "+Number(last.id):"Start reading";
    if(name==="menu"){
      rows($("#menu .rows"));
      $(".progress").textContent=progress.read.filter(id=>ready.some(c=>c.id===id)).length+" of "+book.chapters.length+" chapters read";
    }
    window.scrollTo(0,0);
  }
  $("#all").onclick=()=>screen("menu"); $("#back").onclick=()=>screen("start");
  $("#leave").onclick=()=>screen("menu");
  $("#begin").onclick=()=>open(ready.find(c=>c.id===progress.last)||ready[0],progress.last?progress.paragraph:-1);
  function adjacent(delta) { const c=book.chapters[book.chapters.indexOf(chapter)+delta]; return c?.ready?c:null; }
  function load(id) {
    if(window.AWWFY_CHAPTERS?.[id]) return Promise.resolve();
    return new Promise((resolve,reject)=>{
      const s=document.createElement("script");
      s.src="js/chapters/ch"+id+".js"; s.onload=resolve; s.onerror=reject; document.body.append(s);
    });
  }
  function paragraph(s) {
    const p=element("p"); let end=0;
    for(const m of s.matchAll(/\[\[([^|\]]+)\|([^\]]+)\]\]/g)){
      const w=button(m[1],()=>meaning(w),"word");
      w.dataset.meaning=m[2]; w.setAttribute("aria-expanded","false");
      p.append(s.slice(end,m.index),w); end=m.index+m[0].length;
    }
    p.append(s.slice(end)); return p;
  }
  async function open(c, at=-1) {
    if(!c?.ready)return;
    const token=++loadToken;
    stop(); closeWord(); closePanel(); readyToPage=false; chapter=c; page=0; anchor=at;
    $(".topbar").hidden=$("#start").hidden=$("#menu").hidden=true;
    reader.hidden=false; reader.className="reader top-only"; flow.replaceChildren();
    flow.style.transform="none"; $("#chapter-name").textContent=c.title;
    $(".run-head").textContent=book.title+" · "+c.title;
    const notice=$(".notice"); notice.hidden=false; notice.textContent="Loading...";
    $("#leave").focus({preventScroll:true});
    try {
      await load(c.id);
      if(token!==loadToken)return;
      const data=window.AWWFY_CHAPTERS[c.id];
      const figure=element("figure","story-pic"), img=element("img");
      img.alt=data.alt; img.width=1024; img.height=768; figure.append(img);
      const picture=new Promise(resolve=>{
        img.onload=resolve;
        img.onerror=()=>{figure.replaceChildren(element("div","pic-missing",data.alt));resolve();};
      });
      blocks=data.paragraphs.map(paragraph);
      const end=element("div","chapter-end");
      end.append(element("p","end-title","End of Chapter "+Number(c.id)));
      const next=adjacent(1);
      if(next)end.append(button("Next chapter",()=>open(next),"btn btn-primary"));
      end.append(button("All chapters",()=>screen("menu")));
      flow.append(element("p","label","Chapter "+Number(c.id)),element("h1","chapter-title",c.title),
        element("p","hook",data.hook),figure,...blocks,end);
      img.src=data.image; applySettings();
      await Promise.all([picture,document.fonts?.ready]);
      if(token!==loadToken)return;
      readyToPage=true; notice.hidden=true; layout(at);
    } catch {
      if(token===loadToken) notice.replaceChildren("This chapter could not open. Please go back and try again. ",button("Back",()=>screen("menu")));
    }
  }
  function applySettings(){
    reader.style.setProperty("--read-size",settings.size+"px");
    reader.style.setProperty("--read-font",settings.font==="Simple"?"var(--font)":"var(--serif)");
    reader.style.setProperty("--read-line",settings.line);
  }
  function pageOf(el){ return Math.floor(el.offsetLeft/step); }
  function layout(at=anchor){
    if(!readyToPage)return;
    closeWord();
    const gap=parseFloat(getComputedStyle(flow).columnGap);
    step=viewport.clientWidth+gap;
    const figure=$(".story-pic"), hook=$(".hook");
    const openingHeight=Array.from(flow.children).slice(0,3).reduce((n,el)=>n+el.offsetHeight+parseFloat(getComputedStyle(el).marginBottom),0);
    figure.style.height=Math.max(1,Math.min(innerHeight*.5,figure.clientWidth*.75,viewport.clientHeight-openingHeight-20))+"px";
    // Let the end screen begin a fresh spread, including when the text ends in its left column.
    const end=$(".chapter-end"); end.style.left="";
    const columns=Number(getComputedStyle(flow).columnCount);
    if(columns===2 && end.offsetLeft%step>gap) {
      end.style.position="relative";
      end.style.left=(step/2)+"px";
    }
    const last=pageOf(end);
    pages=Math.max(1,Math.round((flow.scrollWidth+gap)/step),last+1);
    wordEnds=Array(pages).fill(0);
    const range=document.createRange(), walker=document.createTreeWalker(flow,NodeFilter.SHOW_TEXT);
    const origin=flow.getBoundingClientRect().left;
    for(let node=walker.nextNode();node;node=walker.nextNode()){
      if(!blocks.includes(node.parentElement.closest("p")) && !hook.contains(node))continue;
      for(const m of node.textContent.matchAll(/\S+/g)){
        range.setStart(node,m.index);range.setEnd(node,m.index+m[0].length);
        const k=Math.min(pages-1,Math.max(0,Math.floor((range.getBoundingClientRect().left-origin+1)/step)));
        wordEnds[k]++;
      }
    }
    show(at===Infinity||at===blocks.length?pages-1:at>=0&&blocks[at]?pageOf(blocks[at]):0,false);
  }
  function show(index, turn=true){
    if(!readyToPage)return;
    closeWord(); page=Math.max(0,Math.min(pages-1,index));
    if(turn){reader.classList.remove("top-only");reader.classList.add("bars-hidden");}
    flow.style.transform="translateX("+(-page*step)+"px)";
    const end=page===pages-1;
    const origin=flow.getBoundingClientRect().left;
    anchor=blocks.findIndex(p=>Array.from(p.getClientRects()).some(r=>Math.floor((r.left-origin+1)/step)===page));
    if(end)anchor=blocks.length;
    slider.max=pages; slider.value=page+1;
    $("#location").textContent="Page "+(page+1)+" of "+pages;
    $("#time").textContent=end?"End of chapter":"About "+Math.ceil(wordEnds.slice(page+1).reduce((a,b)=>a+b,0)/120)+" min left in chapter";
    $("#position").textContent="Chapter "+Number(chapter.id)+" of "+book.chapters.filter(c=>c.id!=="00").length;
    const before=ready.slice(0,ready.indexOf(chapter)).filter(c=>progress.read.includes(c.id)).length;
    $("#percent").textContent=Math.round(100*(before+(page+1)/pages)/ready.length)+"% of book";
    if(end&&!progress.read.includes(chapter.id))progress.read.push(chapter.id);
    progress.last=chapter.id;progress.paragraph=anchor;save(progressKey,JSON.stringify(progress));
    if(end && chapter===book.chapters.at(-1) && !finished){
      finished=true; setTimeout(function(){ if (window.awwfyEnd) window.awwfyEnd(); },2500);
    }
    for(const control of flow.querySelectorAll("button"))control.tabIndex=pageOf(control)===page?0:-1;
  }
  function turn(delta) {
    if(!readyToPage || getSelection()?.toString())return;
    stop();
    if(page+delta<0 || page+delta>=pages){const c=adjacent(delta);if(c)open(c,delta<0?Infinity:-1);}
    else show(page+delta);
  }
  $("#prev").onclick=()=>turn(-1);$("#next").onclick=()=>turn(1);
  slider.oninput=()=>{stop();show(Number(slider.value)-1);};
  function meaning(w){
    const same=w===activeWord;closeWord();if(same)return;
    activeWord=w;w.setAttribute("aria-expanded","true");
    $(".pop-word").textContent=w.textContent;$(".pop-meaning").textContent=w.dataset.meaning;
    pop.hidden=false;const r=w.getBoundingClientRect();
    pop.style.left=Math.max(16,Math.min(r.left,innerWidth-16-pop.offsetWidth))+"px";
    const below=r.bottom+8;
    pop.style.top=Math.max(16,below+pop.offsetHeight>innerHeight-16?r.top-8-pop.offsetHeight:below)+"px";
  }
  function utter(text){const u=new SpeechSynthesisUtterance(text);u.lang="en-GB";u.rate=settings.speed;return u;}
  $("#hear").hidden=$("#voice").hidden=!synth;
  $("#hear").onclick=()=>{stop();synth.speak(utter(activeWord.textContent+". "+activeWord.dataset.meaning));};
  $("#voice").onclick=()=>{
    if(speaking){stop();return;}
    if(!readyToPage)return;
    stop();speaking=true;const token=speechToken;icon("voice","stop","Stop reading");
    const queue=[$(".hook"),...blocks];
    function speak(i){
      if(token!==speechToken)return;
      flow.querySelector(".reading")?.classList.remove("reading");
      if(i===queue.length){stop();return;}
      const el=queue[i];el.classList.add("reading");
      show(pageOf(el));const u=utter(el.textContent);
      u.onend=()=>speak(i+1);u.onerror=()=>{if(token===speechToken)stop();};synth.speak(u);
    }
    speak(0);
  };
  function showPanel(which){
    if(!readyToPage)return;
    closeWord();panelOpener=$("#"+which);panel.hidden=false;
    const content=$("#panel-body");content.replaceChildren();
    $("#panel-title").textContent=which==="settings"?"Text":"Chapters";
    if(which==="contents"){
      const list=element("div","rows");rows(list);
      const links=element("div","actions"),more=element("a","btn","More books");more.href="https://awwfy.com/reader/";
      links.append(button("Back to start",()=>screen("start")),more);content.append(list,links);
    }else {
      const groups=[
        ["Text size","size",[17,19,21,24,28],["A","A","A","A","A"]],
        ["Font","font",["Classic","Simple"]],["Line spacing","line",[1.4,1.6,1.9],["Close","Normal","Wide"]],
        ["Page colour","theme",["light","sepia","dark"],["White","Sepia","Dark"]],
        ["Reading voice","speed",[0.75,0.9],["Slow","Normal"]]
      ];
      for(const [label,key,values,labels=values] of groups){
        if(key==="speed"&&!synth)continue;
        const row=element("div","set-row"),seg=element("div","seg");row.append(element("p","set-label",label),seg);
        values.forEach((v,i)=>{
          const b=button(labels[i],()=>{
            const keep=anchor;
            if(key==="theme")setTheme(v);else settings[key]=v;
            save("awwfy-reader",JSON.stringify(settings));applySettings();layout(keep);
            for(const other of seg.children)other.setAttribute("aria-pressed",String(other===b));
          });
          b.setAttribute("aria-pressed",String((key==="theme"?colour():settings[key])===v));
          if(key==="size"){b.style.fontSize=v+"px";b.setAttribute("aria-label","Text size "+(i+1));}
          seg.append(b);
        });content.append(row);
      }
    }
    $("#done").focus();
  }
  $("#contents").onclick=()=>showPanel("contents");$("#settings").onclick=()=>showPanel("settings");
  $("#done").onclick=()=>closePanel(true);
  $("#full").hidden=!document.documentElement.requestFullscreen;
  $("#full").onclick=async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen();}catch{}};
  function reflow(){closeWord();cancelAnimationFrame(layoutFrame);layoutFrame=requestAnimationFrame(()=>layout());}
  document.addEventListener("fullscreenchange",()=>{icon("full","full",document.fullscreenElement?"Exit full screen":"Full screen");reflow();});
  window.addEventListener("resize",reflow);
  document.addEventListener("click",e=>{
    if(!pop.hidden && !e.target.closest(".word,.pop")){closeWord();e.stopImmediatePropagation();e.preventDefault();}
    else if(!panel.hidden&&!panel.contains(e.target)){closePanel(true);e.stopImmediatePropagation();e.preventDefault();}
  },true);
  let down,swiped=false;
  reader.addEventListener("pointerdown",e=>{
    swiped=false;down=null;
    if(e.isPrimary && pop.hidden && panel.hidden && !e.target.closest("button,a,input"))down=[e.clientX,e.clientY];
  });
  reader.addEventListener("pointercancel",()=>{down=null;});
  reader.addEventListener("pointerup",e=>{
    if(!down)return;
    const dx=e.clientX-down[0],dy=e.clientY-down[1];down=null;
    if(Math.abs(dx)>40&&Math.abs(dx)>Math.abs(dy)){swiped=true;turn(dx<0?1:-1);}
  });
  reader.addEventListener("click",e=>{
    if(swiped||!readyToPage||e.target.closest("button,a,input,.panel,.reader-top,.reader-bottom")||getSelection()?.toString())return;
    if(e.clientX<innerWidth*.3)turn(-1);
    else if(e.clientX>innerWidth*.7)turn(1);
    else {
      const hide=!reader.classList.contains("bars-hidden")&&!reader.classList.contains("top-only");
      reader.classList.remove("top-only");reader.classList.toggle("bars-hidden",hide);
      reader.style.setProperty("--bottom-height",$(".reader-bottom").offsetHeight+"px");
    }
  });
  document.addEventListener("keydown",e=>{
    if(reader.hidden)return;
    if(e.key==="Escape"){if(activeWord)closeWord(true);else closePanel(true);return;}
    if(!panel.hidden||activeWord||e.target===slider||e.altKey||e.ctrlKey||e.metaKey)return;
    if(e.key===" "&&e.target.closest("button,a"))return;
    if(["ArrowRight","PageDown"," ","ArrowLeft","PageUp"].includes(e.key)){
      e.preventDefault();turn(["ArrowLeft","PageUp"].includes(e.key)?-1:1);
    }
  });
  screen("start");
})();

