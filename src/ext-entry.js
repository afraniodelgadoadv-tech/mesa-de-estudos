// Extensão (popup e painel lateral): mesma Mesa de Estudos, com login feito pelo service worker.
import { initializeApp } from "firebase/app";
import { getAuth, signOut, onAuthStateChanged } from "firebase/auth/web-extension";
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager } from "firebase/firestore";
import { firebaseConfig, SITE_URL, ALLOWED } from "./config.js";
import { startApp } from "./app.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
let db;
try { db = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) }); }
catch (e) { db = initializeFirestore(app, {}); }

const mode = document.body.dataset.mode || "panel";
let windowId = null;
chrome.windows.getCurrent(w => { windowId = w && w.id; });

// o service worker avisa quando o login ou a saída acontecem em outro lugar da extensão
chrome.runtime.onMessage.addListener(msg => { if (msg && msg.type === "auth-changed") location.reload(); });

startApp({
  mode, db, siteUrl: SITE_URL, allowed: ALLOWED,
  // abre a página de login do site numa aba; ela devolve a credencial para a extensão
  signIn: async () => { await chrome.tabs.create({ url: SITE_URL + "auth.html?ext=1" }); if (mode === "popup") window.close(); },
  signOut: async () => { await signOut(auth); chrome.runtime.sendMessage({ type: "logout" }).catch(() => {}); },
  onAuth: cb => onAuthStateChanged(auth, cb),
  onRunning: (running, goal) => { chrome.runtime.sendMessage({ type: "running", running, goal }).catch(() => {}); },
  // janelinha do cronômetro; dentro dela, "Fixar por cima de tudo" a deixa sempre visível
  openFloat: async () => {
    const { floatWin } = await chrome.storage.session.get("floatWin");
    if (floatWin){ try { await chrome.windows.update(floatWin, { focused: true, state: "normal" }); if (mode === "popup") window.close(); return; } catch (e) {} }
    const w = await chrome.windows.create({ url: "float.html", type: "popup", width: 300, height: 300, left: Math.max(0, screen.availWidth - 330), top: 90, focused: true });
    await chrome.storage.session.set({ floatWin: w.id });
    if (mode === "popup") window.close();
  },
  onFloatOpen: () => { if (mode === "float") chrome.windows.getCurrent(w => chrome.windows.update(w.id, { state: "minimized" })); },
  onFloatClose: () => { if (mode === "float") chrome.windows.getCurrent(w => chrome.windows.update(w.id, { state: "normal", focused: true })); },
  openPanel: () => {
    if (chrome.sidePanel && windowId != null) { chrome.sidePanel.open({ windowId }).catch(() => chrome.tabs.create({ url: SITE_URL })); }
    else chrome.tabs.create({ url: SITE_URL });
    setTimeout(() => window.close(), 50);
  },
});
