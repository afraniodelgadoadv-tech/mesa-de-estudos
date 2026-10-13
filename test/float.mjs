import { chromium } from "playwright";
import http from "node:http"; import { readFileSync } from "node:fs";
const srv = http.createServer((q,r)=>{ const f = "test/out" + q.url.split("?")[0]; try { const b = readFileSync(f); r.writeHead(200,{"content-type": f.endsWith(".js")?"text/javascript":"text/html"}); r.end(b);} catch(e){ r.writeHead(404); r.end(); } }).listen(8766);
const browser = await chromium.launch({executablePath:"/opt/pw-browsers/chromium", args:["--headless=new"]});
const errs=[];
const p = await browser.newPage({viewport:{width:1200,height:850}}); p.on("pageerror", e=>errs.push(e.message));
await p.goto("http://localhost:8766/site.html"); await p.waitForTimeout(150); await p.evaluate(()=>window.__login()); await p.waitForTimeout(150);
console.log("has DocPiP:", await p.evaluate(()=>"documentPictureInPicture" in window));
await p.click("#floatBtn"); await p.waitForTimeout(800);
const r = await p.evaluate(()=>({away: !!document.querySelector(".clock-away"), status: document.getElementById("status") ? document.getElementById("status").textContent : "(no status in main doc)", pip: !!(window.documentPictureInPicture && documentPictureInPicture.window)}));
console.log("after click:", JSON.stringify(r));
if (r.pip){
  const pw = await p.evaluate(()=>{ const d=documentPictureInPicture.window.document; d.querySelector("#controls button").click(); return d.getElementById("status").textContent; });
  await p.waitForTimeout(1200);
  console.log("pip status after start:", pw, "| time:", await p.evaluate(()=>documentPictureInPicture.window.document.getElementById("time").textContent));
  await p.evaluate(()=>documentPictureInPicture.window.close()); await p.waitForTimeout(300);
  console.log("back in main:", await p.evaluate(()=>!!document.querySelector("#view-timer #clockPanel") && !document.querySelector(".clock-away")));
}
const f = await browser.newPage({viewport:{width:300,height:340}}); f.on("pageerror", e=>errs.push("float: "+e.message));
await f.goto("http://localhost:8766/float.html"); await f.waitForTimeout(150); await f.evaluate(()=>window.__login()); await f.waitForTimeout(200);
await f.screenshot({path:"test/out/float.png"});
// simulate pip look: emulate body.pip in a page
const g = await browser.newPage({viewport:{width:280,height:210}});
await g.goto("http://localhost:8766/site.html"); await g.waitForTimeout(100); await g.evaluate(()=>window.__login()); await g.waitForTimeout(150);
await g.evaluate(()=>{ const c=document.getElementById("clockPanel"); document.body.className="pip"; document.body.replaceChildren(c); });
await g.screenshot({path:"test/out/pip-idle.png"});
console.log("ERRORS:", errs.length?errs:"none");
await browser.close(); srv.close();
