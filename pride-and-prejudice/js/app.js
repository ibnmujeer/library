(function () {
  'use strict';
  const book = window.AWWFY_BOOK;
  const $ = id => document.getElementById(id);
  const reader = $('reader'), flow = $('flow'), viewport = $('viewport'), pop = $('meaning-box');
  const ready = () => book.chapters.filter(c => c.ready);
  const key = 'awwfy-' + book.slug + '-progress';
  function stored(name, fallback) { try { return JSON.parse(localStorage.getItem(name)) || fallback; } catch (e) { return fallback; } }
  function save(name, value) { try { localStorage.setItem(name, JSON.stringify(value)); } catch (e) {} }
  let progress = stored(key, {read: [], last: null, paragraph: 0});
  if (!Array.isArray(progress.read)) progress.read = [];
  let settings = stored('awwfy-reader', {size: 21, font: 'classic', line: 1.6, speed: 0.9});
  if (![17,19,21,24,28].includes(settings.size)) settings.size = 21;
  if (!['classic','simple'].includes(settings.font)) settings.font = 'classic';
  if (![1.4,1.6,1.9].includes(settings.line)) settings.line = 1.6;
  if (![0.75,0.9].includes(settings.speed)) settings.speed = 0.9;
  let current = null, page = 0, pages = 1, step = 1, nodes = [], endNode;
  let openWord = null, activePanel = null, panelTrigger = null, generation = 0, speechToken = 0, reading = false;
  let finishShown = false, finishTimer = null, resizeFrame = null, wordsPerPage = [];
  const hasVoice = 'speechSynthesis' in window;
  const icons = {
    back:'<path d="m14 6-6 6 6 6"/>', next:'<path d="m10 6 6 6-6 6"/>',
    contents:'<path d="M8 6h12M8 12h12M8 18h12M3 6h1M3 12h1M3 18h1"/>',
    text:'<path d="m2 18 5-12 5 12M4 14h6m5 4 3-8 3 8m-5-3h4"/>',
    voice:'<path d="M5 9H2v6h3l5 4V5L5 9Zm9-1a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/>',
    stop:'<rect x="6" y="6" width="12" height="12"/>',
    full:'<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/>',
    moon:'<path d="M20 14A8 8 0 0 1 10 4a8 8 0 1 0 10 10Z"/>',
    sun:'<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1 1m12 12 1 1M5 19l1-1M18 6l1-1"/>'
  };
  function icon(button, name) { button.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + icons[name] + '</svg>'; }
  [['reader-back','back'],['previous-page','back'],['next-page','next'],['contents-button','contents'],['text-button','text'],['speech-button','voice'],['fullscreen-button','full']].forEach(([id,n])=>icon($(id),n));
  function theme() { return document.documentElement.getAttribute('data-theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'); }
  function themeButtons() { document.querySelectorAll('.theme-toggle').forEach(b=>{const dark=theme()==='dark'; icon(b,dark?'sun':'moon'); b.setAttribute('aria-label',dark?'Switch to light mode':'Switch to dark mode');}); }
  function setTheme(value) { document.documentElement.setAttribute('data-theme',value); try { localStorage.setItem('awwfy-theme',value); } catch(e) {} themeButtons(); }
  document.querySelectorAll('.theme-toggle').forEach(b=>b.addEventListener('click',()=>setTheme(theme()==='dark'?'light':'dark')));
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change',themeButtons);
  themeButtons();
  function el(tag, cls, text) { const n=document.createElement(tag); if(cls)n.className=cls; if(text!==undefined)n.textContent=text; return n; }
  function button(text, action, cls='btn') { const n=el('button',cls,text); n.type='button'; n.addEventListener('click',action); return n; }
  function chapterNumber(id) { return id==='00'?'0':String(Number(id)); }
  function plain(text) { return text.replace(/\[\[([^|\]]+)\|[^\]]+\]\]/g,'$1'); }
  function stopSpeech() { speechToken++; if(hasVoice)window.speechSynthesis.cancel(); reading=false; flow.querySelectorAll('.reading').forEach(n=>n.classList.remove('reading')); $('speech-button').setAttribute('aria-label','Read to me'); icon($('speech-button'),'voice'); }
  function closeMeaning(focus=false) { const old=openWord; if(old)old.setAttribute('aria-expanded','false'); openWord=null; pop.hidden=true; if(focus&&old)old.focus({preventScroll:true}); }
  function closePanel(focus=true) { if(activePanel)activePanel.hidden=true; activePanel=null; if(focus&&panelTrigger)panelTrigger.focus({preventScroll:true}); panelTrigger=null; }
  function leave() { generation++; stopSpeech(); closeMeaning(); closePanel(false); clearTimeout(finishTimer); reader.hidden=true; reader.inert=true; document.body.classList.remove('reading-open'); }
  function showStart() { leave(); $('menu-screen').hidden=true; $('start-screen').hidden=false; const last=book.chapters.find(c=>c.id===progress.last&&c.ready); $('start-reading').textContent=last?'Continue: Chapter '+chapterNumber(last.id):'Start reading'; $('start-reading').focus({preventScroll:true}); }
  function showMenu() { leave(); $('start-screen').hidden=true; $('menu-screen').hidden=false; renderLists(); $('menu-back').focus({preventScroll:true}); }
  function renderList(target) { target.replaceChildren(); book.chapters.forEach(c=>{const row=button('',()=>openChapter(c.id),'chapter-row'); row.disabled=!c.ready; if(current&&c.id===current.id)row.setAttribute('aria-current','true'); row.append(el('span','chapter-number',chapterNumber(c.id)),el('span','chapter-name',c.title),el('span','chapter-state'+(progress.read.includes(c.id)?' read':''),!c.ready?'Coming soon':progress.read.includes(c.id)?'Read':'Start')); target.append(row);}); }
  function renderLists() { renderList($('menu-list')); renderList($('contents-list')); $('menu-progress').textContent=progress.read.filter(id=>book.chapters.some(c=>c.id===id)).length+' of '+book.chapters.length+' chapters read'; }
  $('start-reading').onclick=()=>{const last=book.chapters.find(c=>c.id===progress.last&&c.ready); openChapter((last||ready()[0]).id,last?{paragraph:progress.paragraph}:{});};
  $('all-chapters').onclick=showMenu; $('menu-back').onclick=showStart; $('reader-back').onclick=showMenu; $('back-to-start').onclick=showStart;
  function loadScript(path, group, id) { if(window[group]&&window[group][id])return Promise.resolve(window[group][id]); return new Promise((resolve,reject)=>{const script=document.createElement('script'); script.src=path; script.onload=()=>{script.remove(); window[group]&&window[group][id]?resolve(window[group][id]):reject(new Error('Missing data'));}; script.onerror=()=>{script.remove();reject(new Error('Could not load'));}; document.head.append(script);}); }
  function paragraph(text) { const p=el('p'); const re=/\[\[([^|\]]+)\|([^\]]+)\]\]/g; let match, last=0; while((match=re.exec(text))){ p.append(document.createTextNode(text.slice(last,match.index))); const word=el('button','word',match[1]); word.type='button'; word.dataset.meaning=match[2]; word.setAttribute('aria-expanded','false'); word.addEventListener('click',e=>{e.stopPropagation(); showMeaning(word);}); p.append(word); last=re.lastIndex; } p.append(document.createTextNode(text.slice(last))); return p; }
  function picture(data) { const fig=el('figure','story-pic'); const image=el('img'); image.alt=data.alt; image.width=1024; image.height=768; fig.append(image); const loaded=new Promise(resolve=>{image.onload=resolve; image.onerror=()=>{fig.replaceChildren(el('div','pic-missing',data.alt));resolve();};}); image.src=data.image; return {fig,loaded}; }
  function adjacent(direction) { const i=book.chapters.findIndex(c=>c.id===current.id); const c=book.chapters[i+direction]; return c&&c.ready?c:null; }
  async function openChapter(id, position={}) {
    if(!book.chapters.some(c=>c.id===id&&c.ready))return;
    stopSpeech(); closeMeaning(); closePanel(false); clearTimeout(finishTimer); const ticket=++generation; current=null; endNode=null;
    $('start-screen').hidden=true; $('menu-screen').hidden=true; reader.hidden=false; reader.inert=false; document.body.classList.add('reading-open'); reader.className='reader top-only';
    $('reader-title').textContent=book.chapters.find(c=>c.id===id).title;
    const status=$('load-state'); status.hidden=false; status.replaceChildren(el('p','','Loading...')); flow.replaceChildren(); page=0; applySettings();
    try {
      const data=await loadScript('js/chapters/ch'+id+'.js','AWWFY_CHAPTERS',id); if(ticket!==generation)return;
      current=data; flow.style.transform='none'; nodes=[];
      flow.append(el('p','label','Chapter '+chapterNumber(id)),el('h1','chapter-title',data.title),el('p','hook',data.hook));
      const pic=data.image?picture(data):null; if(pic)flow.append(pic.fig);
      data.paragraphs.forEach(text=>{const p=paragraph(text); nodes.push(p); flow.append(p);});
      endNode=el('div','chapter-end'); endNode.append(el('p','end-title','End of Chapter '+chapterNumber(id)));
      const next=adjacent(1); const nextButton=button('Next chapter',()=>next&&openChapter(next.id),'btn btn-primary'); nextButton.hidden=!next;
      endNode.append(nextButton,button('All chapters',showMenu)); flow.append(endNode);
      if(pic)await pic.loaded; if(document.fonts)await document.fonts.ready; if(ticket!==generation)return;
      status.hidden=true; $('run-head').textContent=book.title+' · '+data.title;
      await new Promise(resolve=>requestAnimationFrame(resolve)); repage(position); renderLists(); $('reader-back').focus({preventScroll:true});
    } catch(error) { if(ticket!==generation)return; current=null; status.replaceChildren(el('p','','This chapter could not open. Please go back and try again.'),button('Back',showMenu)); }
  }
  function firstParagraph() { if(!current)return 0;const vr=viewport.getBoundingClientRect();const first=nodes.findIndex(n=>Array.from(n.getClientRects()).some(r=>r.right>vr.left&&r.left<vr.right&&r.bottom>vr.top&&r.top<vr.bottom));return first<0?nodes.length-1:first; }
  function measureWords() { wordsPerPage=Array(pages).fill(0);const left=viewport.getBoundingClientRect().left;nodes.forEach(p=>{const walker=document.createTreeWalker(p,NodeFilter.SHOW_TEXT);let text;while((text=walker.nextNode())){for(const match of text.textContent.matchAll(/\S+/g)){const range=document.createRange();range.setStart(text,match.index);range.setEnd(text,match.index+match[0].length);const rect=range.getBoundingClientRect();const i=Math.max(0,Math.min(pages-1,Math.floor((rect.left-left)/step)));wordsPerPage[i]++;}}}); }
  function repage(position) { if(reader.hidden||!current||!endNode||!$('load-state').hidden)return; const anchor=position||{paragraph:firstParagraph()}; flow.style.transform='none'; const gap=parseFloat(getComputedStyle(flow).columnGap); step=viewport.clientWidth+gap; pages=Math.max(1,Math.round((flow.scrollWidth+gap)/step)); if(anchor.last)page=pages-1; else if(Number.isInteger(anchor.paragraph)){const p=nodes[Math.min(Math.max(0,anchor.paragraph),nodes.length-1)]; page=Math.floor(p.offsetLeft/step);} page=Math.max(0,Math.min(page,pages-1));measureWords(); update(); }
  function update() {
    if(!current)return; flow.style.transform='translateX('+(-page*step)+'px)';
    $('page-count').textContent='Page '+(page+1)+' of '+pages;
    const endPage=Math.floor(endNode.offsetLeft/step); const ended=page>=endPage;
    const remaining=wordsPerPage.slice(page+1).reduce((sum,n)=>sum+n,0);
    $('time-left').textContent=ended?'End of chapter':'About '+Math.ceil(remaining/120)+' min left in chapter';
    $('scrub').max=pages; $('scrub').value=page+1;
    const all=ready(); const index=all.findIndex(c=>c.id===current.id); $('chapter-position').textContent='Chapter '+chapterNumber(current.id)+' of '+book.chapters.filter(c=>c.id!=='00').length;
    const readBefore=all.slice(0,index).filter(c=>progress.read.includes(c.id)).length;
    $('book-progress').textContent=Math.round((readBefore+(page+1)/pages)/all.length*100)+'% of book';
    $('previous-page').disabled=page===0&&!adjacent(-1); $('next-page').disabled=ended&&!adjacent(1);
    if(ended&&!progress.read.includes(current.id))progress.read.push(current.id);
    progress.last=current.id; progress.paragraph=firstParagraph(); save(key,progress);
    // The website finish callback is the sole delay required by the host integration.
    const final=book.chapters[book.chapters.length-1];
    if(ended&&current.id===final.id&&!finishShown){finishShown=true; finishTimer=setTimeout(function(){if(window.awwfyEnd)window.awwfyEnd();},2500);}
    // Prevent keyboard focus from moving the clipped viewport to another column.
    flow.querySelectorAll('button,a').forEach(b=>{const rects=Array.from(b.getClientRects()); const visible=rects.some(r=>{const vr=viewport.getBoundingClientRect();return r.right>vr.left&&r.left<vr.right;}); b.tabIndex=visible?0:-1;});
  }
  function turn(direction, automatic=false) { if(!current||reader.hidden)return; if(!automatic)stopSpeech(); closeMeaning(); if(activePanel){closePanel();return;} const next=page+direction; if(next<0){const prev=adjacent(-1);if(prev)openChapter(prev.id,{last:true});return;} if(next>=pages){const following=adjacent(1);if(following)openChapter(following.id);return;} page=next; reader.classList.remove('top-only'); reader.classList.add('bars-hidden'); update(); }
  $('previous-page').onclick=()=>turn(-1); $('next-page').onclick=()=>turn(1);
  $('scrub').oninput=()=>{stopSpeech();closeMeaning();page=Number($('scrub').value)-1;reader.className='reader bars-hidden';update();};
  function showMeaning(word) { if(openWord===word){closeMeaning();return;} closeMeaning(); openWord=word; word.setAttribute('aria-expanded','true'); pop.querySelector('.pop-word').textContent=word.textContent; pop.querySelector('.pop-meaning').textContent=word.dataset.meaning; pop.hidden=false; const rect=word.getBoundingClientRect(), boxW=pop.offsetWidth,boxH=pop.offsetHeight; let left=rect.left;if(left+boxW>innerWidth-16)left=innerWidth-16-boxW;if(left<16)left=16;let top=rect.bottom+8;if(top+boxH>innerHeight-16)top=rect.top-8-boxH;if(top<16)top=16;pop.style.left=left+'px';pop.style.top=top+'px'; }
  $('hear-word').hidden=!hasVoice;
  $('hear-word').onclick=()=>{if(!openWord)return;stopSpeech();const u=new SpeechSynthesisUtterance(openWord.textContent+'. '+openWord.dataset.meaning);u.lang='en-GB';u.rate=settings.speed;window.speechSynthesis.speak(u);};
  document.addEventListener('click',e=>{if(!pop.hidden&&!pop.contains(e.target)&&!e.target.closest('.word')){closeMeaning();}});
  function applySettings() { reader.style.setProperty('--read-size',settings.size+'px'); reader.style.setProperty('--read-font',settings.font==='classic'?'var(--serif)':'var(--font)'); reader.style.setProperty('--read-line',settings.line); }
  function buildSettings() { const target=$('settings-rows');target.replaceChildren();
    const groups=[['Text size','size',[[17,'A'],[19,'A'],[21,'A'],[24,'A'],[28,'A']]],['Font','font',[['classic','Classic'],['simple','Simple']]],['Line spacing','line',[[1.4,'Close'],[1.6,'Normal'],[1.9,'Wide']]],['Page colour','theme',[['light','White'],['sepia','Sepia'],['dark','Dark']]],['Reading voice','speed',[[0.75,'Slow'],[0.9,'Normal']]]];
    groups.forEach(([label,key,choices])=>{if(key==='speed'&&!hasVoice)return;const row=el('div','set-row'),seg=el('div','seg'); row.append(el('p','set-label',label)); choices.forEach(([value,text],i)=>{const b=button(text,()=>{const anchor={paragraph:firstParagraph()};stopSpeech();closeMeaning();if(key==='theme')setTheme(value);else{settings[key]=value;applySettings();save('awwfy-reader',settings);repage(anchor);} buildSettings();const replacement=target.querySelector('[data-choice="'+key+'-'+i+'"]');if(replacement)replacement.focus();}); b.dataset.choice=key+'-'+i;b.setAttribute('aria-pressed',String((key==='theme'?theme():settings[key])===value));if(key==='size'){b.style.fontSize=value+'px';b.setAttribute('aria-label','Text size '+(i+1));}seg.append(b);});row.append(seg);target.append(row);}); }
  function panel(which, trigger) { closeMeaning();closePanel(false);panelTrigger=trigger;activePanel=$(which);if(which==='text-panel')buildSettings();else renderLists();activePanel.hidden=false;activePanel.querySelector('button').focus(); }
  $('text-button').onclick=()=>panel('text-panel',$('text-button')); $('contents-button').onclick=()=>panel('contents-panel',$('contents-button'));
  document.querySelectorAll('.panel-done').forEach(b=>b.onclick=()=>closePanel());
  $('fullscreen-button').hidden=!document.documentElement.requestFullscreen;
  $('fullscreen-button').onclick=async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen();}catch(e){$('fullscreen-button').hidden=true;}};
  document.addEventListener('fullscreenchange',()=>{$('fullscreen-button').setAttribute('aria-label',document.fullscreenElement?'Exit full screen':'Full screen');repage();});
  $('speech-button').hidden=!hasVoice;
  $('speech-button').onclick=()=>{
    if(reading){stopSpeech();return;} if(!hasVoice||!current)return;stopSpeech();reading=true;const token=speechToken; $('speech-button').setAttribute('aria-label','Stop reading');icon($('speech-button'),'stop');const sequence=[{text:current.hook,node:flow.querySelector('.hook')},...current.paragraphs.map((text,i)=>({text:plain(text),node:nodes[i]}))];
    function say(i){if(token!==speechToken)return;nodes.forEach(n=>n.classList.remove('reading'));if(i>=sequence.length){stopSpeech();return;}const item=sequence[i],target=Math.floor(item.node.offsetLeft/step);if(target!==page){page=target;reader.className='reader bars-hidden';update();}item.node.classList.add('reading');const u=new SpeechSynthesisUtterance(item.text);u.lang='en-GB';u.rate=settings.speed;const voices=window.speechSynthesis.getVoices();const voice=voices.find(v=>v.lang==='en-GB'&&v.localService);if(voice)u.voice=voice;u.onend=()=>{item.node.classList.remove('reading');say(i+1);};u.onerror=stopSpeech;window.speechSynthesis.speak(u);}say(0);
  };
  reader.addEventListener('click',e=>{if(!pop.hidden&&!e.target.closest('.word')){closeMeaning();e.preventDefault();e.stopPropagation();return;}if(activePanel&&!activePanel.contains(e.target)){closePanel();e.preventDefault();e.stopPropagation();}},true);
  let pointer=null, dragged=false;
  viewport.addEventListener('pointerdown',e=>{if(e.target.closest('button,a,input'))return;pointer={x:e.clientX,y:e.clientY,id:e.pointerId};dragged=false;});
  viewport.addEventListener('pointerup',e=>{if(!pointer||e.pointerId!==pointer.id)return;const dx=e.clientX-pointer.x,dy=e.clientY-pointer.y;pointer=null;if(Math.abs(dx)>40&&Math.abs(dx)>Math.abs(dy)&&!String(getSelection())){dragged=true;if(!pop.hidden){closeMeaning();return;}if(activePanel){closePanel();return;}turn(dx<0?1:-1);}});
  viewport.addEventListener('pointercancel',()=>{pointer=null;});
  viewport.addEventListener('click',e=>{if(dragged){dragged=false;return;}if(e.target.closest('button,a,input')||String(getSelection()))return;if(!pop.hidden){closeMeaning();return;}if(activePanel){closePanel();return;}const rect=viewport.getBoundingClientRect(),fraction=(e.clientX-rect.left)/rect.width;if(fraction<0.3)turn(-1);else if(fraction>0.7)turn(1);else{reader.classList.remove('top-only');reader.classList.toggle('bars-hidden');}});
  document.addEventListener('keydown',e=>{
    if(e.key==='Escape'){if(!pop.hidden)closeMeaning(true);else if(activePanel)closePanel();return;}
    if(reader.hidden||e.target.matches('input'))return;
    if(e.key==='Tab'&&activePanel){const buttons=Array.from(activePanel.querySelectorAll('button:not(:disabled),a')).filter(b=>!b.hidden);const i=buttons.indexOf(document.activeElement);if(e.shiftKey&&i===0){e.preventDefault();buttons[buttons.length-1].focus();}else if(!e.shiftKey&&i===buttons.length-1){e.preventDefault();buttons[0].focus();}return;}
    if(e.target.closest('button,a')&&(e.key===' '||e.key==='Enter'))return;
    if(activePanel||!pop.hidden)return;
    if(['ArrowRight','PageDown',' '].includes(e.key)){e.preventDefault();turn(1);}if(['ArrowLeft','PageUp'].includes(e.key)){e.preventDefault();turn(-1);}
  });
  function resize(){closeMeaning();const anchor={paragraph:Number.isInteger(progress.paragraph)?progress.paragraph:0};if(resizeFrame)cancelAnimationFrame(resizeFrame);resizeFrame=requestAnimationFrame(()=>{resizeFrame=null;repage(anchor);});}
  window.addEventListener('resize',resize); window.addEventListener('orientationchange',resize);
  viewport.addEventListener('scroll',()=>{viewport.scrollLeft=0;viewport.scrollTop=0;});
  applySettings();renderLists();showStart();
})();
