import { doc, collection, onSnapshot, setDoc, deleteDoc, writeBatch, onSnapshotsInSync } from "firebase/firestore";

// env = {mode:"site"|"panel"|"popup", db, signIn, signOut, onAuth, allowed, siteUrl, onRunning?, openPanel?}
export function startApp(env){
let pipWin = null; // janela flutuante (Picture-in-Picture) com o cronômetro
const $ = id => document.getElementById(id) || (pipWin ? pipWin.document.getElementById(id) : null);
const DEFAULT_CATS = [
  {id:"questoes", name:"Questões", color:0},
  {id:"jurisprudencia", name:"Jurisprudência", color:1},
  {id:"flashcards", name:"Flashcards", color:2},
];
const QTY_LABEL = {questoes:"Questões feitas", flashcards:"Cards revisados", jurisprudencia:"Julgados lidos"};
const MESES = ["janeiro","fevereiro","março","abril","maio","junho","julho","agosto","setembro","outubro","novembro","dezembro"];
const DOW = ["dom","seg","ter","qua","qui","sex","sáb"];

/* ---------- estado ---------- */
let config = {categories: DEFAULT_CATS.slice(), exams: [], running: null, dailyGoal: 240};
let sessions = [];   // {id,cat,start,end,dur,qty,ok,note}
let notes = [];      // {id,title,html,color,order,updated}
let tasks = [];      // {id,text,cat,due,done,created,doneAt}
let selCat = "questoes";
let period = 7;
let logLimit = 15;
let calMonth = new Date(); calMonth.setDate(1);
let activeNote = null;
let finishing = null; // {cat,start,dur}

/* ---------- utilidades ---------- */
const pad = n => String(n).padStart(2,"0");
const dayKey = ms => { const d = new Date(ms); return d.getFullYear()+"-"+pad(d.getMonth()+1)+"-"+pad(d.getDate()); };
const startOfDay = d => { const x = new Date(d); x.setHours(0,0,0,0); return x; };
const uid = () => Date.now().toString(36)+Math.random().toString(36).slice(2,8);
function fmtDur(sec){ sec = Math.round(sec); if (sec < 60) return sec>0 ? "<1min" : "0min"; const h = Math.floor(sec/3600), m = Math.floor((sec%3600)/60); return h ? h+"h"+(m? " "+pad(m)+"min":"") : m+"min"; }
function fmtClock(sec){ sec = Math.max(0,Math.floor(sec)); return pad(Math.floor(sec/3600))+":"+pad(Math.floor(sec%3600/60))+":"+pad(sec%60); }
function catById(id){ return config.categories.find(c=>c.id===id) || {id, name: nameFromId(id), color:7, removed:true}; }
function nameFromId(id){ const s = sessions.find(x=>x.cat===id && x.catName); return s ? s.catName : id; }
const colorOf = c => "var(--cat"+((c.color??7)%8)+")";
function el(tag, attrs={}, ...kids){ const e = document.createElement(tag); for (const [k,v] of Object.entries(attrs)){ if (k==="class") e.className=v; else if (k==="style") e.setAttribute("style",v); else if (k.startsWith("on")) e.addEventListener(k.slice(2),v); else if (v!==false && v!=null) e.setAttribute(k, v===true?"":v); } for (const k of kids.flat()){ if (k==null||k===false) continue; e.append(k.nodeType? k : document.createTextNode(String(k))); } return e; }

/* ---------- armazenamento: Firebase (Firestore), com cópia offline ---------- */
const clean = o => JSON.parse(JSON.stringify(o));
const store = {
  uid: null, base: null, unsubs: [],
  start(user){
    this.stop();
    this.uid = user.uid;
    this.base = doc(env.db, "users", user.uid);
    const col = name => collection(env.db, "users", user.uid, name);
    let first = true;
    this.unsubs.push(onSnapshot(this.base, snap => {
      if (snap.exists()){
        const d = clean(snap.data());
        config = {categories: (d.categories&&d.categories.length)? d.categories : DEFAULT_CATS.slice(), exams: d.exams||[], running: d.running||null, dailyGoal: d.dailyGoal||240, timerPrefs: d.timerPrefs||null, lastCat: d.lastCat||null};
      } else if (first && !snap.metadata.fromCache){ this.saveConfig(); }
      first = false;
      restoreRunning();
      if (env.mode === "float" && config.running && config.running.pendingFinish && !finishing) stopTimer();
      if (finishing && finishing.auto && !config.running) finishing = null;
      renderAll(); markReady();
      if (env.onRunning) env.onRunning(config.running, config.dailyGoal);
    }, err => setSync("error", err)));
    this.unsubs.push(onSnapshot(col("sessions"), qs => {
      sessions = qs.docs.map(d => ({id:d.id, ...d.data()})).sort((a,b)=>b.start-a.start);
      renderAll();
    }, err => setSync("error", err)));
    this.unsubs.push(onSnapshot(col("notes"), qs => {
      notes = qs.docs.map(d => ({id:d.id, ...d.data()})).sort(noteOrder);
      renderNotes();
    }, err => setSync("error", err)));
    this.unsubs.push(onSnapshot(col("tasks"), qs => {
      tasks = qs.docs.map(d => ({id:d.id, ...d.data()}));
      renderTasksAll();
    }, err => setSync("error", err)));
    this.unsubs.push(onSnapshotsInSync(env.db, () => { if (navigator.onLine) setSync("ok"); }));
    setSync(navigator.onLine ? "ok" : "offline");
  },
  stop(){ this.unsubs.forEach(u => { try { u(); } catch(e){} }); this.unsubs = []; },
  // grava sem esperar o servidor: o Firestore aplica na hora aqui e sincroniza quando houver internet
  write(p){ p.catch(err => { console.error(err); setSync("error", err); }); return Promise.resolve(); },
  saveConfig(){
    if (!this.base) return Promise.resolve();
    return this.write(setDoc(this.base, clean({categories: config.categories, exams: config.exams, running: config.running||null, dailyGoal: config.dailyGoal||240, timerPrefs: config.timerPrefs||null, lastCat: config.lastCat||null})));
  },
  addSession(s){ const {id, ...body} = s; return this.write(setDoc(doc(this.base, "sessions", id), clean(body))); },
  delSession(id){ return this.write(deleteDoc(doc(this.base, "sessions", id))); },
  saveNote(n){ const {id, ...body} = n; return this.write(setDoc(doc(this.base, "notes", id), clean(body))); },
  delNote(id){ return this.write(deleteDoc(doc(this.base, "notes", id))); },
  saveTask(t){ const {id, ...body} = t; return this.write(setDoc(doc(this.base, "tasks", id), clean(body))); },
  delTask(id){ return this.write(deleteDoc(doc(this.base, "tasks", id))); },
  async writeMany(kind, items){
    for (let i = 0; i < items.length; i += 400){
      const b = writeBatch(env.db);
      items.slice(i, i+400).forEach(x => { const {id, ...body} = x; b.set(doc(this.base, kind, String(id)), clean(body)); });
      this.write(b.commit());
    }
  }
};
window.addEventListener("online", () => setSync("ok"));
window.addEventListener("offline", () => setSync("offline"));
function setSync(m, err){
  const s = $("sync"); if (!s) return;
  s.className = "sync " + (m==="ok" ? "cloud" : "local");
  const msg = m==="ok" ? "Sincronizado" : m==="offline" ? "Sem internet: salvo neste aparelho, sincroniza quando voltar" : "Não consegui salvar"+(err && err.code==="permission-denied" ? ": esta conta não tem acesso" : ". Verifique a conexão");
  $("syncText").textContent = msg; s.title = msg + (currentUser ? " · " + currentUser.email : "");
  const acc = $("syncAcc"); if (acc) acc.textContent = currentUser ? currentUser.email : "";
  const ae = $("accEmail"); if (ae) ae.textContent = currentUser ? currentUser.email : "";
}

/* ---------- abas ---------- */
document.querySelectorAll("nav.tabs button").forEach(b => b.addEventListener("click", () => showTab(b.dataset.tab)));
function showTab(t){
  document.querySelectorAll("nav.tabs button").forEach(b => b.setAttribute("aria-selected", b.dataset.tab===t ? "true":"false"));
  ["timer","tasks","stats","exams","notes"].forEach(v => $("view-"+v).hidden = v!==t);
  document.body.classList.toggle("on-notes", t==="notes");
  if (env.mode === "site" || env.mode === "panel"){ try { localStorage.setItem("mesa.tab", t); } catch(e){} }
  if (t==="stats") renderStats(); if (t==="exams") renderExams(); if (t==="notes") renderNotes(); if (t==="tasks") renderTasks();
}
try { const t = localStorage.getItem("mesa.tab"); if (t) showTab(t); } catch(e){}

/* ---------- cronômetro ---------- */
// running = {cat, mode, start (ms do trecho atual ou null), acc (s de estudo acumulados), first,
//            task?, taskText?, target? (s, regressivo/simulado), questions?, done?,
//            pomodoro: phase ("focus"|"short"|"long"), cycles, blockAcc (acc no início do bloco), breakStart, breakLen, cfg}
const MODES = {free:"Livre", countdown:"Regressivo", pomodoro:"Pomodoro", exam:"Simulado"};
const POMO_PRESETS = [
  {id:"25-5",  label:"25/5", hint:"clássico", focus:25, short:5,  long:15, every:4},
  {id:"50-10", label:"50/10", hint:"blocos longos", focus:50, short:10, long:20, every:3},
  {id:"52-17", label:"52/17", hint:"ritmo de produtividade", focus:52, short:17, long:17, every:99},
  {id:"90-20", label:"90/20", hint:"ciclo ultradiano", focus:90, short:20, long:30, every:3},
];
const JITTER = Math.random() * 1.5; // evita que site, painel e popup avancem a fase ao mesmo tempo
function prefs(){
  const p = config.timerPrefs || {};
  return {mode: MODES[p.mode] ? p.mode : "free", cdMin: p.cdMin || 45, pomo: p.pomo || "25-5", auto: p.auto !== false,
          examMin: p.examMin || 240, examQ: p.examQ || 60, sound: p.sound !== false};
}
function setPrefs(ch){ config.timerPrefs = {...prefs(), ...ch}; store.saveConfig(); renderTimer(); }
function elapsed(){ const r = config.running; if (!r) return 0; return (r.acc||0) + (r.start ? (Date.now()-r.start)/1000 : 0); }
function blockElapsed(){ const r = config.running; return r ? elapsed() - (r.blockAcc||0) : 0; }
function isTimed(r){ return r && (r.mode==="countdown" || r.mode==="exam"); }
function phaseInfo(){
  const r = config.running; if (!r) return null;
  if (isTimed(r)) return {kind: r.done ? "done" : "count", total: r.target, remaining: r.target - elapsed(), frac: Math.min(1, elapsed()/r.target)};
  if (r.mode==="pomodoro"){
    if (r.phase==="focus"){ const t = r.cfg.focus*60; return {kind:"focus", total:t, remaining: t - blockElapsed(), frac: Math.min(1, blockElapsed()/t), waiting: !r.start && blockElapsed() < 1}; }
    const gone = (Date.now() - r.breakStart)/1000;
    return {kind:"break", total: r.breakLen, remaining: r.breakLen - gone, frac: Math.min(1, gone/r.breakLen)};
  }
  return {kind:"free"};
}
function restoreRunning(){ if (config.running && !finishing) selCat = config.running.cat; }
function startTimer(task){
  const p = prefs(), now = Date.now();
  const r = {cat: selCat, mode: p.mode, start: now, acc: 0, first: now};
  if (task && task.id){ r.task = task.id; r.taskText = task.text; }
  if (p.mode==="countdown") r.target = p.cdMin*60;
  if (p.mode==="exam"){ r.target = p.examMin*60; r.questions = p.examQ; }
  if (p.mode==="pomodoro"){
    const c = POMO_PRESETS.find(x=>x.id===p.pomo) || POMO_PRESETS[0];
    r.cfg = {focus:c.focus, short:c.short, long:c.long, every:c.every, auto:p.auto, label:c.label};
    r.phase = "focus"; r.cycles = 0; r.blockAcc = 0;
  }
  config.running = r; config.lastCat = selCat; unlockAudio(); askNotify();
  store.saveConfig(); renderTimer();
}
function pauseTimer(){ const r = config.running; if (!r||!r.start) return; r.acc = (r.acc||0) + (Date.now()-r.start)/1000; r.start = null; store.saveConfig(); renderTimer(); }
function resumeTimer(){ const r = config.running; if (!r||r.start) return; if (r.mode==="pomodoro" && r.phase!=="focus") return; r.start = Date.now(); delete r.pendingFinish; store.saveConfig(); renderTimer(); }
function skipBreak(){ const r = config.running; if (!r || r.mode!=="pomodoro") return; r.phase = "focus"; r.blockAcc = r.acc||0; r.start = Date.now(); delete r.pendingFinish; store.saveConfig(); renderTimer(); }
function extendTimer(min){ const r = config.running; if (!isTimed(r)) return; r.target += min*60; r.done = false; if (!r.start) r.start = Date.now(); delete r.pendingFinish; store.saveConfig(); renderTimer(); }
function stopTimer(){
  const r = config.running; if (!r) return;
  const dur = elapsed();
  if (r.start){ r.acc = dur; r.start = null; store.saveConfig(); }
  finishing = {cat: r.cat, first: r.first || (Date.now()-dur*1000), dur, task: r.task||null, mode: r.mode, questions: r.questions, cycles: r.cycles, auto: !!r.pendingFinish};
  $("fQty").value = ""; $("fOk").value = "";
  $("fNote").value = r.taskText || (r.mode==="exam" ? "Simulado: "+(r.questions||"")+" questões em "+fmtGoal(Math.round((r.target||0)/60)) : r.mode==="pomodoro" && r.cycles ? "Pomodoro "+r.cfg.label+": "+r.cycles+(r.cycles===1?" ciclo":" ciclos") : "");
  $("fTaskWrap").hidden = !(r.task && tasks.some(t=>t.id===r.task && !t.done)); $("fTaskDone").checked = true;
  renderTimer();
}
async function saveFinish(){
  const f = finishing; if (!f) return;
  const qty = parseInt($("fQty").value,10), ok = parseInt($("fOk").value,10);
  const c = catById(f.cat);
  const s = {id: uid(), cat: f.cat, catName: c.name, start: f.first, end: Date.now(), dur: Math.round(f.dur)};
  if (f.mode && f.mode!=="free") s.mode = f.mode;
  if (!isNaN(qty)) s.qty = qty; if (!isNaN(ok)) s.ok = ok;
  const note = $("fNote").value.trim(); if (note) s.note = note;
  if (f.task && $("fTaskDone").checked){ const t = tasks.find(x=>x.id===f.task); if (t && !t.done) toggleTask(t, true); }
  finishing = null; config.running = null;
  await store.saveConfig(); await store.addSession(s);
  renderAll();
  if (env.mode === "float" && f.auto) setTimeout(() => window.close(), 400);
}
function discardFinish(){ finishing = null; config.running = null; store.saveConfig(); renderAll(); }

/* avança fases (fim do regressivo, pausas do pomodoro), inclusive as que passaram com o site fechado */
function checkPhase(){
  const r = config.running; if (!r || finishing) return;
  let changed = false, alert = null;
  for (let guard = 0; guard < 40; guard++){
    const now = Date.now();
    if (isTimed(r)){
      if (r.done || !r.start) break;
      const endAt = r.start + (r.target - (r.acc||0))*1000;
      if (now < endAt + JITTER*1000) break;
      r.acc = r.target; r.start = null; r.done = true; changed = true;
      if (now - endAt < 90000) alert = r.mode==="exam" ? ["Fim do simulado", "Registre quantas questões você fez e quantas acertou."] : ["Tempo esgotado", "Seus "+fmtGoal(Math.round(r.target/60))+" terminaram."];
      continue;
    }
    if (r.mode==="pomodoro"){
      if (r.phase==="focus"){
        if (!r.start) break;
        const endAt = r.start + (r.cfg.focus*60 - ((r.acc||0) - (r.blockAcc||0)))*1000;
        if (now < endAt + JITTER*1000) break;
        r.acc = (r.blockAcc||0) + r.cfg.focus*60; r.start = null; r.cycles = (r.cycles||0) + 1;
        const long = r.cycles % r.cfg.every === 0;
        r.phase = long ? "long" : "short"; r.breakLen = (long ? r.cfg.long : r.cfg.short)*60; r.breakStart = endAt; changed = true;
        if (now - endAt < 90000) alert = ["Hora da pausa", (long ? "Pausa longa" : "Pausa")+" de "+(r.breakLen/60)+" min. "+r.cycles+(r.cycles===1?" ciclo concluído.":" ciclos concluídos.")];
        continue;
      }
      const endAt = r.breakStart + r.breakLen*1000;
      if (now < endAt + JITTER*1000) break;
      const fresh = now - endAt < 90000;
      r.phase = "focus"; r.blockAcc = r.acc||0; r.start = (r.cfg.auto && fresh) ? endAt : null; changed = true;
      if (fresh) alert = ["Fim da pausa", r.start ? "Novo foco de "+r.cfg.focus+" min começou." : "Quando quiser, comece o próximo foco."];
      continue;
    }
    break;
  }
  if (changed){ store.saveConfig(); renderTimer(); if (alert) alertUser(alert[0], alert[1]); }
}

/* som e notificação */
let audioCtx = null;
function unlockAudio(){ try { audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)(); if (audioCtx.state === "suspended") audioCtx.resume(); } catch(e){} }
function beep(){
  if (!prefs().sound) return;
  try {
    unlockAudio(); const t = audioCtx.currentTime;
    [[0,784],[0.28,988],[0.56,1175]].forEach(([d,f]) => {
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.type = "sine"; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t+d); g.gain.exponentialRampToValueAtTime(0.3, t+d+0.02); g.gain.exponentialRampToValueAtTime(0.0001, t+d+0.26);
      o.connect(g).connect(audioCtx.destination); o.start(t+d); o.stop(t+d+0.28);
    });
  } catch(e){}
}
function askNotify(){ if (env.mode==="site" && prefs().mode!=="free" && "Notification" in window && Notification.permission==="default") Notification.requestPermission().catch(()=>{}); }
function alertUser(title, body){
  beep();
  if (env.notify) env.notify(title, body);
  const st = $("status"); if (st){ st.textContent = title+". "+body; }
}

