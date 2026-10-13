// Gera o site (docs/, publicado pelo GitHub Pages) e a extensão (extension/) a partir de src/.
import { build } from "esbuild";
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, rmSync, existsSync } from "node:fs";
import { EXT_KEY } from "./src/config.js";

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const VERSION = pkg.version || "1.0.0";
const styles = readFileSync("src/styles.css", "utf8");
const body = readFileSync("src/body.html", "utf8");
const FONTS = '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Nunito:wght@700;800&family=Manrope:wght@400;500;600;700;800&display=swap">';

for (const d of ["docs", "extension"]) { rmSync(d, { recursive: true, force: true }); mkdirSync(d + "/icons", { recursive: true }); }

const common = { bundle: true, format: "esm", minify: true, target: ["chrome110", "edge110", "safari15"], legalComments: "none", logLevel: "warning" };
await build({ ...common, entryPoints: { app: "src/site-entry.js", auth: "src/auth-entry.js" }, outdir: "docs" });
await build({ ...common, entryPoints: { app: "src/ext-entry.js", background: "src/background.js" }, outdir: "extension" });
await build({ ...common, format: "iife", entryPoints: { content: "src/content.js" }, outdir: "extension" });

const page = ({ title, mode, cssHref, extraHead = "", script }) => `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${title}</title>
${FONTS}
${cssHref ? `<link rel="stylesheet" href="${cssHref}">` : `<style>${styles}</style>`}
${extraHead}
</head>
<body data-mode="${mode}">
${body}
<script type="module" src="${script}"></script>
</body>
</html>
`;

// ---------- site ----------
writeFileSync("docs/index.html", page({
  title: "Mesa de Estudos", mode: "site", script: "app.js",
  extraHead: '<meta name="theme-color" content="#12806D"><link rel="manifest" href="manifest.webmanifest"><link rel="icon" href="icons/icon-32.png"><link rel="apple-touch-icon" href="icons/icon-180.png">',
}));
writeFileSync("docs/auth.html", `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Entrar na extensão · Mesa de Estudos</title>${FONTS}
<style>
:root{--bg:#EFF4F1;--card:#fff;--ink:#1D2B27;--ink2:#4D5D57;--accent:#12806D;--ok:#2C8A4B;--bad:#C4443A;--line:#E0E8E3}
@media (prefers-color-scheme: dark){:root{--bg:#0F1614;--card:#18211F;--ink:#E7EFEB;--ink2:#AEBDB7;--accent:#4CC6AC;--ok:#7CD496;--bad:#F08A7E;--line:#25302D;color-scheme:dark}}
body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--ink);font-family:Manrope,system-ui,sans-serif;padding:16px;box-sizing:border-box}
.card{max-width:420px;width:100%;background:var(--card);border:1px solid var(--line);border-radius:24px;padding:32px 28px;display:flex;flex-direction:column;gap:14px;align-items:center;text-align:center}
h1{font-family:Nunito,system-ui,sans-serif;margin:0;font-size:1.5rem}
p{margin:0;color:var(--ink2)}
button,a.b{font:inherit;font-weight:700;border:0;border-radius:999px;padding:12px 24px;background:var(--accent);color:#fff;cursor:pointer;text-decoration:none}
button:disabled{opacity:.5}
.msg{min-height:1.4em}.msg.ok{color:var(--ok);font-weight:700}.msg.err{color:var(--bad)}
</style></head>
<body><main class="card">
<h1>Conectar a extensão</h1>
<p>Entre com a mesma conta Google do site. A extensão passa a mostrar seu cronômetro, tarefas, notas e provas.</p>
<button id="go" type="button">Entrar com Google</button>
<a class="b" id="home" href="./" hidden>Abrir a Mesa de Estudos</a>
<p class="msg" id="msg" role="status"></p>
</main><script type="module" src="auth.js"></script></body></html>
`);
writeFileSync("docs/manifest.webmanifest", JSON.stringify({
  name: "Mesa de Estudos", short_name: "Estudos", start_url: "./", scope: "./", display: "standalone",
  background_color: "#EFF4F1", theme_color: "#12806D", lang: "pt-BR",
  icons: [{ src: "icons/icon-192.png", sizes: "192x192", type: "image/png" }, { src: "icons/icon-512.png", sizes: "512x512", type: "image/png" }, { src: "icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" }],
}, null, 2));
writeFileSync("docs/sw.js", `// Guarda o site para abrir mesmo sem internet (os dados já ficam no Firestore offline).
const C = "mesa-${VERSION}-${Date.now()}";
const SHELL = ["./", "index.html", "app.js", "manifest.webmanifest", "icons/icon-192.png"];
self.addEventListener("install", e => { e.waitUntil(caches.open(C).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== C).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", e => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== location.origin) return;
  e.respondWith(fetch(e.request).then(r => { const copy = r.clone(); caches.open(C).then(c => c.put(e.request, copy)); return r; }).catch(() => caches.match(e.request).then(r => r || caches.match("index.html"))));
});
`);
writeFileSync("docs/.nojekyll", "");

// ---------- extensão ----------
writeFileSync("extension/styles.css", styles);
writeFileSync("extension/sidepanel.html", page({ title: "Mesa de Estudos", mode: "panel", cssHref: "styles.css", script: "app.js" }));
writeFileSync("extension/popup.html", page({ title: "Mesa de Estudos", mode: "popup", cssHref: "styles.css", script: "app.js" }));
writeFileSync("extension/float.html", page({ title: "Cronômetro · Mesa de Estudos", mode: "float", cssHref: "styles.css", script: "app.js" }));
const { SITE_URL } = await import("./src/config.js");
const site = new URL(SITE_URL);
writeFileSync("extension/manifest.json", JSON.stringify({
  manifest_version: 3,
  name: "Mesa de Estudos",
  short_name: "Estudos",
  version: VERSION,
  description: "Cronômetro no ícone e painel lateral com tarefas, notas, estatísticas e provas da sua Mesa de Estudos.",
  key: EXT_KEY,
  icons: { 16: "icons/icon-16.png", 32: "icons/icon-32.png", 48: "icons/icon-48.png", 128: "icons/icon-128.png" },
  action: { default_popup: "popup.html", default_title: "Mesa de Estudos", default_icon: { 16: "icons/icon-16.png", 32: "icons/icon-32.png" } },
  side_panel: { default_path: "sidepanel.html" },
  background: { service_worker: "background.js", type: "module" },
  permissions: ["sidePanel", "alarms", "storage", "notifications"],
  externally_connectable: { matches: [site.origin + "/*"] },
  content_scripts: [{ matches: ["<all_urls>"], js: ["content.js"], run_at: "document_idle" }],
  commands: { _execute_action: { suggested_key: { default: "Alt+Shift+E" }, description: "Abrir o cronômetro" } },
}, null, 2));

// ícones
for (const s of [16, 32, 48, 128]) copyFileSync(`assets/icon-${s}.png`, `extension/icons/icon-${s}.png`);
for (const s of [32, 180, 192, 512]) copyFileSync(`assets/icon-${s}.png`, `docs/icons/icon-${s}.png`);
console.log("ok: docs/ e extension/ gerados (versão " + VERSION + ")");
