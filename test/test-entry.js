import { startApp } from "../src/app.js";
import { __docs } from "firebase/firestore";
window.__docs = __docs;
let cb = null; const user = {uid: "u1", email: "afraniodelgado.adv@gmail.com", displayName: "Afrânio Delgado"};
window.__login = () => cb && cb(user);
window.__logout = () => cb && cb(null);
startApp({ mode: document.body.dataset.mode, db: {}, siteUrl: "https://example.test/", allowed: ["afraniodelgado.adv@gmail.com"],
  signIn: async () => { cb(user); }, signOut: async () => { cb(null); }, onAuth: f => { cb = f; setTimeout(() => f(null), 10); },
  onRunning: (r) => { window.__running = r; }, openPanel: () => { window.__panel = true; } });