const SVG = {
  play:'<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z"/></svg>',
  pause:'<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4.5" height="14" rx="1.5"/><rect x="13.5" y="5" width="4.5" height="14" rx="1.5"/></svg>',
  stop:'<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2.5"/></svg>',
  questoes:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  jurisprudencia:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v16M7 20h10M5 7h14M5 7l-3 6a3 3 0 0 0 6 0zM19 7l-3 6a3 3 0 0 0 6 0z"/></svg>',
  flashcards:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"><rect x="3" y="7" width="13" height="13" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-3"/></svg>',
  other:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5V6a2 2 0 0 1 2-2h12v15H6a2 2 0 0 0-2 2"/></svg>',
};
function svgEl(name){ const s = document.createElement("span"); s.style.display = "contents"; s.innerHTML = SVG[name] || SVG.other; return s; }
function catIcon(c){ return el("span",{class:"ci",style:"background:"+colorOf(c)}, svgEl(SVG[c.id] ? c.id : "other")); }

function renderModeBar(){
  const bar = $("modeBar"), opts = $("modeOpts"), p = prefs();
  const idle = !config.running && !finishing;
  bar.hidden = opts.hidden = !idle;
  if (!idle) return;
  bar.replaceChildren(...Object.entries(MODES).map(([k,v]) => el("button",{type:"button","aria-pressed":String(p.mode===k),onclick:()=>setPrefs({mode:k})}, v)));
  opts.replaceChildren();
  const opt = (label, on, fn, hint) => el("button",{type:"button",class:"opt","aria-pressed":String(on),title:hint||"",onclick:fn}, label);
  const num = (id, val, min, max, step, onset, aria) => el("input",{type:"number",id,min:String(min),max:String(max),step:String(step),value:String(val),"aria-label":aria,onchange:e=>{ const v = parseFloat(e.target.value); if (v>=min && v<=max) onset(v); }});
  if (p.mode==="free") opts.append(el("span",{class:"note-sm"},"Conta o tempo livremente até você encerrar."));
  if (p.mode==="countdown"){
    [15,25,45,60,90].forEach(m => opts.append(opt(fmtGoal(m), p.cdMin===m, ()=>setPrefs({cdMin:m}))));
    opts.append(el("label",{class:"opt-in"}, num("cdMinIn", p.cdMin, 1, 600, 1, v=>setPrefs({cdMin:Math.round(v)}), "Minutos do regressivo"), "min"));
  }
  if (p.mode==="pomodoro"){
    POMO_PRESETS.forEach(c => opts.append(opt(c.label, p.pomo===c.id, ()=>setPrefs({pomo:c.id}), c.hint+": "+c.focus+" min de foco e "+c.short+" de pausa")));
    const c = POMO_PRESETS.find(x=>x.id===p.pomo) || POMO_PRESETS[0];
    opts.append(el("span",{class:"note-sm opt-line"}, c.focus+" min de foco, "+c.short+" de pausa"+(c.every<20 ? ", e "+c.long+" de pausa longa a cada "+c.every+" ciclos" : "")+". Só o foco conta como estudo."));
    opts.append(el("label",{class:"opt-check"}, el("input",{type:"checkbox",id:"pomoAuto",checked:p.auto,onchange:e=>setPrefs({auto:e.target.checked})}), "Emendar o próximo ciclo sozinho"));
  }
  if (p.mode==="exam"){
    opts.append(el("label",{class:"opt-in"}, "Duração", num("examMinIn", p.examMin/60, 0.5, 8, 0.5, v=>setPrefs({examMin:Math.round(v*60)}), "Duração do simulado em horas"), "h"));
    opts.append(el("label",{class:"opt-in"}, num("examQIn", p.examQ, 1, 300, 1, v=>setPrefs({examQ:Math.round(v)}), "Número de questões"), "questões"));
    opts.append(el("span",{class:"note-sm opt-line"}, "Ritmo: "+(p.examMin/p.examQ).toFixed(1).replace(".",",")+" min por questão. Prova da FCC para Analista: 4h e 60 questões, mais a redação."));
  }
  if (p.mode!=="free") opts.append(el("label",{class:"opt-check"}, el("input",{type:"checkbox",id:"soundOn",checked:p.sound,onchange:e=>setPrefs({sound:e.target.checked})}), "Aviso sonoro"));
}

function renderTimer(){
  const r = config.running, p = prefs();
  const ph = !finishing && r ? phaseInfo() : null;
  const panel = $("clockPanel");
  panel.dataset.state = finishing ? "finishing" : !r ? "idle" : (ph && ph.kind==="break") ? "break" : (ph && ph.kind==="done") ? "done" : r.start ? "running" : "paused";
  const picker = $("catPicker"); picker.replaceChildren();
  const locked = !!r || !!finishing;
  config.categories.forEach(c => picker.append(el("button",{class:"chip",style:"--chipc:"+colorOf(c),"aria-pressed": String(selCat===c.id), disabled: locked && selCat!==c.id, onclick:()=>{ if(locked) return; selCat=c.id; renderTimer(); }}, catIcon(c), c.name)));
  if (!locked) picker.append(el("button",{class:"chip add",onclick:()=>{ $("newCatRow").hidden=false; $("newCatName").focus(); }}, "+ Nova atividade"));
  renderModeBar();

  const t = $("time"), st = $("status"), ctr = $("controls"), pill = $("modePill");
  ctr.replaceChildren();
  $("finish").hidden = !finishing;
  $("goalEdit").hidden = !!finishing || !!r;
  pill.hidden = !r || !!finishing || r.mode==="free" || !r.mode;
  const big = (cls, icon, label, fn) => el("button",{class:"btn big"+(cls?" "+cls:""),type:"button",onclick:fn}, icon ? svgEl(icon) : null, label);
  if (finishing){
    t.textContent = fmtClock(finishing.dur); t.classList.add("paused");
    st.textContent = "Sessão encerrada: "+fmtDur(finishing.dur)+" de "+catById(finishing.cat).name.toLowerCase()+".";
    $("finishDur").textContent = "";
    $("qtyLabel").textContent = (finishing.mode==="exam" ? "Questões feitas" : (QTY_LABEL[finishing.cat]||"Quantidade"))+" (opcional)";
    $("fQty").placeholder = finishing.mode==="exam" && finishing.questions ? String(finishing.questions) : "";
  } else if (!r){
    t.classList.remove("paused");
    const preview = {free:0, countdown:p.cdMin*60, exam:p.examMin*60, pomodoro:((POMO_PRESETS.find(x=>x.id===p.pomo)||POMO_PRESETS[0]).focus)*60}[p.mode];
    t.textContent = fmtClock(preview);
    const done = todaySeconds();
    st.textContent = done > 0 ? "Você já estudou "+fmtDur(done)+" hoje. Vamos para mais uma rodada?" : "Escolha a atividade e aperte começar.";
    const label = {free:"Começar", countdown:"Começar "+fmtGoal(p.cdMin), pomodoro:"Começar foco", exam:"Começar simulado"}[p.mode];
    ctr.append(big("primary","play",label,()=>startTimer()));
  } else {
    const since = new Date(r.first||Date.now());
    const what = r.taskText ? r.taskText : catById(r.cat).name.toLowerCase();
    if (ph.kind==="done"){
      st.textContent = r.mode==="exam" ? "Fim do simulado! Registre as questões feitas." : "Tempo esgotado! Registre a sessão ou estenda o tempo.";
      ctr.append(big("primary","stop","Registrar sessão",stopTimer), big("",null,"+5 min",()=>extendTimer(5)), big("",null,"+15 min",()=>extendTimer(15)));
    } else if (ph.kind==="break"){
      st.textContent = (r.phase==="long" ? "Pausa longa" : "Pausa")+": levante, beba água, descanse a vista.";
      ctr.append(big("primary","play","Pular pausa",skipBreak), big("","stop","Encerrar",stopTimer));
    } else if (ph.kind==="focus" && ph.waiting && r.cycles){
      st.textContent = "Pausa encerrada. Pronto para o próximo foco?";
      ctr.append(big("primary","play","Começar foco",resumeTimer), big("","stop","Encerrar",stopTimer));
    } else {
      st.textContent = r.start ? (r.taskText ? "Estudando: "+r.taskText+" · desde " : "Estudando "+what+" desde ")+pad(since.getHours())+":"+pad(since.getMinutes())+"." : "Pausado. Respira, e retome quando quiser.";
      ctr.append(r.start ? big("","pause","Pausar",pauseTimer) : big("primary","play","Continuar",resumeTimer));
      ctr.append(big(r.start?"primary":"","stop","Encerrar",stopTimer));
    }
  }
  renderGoalEdit(); updateTimeDisplay(); renderMini();
}

