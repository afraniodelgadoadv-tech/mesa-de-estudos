// Pílula: mini cronômetro arrastável dentro das páginas. Só aparece quando ligada (botão da pílula ou Alt+Shift+P).
(() => {
  if (window.top !== window || document.getElementById("mesa-pill-host")) return;
  if (location.origin === "https://afraniodelgadoadv-tech.github.io") return; // o site já mostra o cronômetro

  const host = document.createElement("div");
  host.id = "mesa-pill-host";
  host.style.cssText = "all:initial;position:fixed;z-index:2147483646;left:0;top:0;";
  const root = host.attachShadow({ mode: "closed" });
  root.innerHTML = `<style>
    .pill{display:flex;align-items:center;gap:6px;padding:4px 5px 4px 10px;border-radius:999px;background:rgba(22,32,29,.93);color:#fff;
      font:600 13px/1 system-ui,-apple-system,"Segoe UI",sans-serif;box-shadow:0 6px 18px rgba(0,0,0,.28);cursor:grab;user-select:none;-webkit-user-select:none;touch-action:none}
    .pill:active{cursor:grabbing}
    .dot{width:7px;height:7px;border-radius:50%;background:#4CC6AC;flex:none}
    .pill[data-k="paused"] .dot{background:#9AA6A1}
    .pill[data-k="break"] .dot{background:#F1B15B}
    .pill[data-k="count"] .dot{background:#75B8EA}
    .pill[data-k="done"] .dot{background:#7CD496}
    .t{font-variant-numeric:tabular-nums;letter-spacing:.01em;min-width:3.6em;text-align:center}
    button{all:unset;display:grid;place-items:center;width:20px;height:20px;border-radius:50%;cursor:pointer;background:rgba(255,255,255,.14);color:#fff}
    button:hover{background:rgba(255,255,255,.28)}
    button.stop{background:#12806D}
    button.x{background:transparent;width:16px;color:rgba(255,255,255,.55);font:700 13px/1 system-ui}
    button.x:hover{color:#fff;background:transparent}
    svg{width:9px;height:9px;display:block}
  </style>
  <div class="pill" part="pill" title="Mesa de Estudos: arraste para mover">
    <span class="dot"></span><span class="t">--:--</span>
    <button class="pp" type="button" aria-label="Pausar"></button>
    <button class="stop" type="button" aria-label="Finalizar" title="Finalizar e registrar"><svg viewBox="0 0 24 24" fill="currentColor"><rect x="5" y="5" width="14" height="14" rx="2.5"/></svg></button>
    <button class="x" type="button" aria-label="Esconder a pílula" title="Esconder a pílula (religue pelo botão ou Alt+Shift+P)">×</button>
  </div>`;
  const pill = root.querySelector(".pill"), tEl = root.querySelector(".t"), pp = root.querySelector(".pp");
  const ICON = { pause: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="5" y="4" width="5" height="16" rx="1.5"/><rect x="14" y="4" width="5" height="16" rx="1.5"/></svg>',
                 play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 4.5v15a1 1 0 0 0 1.5.86l12-7.5a1 1 0 0 0 0-1.72l-12-7.5A1 1 0 0 0 7 4.5z"/></svg>' };

  let running = null, pillOn = false, pos = null, attached = false;
  const pad = n => String(n).padStart(2, "0");
  const clock = s => { s = Math.max(0, Math.floor(s)); const h = Math.floor(s / 3600); return (h ? h + ":" : "") + pad(Math.floor(s % 3600 / 60)) + ":" + pad(s % 60); };
  const elapsed = r => (r.acc || 0) + (r.start ? (Date.now() - r.start) / 1000 : 0);
  function view(r){
    if ((r.mode === "countdown" || r.mode === "exam")) return r.done ? { k: "done", s: 0 } : { k: r.start ? "count" : "paused", s: r.target - elapsed(r) };
    if (r.mode === "pomodoro" && r.cfg){
      if (r.phase !== "focus") return { k: "break", s: r.breakLen - (Date.now() - r.breakStart) / 1000 };
      return { k: r.start ? "count" : "paused", s: r.cfg.focus * 60 - (elapsed(r) - (r.blockAcc || 0)) };
    }
    return { k: r.start ? "run" : "paused", s: elapsed(r) };
  }
  function place(){
    const w = pill.offsetWidth || 150, h = pill.offsetHeight || 30;
    let x = pos ? pos.x * innerWidth : innerWidth - w - 18, y = pos ? pos.y * innerHeight : innerHeight - h - 18;
    x = Math.min(Math.max(4, x), innerWidth - w - 4); y = Math.min(Math.max(4, y), innerHeight - h - 4);
    host.style.left = x + "px"; host.style.top = y + "px";
  }
  function render(){
    if (!pillOn){ if (attached){ host.remove(); attached = false; } return; }
    if (!attached){ (document.body || document.documentElement).appendChild(host); attached = true; place(); }
    const idle = !running || running.pendingFinish;
    root.querySelector(".stop").style.display = idle ? "none" : "";
    if (idle){ pill.dataset.k = "paused"; tEl.textContent = "00:00"; pp.innerHTML = ICON.play; pp.setAttribute("aria-label", "Começar a estudar"); pp.title = "Começar (usa o último modo e atividade)"; return; }
    const v = view(running);
    pill.dataset.k = v.k;
    tEl.textContent = clock(v.s);
    const playing = v.k === "run" || v.k === "count";
    pp.innerHTML = playing ? ICON.pause : ICON.play;
    pp.setAttribute("aria-label", playing ? "Pausar" : v.k === "break" ? "Pular pausa" : v.k === "done" ? "Mais 5 minutos" : "Continuar");
    pp.title = pp.getAttribute("aria-label");
  }
  const act = action => chrome.runtime.sendMessage({ type: "pill", action }).catch(() => {});
  pp.addEventListener("click", e => { e.stopPropagation(); const v = running && view(running); act(v && (v.k === "run" || v.k === "count") ? "pause" : "play"); });
  root.querySelector(".stop").addEventListener("click", e => { e.stopPropagation(); act("stop"); });
  root.querySelector(".x").addEventListener("click", e => { e.stopPropagation(); chrome.storage.local.set({ pillOn: false }); });

  // arrastar (posição guardada em proporção da tela, igual em todos os sites)
  pill.addEventListener("pointerdown", e => {
    if (e.target.closest("button")) return;
    e.preventDefault(); pill.setPointerCapture(e.pointerId);
    const r = host.getBoundingClientRect(), dx = e.clientX - r.left, dy = e.clientY - r.top;
    const move = ev => { host.style.left = Math.min(Math.max(4, ev.clientX - dx), innerWidth - pill.offsetWidth - 4) + "px"; host.style.top = Math.min(Math.max(4, ev.clientY - dy), innerHeight - pill.offsetHeight - 4) + "px"; };
    const up = () => { pill.removeEventListener("pointermove", move); pill.removeEventListener("pointerup", up);
      pos = { x: parseFloat(host.style.left) / innerWidth, y: parseFloat(host.style.top) / innerHeight }; chrome.storage.local.set({ pillPos: pos }); };
    pill.addEventListener("pointermove", move); pill.addEventListener("pointerup", up);
  });
  addEventListener("resize", () => attached && place());

  chrome.storage.local.get(["running", "pillPos", "pillOn"], d => { running = d.running || null; pos = d.pillPos || null; pillOn = !!d.pillOn; render(); });
  chrome.storage.onChanged.addListener((ch, area) => {
    if (area !== "local") return;
    if (ch.running) running = ch.running.newValue || null;
    if (ch.pillPos){ pos = ch.pillPos.newValue || null; if (attached) place(); }
    if (ch.pillOn) pillOn = !!ch.pillOn.newValue;
    render();
  });
  setInterval(() => { if (attached && !document.hidden) render(); }, 1000);
})();
