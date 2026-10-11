// Service worker da extensão: tempo no ícone, login vindo do site e consulta periódica ao Firestore.
import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider, signInWithCredential, signOut } from "firebase/auth/web-extension";
import { getFirestore, doc, getDoc } from "firebase/firestore/lite";
import { firebaseConfig, SITE_URL, ALLOWED } from "./config.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const SITE_ORIGIN = new URL(SITE_URL).origin;

/* ---------- tempo no ícone ---------- */
function elapsedSec(r){ return r ? (r.acc || 0) + (r.start ? (Date.now() - r.start) / 1000 : 0) : 0; }
function badgeText(r){
  if (!r) return "";
  const m = Math.floor(elapsedSec(r) / 60);
  if (m < 60) return m + "m";
  return Math.floor(m / 60) + "h" + String(m % 60).padStart(2, "0");
}
async function paint(r){
  const text = badgeText(r);
  await chrome.action.setBadgeText({ text });
  if (r){
    await chrome.action.setBadgeBackgroundColor({ color: r.start ? "#12806D" : "#7F8E88" });
    if (chrome.action.setBadgeTextColor) await chrome.action.setBadgeTextColor({ color: "#FFFFFF" });
    const what = r.taskText ? r.taskText : "estudando";
    await chrome.action.setTitle({ title: "Mesa de Estudos · " + (r.start ? what + " há " : "pausado em ") + Math.floor(elapsedSec(r) / 60) + " min" });
  } else {
    await chrome.action.setTitle({ title: "Mesa de Estudos" });
  }
}
async function setRunning(r){
  await chrome.storage.local.set({ running: r || null });
  await paint(r || null);
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

/* ---------- mensagens das páginas da extensão ---------- */
chrome.runtime.onMessage.addListener((msg, sender, send) => {
  if (!msg) return false;
  if (msg.type === "running"){ setRunning(msg.running); return false; }
  if (msg.type === "logout"){
    signOut(auth).then(() => setRunning(null)).then(() => send({ ok: true }));
    return true;
  }
  return false;
});

/* ---------- login: a página auth.html do site envia a credencial do Google ---------- */
chrome.runtime.onMessageExternal.addListener((msg, sender, send) => {
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