/* botão único da janela flutuante: pausar / continuar */
function renderMini(){
  const b = $("miniToggle"); if (!b) return;
  const r = config.running, ph = r && !finishing ? phaseInfo() : null;
  let icon = "play", label = "Começar", fn = () => startTimer();
  if (finishing || (ph && ph.kind==="done")){ icon = "play"; label = "+5 min"; fn = () => extendTimer(5); }
  else if (ph && ph.kind==="break"){ icon = "play"; label = "Pular pausa"; fn = skipBreak; }
  else if (r && r.start){ icon = "pause"; label = "Pausar"; fn = pauseTimer; }
  else if (r){ icon = "play"; label = "Continuar"; fn = resumeTimer; }
  b.replaceChildren(svgEl(icon)); b.title = label; b.setAttribute("aria-label", label); b.onclick = fn;
  b.hidden = !!finishing;
  // finalizar: encerra e abre o registro da sessão na janela principal
  const s = $("miniStop");
  s.replaceChildren(svgEl("stop")); s.hidden = !r || !!finishing;
  s.onclick = () => { stopTimer(); if (pipWin) pipWin.close(); };
}

/* tempo, anel e linha de ritmo (atualizados a cada segundo) */
function updateTimeDisplay(){
  const r = config.running, t = $("time");
  if (finishing || !r){ updateRing(); return; }
  const ph = phaseInfo();
  t.classList.toggle("paused", !r.start && ph.kind!=="break");
  t.textContent = ph.kind==="free" ? fmtClock(elapsed()) : fmtClock(Math.max(0, Math.ceil(ph.remaining)));
  const pill = $("modePill");
  if (r.mode==="pomodoro") pill.textContent = "Pomodoro "+r.cfg.label+" · "+(ph.kind==="break" ? (r.phase==="long"?"pausa longa":"pausa") : "foco "+((r.cycles||0)+1));
  else if (r.mode==="countdown") pill.textContent = "Regressivo · "+fmtGoal(Math.round(r.target/60));
  else if (r.mode==="exam") pill.textContent = "Simulado · "+r.questions+" questões";
  if (r.mode==="exam" && ph.kind==="count" && r.start){
    const per = r.target / r.questions, q = Math.min(r.questions, Math.floor(elapsed()/per) + 1);
    $("status").textContent = "Pelo ritmo, você deveria estar na questão "+q+" de "+r.questions+" ("+(per/60).toFixed(1).replace(".",",")+" min cada).";
  }
  updateRing();
}

/* meta diária + anel */
let editingGoal = false;
function todaySeconds(){
  const base = sessionsSince(1).reduce((a,s)=>a+(s.dur||0),0);
  return base + (finishing ? finishing.dur : (config.running ? elapsed() : 0));
}
function fmtGoal(min){ const h = Math.floor(min/60), m = min%60; return h ? h+"h"+(m? pad(m) : "") : m+"min"; }
function updateRing(){
  const r = config.running;
  if (r && !finishing && r.mode && r.mode!=="free"){
    const ph = phaseInfo(), pr = $("ringProg"), g = $("ringGoal");
    pr.setAttribute("stroke-dashoffset", (666*(1-ph.frac)).toFixed(1));
    pr.setAttribute("stroke", ph.kind==="break" ? "var(--warn)" : ph.kind==="done" ? "var(--good)" : "var(--cat5)");
    g.replaceChildren(ph.kind==="break" ? "pausa de "+Math.round(ph.total/60)+" min" : ph.kind==="done" ? "concluído" : el("b",{}, fmtDur(r.mode==="pomodoro" ? blockElapsed() : elapsed())), ph.kind==="count"||ph.kind==="focus" ? " de "+fmtGoal(Math.round(ph.total/60)) : "");
    return;
  }
  const goal = (config.dailyGoal||240)*60, done = todaySeconds();
  const frac = Math.min(1, done/goal);
  const pr = $("ringProg"); pr.setAttribute("stroke-dashoffset", (666*(1-frac)).toFixed(1));
  pr.setAttribute("stroke", frac>=1 ? "var(--good)" : "var(--accent)");
  const g = $("ringGoal"); g.replaceChildren();
  if (frac>=1) g.append("Meta do dia cumprida!");
  else g.append(el("b",{}, fmtDur(done)), " de "+fmtGoal(config.dailyGoal||240)+" hoje");
}
function renderGoalEdit(){
  const box = $("goalEdit"); box.replaceChildren();
  if (!editingGoal){
    box.append("Meta diária: "+fmtGoal(config.dailyGoal||240)+" · ", el("button",{class:"btn ghost sm",style:"padding:2px 6px",onclick:()=>{ editingGoal = true; renderGoalEdit(); $("goalInput").focus(); }},"Alterar"));
    return;
  }
  const inp = el("input",{type:"number",id:"goalInput",min:"0.5",max:"16",step:"0.5",value:String((config.dailyGoal||240)/60),"aria-label":"Meta diária em horas"});
  const save = () => { const h = parseFloat(inp.value); if (h>0 && h<=16){ config.dailyGoal = Math.round(h*60); store.saveConfig(); } editingGoal = false; renderGoalEdit(); updateRing(); };
  inp.addEventListener("keydown", e => { if (e.key==="Enter") save(); if (e.key==="Escape"){ editingGoal=false; renderGoalEdit(); } });
  box.append(el("span",{class:"row",style:"justify-content:center;gap:6px"}, "Meta diária", inp, "horas", el("button",{class:"btn primary sm",onclick:save},"Salvar")));
}
$("newCatSave").addEventListener("click", addCategory);
$("newCatName").addEventListener("keydown", e => { if (e.key==="Enter") addCategory(); if (e.key==="Escape") $("newCatCancel").click(); });
$("newCatCancel").addEventListener("click", () => { $("newCatRow").hidden=true; $("newCatName").value=""; });
function addCategory(){
  const name = $("newCatName").value.trim(); if (!name) return;
  if (config.categories.some(c=>c.name.toLowerCase()===name.toLowerCase())){ $("newCatName").select(); return; }
  const used = new Set(config.categories.map(c=>c.color));
  let color = 0; while (used.has(color) && color<7) color++;
  const id = name.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g,"").replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"").slice(0,30) || uid();
  config.categories.push({id: config.categories.some(c=>c.id===id)? id+"-"+uid().slice(-4) : id, name, color});
  selCat = config.categories[config.categories.length-1].id;
  $("newCatRow").hidden = true; $("newCatName").value = "";
  store.saveConfig(); renderAll();
}
$("fSave").addEventListener("click", saveFinish);
$("fBack").addEventListener("click", () => { finishing = null; renderTimer(); });
inlineConfirm($("fDiscardWrap"), "Descartar esta sessão?", discardFinish);

/* ---------- agregações ---------- */
function sessionsSince(days){ if (!days) return sessions; const from = startOfDay(Date.now()).getTime() - (days-1)*86400000; return sessions.filter(s=>s.start>=from); }
function byCat(list){
  const m = new Map();
  list.forEach(s => { const x = m.get(s.cat) || {dur:0,qty:0,ok:0,okBase:0,n:0}; x.dur+=s.dur||0; x.n++; if (s.qty!=null){ x.qty+=s.qty; if (s.ok!=null){ x.ok+=s.ok; x.okBase+=s.qty; } } m.set(s.cat,x); });
  return m;
}
function perDay(){ const m = new Map(); sessions.forEach(s => m.set(dayKey(s.start), (m.get(dayKey(s.start))||0) + (s.dur||0))); return m; }
function streak(){
  const pd = perDay(); let d = startOfDay(Date.now()); let n = 0;
  if (!pd.get(dayKey(d.getTime()))) d = new Date(d.getTime()-86400000);
  while (pd.get(dayKey(d.getTime()))){ n++; d = new Date(d.getTime()-86400000); }
  return n;
}
function weekStart(){ const d = startOfDay(Date.now()); const wd = (d.getDay()+6)%7; return d.getTime()-wd*86400000; }
function renderBars(container, list, withSub){
  container.replaceChildren();
  const m = byCat(list);
  const ids = [...new Set([...config.categories.map(c=>c.id), ...m.keys()])].filter(id => m.has(id) || !catById(id).removed);
  const max = Math.max(1, ...[...m.values()].map(x=>x.dur));
  if (!list.length){ container.append(el("p",{class:"empty"}, "Nenhuma sessão neste período ainda. Use o cronômetro ou lance uma sessão manualmente.")); }
  ids.forEach(id => {
    const c = catById(id), x = m.get(id) || {dur:0,qty:0,ok:0,okBase:0,n:0};
    if (!list.length) return;
    const row = el("div",{class:"bar"},
      el("div",{class:"name"}, el("span",{style:"background:"+colorOf(c)+";width:10px;height:10px;border-radius:50%;flex:none;display:inline-block"}), el("span",{}, c.name)),
      el("div",{class:"track"}, el("div",{class:"fill",style:"width:"+(x.dur/max*100).toFixed(1)+"%;background:"+colorOf(c)})),
      el("div",{class:"val"}, fmtDur(x.dur)));
    if (withSub && (x.qty || x.n)){
      const parts = [x.n+" sess"+(x.n===1?"ão":"ões")];
      if (x.qty) parts.push(x.qty+" "+(c.id==="questoes"?"questões":c.id==="flashcards"?"cards":c.id==="jurisprudencia"?"julgados":"itens"));
      if (x.okBase) parts.push(Math.round(x.ok/x.okBase*100)+"% de acerto");
      row.append(el("div",{class:"sub"}, parts.join(" · ")));
    }
    container.append(row);
  });
}

/* ---------- saudação ---------- */
function renderHello(){
  const now = new Date(), h = now.getHours();
  $("helloTitle").textContent = (h<12 ? "Bom dia" : h<18 ? "Boa tarde" : "Boa noite") + ", " + firstName();
  { const dt = now.toLocaleDateString("pt-BR",{weekday:"long", day:"numeric", month:"long"}); $("helloDate").textContent = dt.charAt(0).toUpperCase()+dt.slice(1); }
  const up = upcomingExams(), done = todaySeconds();
  let sub;
  if (config.running && config.running.start) sub = "Cronômetro rodando. Foco total!";
  else if (upcomingDeadlines(1,3).length){ const d = upcomingDeadlines(1,3)[0]; const quando = d.days===0?"hoje":d.days===1?"amanhã":"em "+d.days+" dias"; const n = d.exam.name;
    sub = "Atenção: " + (d.type==="pag" ? "o pagamento da taxa do "+n+" vence "+quando : d.type==="insc-fim" ? "as inscrições do "+n+" terminam "+quando : d.type==="insc-ini" ? "as inscrições do "+n+" abrem "+quando : d.label+" ("+n+") "+quando) + "."; }
  else if (up.length){ const cd = countdown(up[0]); sub = cd.days===0 ? "Hoje é dia de "+up[0].name+". Boa prova!" : "Faltam "+cd.days+(cd.days===1?" dia":" dias")+" para "+up[0].name+"."; }
  else sub = done ? "Bom ritmo hoje. Continue assim." : "Um passo de cada vez. Que tal começar agora?";
  $("helloSub").textContent = sub;
}

/* ---------- painel lateral do cronômetro ---------- */
function renderToday(){
  const today = sessionsSince(1), week = sessions.filter(s=>s.start>=weekStart());
  const live = finishing ? 0 : (config.running ? elapsed() : 0);
  $("kToday").textContent = fmtDur(today.reduce((a,s)=>a+(s.dur||0),0) + live);
  $("kWeek").textContent = fmtDur(week.reduce((a,s)=>a+(s.dur||0),0) + live);
  const k = streak(); $("kStreak").textContent = k+(k===1?" dia":" dias");
  renderBars($("todayBars"), today, true);
  if (!today.length){ $("todayBars").replaceChildren(el("p",{class:"empty"},"Suas atividades de hoje vão aparecer aqui.")); }
  const nx = $("nextExam"); nx.replaceChildren();
  const up = upcomingExams();
  const dl = upcomingDeadlines(3, 30);
  const dlBox = el("div",{class:"stack",style:"gap:8px"});
  if (dl.length){ const b = el("div"); renderDeadlines(b, 3, 30); dlBox.append(el("span",{class:"label"},"Prazos nos próximos 30 dias"), b); }
  if (!up.length){ nx.append(el("div",{class:"row"}, el("p",{class:"empty"},"Cadastre seu concurso para acompanhar a contagem e os prazos."), el("button",{class:"btn sm",onclick:()=>showTab("exams")},"Cadastrar concurso")), dlBox); return; }
  const e = up[0], cd = countdown(e);
  nx.append(el("div",{class:"next"},
    el("span",{class:"big num"}, String(cd.days), el("small",{}, cd.days===1?"dia":"dias")),
    el("strong",{}, e.name),
    el("span",{class:"meta num"}, fmtExamDate(e)),
    el("span",{class:"meta num",id:"nextLive"}, "Faltam "+cd.text)));
  if (up.length>1) nx.append(el("span",{class:"note-sm"}, "Depois: "+up.slice(1,3).map(x=>x.name+" ("+countdown(x).days+" dias)").join(", ")));
  nx.append(dlBox);
}

