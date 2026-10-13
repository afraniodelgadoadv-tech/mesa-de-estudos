import { chromium } from "playwright";
import http from "node:http"; import { readFileSync } from "node:fs";
const srv = http.createServer((q,r)=>{ const f = "test/out" + q.url.split("?")[0]; try { const b = readFileSync(f); r.writeHead(200,{"content-type": f.endsWith(".js")?"text/javascript":"text/html"}); r.end(b);} catch(e){ r.writeHead(404); r.end(); } }).listen(8771);
const browser = await chromium.launch({executablePath:"/opt/pw-browsers/chromium"});
const errs=[];
for (const mode of ["float","site"]){
  const p = await browser.newPage({viewport:{width:320,height:430}}); p.on("pageerror", e=>errs.push(e.message));
  await p.goto(`http://localhost:8771/${mode}.html`); await p.waitForTimeout(100);
  await p.evaluate(()=>{ window.__docs.set("users/u1", {categories:[{id:"questoes",name:"Questões",color:0}], exams:[], dailyGoal:240, running:{cat:"questoes", mode:"free", start:null, acc:1800, first:Date.now()-1900000, pendingFinish:true}}); window.__login(); });
  await p.waitForTimeout(300);
  console.log(mode, "finish visible:", await p.isVisible("#finish"), "| state:", await p.getAttribute("#clockPanel","data-state"));
  if (mode==="float"){ await p.fill("#fQty","30"); await p.click("#fSave"); await p.waitForTimeout(300); console.log("saved:", await p.evaluate(()=>[...window.__docs.entries()].filter(([k])=>k.includes("sessions")).map(([k,v])=>v.dur+"s qty "+v.qty)), "running:", await p.evaluate(()=>JSON.stringify(window.__docs.get("users/u1").running))); await p.screenshot({path:"test/out/float-finish.png"}); }
}
console.log("ERRORS:", errs.length?errs:"none"); await browser.close(); srv.close();
