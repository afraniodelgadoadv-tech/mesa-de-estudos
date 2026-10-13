import { chromium } from "playwright";
import http from "node:http"; import path from "node:path";
const srv = http.createServer((q,r)=>{ r.writeHead(200,{"content-type":"text/html"}); r.end("<!doctype html><html><body style='margin:0;background:#fff'><h1 style='font-family:serif;padding:20px'>Página qualquer (ex.: TEC Concursos)</h1><p style='padding:0 20px'>Texto de exemplo.</p></body></html>"); }).listen(8770);
const ext = path.resolve("extension");
const ctx = await chromium.launchPersistentContext("/tmp/claude-0/-home-claude-mesa-de-estudos/c8ec4ea5-de57-5af4-afd2-a23c13a27d86/scratchpad/prof"+Date.now(), {executablePath:"/opt/pw-browsers/chromium", headless:true, viewport:{width:900,height:500}, args:[`--disable-extensions-except=${ext}`,`--load-extension=${ext}`,"--headless=new"]});
let [sw] = ctx.serviceWorkers(); if (!sw) sw = await ctx.waitForEvent("serviceworker");
const p = await ctx.newPage(); const errs=[]; p.on("pageerror", e=>errs.push(e.message));
await p.goto("http://localhost:8770/"); await p.waitForTimeout(800);
console.log("pill before running:", await p.evaluate(()=>!!document.getElementById("mesa-pill-host")));
await sw.evaluate(() => chrome.storage.local.set({ running: { cat:"questoes", mode:"pomodoro", start: Date.now()-5*60000, acc:0, blockAcc:0, phase:"focus", cycles:0, first: 123, cfg:{focus:25,short:5,long:15,every:4,auto:true,label:"25/5"} } }));
await p.waitForTimeout(1300);
console.log("pill after running:", await p.evaluate(()=>!!document.getElementById("mesa-pill-host")));
await p.screenshot({path:"test/out/pill.png"});
const box = await p.evaluate(()=>{ const r=document.getElementById("mesa-pill-host").getBoundingClientRect(); return {x:r.x,y:r.y,w:r.width,h:r.height}; });
console.log("pill box:", JSON.stringify(box));
// drag from the dot area
await p.mouse.move(box.x+10, box.y+12); await p.mouse.down(); await p.mouse.move(120, 80, {steps:5}); await p.mouse.up(); await p.waitForTimeout(300);
console.log("after drag:", JSON.stringify(await p.evaluate(()=>{ const r=document.getElementById("mesa-pill-host").getBoundingClientRect(); return [Math.round(r.x),Math.round(r.y)]; })), "| saved pos:", JSON.stringify(await sw.evaluate(async()=> (await chrome.storage.local.get("pillPos")).pillPos)));
await p.screenshot({path:"test/out/pill-moved.png"});
// paused state
await sw.evaluate(() => chrome.storage.local.set({ running: { cat:"questoes", mode:"free", start: null, acc: 754, first: 123 } }));
await p.waitForTimeout(500);
console.log("paused shows:", await p.evaluate(()=>document.getElementById("mesa-pill-host") ? "visible" : "gone"));
await sw.evaluate(() => chrome.storage.local.set({ running: null })); await p.waitForTimeout(400);
console.log("stopped:", await p.evaluate(()=>!!document.getElementById("mesa-pill-host")), "ERRORS:", errs.length?errs:"none");
await ctx.close(); srv.close();