/* ---------- estatísticas ---------- */
$("period").addEventListener("click", e => { const b = e.target.closest("button"); if (!b) return; period = +b.dataset.p; document.querySelectorAll("#period button").forEach(x=>x.setAttribute("aria-pressed", String(x===b))); renderStats(); });
function renderStats(){
  const list = sessionsSince(period);
  const total = list.reduce((a,s)=>a+(s.dur||0),0);
  let days = period;
  if (!period){ days = sessions.length ? Math.max(1, Math.round((startOfDay(Date.now()) - startOfDay(sessions[sessions.length-1].start))/86400000)+1) : 1; }
  $("sTotal").textContent = fmtDur(total); $("sAvg").textContent = fmtDur(total/days); $("sCount").textContent = list.length;
  renderBars($("statBars"), list, true);
  renderChart(); renderLog(); renderCatAdmin(); fillCatSelect();
  renderHours("hoursChart", list, "hoursNote");
  $("hoursPeriod").textContent = period===1 ? "hoje" : period ? "nos últimos "+period+" dias" : "desde o início";
}
function renderChart(){
  const N = 14, W = 700, H = 220, padL = 44, padB = 28, padT = 12, padR = 8;
  const start = startOfDay(Date.now()).getTime() - (N-1)*86400000;
  const days = [...Array(N)].map((_,i)=>({t:start+i*86400000, cats:new Map(), total:0}));
  sessions.forEach(s => { const i = Math.floor((startOfDay(s.start).getTime()-start)/86400000); if (i<0||i>=N) return; days[i].total += s.dur||0; days[i].cats.set(s.cat,(days[i].cats.get(s.cat)||0)+(s.dur||0)); });
  const maxH = Math.max(1, ...days.map(d=>d.total/3600));
  const step = maxH<=2?0.5:maxH<=4?1:maxH<=8?2:3;
  const top = Math.ceil(maxH/step)*step;
  const y = v => padT + (H-padT-padB)*(1 - v/top);
  const bw = (W-padL-padR)/N;
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns,"svg"); svg.setAttribute("viewBox",`0 0 ${W} ${H}`); svg.setAttribute("role","img"); svg.setAttribute("aria-label","Horas de estudo por dia nos últimos 14 dias");
  const add = (tag, a, txt) => { const e = document.createElementNS(ns,tag); for (const k in a) e.setAttribute(k,a[k]); if (txt!=null) e.textContent = txt; svg.append(e); return e; };
  for (let v=0; v<=top+1e-9; v+=step){ add("line",{x1:padL,x2:W-padR,y1:y(v),y2:y(v),stroke:"var(--line)","stroke-width":1}); add("text",{x:padL-8,y:y(v)+4,"text-anchor":"end","font-size":11,fill:"var(--ink-3)","font-family":"Manrope, sans-serif"}, (Number.isInteger(v)?v:v.toFixed(1))+"h"); }
  const order = config.categories.map(c=>c.id);
  days.forEach((d,i) => {
    let acc = 0; const x = padL + i*bw + bw*0.18, w = bw*0.64;
    const ids = [...d.cats.keys()].sort((a,b)=>(order.indexOf(a)+99*(order.indexOf(a)<0))-(order.indexOf(b)+99*(order.indexOf(b)<0)));
    ids.forEach(id => { const h = d.cats.get(id)/3600; add("rect",{x, y:y(acc+h), rx:3, width:w, height:Math.max(0,y(acc)-y(acc+h)), fill:colorOf(catById(id))}); acc+=h; });
    const dt = new Date(d.t), isToday = i===N-1;
    add("text",{x:x+w/2,y:H-10,"text-anchor":"middle","font-size":11,fill:isToday?"var(--ink)":"var(--ink-3)","font-weight":isToday?600:400,"font-family":"Manrope, sans-serif"}, pad(dt.getDate())+"/"+pad(dt.getMonth()+1));
  });
  $("chart").replaceChildren(svg);
  const lg = $("chartLegend"); lg.replaceChildren();
  config.categories.forEach(c => lg.append(el("i",{style:"background:"+colorOf(c)}), el("span",{style:"margin-right:6px"}, c.name)));
}
function renderLog(){
  const tb = $("logBody"); tb.replaceChildren();
  $("logCount").textContent = sessions.length ? sessions.length+" no total" : "";
  if (!sessions.length){ tb.append(el("tr",{}, el("td",{colspan:5,class:"empty"},"Suas sessões aparecem aqui."))); $("logMore").hidden = true; return; }
  sessions.slice(0,logLimit).forEach(s => {
    const c = catById(s.cat), d = new Date(s.start);
    const items = s.qty!=null ? (s.qty + (s.ok!=null ? " · "+s.ok+" ✓" : "")) : "—";
    const actions = el("td",{style:"text-align:right"});
    const wrap = el("span",{class:"confirm"}, el("button",{class:"btn ghost sm danger","aria-label":"Apagar sessão"},"Apagar"));
    actions.append(wrap); inlineConfirm(wrap, "Apagar?", () => store.delSession(s.id));
    tb.append(el("tr",{},
      el("td",{class:"n"}, pad(d.getDate())+"/"+pad(d.getMonth()+1)+" "+pad(d.getHours())+":"+pad(d.getMinutes())),
      el("td",{}, el("span",{style:"display:inline-flex;gap:6px;align-items:center"}, el("span",{style:"width:9px;height:9px;border-radius:2px;background:"+colorOf(c)}), c.name), s.note ? el("div",{class:"note-sm"}, s.note) : null),
      el("td",{class:"n"}, fmtDur(s.dur)),
      el("td",{class:"n"}, items),
      actions));
  });
  $("logMore").hidden = sessions.length <= logLimit;
}
$("logMore").addEventListener("click", () => { logLimit += 30; renderLog(); });
function renderCatAdmin(){
  const box = $("catAdmin"); box.replaceChildren();
  config.categories.forEach((c,i) => {
    const wrap = el("span",{class:"confirm"}, el("button",{class:"btn ghost sm danger",disabled:config.categories.length<=1 || (config.running&&config.running.cat===c.id)},"Remover"));
    inlineConfirm(wrap, "Remover “"+c.name+"”?", () => { config.categories = config.categories.filter(x=>x.id!==c.id); if (selCat===c.id) selCat = config.categories[0].id; store.saveConfig(); renderAll(); });
    box.append(el("div",{class:"row between"}, el("span",{style:"display:inline-flex;gap:8px;align-items:center"}, el("span",{style:"width:12px;height:12px;border-radius:3px;background:"+colorOf(c)}), c.name), wrap));
  });
  box.append(el("button",{class:"btn sm",onclick:()=>{ showTab("timer"); $("newCatRow").hidden=false; $("newCatName").focus(); }},"+ Nova atividade"));
}
function fillCatSelect(){
  const s = $("mCat"), v = s.value; s.replaceChildren(...config.categories.map(c=>el("option",{value:c.id},c.name)));
  if (v && config.categories.some(c=>c.id===v)) s.value = v;
  if (!$("mDate").value) $("mDate").value = dayKey(Date.now());
}
$("mSave").addEventListener("click", async () => {
  const min = parseInt($("mMin").value,10), date = $("mDate").value;
  if (!date || !(min>0)){ $("mMsg").textContent = "Informe a data e os minutos."; return; }
  const [Y,M,D] = date.split("-").map(Number); const start = new Date(Y,M-1,D,12,0,0).getTime();
  const c = catById($("mCat").value);
  const s = {id:uid(), cat:c.id, catName:c.name, start, end:start+min*60000, dur:min*60, manual:true};
  const q = parseInt($("mQty").value,10), o = parseInt($("mOk").value,10);
  if (!isNaN(q)) s.qty=q; if (!isNaN(o)) s.ok=o;
  await store.addSession(s);
  $("mMin").value=""; $("mQty").value=""; $("mOk").value="";
  $("mMsg").textContent = "Lançado: "+fmtDur(s.dur)+" de "+c.name+".";
});

/* ---------- provas: ficha do concurso com datas, nota e checklist ---------- */
const EV = {
  "prova":    {label:"Prova",                 short:"Prova",    color:"var(--warn)"},
  "insc-ini": {label:"Início das inscrições", short:"Insc.",    color:"var(--cat5)", link:"insc"},
  "insc-fim": {label:"Fim das inscrições",    short:"Fim insc.",color:"var(--cat4)", link:"insc"},
  "pag":      {label:"Pagamento da taxa",     short:"Pagto",    color:"var(--cat2)", link:"pag"},
  "outra":    {label:"Outra data",            short:"",         color:"var(--cat0)"},
};
const DEFAULT_CHECKS = [["insc","Inscrição feita"],["pag","Taxa paga"],["local","Local de prova conferido"]];
let examEditing = null; // null | "new" | id
function ensureExam(e){
  if (!Array.isArray(e.checks)) e.checks = DEFAULT_CHECKS.map(([key,text]) => ({id:uid(), key, text, done:false}));
  if (!Array.isArray(e.extra)) e.extra = [];
  return e;
}
function parseDay(s){ const [Y,M,D] = s.split("-").map(Number); return new Date(Y,M-1,D).getTime(); }
function relDays(s){
  const n = Math.round((parseDay(s) - startOfDay(Date.now()).getTime())/86400000);
  return n===0 ? "hoje" : n===1 ? "amanhã" : n===-1 ? "ontem" : n>1 ? "em "+n+" dias" : "há "+(-n)+" dias";
}
function fmtDay(s){ const d = new Date(parseDay(s)); return DOW[d.getDay()]+", "+pad(d.getDate())+"/"+pad(d.getMonth()+1)+"/"+d.getFullYear(); }
function examEvents(e){
  ensureExam(e);
  const out = [];
  if (e.date) out.push({type:"prova", date:e.date, time:e.time, label:EV.prova.label});
  if (e.inscIni) out.push({type:"insc-ini", date:e.inscIni, label:EV["insc-ini"].label});
  if (e.inscFim) out.push({type:"insc-fim", date:e.inscFim, label:EV["insc-fim"].label});
  if (e.pag) out.push({type:"pag", date:e.pag, label:EV.pag.label});
  e.extra.forEach(x => { if (x.date) out.push({type:"outra", date:x.date, label:x.label||"Outra data"}); });
  out.forEach(ev => { ev.exam = e; const link = EV[ev.type].link; ev.done = !!(link && e.checks.some(c=>c.key===link && c.done)); ev.days = Math.round((parseDay(ev.date) - startOfDay(Date.now()).getTime())/86400000); });
  return out.sort((a,b)=>parseDay(a.date)-parseDay(b.date));
}
function allEvents(){ return config.exams.flatMap(examEvents).sort((a,b)=>parseDay(a.date)-parseDay(b.date)); }
function upcomingDeadlines(limit, withinDays){ return allEvents().filter(ev => ev.type!=="prova" && !ev.done && ev.days>=0 && (withinDays==null || ev.days<=withinDays)).slice(0,limit); }

// sem horário informado, conta até o início do dia da prova e só considera "realizada" quando o dia acaba
function examTime(e){ const [Y,M,D] = e.date.split("-").map(Number); const [h,m] = (e.time||"00:00").split(":").map(Number); return new Date(Y,M-1,D,h,m).getTime(); }
function upcomingExams(){ return config.exams.filter(e=>e.date && !countdown(e).past).sort((a,b)=>examTime(a)-examTime(b)); }
function countdown(e){
  const ms = examTime(e)-Date.now();
  const days = Math.floor((startOfDay(examTime(e)) - startOfDay(Date.now()))/86400000);
  if (ms<=0){ if (!e.time && Date.now() < examTime(e)+86400000) return {days:0, text:"a prova é hoje", past:false}; return {days, text:"prova realizada", past:true}; }
  const s = Math.floor(ms/1000), d = Math.floor(s/86400), h = Math.floor(s%86400/3600), m = Math.floor(s%3600/60), sec = s%60;
  return {days, text: (d? d+"d ":"")+pad(h)+"h "+pad(m)+"min "+pad(sec)+"s", past:false};
}
function fmtExamDate(e){ const d = new Date(examTime(e)); return DOW[d.getDay()]+", "+pad(d.getDate())+"/"+pad(d.getMonth()+1)+"/"+d.getFullYear()+(e.time ? " às "+e.time : " · horário não informado"); }
function saveExams(){ store.saveConfig(); renderAll(); }

