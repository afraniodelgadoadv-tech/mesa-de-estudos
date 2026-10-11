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
  openPanel: () => {
    if (chrome.sidePanel && windowId != null) { chrome.sidePanel.open({ windowId }).catch(() => chrome.tabs.create({ url: SITE_URL })); }
    else chrome.tabs.create({ url: SITE_URL });
    setTimeout(() => window.close(), 50);
  },
});
