import { chromium } from "playwright";
import http from "node:http"; import { readFileSync } from "node:fs";
const srv = http.createServer((q,r)=>{ const f = "test/out" + q.url.split("?")[0]; try { const b = readFileSync(f); r.writeHead(200,{"content-type": f.endsWith(".js")?"text/javascript":"text/html"}); r.end(b);} catch(e){ r.writeHead(404); r.end(); } }).listen(8767);
const browser = await chromium.launch({executablePath:"/opt/pw-browsers/chromium"});
const errs=[]; const p = await browser.newPage({viewport:{width:1200,height:900}}); p.on("pageerror", e=>errs.push(e.message));
await p.clock.install({time: new Date("2026-10-13T09:00:00-03:00")});
await p.goto("http://localhost:8767/site.html"); await p.clock.runFor(200); await p.evaluate(()=>window.__login()); await p.clock.runFor(300);
const S = async (lbl) => console.log(lbl, "|", await p.textContent("#time"), "|", (await p.textContent("#status")).slice(0,110), "| state:", await p.getAttribute("#clockPanel","data-state"), "| pill:", await p.isVisible("#modePill") ? await p.textContent("#modePill") : "-", "| btns:", (await p.locator("#controls button").allTextContents()).join("/"));
// Regressivo
await p.click("#modeBar button:has-text('Regressivo')"); await p.clock.runFor(100);
await p.click("#modeOpts .opt:has-text('15min')"); await p.clock.runFor(100);
await S("cd idle");
await p.click("#controls button"); await p.clock.runFor(2000); await S("cd running");
await p.clock.runFor(15*60*1000 + 3000); await S("cd ended");
await p.click("#controls button:has-text('+5 min')"); await p.clock.runFor(60000); await S("cd extended");
await p.clock.runFor(5*60*1000); await S("cd ended2");
await p.click("#controls button:has-text('Registrar')"); await p.clock.runFor(100);
await p.click("#fSave"); await p.clock.runFor(300);
console.log("session durs:", await p.evaluate(()=>[...window.__docs.entries()].filter(([k])=>k.includes("sessions")).map(([k,v])=>v.dur+":"+v.mode)));
// Pomodoro
await p.click("#modeBar button:has-text('Pomodoro')"); await p.clock.runFor(100); await S("pomo idle");
await p.click("#controls button"); await p.clock.runFor(60000); await S("pomo focus");
await p.clock.runFor(24*60000 + 3000); await S("pomo break");
await p.clock.runFor(5*60000); await S("pomo focus2");
await p.click("#controls button:has-text('Pausar')"); await p.clock.runFor(10*60000); await S("pomo paused");
await p.click("#controls button:has-text('Encerrar')"); await p.clock.runFor(100);
console.log("fNote:", await p.inputValue("#fNote")); await p.click("#fSave"); await p.clock.runFor(300);
console.log("session durs:", await p.evaluate(()=>[...window.__docs.entries()].filter(([k])=>k.includes("sessions")).map(([k,v])=>Math.round(v.dur)+":"+v.mode)));
// Simulado
await p.click("#modeBar button:has-text('Simulado')"); await p.clock.runFor(100); await S("exam idle"); console.log("opts:", (await p.textContent("#modeOpts")).slice(0,160));
await p.click("#controls button"); await p.clock.runFor(30*60000); await S("exam 30min");
await p.screenshot({path:"test/out/modes-exam.png"});
await p.click("#controls button:has-text('Encerrar')"); await p.clock.runFor(100); await p.click("#fDiscard"); await p.clock.runFor(100); await p.click("#fDiscardWrap button:has-text('Sim')"); await p.clock.runFor(100);
await p.click("#modeBar button:has-text('Pomodoro')"); await p.clock.runFor(100); await p.screenshot({path:"test/out/modes-pomo.png"});
console.log("ERRORS:", errs.length?errs:"none");
await browser.close(); srv.close();