function renderExams(){
  renderExamForm();
  const list = $("examList"); list.replaceChildren();
  const sorted = config.exams.slice().sort((a,b)=>(a.date?examTime(a):9e15)-(b.date?examTime(b):9e15));
  const past = sorted.filter(e => e.date && countdown(e).past), future = sorted.filter(e => !(e.date && countdown(e).past));
  if (!sorted.length && examEditing===null) list.append(el("div",{class:"panel stack"}, el("p",{class:"empty"},"Cadastre seu primeiro concurso com as datas de inscrição, pagamento e prova."), el("div",{}, el("button",{class:"btn primary",onclick:()=>{ examEditing="new"; renderExams(); }},"+ Novo concurso"))));
  [...future, ...past].forEach(e => list.append(examCard(ensureExam(e))));
  renderDeadlines($("deadlines"), 6, null);
  renderCal();
}
function examCard(e){
  const cd = e.date ? countdown(e) : null;
  const delWrap = el("span",{class:"confirm"}, el("button",{class:"btn ghost sm danger"},"Remover"));
  inlineConfirm(delWrap, "Remover este concurso?", () => { config.exams = config.exams.filter(x=>x.id!==e.id); saveExams(); });
  const card = el("article",{class:"panel ecard"+(cd&&cd.past?" past":"")});
  card.append(el("div",{class:"ec-head"},
    el("div",{class:"stack",style:"gap:2px;min-width:0"}, el("h3",{}, e.name), cd ? el("span",{class:"meta num","data-live":e.id}, fmtExamDate(e)+(cd.past?"":" · "+cd.text)) : el("span",{class:"meta"},"Data da prova ainda não definida")),
    cd ? el("span",{class:"cd-pill"+(cd.past?" past":cd.days<=30?" soon":"")}, cd.past ? "Realizada" : cd.days===0 ? "É hoje!" : el("span",{}, el("b",{}, String(cd.days)), cd.days===1?" dia":" dias")) : null));
  // datas
  const evs = examEvents(e);
  if (evs.length){
    const tl = el("ul",{class:"timeline"});
    evs.forEach(ev => {
      const state = ev.done ? "done" : ev.days<0 ? "past" : ev.days<=3 ? "near" : "";
      tl.append(el("li",{class:state},
        el("span",{class:"tdot",style:"background:"+EV[ev.type].color}),
        el("span",{class:"tl-label"}, ev.label),
        el("span",{class:"tl-date num"}, fmtDay(ev.date)+(ev.type==="prova"&&ev.time? " · "+ev.time : "")),
        el("span",{class:"tl-rel"}, ev.done ? "feito ✓" : relDays(ev.date))));
    });
    card.append(tl);
  }
  if (e.note && e.note.trim()) card.append(el("div",{class:"ec-note"}, e.note));
  // checklist
  const doneN = e.checks.filter(c=>c.done).length;
  const ck = el("div",{class:"ec-checks"},
    el("div",{class:"row between"}, el("span",{class:"label"},"Checklist"), el("span",{class:"note-sm num"}, doneN+" de "+e.checks.length)),
    el("div",{class:"ec-prog"}, el("div",{style:"width:"+(e.checks.length? doneN/e.checks.length*100 : 0)+"%"})));
  const ul = el("ul",{class:"checks"});
  e.checks.forEach(c => {
    const id = "ck-"+e.id+"-"+c.id;
    ul.append(el("li",{class:c.done?"done":""},
      el("input",{type:"checkbox",id,checked:c.done,onchange:ev=>{ c.done = ev.target.checked; saveExams(); }}),
      el("label",{for:id}, c.text),
      el("button",{class:"x",type:"button","aria-label":"Remover item "+c.text,title:"Remover item",onclick:()=>{ e.checks = e.checks.filter(x=>x!==c); saveExams(); }},"×")));
  });
  const addInp = el("input",{type:"text",placeholder:"Adicionar item (ex.: Imprimir cartão de confirmação)",maxlength:"90","aria-label":"Novo item do checklist",id:"ckadd-"+e.id});
  const add = () => { const t = addInp.value.trim(); if (!t) return; e.checks.push({id:uid(), text:t, done:false}); saveExams(); setTimeout(()=>{ const n = $("ckadd-"+e.id); if (n) n.focus(); },0); };
  addInp.addEventListener("keydown", ev => { if (ev.key==="Enter") add(); });
  ck.append(ul, el("div",{class:"row ck-add"}, addInp, el("button",{class:"btn sm",type:"button",onclick:add},"Adicionar")));
  card.append(ck);
  card.append(el("div",{class:"row",style:"justify-content:flex-end;gap:4px"}, el("button",{class:"btn ghost sm",onclick:()=>{ examEditing = e.id; renderExams(); $("examForm").scrollIntoView({block:"nearest",behavior:"smooth"}); }},"Editar datas e nota"), delWrap));
  return card;
}
function renderDeadlines(box, limit, within){
  box.replaceChildren();
  const list = upcomingDeadlines(limit, within);
  if (!list.length){ box.append(el("p",{class:"empty"}, within!=null ? "Nenhum prazo nos próximos "+within+" dias." : "Nenhum prazo pendente. Cadastre datas de inscrição e pagamento nos seus concursos.")); return; }
  const ul = el("ul",{class:"timeline compact-tl"});
  list.forEach(ev => ul.append(el("li",{class:ev.days<=3?"near":""},
    el("span",{class:"tdot",style:"background:"+EV[ev.type].color}),
    el("span",{class:"tl-label"}, ev.label+" · ", el("b",{}, ev.exam.name)),
    el("span",{class:"tl-date num"}, fmtDay(ev.date)),
    el("span",{class:"tl-rel"}, relDays(ev.date)))));
  box.append(ul);
}

/* formulário de concurso (novo ou edição) */
let formFor;
function renderExamForm(){
  const box = $("examForm");
  box.hidden = examEditing===null;
  $("eAdd").hidden = examEditing!==null;
  if (examEditing===null){ formFor = null; box.replaceChildren(); return; }
  if (formFor===examEditing) return; // não apaga o que está sendo digitado
  formFor = examEditing; box.replaceChildren();
  const e = examEditing==="new" ? {name:"",date:"",time:"",inscIni:"",inscFim:"",pag:"",note:"",extra:[]} : ensureExam(config.exams.find(x=>x.id===examEditing) || {});
  const extra = (e.extra||[]).map(x=>({...x}));
  const f = (label, input, flex) => el("label",{class:"field",style:"flex:"+(flex||"1 1 150px")}, el("span",{},label), input);
  const name = el("input",{type:"text",id:"efName",maxlength:"80",placeholder:"Ex.: TRF1 — Juiz Federal Substituto",value:e.name||""});
  const date = el("input",{type:"date",id:"efDate",value:e.date||""});
  const time = el("input",{type:"time",id:"efTime",value:e.time||""});
  const ini = el("input",{type:"date",id:"efIni",value:e.inscIni||""});
  const fim = el("input",{type:"date",id:"efFim",value:e.inscFim||""});
  const pag = el("input",{type:"date",id:"efPag",value:e.pag||""});
  const note = el("textarea",{id:"efNote",rows:"3",placeholder:"Ex.: Edital saiu em 02/10. Levar caneta preta transparente. Local: UFRN, setor II."});
  note.value = e.note||"";
  const extraBox = el("div",{class:"stack",style:"gap:8px"});
  const drawExtra = () => {
    extraBox.replaceChildren(...extra.map((x,i) => el("div",{class:"row"},
      el("input",{type:"text",placeholder:"Ex.: Resultado da isenção",value:x.label||"",maxlength:"60","aria-label":"Nome da data",style:"flex:2 1 160px",oninput:ev=>{ x.label = ev.target.value; }}),
      el("input",{type:"date",value:x.date||"","aria-label":"Data",style:"flex:1 1 140px",oninput:ev=>{ x.date = ev.target.value; }}),
      el("button",{class:"btn ghost sm danger",type:"button",onclick:()=>{ extra.splice(i,1); drawExtra(); }},"Remover"))));
  };
  drawExtra();
  const msg = el("span",{class:"note-sm"});
  const save = () => {
    const nm = name.value.trim();
    if (!nm){ msg.textContent = "Dê um nome ao concurso."; name.focus(); return; }
    const data = {name:nm, date:date.value, time:time.value||"", inscIni:ini.value, inscFim:fim.value, pag:pag.value, note:note.value.trim(), extra: extra.filter(x=>x.date||x.label).map(x=>({id:x.id||uid(), label:(x.label||"").trim()||"Outra data", date:x.date}))};
    if (examEditing==="new"){ const ne = ensureExam({id:uid(), ...data}); config.exams.push(ne); }
    else { const i = config.exams.findIndex(x=>x.id===examEditing); if (i>=0) config.exams[i] = {...config.exams[i], ...data}; }
    if (data.date){ const [Y,M] = data.date.split("-").map(Number); calMonth = new Date(Y,M-1,1); }
    examEditing = null; saveExams();
  };
  box.append(
    el("h2",{}, examEditing==="new" ? "Novo concurso" : "Editar concurso"),
    f("Concurso / cargo", name, "1 1 100%"),
    el("div",{class:"row",style:"align-items:flex-end"}, f("Data da prova", date), f("Horário (opcional)", time, "1 1 110px"), el("button",{class:"btn ghost sm",type:"button",onclick:()=>{ time.value=""; }},"Sem horário")),
    el("span",{class:"note-sm",style:"margin-top:-8px"},"Deixe o horário em branco se o edital ainda não informou."),
    el("div",{class:"row"}, f("Início das inscrições", ini), f("Fim das inscrições", fim), f("Pagamento da taxa (vencimento)", pag)),
    el("div",{class:"stack",style:"gap:8px"}, el("span",{class:"label"},"Outras datas"), extraBox, el("div",{}, el("button",{class:"btn sm",type:"button",onclick:()=>{ extra.push({id:uid(),label:"",date:""}); drawExtra(); }},"+ Outra data"))),
    f("Nota", note, "1 1 100%"),
    el("div",{class:"row"}, el("button",{class:"btn primary",type:"button",onclick:save}, examEditing==="new" ? "Adicionar concurso" : "Salvar alterações"), el("button",{class:"btn",type:"button",onclick:()=>{ examEditing = null; renderExams(); }},"Cancelar"), msg));
  if (examEditing==="new") setTimeout(()=>name.focus(),0);
}
$("eAdd").addEventListener("click", () => { examEditing = "new"; renderExams(); });

$("calPrev").addEventListener("click", () => { calMonth = new Date(calMonth.getFullYear(), calMonth.getMonth()-1, 1); renderCal(); });
$("calNext").addEventListener("click", () => { calMonth = new Date(calMonth.getFullYear(), calMonth.getMonth()+1, 1); renderCal(); });
$("calToday").addEventListener("click", () => { calMonth = new Date(); calMonth.setDate(1); renderCal(); });
function renderCal(){
  const y = calMonth.getFullYear(), m = calMonth.getMonth();
  $("calTitle").textContent = MESES[m].charAt(0).toUpperCase()+MESES[m].slice(1)+" de "+y;
  const cal = $("cal"); cal.replaceChildren(...DOW.map(d=>el("div",{class:"dow"},d)));
  const first = new Date(y,m,1).getDay(), n = new Date(y,m+1,0).getDate();
  const pd = perDay(), today = dayKey(Date.now());
  const byDay = new Map(); allEvents().forEach(ev => { const a = byDay.get(ev.date)||[]; a.push(ev); byDay.set(ev.date,a); });
  for (let i=0;i<first;i++) cal.append(el("div",{class:"d out"}));
  for (let d=1; d<=n; d++){
    const k = y+"-"+pad(m+1)+"-"+pad(d), sec = pd.get(k)||0, h = sec/3600;
    const lvl = sec<=0?0: h<1?1: h<2?2: h<4?3:4;
    const evs = byDay.get(k)||[];
    const tip = [sec? fmtDur(sec)+" de estudo" : "", ...evs.map(ev => ev.label+" · "+ev.exam.name)].filter(Boolean).join("\n");
    const cell = el("div",{class:"d"+(lvl?" h"+lvl:"")+(k===today?" today":""), title: tip}, el("span",{}, d));
    evs.slice(0,2).forEach(ev => cell.append(el("span",{class:"ex"+(ev.done?" done":""),style:"background:"+EV[ev.type].color}, (EV[ev.type].short ? EV[ev.type].short+" " : ev.label+" · ")+ev.exam.name)));
    if (evs.length>2) cell.append(el("span",{class:"ex more"}, "+"+(evs.length-2)));
    cal.append(cell);
  }
}

