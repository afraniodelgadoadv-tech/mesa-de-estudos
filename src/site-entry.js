// Site (GitHub Pages): login direto com o Google pelo Firebase.
import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from "firebase/auth";
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager } from "firebase/firestore";
import { firebaseConfig, SITE_URL, ALLOWED } from "./config.js";
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
});

if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
