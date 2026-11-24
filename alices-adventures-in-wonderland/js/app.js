"use strict";
const book = window.AWWFY_BOOK;
const app = document.querySelector("#app");
const ready = book.chapters.filter(c => c.ready);
const progressKey = "awwfy-" + book.slug + "-progress";
function read(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}
function save(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch {} }
const progress = read(progressKey,{read:[],last:null,paragraph:0});
const prefs = Object.assign({size:21,font:"Classic",line:1.6,speed:0.9},read("awwfy-reader",{}));
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}
function btn(text, action, cls="btn") {
  const b = el("button",cls,text);
  b.type="button"; b.onclick=action; return b;
}
const paths = {
  back:"M15 5l-7 7 7 7", next:"M9 5l7 7-7 7", contents:"M4 6h16M4 12h16M4 18h16",
  text:"M2 18l5-12 5 12M4 14h6M14 11q6-3 6 2v5m0-5q-7-1-6 3t6 0",
  voice:"M3 9h4l5-4v14l-5-4H3zM16 8q5 4 0 8M19 5q8 7 0 14",
  stop:"M6 6h12v12H6z", full:"M4 9V4h5m6 0h5v5m0 6v5h-5m-6 0H4v-5",
  moon:"M20 15A9 9 0 019 4a9 9 0 1011 11z",sun:"M12 7a5 5 0 100 10 5 5 0 000-10M12 1v3m0 16v3M1 12h3m16 0h3M4 4l2 2m12 12l2 2M4 20l2-2M18 6l2-2"
};
function icon(b,label,key) {
  b.setAttribute("aria-label",label); b.title=label;
  const ns="http:"+"//www\u002ew3.org/2000/svg",svg=document.createElementNS(ns,"svg"),path=document.createElementNS(ns,"path");
  svg.setAttribute("viewBox","0 0 24 24"); svg.setAttribute("aria-hidden","true");
  path.setAttribute("d",paths[key]); path.setAttribute("stroke","currentColor");path.setAttribute("stroke-width","1.8");path.setAttribute("fill","none");
  svg.append(path); b.replaceChildren(svg); return b;
}
function ib(label,key,fn){return icon(btn("",fn,"btn btn-icon"),label,key);}
function theme(){return document.documentElement.dataset.theme || (matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light");}
function setTheme(t){document.documentElement.dataset.theme=t;try{localStorage.setItem("awwfy-theme",t);}catch{}}
function themeButton(){
  const b=btn("",()=>{setTheme(theme()==="dark"?"light":"dark");update();},"btn btn-icon");
  function update(){const dark=theme()==="dark";icon(b,dark?"Switch to light mode":"Switch to dark mode",dark?"sun":"moon");}
  update();return b;
}
function more(){return document.querySelector("#more").content.firstElementChild.cloneNode(true);}
let state=null, serial=0, panel=null, panelTrigger=null, activeWord=null, speaking=false, utterance=null, finished=false;
const pop=el("aside","pop");pop.hidden=true;document.body.append(pop);
function closeWord(focus=false){if(activeWord){activeWord.setAttribute("aria-expanded","false");if(focus)activeWord.focus({preventScroll:true});}activeWord=null;pop.hidden=true;}
function closePanel(){if(panel){panel.remove();panel=null;panelTrigger?.focus({preventScroll:true});panelTrigger=null;}}
function stop(){speaking=false;utterance=null;if("speechSynthesis" in window)speechSynthesis.cancel();document.querySelector(".reading")?.classList.remove("reading");if(state?.voice)icon(state.voice,"Read to me","voice");}
function leave(){serial++;stop();closeWord();closePanel();state=null;app.replaceChildren();window.scrollTo(0,0);}
function shell(title,back){
  leave();const bar=el("header","topbar"),page=el("section","page");
  if(back)bar.append(btn("Back",start));bar.append(el("span","topbar-title",title),themeButton());app.append(bar,page);return page;
}
function start(){
  const page=shell(book.title,false),cover=el("img","start-cover");cover.src=book.cover.image;cover.alt=book.cover.alt;
  const resume=ready.find(c=>c.id===progress.last),actions=el("div","actions");
  actions.append(btn(resume?"Continue: Chapter "+Number(resume.id):"Start reading",()=>openChapter(resume||ready[0],resume?progress.paragraph:0),"btn btn-primary"),btn("All chapters",menu));
  page.append(cover,el("h1","",book.title),el("p","credit","Retold from "+book.title+" by "+book.author+" ("+book.year+")."),actions,el("p","level","Reading level: "+book.level),el("p","device","Your place is saved on this device only."),more());
}
function rows(){
  const list=el("div","rows");
  for(const c of book.chapters){
    const done=progress.read.includes(c.id),b=btn("",()=>openChapter(c),"chapter-row");b.disabled=!c.ready;
    if(state?.data.id===c.id)b.setAttribute("aria-current","true");
    b.append(el("span","number",Number(c.id)),el("span","row-title",c.title),el("span","status"+(done?" read":""),c.ready?(done?"Read":"Start"):"Coming soon"));list.append(b);
  }return list;
}
function menu(){const page=shell("Chapters",true);page.append(el("p","count",progress.read.filter(id=>id!=="00").length+" of "+book.chapters.filter(c=>c.id!=="00").length+" chapters read"),rows());}
function picture(data){
  const fig=el("figure","story-pic"),img=el("img");img.alt=data.alt;img.width=1024;img.height=768;
  const loaded=new Promise(resolve=>{img.onload=resolve;img.onerror=()=>{fig.replaceChildren(el("div","pic-missing",data.alt));resolve();};});
  fig.append(img);img.src=data.image;return {fig,loaded};
}
function meaning(b){
  closeWord();activeWord=b;b.setAttribute("aria-expanded","true");
  pop.replaceChildren(el("p","pop-word",b.textContent),el("p","pop-meaning",b.dataset.meaning));
  if("speechSynthesis" in window)pop.append(btn("Hear it",()=>{stop();speak(b.textContent+". "+b.dataset.meaning);}));
  pop.hidden=false;const r=b.getBoundingClientRect();pop.style.left=Math.max(16,Math.min(r.left,innerWidth-16-pop.offsetWidth))+"px";
  pop.style.top=Math.max(16,r.bottom+8+pop.offsetHeight>innerHeight-16?r.top-8-pop.offsetHeight:r.bottom+8)+"px";
}
function paragraph(value){
  const p=el("p");let end=0;
  for(const m of value.matchAll(/\[\[([^|\]]+)\|([^\]]+)\]\]/g)){
    p.append(value.slice(end,m.index));const b=btn(m[1],()=>meaning(b),"word");b.dataset.meaning=m[2];b.setAttribute("aria-expanded","false");p.append(b);end=m.index+m[0].length;
  }p.append(value.slice(end));return p;
}
function chapterScript(id){
  if(window.AWWFY_CHAPTERS?.[id])return Promise.resolve();
  return new Promise((resolve,reject)=>{const s=el("script");s.onload=resolve;s.onerror=reject;s.src="js/chapters/ch"+id+".js";document.body.append(s);});
}
async function openChapter(c,anchor=0){
  if(!c?.ready)return;
  leave();const token=serial;app.append(el("p","page","Loading..."));
  try{await chapterScript(c.id);if(token!==serial)return;const d=window.AWWFY_CHAPTERS[c.id];
    const reader=el("article","reader top-only"),top=el("header","reader-top"),view=el("div","viewport"),flow=el("div","flow"),bottom=el("footer","reader-bottom"),status=el("div","page-status");
    const voice=ib("Read to me","voice",readAloud),full=ib("Full screen","full",async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen();}catch{}});
    voice.hidden=!("speechSynthesis" in window);full.hidden=!document.documentElement.requestFullscreen;
    top.append(ib("Back","back",menu),el("span","topbar-title",d.title),ib("Contents","contents",e=>showPanel("Chapters",e.currentTarget)),ib("Text settings","text",e=>showPanel("Text",e.currentTarget)),voice,full);
    const hook=el("p","hook",d.hook),pic=picture(d),pars=d.paragraphs.map(paragraph),end=el("div","chapter-end");
    const next=book.chapters[book.chapters.findIndex(x=>x.id===c.id)+1];
    end.append(el("p","end-title","End of Chapter "+Number(c.id)));if(next?.ready)end.append(btn("Next chapter",()=>openChapter(next),"btn btn-primary"));end.append(btn("All chapters",menu));
    flow.append(el("p","label","Chapter "+Number(c.id)),el("h1","chapter-title",d.title),hook,pic.fig,...pars,end);view.append(flow);
    const page=el("span"),minutes=el("span"),prev=ib("Previous page","back",()=>turn(-1)),forward=ib("Next page","next",()=>turn(1));
    status.append(prev,page,minutes,forward);const slider=el("input","scrub");slider.type="range";slider.min=1;slider.setAttribute("aria-label","Page");slider.oninput=()=>jump(Number(slider.value)-1,true);
    const stats=el("div","bottom-row"),percent=el("span");stats.append(el("span","", "Chapter "+Number(c.id)+" of "+book.chapters.filter(x=>x.id!=="00").length),percent);bottom.append(slider,stats);
    const head=el("p","run-head",book.title+" · "+d.title);reader.append(top,head,view,status,bottom);app.replaceChildren(reader);
    state={data:d,reader,top,head,view,flow,bottom,status,voice,full,hook,pars,end,page,minutes,slider,percent,prev,forward,step:1,count:1,index:0,anchor:0,first:true,positions:[]};
    applyPrefs();gestures(view);await Promise.all([document.fonts?.ready,pic.loaded]);if(token===serial)layout(anchor);
  }catch{if(token===serial)app.replaceChildren(el("p","page","This chapter could not open. Please go back and try again."),btn("Back",menu));}
}
function applyPrefs(){const r=state.reader.style;r.setProperty("--read-size",prefs.size+"px");r.setProperty("--read-font",prefs.font==="Simple"?"var(--font)":"var(--serif)");r.setProperty("--read-line",prefs.line);}
function layout(anchor=state?.anchor){
  if(!state)return;closeWord();const s=state, gap=parseFloat(getComputedStyle(s.flow).columnGap);
  const topVisible=!s.reader.classList.contains("bars-hidden"),bottomVisible=topVisible&&!s.reader.classList.contains("top-only");
  s.head.style.translate=topVisible?"0 "+s.top.offsetHeight+"px":"";
  s.status.style.translate=bottomVisible?"0 -"+s.bottom.offsetHeight+"px":"";
  s.view.style.clipPath="inset(0)";
  // Reserve space for the persistent header and status without changing the base layout values.
  s.view.style.marginTop=topVisible?s.head.offsetHeight+20+"px":"";
  s.view.style.marginBottom=bottomVisible?s.bottom.offsetHeight+4+"px":"4px";
  const fig=s.flow.querySelector("figure");fig.style.height="";
  const opening=[...s.flow.children].slice(0,3).reduce((n,e)=>n+e.offsetHeight+parseFloat(getComputedStyle(e).marginBottom),0);
  fig.style.height=Math.max(1,Math.min(fig.clientWidth*.75,innerHeight*.5,s.view.clientHeight-opening-parseFloat(getComputedStyle(fig).marginBottom)-2))+"px";
  s.step=s.view.clientWidth+gap;
    const finalParagraph=s.pars.at(-1);
  finalParagraph.classList.remove("spread-spacer");
  if(getComputedStyle(s.flow).columnCount==="2"){
    const endLeft=s.end.getBoundingClientRect().left-s.flow.getBoundingClientRect().left;
    if(Math.round(endLeft/(s.step/2))%2===1){
      finalParagraph.style.setProperty("--spacer-height",s.view.clientHeight+"px");
      finalParagraph.classList.add("spread-spacer");
    }
  }
  s.count=Math.max(1,Math.round((s.flow.scrollWidth+gap)/s.step));
  const base=s.flow.getBoundingClientRect().left;
  function pageOf(left){return Math.max(0,Math.floor((left-base+1)/s.step));}
  s.positions=s.pars.map(p=>pageOf(p.getClientRects()[0].left));
  s.words=Array(s.count).fill(0);
  const range=document.createRange();
  for(const p of [s.hook,...s.pars]){
    const walker=document.createTreeWalker(p,NodeFilter.SHOW_TEXT);
    while(walker.nextNode()){const n=walker.currentNode;for(const m of n.data.matchAll(/\S+/g)){range.setStart(n,m.index);range.setEnd(n,m.index+m[0].length);const i=pageOf(range.getBoundingClientRect().left);if(i<s.count)s.words[i]++;}}
  }
  jump(anchor===-1?s.count-1:anchor===0?0:s.positions[anchor]||0,false);
}
function jump(index,manual){
  if(!state)return;const s=state;if(manual){stop();if(s.first){s.first=false;s.reader.className="reader bars-hidden";const old=index;layout();index=old;}}
  closeWord();s.index=Math.max(0,Math.min(s.count-1,index));s.flow.style.transform="translateX("+(-s.index*s.step)+"px)";
  s.page.textContent="Page "+(s.index+1)+" of "+s.count;
  const last=s.index===s.count-1;s.minutes.textContent=last?"End of chapter":"About "+Math.ceil(s.words.slice(s.index+1).reduce((a,b)=>a+b,0)/120)+" min left in chapter";
  s.slider.max=s.count;s.slider.value=s.index+1;
  const before=ready.slice(0,ready.findIndex(c=>c.id===s.data.id)).filter(c=>progress.read.includes(c.id)).length;
  s.percent.textContent=Math.round(100*(before+(s.index+1)/s.count)/ready.length)+"% of book";
  const first=s.positions.findIndex(p=>p>=s.index);
  s.anchor=last?-1:s.index===0?0:first<0?s.pars.length-1:first;
  progress.last=s.data.id;progress.paragraph=s.anchor;
  if(last&&!progress.read.includes(s.data.id))progress.read.push(s.data.id);save(progressKey,progress);
  if(last&&!finished&&s.data.id===book.chapters.at(-1).id){finished=true;window.awwfyEnd?.();}
}
function turn(delta){if(!state)return;const s=state,i=s.index+delta;
  if(i<0||i>=s.count){const c=book.chapters[book.chapters.findIndex(c=>c.id===s.data.id)+delta];if(c?.ready)openChapter(c,delta<0?-1:0);return;}jump(i,true);}