/* ---------- bloco de notas: abas coloridas, editor com formatação e grifos ---------- */
var books = [];
const NOTE_COLOR_NAMES = ["Amarelo","Rosa","Azul","Verde","Lilás","Papel"];
const HL = [["y","Amarelo"],["g","Verde"],["p","Rosa"],["b","Azul"]];
function noteOrder(a,b){ return (a.order||a.updated||0) - (b.order||b.updated||0); }
function esc(t){ return String(t).replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c])); }
function noteHtml(n){ if (!n) return ""; if (n.html!=null) return n.html; return n.body ? esc(n.body).replace(/\n/g,"<br>") : ""; }
function noteText(n){ const d = document.createElement("div"); d.innerHTML = noteHtml(n).replace(/<(br|\/div|\/p|\/li)>/gi,"\n$&"); return (d.textContent||"").trim(); }
function noteLabel(n,i){ if (n.title && n.title.trim()) return n.title.trim(); const t = noteText(n).split("\n").find(x=>x.trim()); return t ? t.trim().slice(0,24) : "Nota "+(i+1); }
function fmtStamp(ms){ return ms ? new Date(ms).toLocaleString("pt-BR",{dateStyle:"short",timeStyle:"short"}) : ""; }
const ICON = {
  grip:'<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></svg>',
  plus:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  trash:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>',
  close:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  color:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor"/></svg>',
  ul:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1.2" fill="currentColor"/><circle cx="4.5" cy="12" r="1.2" fill="currentColor"/><circle cx="4.5" cy="18" r="1.2" fill="currentColor"/></svg>',
  ol:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M10 6h10M10 12h10M10 18h10"/><path d="M4 5l1.5-1v5M3.5 9h3M3.5 14.5a1.5 1.5 0 1 1 2.6 1L3.5 19h3" stroke-width="1.5"/></svg>',
  check:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="6" height="6" rx="1.2"/><path d="M4.5 7l1.2 1.2L8 5.8"/><rect x="3" y="14" width="6" height="6" rx="1.2"/><path d="M12 7h9M12 17h9"/></svg>',
  hl:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 4l6 6-8 8H6v-6z"/><path d="M4 21h8"/></svg>',
};
function icon(name){ const s = document.createElement("span"); s.style.display="contents"; s.innerHTML = ICON[name]; return s; }

class Notebook {
  constructor(root, compact){
    this.root = root; this.compact = compact; this.dirty = false; this.timer = null; this.loaded = null; this.hlMode = null; this.lastHl = "y";
    this.build();
  }
  build(){
    const ib = (name, label, onclick, extra={}) => el("button",{class:"ibtn",type:"button","aria-label":label,title:label,onclick,...extra}, icon(name));
    this.box = el("div",{class:"nb "+(this.compact?"compact":"full")});
    this.tabs = el("div",{class:"nb-tabs",role:"tablist","aria-label":"Notas"});
    this.colorPop = el("div",{class:"nb-pop",hidden:true});
    const actions = el("div",{class:"nb-actions"},
      ib("plus","Nova aba", () => newNote()),
      ib("color","Cor da aba", () => { this.colorPop.hidden = !this.colorPop.hidden; this.hlPop.hidden = true; this.renderColorPop(); }),
      this.delWrap = el("span",{class:"confirm"}, ib("trash","Apagar esta aba")),
      this.compact ? ib("close","Fechar bloco de notas", () => sticky.close()) : null);
    this.grip = this.compact ? el("span",{class:"nb-grip",title:"Arrastar"}, icon("grip")) : null;
    this.head = el("div",{class:"nb-head",style:"position:relative"}, this.grip, this.tabs, actions, this.colorPop);
    this.title = el("input",{type:"text",class:"nb-title",placeholder:"Título da aba (opcional)",maxlength:"80","aria-label":"Título da nota",id:this.compact?"nbTitleC":"nbTitleF"});
    this.editor = el("div",{class:"nb-editor",contenteditable:"true",spellcheck:"true","data-placeholder":"Escreva suas anotações aqui…",role:"textbox","aria-multiline":"true","aria-label":"Texto da nota"});
    const cmd = (name, label, txt, style) => el("button",{class:"ibtn",type:"button","data-cmd":name,"aria-label":label,title:label,"aria-pressed":"false",style}, txt);
    this.hlInd = el("span",{class:"hl-ind",style:"background:var(--hl-y)"});
    this.hlBtn = el("button",{class:"ibtn",type:"button","data-cmd":"hl","aria-label":"Marca-texto",title:"Marca-texto","aria-pressed":"false",style:"display:inline-flex;flex-direction:column;align-items:center;justify-content:center"}, icon("hl"), this.hlInd);
    this.hlPop = el("div",{class:"nb-pop",hidden:true});
    this.tools = el("div",{class:"nb-tools"},
      cmd("bold","Negrito (Ctrl+B)","B"), cmd("italic","Itálico (Ctrl+I)","I","font-style:italic;font-family:var(--f-display)"), cmd("underline","Sublinhado (Ctrl+U)","U","text-decoration:underline"),
      el("span",{class:"nb-sep"}),
      el("button",{class:"ibtn",type:"button","data-cmd":"ul","aria-label":"Lista com marcadores",title:"Lista com marcadores","aria-pressed":"false"}, icon("ul")),
      el("button",{class:"ibtn",type:"button","data-cmd":"ol","aria-label":"Lista numerada",title:"Lista numerada","aria-pressed":"false"}, icon("ol")),
      el("button",{class:"ibtn",type:"button","data-cmd":"check","aria-label":"Lista de tarefas",title:"Lista de tarefas","aria-pressed":"false"}, icon("check")),
      el("span",{class:"nb-sep"}), this.hlBtn, this.hlPop);
    this.stamp = el("span",{});
    this.foot = el("div",{class:"nb-foot"}, this.stamp, el("span",{class:"note-sm"}, this.compact ? "" : "Ctrl+B, I, U · selecione o texto e use o marca-texto"));
    this.emptyBox = el("div",{class:"nb-empty",hidden:true}, el("span",{},"Nenhuma nota ainda."), el("button",{class:"btn primary sm",type:"button",onclick:()=>newNote()},"Criar primeira nota"));
    this.workArea = this.compact ? [this.editor, this.tools, this.foot] : [this.title, this.tools, this.editor, this.foot];
    this.box.append(this.head, this.emptyBox, ...this.workArea);
    this.root.replaceChildren(this.box);

    inlineConfirm(this.delWrap, "Apagar?", () => deleteNote(activeNote));
    // toolbar sem perder a seleção
    this.tools.addEventListener("mousedown", e => { if (e.target.closest("button")) e.preventDefault(); });
    this.tools.addEventListener("click", e => { const b = e.target.closest("button[data-cmd]"); if (b) this.exec(b.dataset.cmd); });
    this.editor.addEventListener("input", () => this.schedule());
    this.title.addEventListener("input", () => { this.schedule(); });
    this.editor.addEventListener("blur", () => this.flush());
    this.title.addEventListener("blur", () => this.flush());
    this.editor.addEventListener("paste", e => { e.preventDefault(); const t = (e.clipboardData||window.clipboardData).getData("text/plain"); document.execCommand("insertText", false, t); });
    this.editor.addEventListener("click", e => {
      const li = e.target.closest("ul.checklist > li");
      if (li && this.editor.contains(li) && e.clientX - li.getBoundingClientRect().left < 22){ li.dataset.checked = li.dataset.checked==="true" ? "false" : "true"; this.schedule(); e.preventDefault(); }
    });
    const maybeHl = () => { if (!this.hlMode) return; const sel = getSelection(); if (sel.rangeCount && !sel.isCollapsed && this.editor.contains(sel.anchorNode)) this.applyHl(this.hlMode); };
    this.editor.addEventListener("mouseup", () => setTimeout(maybeHl, 0));
    this.editor.addEventListener("keyup", e => { if (e.shiftKey) maybeHl(); });
    this.editor.addEventListener("keydown", e => {
      // Enter numa tarefa vazia encerra a lista; nova tarefa começa desmarcada
      if (e.key==="Enter" && !e.shiftKey){ const li = this.closestIn("li"); if (li && li.parentElement.classList.contains("checklist")) setTimeout(() => { const n = this.closestIn("li"); if (n && n!==li) n.removeAttribute("data-checked"); }, 0); }
    });
  }
  closestIn(sel){ const s = getSelection(); if (!s.rangeCount) return null; let n = s.anchorNode; if (n && n.nodeType===3) n = n.parentElement; const x = n && n.closest(sel); return x && this.editor.contains(x) ? x : null; }
  ensureFocus(){ const s = getSelection(); if (!s.rangeCount || !this.editor.contains(s.anchorNode)){ this.editor.focus(); const r = document.createRange(); r.selectNodeContents(this.editor); r.collapse(false); s.removeAllRanges(); s.addRange(r); } }
  exec(c){
    if (!activeNote) return;
    if (c==="hl"){ this.hlPop.hidden = !this.hlPop.hidden; this.colorPop.hidden = true; this.renderHlPop(); return; }
    this.ensureFocus();
    try { document.execCommand("styleWithCSS", false, false); } catch(e){}
    if (c==="bold"||c==="italic"||c==="underline") document.execCommand(c);
    else if (c==="ol"){ const ul = this.closestIn("ul.checklist"); if (ul) ul.classList.remove("checklist"); document.execCommand("insertOrderedList"); }
    else if (c==="ul"){ const ul = this.closestIn("ul.checklist"); if (ul){ ul.classList.remove("checklist"); ul.querySelectorAll("li").forEach(li=>li.removeAttribute("data-checked")); } else document.execCommand("insertUnorderedList"); }
    else if (c==="check"){
      const cl = this.closestIn("ul.checklist");
      if (cl) document.execCommand("insertUnorderedList");
      else { if (!this.closestIn("ul")) { if (this.closestIn("ol")) document.execCommand("insertOrderedList"); document.execCommand("insertUnorderedList"); } const ul = this.closestIn("ul"); if (ul) ul.classList.add("checklist"); }
    }
    this.schedule(); this.updateState();
  }
  applyHl(cls){
    const sel = getSelection(); if (!sel.rangeCount || sel.isCollapsed) return;
    const r = sel.getRangeAt(0); if (!this.editor.contains(r.commonAncestorContainer)) return;
    const near = n => { n = n.nodeType===3 ? n.parentElement : n; return n && n.closest("mark"); };
    if (!cls){ [near(r.startContainer), near(r.endContainer)].forEach(m => { if (m && this.editor.contains(m)) m.replaceWith(...m.childNodes); }); }
    const frag = r.extractContents();
    frag.querySelectorAll("mark").forEach(m => m.replaceWith(...m.childNodes));
    let node = frag;
    if (cls){ node = document.createElement("mark"); node.className = "hl-"+cls; node.append(frag); }
    const last = cls ? node : frag.lastChild;
    r.insertNode(node);
    this.editor.querySelectorAll("mark").forEach(m => { if (!m.textContent) m.remove(); });
    sel.removeAllRanges(); if (last && last.parentNode){ const nr = document.createRange(); nr.setStartAfter(last); nr.collapse(true); sel.addRange(nr); }
    this.schedule();
  }
  renderHlPop(){
    const p = this.hlPop; p.replaceChildren();
    HL.forEach(([k,label]) => p.append(el("button",{type:"button",class:"swatch",title:label,"aria-label":"Grifar em "+label.toLowerCase(),"aria-pressed":String(this.hlMode===k),style:"background:var(--hl-"+k+")",onmousedown:e=>e.preventDefault(),onclick:()=>{
      const sel = getSelection(); const has = sel.rangeCount && !sel.isCollapsed && this.editor.contains(sel.anchorNode);
      if (has) this.applyHl(k);
      this.hlMode = k; this.lastHl = k; p.hidden = true; this.updateState();
    }})));
    p.append(el("button",{type:"button",class:"txt",onmousedown:e=>e.preventDefault(),onclick:()=>{ const sel = getSelection(); if (sel.rangeCount && !sel.isCollapsed && this.editor.contains(sel.anchorNode)) this.applyHl(null); p.hidden = true; }},"Tirar grifo"));
    if (this.hlMode) p.append(el("button",{type:"button",class:"txt",onmousedown:e=>e.preventDefault(),onclick:()=>{ this.hlMode = null; p.hidden = true; this.updateState(); }},"Desligar marca-texto"));
    p.append(el("span",{class:"note-sm",style:"flex-basis:100%"}, this.hlMode ? "Marca-texto ligado: selecione um trecho para grifar." : "Selecione um trecho e escolha a cor. A cor fica ligada para os próximos grifos."));
  }
  renderColorPop(){
    const p = this.colorPop; p.replaceChildren();
    const n = notes.find(x=>x.id===activeNote); if (!n) return;
    NOTE_COLOR_NAMES.forEach((name,i) => p.append(el("button",{type:"button",class:"swatch",title:name,"aria-label":"Aba "+name.toLowerCase(),"aria-pressed":String((n.color||0)===i),style:"background:var(--note"+i+")",onclick:()=>{ this.flush(); setNoteColor(n.id,i); p.hidden = true; }})));
  }
  updateState(){
    const inEd = (() => { const s = getSelection(); return s.rangeCount && this.editor.contains(s.anchorNode); })();
    this.tools.querySelectorAll("button[data-cmd]").forEach(b => {
      const c = b.dataset.cmd; let on = false;
      if (inEd){ try { if (c==="bold"||c==="italic"||c==="underline") on = document.queryCommandState(c); } catch(e){}
        if (c==="ol") on = !!this.closestIn("ol"); if (c==="ul") on = !!this.closestIn("ul") && !this.closestIn("ul.checklist"); if (c==="check") on = !!this.closestIn("ul.checklist"); }
      if (c==="hl") on = !!this.hlMode;
      b.setAttribute("aria-pressed", String(on));
    });
    this.hlInd.style.background = "var(--hl-"+(this.hlMode||this.lastHl)+")";
  }
  render(){
    if (activeNote && !notes.some(n=>n.id===activeNote)) activeNote = null;
    if (!activeNote && notes.length) activeNote = notes[0].id;
    const n = notes.find(x=>x.id===activeNote);
    this.tabs.replaceChildren(...notes.map((x,i) => el("button",{type:"button",class:"nb-tab",role:"tab","aria-selected":String(x.id===activeNote),title:noteLabel(x,i),"aria-label":noteLabel(x,i),style:"--tabc:var(--note"+((x.color||0)%6)+")",onclick:()=>openNote(x.id)})));
    const sel = this.tabs.querySelector('[aria-selected="true"]'); if (sel) sel.scrollIntoView({block:"nearest",inline:"nearest"});
    this.emptyBox.hidden = !!n; this.workArea.forEach(w => w.hidden = !n);
    this.head.querySelectorAll(".nb-actions .ibtn").forEach((b,i) => { if (i>0 && !(this.compact && b.getAttribute("aria-label")==="Fechar bloco de notas")) b.disabled = !n; });
    if (!n){ this.loaded = null; return; }
    this.box.style.setProperty("--nb","var(--note"+((n.color||0)%6)+")");
    const focused = this.box.contains(document.activeElement);
    if (this.loaded!==n.id || (!this.dirty && !focused)){
      if (this.loaded!==n.id || this.editor.innerHTML!==noteHtml(n)) this.editor.innerHTML = noteHtml(n);
      if (this.title.value!==(n.title||"")) this.title.value = n.title||"";
      this.loaded = n.id;
    }
    if (!this.dirty) this.stamp.textContent = n.updated ? "Última atualização: "+fmtStamp(n.updated) : "";
    if (!this.colorPop.hidden) this.renderColorPop();
    this.updateState();
  }
  schedule(){ if (!activeNote) return; this.dirty = true; this.stamp.textContent = "Salvando…"; clearTimeout(this.timer); this.timer = setTimeout(() => this.flush(), 700); }
  flush(){
    if (!this.dirty) return; clearTimeout(this.timer); this.dirty = false;
    const i = notes.findIndex(x=>x.id===this.loaded); if (i<0) return;
    const html = this.editor.innerHTML.replace(/^(<br>)+$/,"");
    const n = {...notes[i], title:this.title.value, html, updated:Date.now()}; delete n.body;
    notes[i] = n;
    store.saveNote(n).then(() => { if (!this.dirty) this.stamp.textContent = "Última atualização: "+fmtStamp(n.updated); });
    books.forEach(b => { if (b!==this) b.render(); });
    // atualiza o rótulo da aba sem recarregar o editor
    const ix = notes.indexOf(n), t = this.tabs.children[ix]; if (t){ t.title = noteLabel(n,ix); t.setAttribute("aria-label", noteLabel(n,ix)); }
  }
}
function flushAll(){ books.forEach(b => b.flush()); }
function renderNotes(){ (books||[]).forEach(b => b.render()); }
function openNote(id){ flushAll(); activeNote = id; books.forEach(b => { b.loaded = null; b.render(); }); }
function newNote(){
  flushAll();
  const used = notes.map(n=>n.color||0); let color = notes.length % 6; for (let c=0;c<6;c++){ if (!used.includes(c)){ color = c; break; } }
  const n = {id:uid(), title:"", html:"", color, order:Date.now(), updated:Date.now()};
  notes.push(n); activeNote = n.id;
  store.saveNote(n);
  books.forEach(b => { b.loaded = null; b.render(); });
  const vis = books.find(b => b.root.offsetParent!==null) || books[0]; if (vis) setTimeout(() => vis.editor.focus(), 0);
}
function deleteNote(id){
  if (!id) return; books.forEach(b => { if (b.loaded===id){ clearTimeout(b.timer); b.dirty = false; } });
  const i = notes.findIndex(n=>n.id===id); notes = notes.filter(n=>n.id!==id);
  activeNote = notes.length ? notes[Math.max(0,i-1)].id : null;
  store.delNote(id); books.forEach(b => { b.loaded = null; b.render(); });
}
function setNoteColor(id, c){ const i = notes.findIndex(n=>n.id===id); if (i<0) return; notes[i] = {...notes[i], color:c, updated:Date.now()}; store.saveNote(notes[i]); renderNotes(); }
document.addEventListener("selectionchange", () => books.forEach(b => { const s = getSelection(); if (s.rangeCount && b.editor.contains(s.anchorNode)) b.updateState(); }));
document.addEventListener("mousedown", e => books.forEach(b => { if (!b.hlPop.contains(e.target) && !e.target.closest("[data-cmd='hl']")) b.hlPop.hidden = true; if (!b.colorPop.contains(e.target) && !e.target.closest("[aria-label='Cor da aba']")) b.colorPop.hidden = true; }));
window.addEventListener("pagehide", flushAll);
document.addEventListener("visibilitychange", () => { if (document.hidden) flushAll(); });

