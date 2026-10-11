// auth.html: login com Google que entrega a credencial para a extensão (Chrome e Edge).
import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider, signInWithPopup } from "firebase/auth";
import { firebaseConfig, EXT_ID } from "./config.js";

const auth = getAuth(initializeApp(firebaseConfig));
const $ = id => document.getElementById(id);
const fromExt = new URLSearchParams(location.search).has("ext");
const canTalk = typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.sendMessage;

function say(t, cls){ const m = $("msg"); m.textContent = t; m.className = "msg " + (cls || ""); }

if (!fromExt){
  say("Esta página serve para entrar na extensão. Para usar a Mesa de Estudos, abra o site principal.");
  $("go").hidden = true; $("home").hidden = false;
} else if (!canTalk){
  say("Não encontrei a extensão Mesa de Estudos neste navegador. Instale-a e tente de novo pelo botão Entrar dela.", "err");
  $("go").hidden = true;
}

$("go").addEventListener("click", async () => {
  $("go").disabled = true; say("Abrindo o login do Google…");
  try {
    const p = new GoogleAuthProvider(); p.setCustomParameters({ prompt: "select_account" });
    const r = await signInWithPopup(auth, p);
    const c = GoogleAuthProvider.credentialFromResult(r);
    say("Conectando a extensão…");
    chrome.runtime.sendMessage(EXT_ID, { type: "credential", idToken: c.idToken, accessToken: c.accessToken }, res => {
      if (chrome.runtime.lastError || !res){ say("A extensão não respondeu. Confira se ela está instalada e ativa e tente de novo.", "err"); $("go").disabled = false; return; }
      if (res.ok) say("Pronto! A extensão está conectada como " + res.email + ". Esta aba vai fechar sozinha.", "ok");
      else { say(res.message || "Não consegui entrar.", "err"); $("go").disabled = false; }
    });
  } catch (e) {
    const code = e.code || "";
    say(code.includes("popup-closed") ? "A janela do Google foi fechada antes de terminar. Tente de novo." : "Não consegui entrar: " + (e.message || code), "err");
    $("go").disabled = false;
  }
});
