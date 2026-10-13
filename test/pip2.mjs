import { chromium } from "playwright";
import http from "node:http"; import { readFileSync } from "node:fs";
const srv = http.createServer((q,r)=>{ const f = "test/out" + q.url.split("?")[0]; try { const b = readFileSync(f); r.writeHead(200,{"content-type": f.endsWith(".js")?"text/javascript":"text/html"}); r.end(b);} catch(e){ r.writeHead(404); r.end(); } }).listen(8769);
const browser = await chromium.launch({executablePath:"/opt/pw-browsers/chromium"});
const g = await browser.newPage({viewport:{width:210,height:70}});
await g.goto("http://localhost:8769/site.html"); await g.waitForTimeout(100); await g.evaluate(()=>window.__login()); await g.waitForTimeout(150);
await g.evaluate(()=>document.querySelector("#controls button").click()); await g.waitForTimeout(300);
console.log(await g.evaluate(()=>{ const b=document.getElementById("miniToggle"); const s=b.querySelector("svg"); return b.innerHTML.slice(0,200)+" | svg box "+(s?JSON.stringify(s.getBoundingClientRect()):"none"); }));
await browser.close(); srv.close();