/* ---------- post-it flutuante: abre/fecha, arrasta, redimensiona ---------- */
const sticky = {
  box: $("sticky"), fab: $("stickyFab"), pos: null,
  init(){
    try { this.pos = JSON.parse(localStorage.getItem("mesa.sticky")||"null"); } catch(e){}
    this.book = new Notebook(this.box, true); books.push(this.book);
    this.fab.addEventListener("click", () => this.box.hidden ? this.open() : this.close());
    // arrastar pela alça ou pelo espaço livre do cabeçalho
    const head = this.book.head;
    head.addEventListener("pointerdown", e => {
      if (e.target.closest("button") || window.innerWidth<=600) return;
      e.preventDefault(); const r = this.box.getBoundingClientRect(); const dx = e.clientX - r.left, dy = e.clientY - r.top;
      head.setPointerCapture(e.pointerId);
      const move = ev => this.place(ev.clientX-dx, ev.clientY-dy);
      const up = () => { head.removeEventListener("pointermove", move); head.removeEventListener("pointerup", up); head.removeEventListener("pointercancel", up); this.save(); };
      head.addEventListener("pointermove", move); head.addEventListener("pointerup", up); head.addEventListener("pointercancel", up);
    });
    let rt; new ResizeObserver(() => { clearTimeout(rt); rt = setTimeout(() => this.save(), 300); }).observe(this.box);
    window.addEventListener("resize", () => { if (!this.box.hidden) this.place(this.box.offsetLeft, this.box.offsetTop); });
    document.addEventListener("keydown", e => { if (e.key==="Escape" && !this.box.hidden && this.box.contains(document.activeElement)) { this.close(); this.fab.focus(); } });
    if (this.pos && this.pos.open) this.open(true);
  },
  place(x,y){ const w = this.box.offsetWidth, h = this.box.offsetHeight; x = Math.min(Math.max(8,x), window.innerWidth-w-8); y = Math.min(Math.max(8,y), window.innerHeight-h-8); this.box.style.left = x+"px"; this.box.style.top = y+"px"; },
  open(silent){
    this.box.hidden = false; this.fab.setAttribute("aria-expanded","true"); this.fab.setAttribute("aria-label","Fechar bloco de notas");
    const p = this.pos || {};
    if (p.w && p.h && window.innerWidth>600){ this.box.style.width = p.w+"px"; this.box.style.height = p.h+"px"; }
    const x = p.x!=null ? p.x : window.innerWidth - this.box.offsetWidth - 18;
    const y = p.y!=null ? p.y : window.innerHeight - this.box.offsetHeight - 84;
    this.place(x,y); this.book.render(); this.save(true);
    if (!silent && this.book.editor.offsetParent) this.book.editor.focus();
  },
  close(){ this.book.flush(); this.box.hidden = true; this.fab.setAttribute("aria-expanded","false"); this.fab.setAttribute("aria-label","Abrir bloco de notas"); this.save(); },
  save(){
    const open = !this.box.hidden;
    const p = {...(this.pos||{}), open};
    if (open && window.innerWidth>600){ p.x = this.box.offsetLeft; p.y = this.box.offsetTop; p.w = this.box.offsetWidth; p.h = this.box.offsetHeight; }
    this.pos = p; try { localStorage.setItem("mesa.sticky", JSON.stringify(p)); } catch(e){}
  }
};
books.push(new Notebook($("notesFull"), false));
sticky.init();

/* ---------- confirmação inline (sem diálogos do navegador) ---------- */
function inlineConfirm(wrap, question, action){
  const btn = wrap.querySelector("button");
  btn.addEventListener("click", () => {
    const original = [...wrap.childNodes];
    const yes = el("button",{class:"btn sm danger"},"Sim"), no = el("button",{class:"btn ghost sm"},"Não");
    wrap.replaceChildren(el("span",{}, question), yes, no);
    no.addEventListener("click", () => wrap.replaceChildren(...original));
    yes.addEventListener("click", () => { wrap.replaceChildren(...original); action(); });
    no.focus();
  });
}

/* ---------- tarefas de estudo ---------- */
// tarefa = {id, text, cat?, due? (AAAA-MM-DD), done, created, doneAt?}
function todayKey(){ return dayKey(Date.now()); }
function taskDueInfo(t){
  if (!t.due) return {group:"nodate", label:"", cls:""};
  const n = Math.round((parseDay(t.due) - startOfDay(Date.now()).getTime())/86400000);
  if (n < 0) return {group:"late", label: n===-1 ? "ontem" : "há "+(-n)+" dias", cls:"late"};
  if (n === 0) return {group:"today", label:"hoje", cls:"today"};
  if (n === 1) return {group:"next", label:"amanhã", cls:""};
  const d = new Date(parseDay(t.due));
  return {group:"next", label: DOW[d.getDay()]+", "+pad(d.getDate())+"/"+pad(d.getMonth()+1), cls:""};
}
function pendingTasks(){ return tasks.filter(t=>!t.done).sort((a,b)=>(a.due||"9999").localeCompare(b.due||"9999") || (a.created||0)-(b.created||0)); }
function toggleTask(t, done){ const n = {...t, done, doneAt: done ? Date.now() : null}; const i = tasks.findIndex(x=>x.id===t.id); if (i>=0) tasks[i] = n; store.saveTask(n); renderTasksAll(); }
function startTask(t){
  if (config.running || finishing) return;
  if (t.cat && config.categories.some(c=>c.id===t.cat)) selCat = t.cat;
  showTab("timer");
  startTimer(t);
}
function addTask(text, cat, due){
  text = (text||"").trim(); if (!text) return false;
  const t = {id: uid(), text, done:false, created: Date.now()};
  if (cat) t.cat = cat; if (due) t.due = due;
  tasks.push(t); store.saveTask(t); renderTasksAll(); return true;
}
function taskItem(t){
  const info = taskDueInfo(t), c = t.cat ? catById(t.cat) : null;
  const id = "tk-"+t.id;
  const canStart = !t.done && !config.running && !finishing;
  return el("li",{class:"task"+(t.done?" done":"")},
    el("input",{type:"checkbox",id,checked:!!t.done,onchange:e=>toggleTask(t, e.target.checked)}),
    el("label",{for:id,class:"t-main"},
      el("span",{class:"t-text"}, t.text),
      (c || info.label) ? el("span",{class:"t-meta"},
        c ? el("span",{class:"t-cat"}, el("i",{style:"background:"+colorOf(c)}), c.name) : null,
        info.label && !t.done ? el("span",{class:"t-due "+info.cls}, info.label) : null) : null),
    canStart ? el("button",{class:"ibtn t-play",type:"button",title:"Começar a estudar esta tarefa","aria-label":"Começar a estudar: "+t.text,onclick:()=>startTask(t)}, svgEl("play")) : null,
    el("button",{class:"x",type:"button",title:"Apagar tarefa","aria-label":"Apagar tarefa "+t.text,onclick:()=>{ tasks = tasks.filter(x=>x.id!==t.id); store.delTask(t.id); renderTasksAll(); }},"×"));
}
function fillTaskCats(sel){
  const v = sel.value;
  sel.replaceChildren(el("option",{value:""},"Sem atividade"), ...config.categories.map(c=>el("option",{value:c.id}, c.name)));
  if ([...sel.options].some(o=>o.value===v)) sel.value = v;
}
function renderTasks(){
  if ($("view-tasks").hidden) return;
  fillTaskCats($("tCat"));
  const box = $("taskList"); box.replaceChildren();
  const pend = pendingTasks();
  const groups = [["late","Atrasadas"],["today","Hoje"],["next","Próximos dias"],["nodate","Sem data"]];
  if (!pend.length) box.append(el("p",{class:"empty"},"Nenhuma tarefa pendente. Anote acima o que você quer estudar."));
  groups.forEach(([g,label]) => {
    const list = pend.filter(t=>taskDueInfo(t).group===g); if (!list.length) return;
    box.append(el("div",{class:"t-group"}, el("span",{class:"label"+(g==="late"?" late":"")}, label+" · "+list.length), el("ul",{class:"tasks"}, ...list.map(taskItem))));
  });
  const done = tasks.filter(t=>t.done).sort((a,b)=>(b.doneAt||0)-(a.doneAt||0));
  const db = $("taskDone"); db.replaceChildren();
  if (!done.length){ db.append(el("p",{class:"empty"},"As tarefas concluídas aparecem aqui.")); return; }
  db.append(el("ul",{class:"tasks"}, ...done.slice(0,20).map(taskItem)));
  const wrap = el("span",{class:"confirm"}, el("button",{class:"btn ghost sm danger",type:"button"},"Limpar concluídas"));
  inlineConfirm(wrap, "Apagar "+done.length+(done.length===1?" tarefa concluída?":" tarefas concluídas?"), () => { done.forEach(t=>store.delTask(t.id)); tasks = tasks.filter(t=>!t.done); renderTasksAll(); });
  db.append(wrap);
}
function renderTodayTasks(){
  const box = $("todayTasks"); if (!box) return; box.replaceChildren();
  const list = pendingTasks().filter(t => { const g = taskDueInfo(t).group; return g==="late"||g==="today"||g==="nodate"; });
  if (!list.length) box.append(el("p",{class:"empty"}, tasks.some(t=>!t.done) ? "Nada para hoje. As próximas estão na aba Tarefas." : "Anote abaixo o que você quer estudar hoje."));
  else box.append(el("ul",{class:"tasks"}, ...list.slice(0,6).map(taskItem)));
  if (list.length > 6) box.append(el("button",{class:"btn ghost sm",type:"button",onclick:()=>showTab("tasks")},"Ver todas ("+list.length+")"));
}
function renderTasksAll(){ renderTasks(); renderTodayTasks(); }
$("taskForm").addEventListener("submit", e => {
  e.preventDefault();
  if (addTask($("tText").value, $("tCat").value, $("tDue").value)){ $("tText").value = ""; $("tText").focus(); }
});
document.querySelectorAll("[data-due]").forEach(b => b.addEventListener("click", () => {
  const d = new Date(); d.setDate(d.getDate() + Number(b.dataset.due)); $("tDue").value = dayKey(d.getTime());
}));
$("quickTask").addEventListener("submit", e => {
  e.preventDefault(); if (addTask($("qtText").value, null, todayKey())) $("qtText").value = "";
});

