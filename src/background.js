// Service worker da extensão: tempo no ícone, login vindo do site e consulta periódica ao Firestore.
import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider, signInWithCredential, signOut } from "firebase/auth/web-extension";
import { getFirestore, doc, getDoc, updateDoc } from "firebase/firestore/lite";
import { firebaseConfig, SITE_URL, ALLOWED } from "./config.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const SITE_ORIGIN = new URL(SITE_URL).origin;

/* ---------- tempo no ícone ---------- */
function elapsedSec(r){ return r ? (r.acc || 0) + (r.start ? (Date.now() - r.start) / 1000 : 0) : 0; }
const fmtMin = m => m < 60 ? m + "m" : Math.floor(m / 60) + "h" + String(m % 60).padStart(2, "0");
// próximo aviso: fim do regressivo/simulado, fim do foco ou da pausa do pomodoro
function nextEvent(r){
  if (!r) return null;
  if ((r.mode === "countdown" || r.mode === "exam") && r.start && !r.done)
    return { at: r.start + (r.target - (r.acc || 0)) * 1000, kind: "count", title: r.mode === "exam" ? "Fim do simulado" : "Tempo esgotado", body: r.mode === "exam" ? "Registre quantas questões você fez." : "Seu tempo de estudo terminou." };
  if (r.mode === "pomodoro" && r.cfg){
    if (r.phase === "focus" && r.start) return { at: r.start + (r.cfg.focus * 60 - ((r.acc || 0) - (r.blockAcc || 0))) * 1000, kind: "focus", title: "Hora da pausa", body: "Ciclo de foco concluído. Descanse um pouco." };
    if (r.phase !== "focus" && r.breakStart) return { at: r.breakStart + r.breakLen * 1000, kind: "break", title: "Fim da pausa", body: r.cfg.auto ? "Um novo foco começou." : "Hora de voltar a estudar." };
  }
  return null;
}
function badgeText(r){
  if (!r) return "";
  const ev = nextEvent(r);
  if (ev){ const left = Math.ceil((ev.at - Date.now()) / 60000); return left <= 0 ? "!" : fmtMin(left); }
  if (r.done) return "!";
  return fmtMin(Math.floor(elapsedSec(r) / 60));
}
function badgeColor(r){
  const ev = nextEvent(r);
  if (ev && ev.kind === "break") return "#C9770F";
  if (ev) return "#2C82BF";
  if (r.done) return "#2C8A4B";
  return r.start ? "#12806D" : "#7F8E88";
}
async function paint(r){
  const text = badgeText(r);
  await chrome.action.setBadgeText({ text });
  if (r){
    await chrome.action.setBadgeBackgroundColor({ color: badgeColor(r) });
    if (chrome.action.setBadgeTextColor) await chrome.action.setBadgeTextColor({ color: "#FFFFFF" });
    const ev = nextEvent(r), what = r.taskText ? r.taskText : "estudando";
    const left = ev ? Math.max(0, Math.ceil((ev.at - Date.now()) / 60000)) : 0;
    const title = ev ? (ev.kind === "break" ? "pausa: faltam " + left + " min" : "faltam " + left + " min") : (r.start ? what + " há " + Math.floor(elapsedSec(r) / 60) + " min" : "pausado em " + Math.floor(elapsedSec(r) / 60) + " min");
    await chrome.action.setTitle({ title: "Mesa de Estudos · " + title });
  } else {
    await chrome.action.setTitle({ title: "Mesa de Estudos" });
  }
}
async function setRunning(r){
  await chrome.storage.local.set({ running: r || null });
  await paint(r || null);
  await schedule(r || null);
}
// agenda a notificação do sistema para o fim da fase (funciona mesmo com o site e o painel fechados)
async function schedule(r){
  const ev = nextEvent(r);
  await chrome.alarms.clear("phase");
  if (ev && ev.at > Date.now() + 500){
    await chrome.storage.local.set({ phaseEvent: ev });
    chrome.alarms.create("phase", { when: ev.at });
  }
}
async function notifyPhase(){
  const { phaseEvent, lastNotified } = await chrome.storage.local.get(["phaseEvent", "lastNotified"]);
  if (!phaseEvent || lastNotified === phaseEvent.at || Date.now() - phaseEvent.at > 120000) return;
  await chrome.storage.local.set({ lastNotified: phaseEvent.at });
  chrome.notifications.create("mesa-" + phaseEvent.at, { type: "basic", iconUrl: "icons/icon-128.png", title: phaseEvent.title, message: phaseEvent.body, priority: 2 });
}
async function cached(){ const { running } = await chrome.storage.local.get("running"); return running || null; }

/* ---------- consulta ao Firestore (pega cronômetro iniciado no site ou no celular) ---------- */
async function refresh(){
  try {
    await auth.authStateReady();
    const u = auth.currentUser;
    if (!u){ await setRunning(null); return; }
    const snap = await getDoc(doc(db, "users", u.uid));
    await setRunning(snap.exists() ? (snap.data().running || null) : null);
  } catch (e) {
    await paint(await cached()); // sem internet: continua contando a partir do último estado conhecido
  }
}

chrome.alarms.onAlarm.addListener(async a => {
  if (a.name === "phase"){ await notifyPhase(); await paint(await cached()); return; }
  if (a.name !== "tick") return;
  await paint(await cached());
  refresh();
});
function setup(){
  chrome.alarms.create("tick", { periodInMinutes: 1 });
  if (chrome.sidePanel && chrome.sidePanel.setPanelBehavior) chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch(() => {});
  refresh();
}
chrome.runtime.onInstalled.addListener(setup);
chrome.runtime.onStartup.addListener(setup);