function toggleBars(){const r=state.reader,hidden=r.classList.contains("bars-hidden")||r.classList.contains("top-only");r.className=hidden?"reader":"reader bars-hidden";layout();}
function gestures(view){
  let point=null;
  view.onpointerdown=e=>{point=[e.clientX,e.clientY];};
  view.onpointercancel=()=>point=null;
  view.onpointerup=e=>{if(!point)return;const [x,y]=point;point=null;if(panel||activeWord||e.target.closest("button,a,input")||getSelection().toString())return;
    const dx=e.clientX-x,dy=e.clientY-y;if(Math.abs(dx)>40&&Math.abs(dx)>Math.abs(dy)){turn(dx<0?1:-1);return;}
    if(Math.abs(dx)+Math.abs(dy)>12)return;const part=(x-view.getBoundingClientRect().left)/view.clientWidth;
    if(part<.3)turn(-1);else if(part>.7)turn(1);else toggleBars();
  };
}
document.addEventListener("click",e=>{if(activeWord&&!pop.contains(e.target)&&!e.target.closest(".word")){closeWord();e.stopImmediatePropagation();}else if(panel&&!panel.contains(e.target)){closePanel();e.stopImmediatePropagation();}},true);
function showPanel(title,trigger){
  closeWord();closePanel();panelTrigger=trigger;panel=el("section","panel");panel.setAttribute("role","dialog");panel.setAttribute("aria-label",title);
  const header=el("div","panel-head"),done=btn("Done",closePanel);header.append(el("h2","",title),done);panel.append(header);
  if(title==="Chapters"){panel.append(rows(),btn("Back to start",start),more());}
  else{
    function group(label,key,values,labels){
      const row=el("div","set-row"),seg=el("div","seg");row.append(el("p","set-label",label),seg);panel.append(row);
      values.forEach((v,i)=>{const b=btn(labels[i],()=>{if(key==="theme")setTheme(v);else prefs[key]=v;
        save("awwfy-reader",prefs);applyPrefs();layout();[...seg.children].forEach(x=>x.setAttribute("aria-pressed",String(x===b)));});
        if(key==="size"){b.style.fontSize=v+"px";b.setAttribute("aria-label","Text size "+(i+1));}b.setAttribute("aria-pressed",String(v===(key==="theme"?theme():prefs[key])));seg.append(b);});
    }
    group("Text size","size",[17,19,21,24,28],Array(5).fill("A"));group("Font","font",["Classic","Simple"],["Classic","Simple"]);group("Line spacing","line",[1.4,1.6,1.9],["Close","Normal","Wide"]);group("Page colour","theme",["light","sepia","dark"],["White","Sepia","Dark"]);if("speechSynthesis" in window)group("Reading voice","speed",[.75,.9],["Slow","Normal"]);
  }
  state.reader.append(panel);done.focus();
}
function speak(text,end){const u=new SpeechSynthesisUtterance(text);u.lang="en-GB";u.rate=prefs.speed;const local=speechSynthesis.getVoices().filter(v=>v.localService);u.voice=local.find(v=>v.lang==="en-GB")||local.find(v=>v.lang.startsWith("en"))||null;
  if(!u.voice){
    stop();closeWord();closePanel();
    panel=el("section","panel");panel.setAttribute("role","dialog");
    panel.append(el("p","","An English voice installed on this device is needed for offline reading."),btn("Done",closePanel));
    state.reader.append(panel);panel.querySelector("button").focus();return;
  }
  utterance=u;u.onend=()=>{if(utterance===u)end?.();};u.onerror=()=>{if(utterance===u)stop();};speechSynthesis.speak(u);}
function readAloud(){if(speaking){stop();return;}const s=state;stop();speaking=true;icon(s.voice,"Stop reading","stop");const lines=[s.hook,...s.pars];let i=0;
  function next(){if(!speaking||state!==s)return;document.querySelector(".reading")?.classList.remove("reading");if(i===lines.length){stop();return;}const line=lines[i];jump(i?s.positions[i-1]:0,false);line.classList.add("reading");i++;speak(line.textContent,next);}next();}
document.addEventListener("keydown",e=>{if(!state)return;if(e.key==="Escape"){if(activeWord)closeWord(true);else closePanel();return;}if(panel||activeWord||e.target.matches("input")||e.altKey||e.ctrlKey||e.metaKey)return;
  if(e.key===" "&&e.target.closest("button,a"))return;
  if(["ArrowRight","PageDown"," ","ArrowLeft","PageUp"].includes(e.key)){e.preventDefault();turn(["ArrowLeft","PageUp"].includes(e.key)?-1:1);}
});
window.addEventListener("resize",()=>{if(state?.words)layout();});document.addEventListener("fullscreenchange",()=>{if(state){icon(state.full,document.fullscreenElement?"Exit full screen":"Full screen","full");layout();}});
start();