/* ---------- horários de estudo (distribuição por hora do dia) ---------- */
function hourDist(list){
  const h = new Array(24).fill(0);
  list.forEach(s => {
    if (s.manual) return; // lançamentos manuais não têm horário real
    let t = s.start, end = s.end || (s.start + (s.dur||0)*1000);
    // usa o tempo efetivo (sem pausas) proporcionalmente ao intervalo
    const span = Math.max(1, end - t), ratio = Math.min(1, ((s.dur||0)*1000) / span);
    while (t < end){
      const d = new Date(t), next = new Date(d); next.setMinutes(60,0,0);
      const chunk = Math.min(end, next.getTime()) - t;
      h[d.getHours()] += chunk/1000*ratio; t += chunk;
    }
  });
  return h;
}
function renderHours(boxId, list, noteId){
  const box = $(boxId); if (!box) return;
  const h = hourDist(list), max = Math.max(...h);
  const W = 560, H = 150, pl = 6, pr = 6, pt = 8, pb = 22, bw = (W-pl-pr)/24;
  const ns = "http://www.w3.org/2000/svg", svg = document.createElementNS(ns,"svg");
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`); svg.setAttribute("role","img"); svg.setAttribute("aria-label","Tempo de estudo por hora do dia");
  const add = (tag,a,txt) => { const e = document.createElementNS(ns,tag); for (const k in a) e.setAttribute(k,a[k]); if (txt!=null) e.textContent = txt; svg.append(e); return e; };
  add("line",{x1:pl,x2:W-pr,y1:H-pb,y2:H-pb,stroke:"var(--line)"});
  const best = max>0 ? h.indexOf(max) : -1;
  h.forEach((v,i) => {
    const bh = max>0 ? (H-pt-pb)*v/max : 0, x = pl + i*bw + bw*0.15;
    const r = add("rect",{x, y:H-pb-bh, width:bw*0.7, height:Math.max(bh, v>0?2:0), rx:3, fill: i===best ? "var(--accent)" : "var(--heat2)"});
    const t = document.createElementNS(ns,"title"); t.textContent = i+"h–"+(i+1)+"h: "+fmtDur(v); r.append(t);
    if (i%3===0) add("text",{x:pl+i*bw+bw/2, y:H-6, "text-anchor":"middle","font-size":11, fill:"var(--ink-3)","font-family":"Manrope, sans-serif"}, i+"h");
  });
  box.replaceChildren(svg);
  const note = $(noteId);
  if (note) note.textContent = best>=0 ? "Você rende mais entre "+best+"h e "+(best+1)+"h ("+fmtDur(max)+" no período)." : "Use o cronômetro para descobrir seus melhores horários.";
}

/* ---------- seus dados: conta, exportar e importar ---------- */
function exportData(){
  return {app:"mesa-de-estudos", version:1, exportedAt: new Date().toISOString(),
    config: {categories: config.categories, exams: config.exams, dailyGoal: config.dailyGoal},
    sessions, notes, tasks};
}
$("expBtn").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(exportData(), null, 1)], {type:"application/json"});
  const a = el("a",{href:URL.createObjectURL(blob), download:"mesa-de-estudos-"+todayKey()+".json"});
  document.body.append(a); a.click(); a.remove();
  $("impMsg").textContent = "Backup baixado.";
});
$("impFile").addEventListener("change", async e => {
  const f = e.target.files[0]; if (!f) return;
  $("impText").value = await f.text(); e.target.value = "";
  importData();
});
$("impBtn").addEventListener("click", importData);
function importData(){
  const msg = $("impMsg");
  let d;
  try { d = JSON.parse($("impText").value); } catch(e){ msg.textContent = "Não reconheci o conteúdo. Cole exatamente o texto copiado no site antigo ou escolha o arquivo de backup."; return; }
  if (!d || d.app!=="mesa-de-estudos"){ msg.textContent = "Esse conteúdo não parece um backup da Mesa de Estudos."; return; }
  const c = d.config || {};
  const byId = (a,b) => { const m = new Map(a.map(x=>[x.id,x])); (b||[]).forEach(x => { if (x && x.id && !m.has(x.id)) m.set(x.id, x); }); return [...m.values()]; };
  config.categories = byId(config.categories, c.categories);
  config.exams = byId(config.exams, c.exams);
  if (c.dailyGoal && (!config.dailyGoal || config.dailyGoal===240)) config.dailyGoal = c.dailyGoal;
  store.saveConfig();
  const ss = (d.sessions||[]).filter(x=>x&&x.id), ns = (d.notes||[]).filter(x=>x&&x.id), ts = (d.tasks||[]).filter(x=>x&&x.id);
  store.writeMany("sessions", ss); store.writeMany("notes", ns); store.writeMany("tasks", ts);
  $("impText").value = "";
  msg.textContent = "Importado: "+ss.length+" sessões, "+ns.length+" notas, "+(c.exams||[]).length+" concursos e "+ts.length+" tarefas.";
}
$("logoutBtn").addEventListener("click", () => env.signOut());
$("seeTasks").addEventListener("click", () => showTab("tasks"));

/* ---------- cronômetro flutuante (fica por cima de todos os programas) ---------- */
async function openFloating(){
  // no popup e no painel da extensão, abre uma janelinha própria que pode virar flutuante
  if ((env.mode === "popup" || env.mode === "panel") && env.openFloat){ env.openFloat(); return; }
  if (pipWin){ pipWin.focus(); return; }
  if (!("documentPictureInPicture" in window)){
    $("status").textContent = "Este navegador não tem janela flutuante. Use o Chrome ou o Edge atualizados.";
    return;
  }
  const clock = $("clockPanel");
  let win;
  try { win = await documentPictureInPicture.requestWindow({ width: 210, height: 70 }); }
  catch (e){ $("status").textContent = "Não consegui abrir a janela flutuante: " + (e.message || e); return; }
  pipWin = win;
  [...document.styleSheets].forEach(ss => {
    try { const st = win.document.createElement("style"); st.textContent = [...ss.cssRules].map(r => r.cssText).join("\n"); win.document.head.append(st); }
    catch (e){ if (ss.href){ const l = win.document.createElement("link"); l.rel = "stylesheet"; l.href = ss.href; win.document.head.append(l); } }
  });
  win.document.title = "Cronômetro";
  win.document.body.className = "pip " + document.body.className;
  const back = el("div",{class:"panel clock-away"},
    el("p",{class:"empty"},"O cronômetro está na janela flutuante."),
    el("button",{class:"btn sm",type:"button",onclick:()=>{ if (pipWin) pipWin.close(); }},"Trazer de volta"));
  clock.replaceWith(back);
  win.document.body.append(clock);
  if (env.onFloatOpen) env.onFloatOpen();
  win.addEventListener("pagehide", () => {
    back.replaceWith(clock); pipWin = null;
    renderTimer();
    if (env.onFloatClose) env.onFloatClose();
  });
  renderTimer();
}
$("floatBtn").addEventListener("click", openFloating);
if (env.mode === "float") $("floatBtn").querySelector("span").textContent = "Fixar por cima de tudo";
else $("floatBtn").querySelector("span").remove();
// pílula: só aparece quando você liga por este botão (ou Alt+Shift+P)
if (env.pill && env.mode !== "float"){
  const pb = $("pillBtn");
  env.pill.state().then(on => { if (on === null) return; pb.hidden = false; pb.setAttribute("aria-pressed", String(!!on)); });
  pb.addEventListener("click", async () => { const on = await env.pill.toggle(); if (on !== null) pb.setAttribute("aria-pressed", String(!!on)); });
  if (env.pill.onChange) env.pill.onChange(on => pb.setAttribute("aria-pressed", String(!!on)));
}

/* ---------- ciclo ---------- */
function renderAll(){
  renderTimer(); renderToday(); renderHello(); renderTasksAll();
  if (!$("view-stats").hidden) renderStats(); else fillCatSelect();
  if (!$("view-exams").hidden) renderExams();
}
setInterval(() => {
  if (config.running && !finishing){ checkPhase(); updateTimeDisplay(); }
  document.querySelectorAll("[data-live]").forEach(n => { const e = config.exams.find(x=>x.id===n.dataset.live); if (e){ const cd = countdown(e); n.textContent = fmtExamDate(e)+(cd.past?"":" · "+cd.text); } });
  const nl = $("nextLive"); if (nl){ const e = upcomingExams()[0]; if (e) nl.textContent = "Faltam "+countdown(e).text; }
}, 1000);
setInterval(() => { if (config.running && config.running.start) renderToday(); }, 30000);
document.addEventListener("visibilitychange", () => { if (!document.hidden) renderAll(); });

/* ---------- login e início ---------- */
let currentUser = null, readyOnce = false, deniedEmail = null;
function markReady(){ if (readyOnce) return; readyOnce = true; document.body.classList.remove("loading"); }
function firstName(){ const n = (currentUser && currentUser.displayName) || ""; return n.split(" ")[0] || "Afrânio"; }
function loginError(e){
  const c = (e && e.code) || "";
  if (c.includes("popup-closed") || c.includes("cancelled")) return "A janela de login foi fechada antes de terminar. Tente de novo.";
  if (c.includes("popup-blocked")) return "O navegador bloqueou a janela de login. Permita pop-ups para este site e tente de novo.";
  if (c.includes("unauthorized-domain")) return "Este endereço ainda não está autorizado no Firebase (Authentication › Configurações › Domínios autorizados).";
  if (c.includes("network")) return "Sem conexão com a internet. Conecte-se e tente de novo.";
  return "Não consegui entrar" + (e && e.message ? ": " + e.message : ".");
}
function resetState(){
  config = {categories: DEFAULT_CATS.slice(), exams: [], running: null, dailyGoal: 240};
  sessions = []; notes = []; tasks = []; finishing = null; activeNote = null;
}
function showGate(text, busy){
  $("gate").hidden = false; document.body.classList.add("signed-out");
  $("gateMsg").textContent = text || "";
  $("loginBtn").hidden = !!busy;
}
document.body.classList.add("mode-"+env.mode, "loading");
if (env.siteUrl && env.mode !== "site"){ document.querySelectorAll(".open-site").forEach(a => { a.href = env.siteUrl; a.hidden = false; }); }
if (env.mode === "popup") $("popPanel").addEventListener("click", () => env.openPanel && env.openPanel());
if (env.mode === "popup" || env.mode === "float") showTab("timer");
$("loginBtn").addEventListener("click", async () => {
  deniedEmail = null;
  showGate("Abrindo o login do Google…", true);
  try { await env.signIn(); }
  catch(e){ showGate(loginError(e)); }
});
showGate("Carregando…", true);
env.onAuth(user => {
  const allowed = (env.allowed||[]).map(x=>x.toLowerCase());
  if (user && allowed.length && !allowed.includes((user.email||"").toLowerCase())){
    deniedEmail = user.email; env.signOut(); return;
  }
  currentUser = user;
  if (user){
    $("gate").hidden = true; document.body.classList.remove("signed-out");
    store.start(user);
  } else {
    store.stop(); resetState(); readyOnce = false;
    renderAll(); renderNotes();
    showGate(deniedEmail ? "A conta "+deniedEmail+" não tem acesso a esta Mesa de Estudos. Entre com a sua conta." : (env.mode==="site" ? "" : "Entre uma vez e o cronômetro, as notas e as provas ficam iguais no site e na extensão."));
    if (env.onRunning) env.onRunning(null, 240);
  }
  renderHello();
});
renderAll();
}