/* ---------- ações da pílula (mini cronômetro dentro das páginas) ---------- */
async function togglePill(flip){
  const on = !!(await chrome.storage.local.get("pillOn")).pillOn;
  if (!flip) return on;
  await chrome.storage.local.set({ pillOn: !on });
  return !on;
}
chrome.commands.onCommand.addListener(cmd => { if (cmd === "toggle-pill") togglePill(true); });
const POMO = { "25-5": [25,5,15,4,"25/5"], "50-10": [50,10,20,3,"50/10"], "52-17": [52,17,17,99,"52/17"], "90-20": [90,20,30,3,"90/20"] };
function newRunning(cfgDoc){
  const p = cfgDoc.timerPrefs || {}, now = Date.now(), mode = p.mode || "free";
  const cats = cfgDoc.categories || [];
  const cat = (cfgDoc.lastCat && cats.some(c => c.id === cfgDoc.lastCat)) ? cfgDoc.lastCat : (cats[0] ? cats[0].id : "questoes");
  const r = { cat, mode, start: now, acc: 0, first: now };
  if (mode === "countdown") r.target = (p.cdMin || 45) * 60;
  if (mode === "exam"){ r.target = (p.examMin || 240) * 60; r.questions = p.examQ || 60; }
  if (mode === "pomodoro"){ const c = POMO[p.pomo || "25-5"] || POMO["25-5"]; r.cfg = { focus: c[0], short: c[1], long: c[2], every: c[3], auto: p.auto !== false, label: c[4] }; r.phase = "focus"; r.cycles = 0; r.blockAcc = 0; }
  return r;
}
const FLOAT_URL = "float.html";
async function openFinishWindow(){
  const { floatWin } = await chrome.storage.session.get("floatWin");
  if (floatWin){ try { await chrome.windows.update(floatWin, { focused: true, state: "normal" }); return; } catch (e) {} }
  const w = await chrome.windows.create({ url: FLOAT_URL, type: "popup", width: 320, height: 430, focused: true });
  await chrome.storage.session.set({ floatWin: w.id });
}
async function pillAction(action){
  await auth.authStateReady();
  const u = auth.currentUser; if (!u) return { ok: false, message: "Entre na extensão primeiro." };
  const ref = doc(db, "users", u.uid);
  const snap = await getDoc(ref);
  let r = snap.exists() ? snap.data().running : null;
  if (!r && action === "play" && snap.exists()){
    r = newRunning(snap.data());
    await updateDoc(ref, { running: r });
    await setRunning(r);
    return { ok: true };
  }
  if (!r) { await setRunning(null); return { ok: false }; }
  const now = Date.now();
  const acc = () => (r.acc || 0) + (r.start ? (now - r.start) / 1000 : 0);
  if (action === "pause" && r.start){ r.acc = acc(); r.start = null; }
  else if (action === "play"){
    delete r.pendingFinish;
    if (r.mode === "pomodoro" && r.phase !== "focus"){ r.phase = "focus"; r.blockAcc = r.acc || 0; r.start = now; }
    else if ((r.mode === "countdown" || r.mode === "exam") && r.done){ r.target += 300; r.done = false; r.start = now; }
    else if (!r.start) r.start = now;
  }
  else if (action === "stop"){ if (r.start){ r.acc = acc(); r.start = null; } r.pendingFinish = true; }
  await updateDoc(ref, { running: r });
  await setRunning(r);
  if (action === "stop") await openFinishWindow();
  return { ok: true };
}

/* ---------- mensagens das páginas da extensão ---------- */
chrome.runtime.onMessage.addListener((msg, sender, send) => {
  if (!msg) return false;
  if (msg.type === "running"){ setRunning(msg.running); return false; }
  if (msg.type === "pill"){ pillAction(msg.action).then(send, e => send({ ok: false, message: e.message })); return true; }
  if (msg.type === "logout"){
    signOut(auth).then(() => setRunning(null)).then(() => send({ ok: true }));
    return true;
  }
  return false;
});

/* ---------- login: a página auth.html do site envia a credencial do Google ---------- */
chrome.runtime.onMessageExternal.addListener((msg, sender, send) => {
  if (msg && sender.origin === SITE_ORIGIN && (msg.type === "pill-state" || msg.type === "pill-toggle")){
    togglePill(msg.type === "pill-toggle").then(on => send({ on }));
    return true;
  }
  if (!msg || msg.type !== "credential" || sender.origin !== SITE_ORIGIN) return false;
  (async () => {
    try {
      const cred = GoogleAuthProvider.credential(msg.idToken, msg.accessToken);
      const res = await signInWithCredential(auth, cred);
      const email = (res.user.email || "").toLowerCase();
      if (ALLOWED.length && !ALLOWED.map(x => x.toLowerCase()).includes(email)){
        await signOut(auth);
        send({ ok: false, message: "A conta " + email + " não tem acesso a esta Mesa de Estudos." });
        return;
      }
      send({ ok: true, email });
      chrome.runtime.sendMessage({ type: "auth-changed" }).catch(() => {});
      refresh();
      if (sender.tab && sender.tab.id != null) setTimeout(() => chrome.tabs.remove(sender.tab.id).catch(() => {}), 1500);
    } catch (e) {
      send({ ok: false, code: e.code, message: e.message });
    }
  })();
  return true;
});

// clicar na notificação abre o painel lateral (ou o site)
chrome.notifications.onClicked.addListener(id => {
  chrome.notifications.clear(id);
  chrome.windows.getLastFocused(w => {
    if (chrome.sidePanel && w) chrome.sidePanel.open({ windowId: w.id }).catch(() => chrome.tabs.create({ url: SITE_URL }));
    else chrome.tabs.create({ url: SITE_URL });
  });
});
