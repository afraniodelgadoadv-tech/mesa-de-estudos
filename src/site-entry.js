// Site (GitHub Pages): login direto com o Google pelo Firebase.
import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from "firebase/auth";
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager } from "firebase/firestore";
import { firebaseConfig, SITE_URL, ALLOWED, EXT_ID } from "./config.js";
import { startApp } from "./app.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
let db;
try { db = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) }); }
catch (e) { db = initializeFirestore(app, {}); }

const provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: "select_account" });

startApp({
  mode: "site", db, siteUrl: SITE_URL, allowed: ALLOWED,
  signIn: () => signInWithPopup(auth, provider),
  signOut: () => signOut(auth),
  onAuth: cb => onAuthStateChanged(auth, cb),
  // se a extensão estiver instalada, o site também liga e desliga a pílula
  pill: {
    state: () => new Promise(res => {
      try { if (!(window.chrome && chrome.runtime && chrome.runtime.sendMessage)) return res(null);
        chrome.runtime.sendMessage(EXT_ID, { type: "pill-state" }, r => res(chrome.runtime.lastError || !r ? null : !!r.on)); }
      catch (e) { res(null); }
    }),
    toggle: () => new Promise(res => { try { chrome.runtime.sendMessage(EXT_ID, { type: "pill-toggle" }, r => res(chrome.runtime.lastError || !r ? null : !!r.on)); } catch (e) { res(null); } }),
  },
  notify: (title, body) => {
    try { if ("Notification" in window && Notification.permission === "granted") new Notification(title, { body, icon: "icons/icon-192.png", tag: "mesa-timer" }); } catch (e) {}
  },
});

if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
