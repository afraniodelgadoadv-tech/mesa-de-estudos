import { chromium } from "playwright";
import http from "node:http"; import { readFileSync } from "node:fs";
const srv = http.createServer((q,r)=>{ const f = "test/out" + (q.url.split("?")[0]==="/"?"/site.html":q.url.split("?")[0]); try { const b = readFileSync(f); r.writeHead(200,{"content-type": f.endsWith(".js")?"text/javascript":"text/html"}); r.end(b);} catch(e){ r.writeHead(404); r.end(); } }).listen(8765);
const browser = await chromium.launch({executablePath:"/opt/pw-browsers/chromium"});
const errs = [];
async function open(mode, w=1280, h=900){ const p = await browser.newPage({viewport:{width:w,height:h}}); p.on("pageerror", e=>errs.push(mode+": "+e.message)); p.on("console", m=>{ if (m.type()==="error") errs.push(mode+" console: "+m.text()); }); await p.goto(`http://localhost:8765/${mode}.html`); await p.waitForTimeout(150); return p; }
const p = await open("site");
const gate1 = await p.isVisible("#gate"); const gateMsg = await p.textContent("#gateMsg");
await p.click("#loginBtn"); await p.waitForTimeout(200);
console.log("gate before", gate1, JSON.stringify(gateMsg), "after login gate", await p.isVisible("#gate"), "| hello:", await p.textContent("#helloTitle"));
// timer start with task
await p.fill("#qtText","Revisar prescrição"); await p.press("#qtText","Enter"); await p.waitForTimeout(100);
console.log("today tasks:", await p.textContent("#todayTasks"));
await p.click("#todayTasks .t-play"); await p.waitForTimeout(100);
console.log("status:", await p.textContent("#status"), "running sent:", JSON.stringify(await p.evaluate(()=>window.__running && window.__running.taskText)));
await p.click("#controls button:has-text('Pausar')"); await p.waitForTimeout(50);
await p.click("#controls button:has-text('Encerrar')"); await p.waitForTimeout(50);
console.log("finish task box visible:", await p.isVisible("#fTaskWrap"), "note:", await p.inputValue("#fNote"));
await p.fill("#fQty","20"); await p.fill("#fOk","15"); await p.click("#fSave"); await p.waitForTimeout(150);
const docs = await p.evaluate(()=>[...window.__docs.entries()]);
console.log("docs:", docs.map(([k,v])=>k+(k.includes("tasks")?" done="+v.done:"")).join(", "));
// stats + hours
await p.click("#tab-stats"); await p.waitForTimeout(100);
console.log("hours note:", await p.textContent("#hoursNote"), "| bars:", await p.locator("#hoursChart rect").count(), "| acc:", await p.textContent("#accEmail"));
// export/import
const exp = await p.evaluate(()=>{ return null; });
await p.fill("#impText", JSON.stringify({app:"mesa-de-estudos",version:1,config:{categories:[{id:"lei-seca",name:"Lei seca",color:3}],exams:[{id:"e1",name:"TRF1",date:"2026-12-22",time:""}],dailyGoal:300},sessions:[{id:"s9",cat:"questoes",start:Date.now()-7200000,end:Date.now()-3600000,dur:3600}],notes:[{id:"n1",title:"",html:"Estudar: <b>Administrativo</b>",color:1,order:1,updated:1}],tasks:[]}));
await p.click("#impBtn"); await p.waitForTimeout(150);
console.log("import msg:", await p.textContent("#impMsg"));
await p.click("#tab-exams"); await p.waitForTimeout(100);
console.log("exams:", (await p.textContent("#examList")).replace(/\s+/g," ").slice(0,120));
await p.click("#tab-notes"); await p.waitForTimeout(100);
console.log("notes tabs:", await p.locator("#notesFull .nb-tab").count());
await p.screenshot({path:"test/out/site-notes.png"});
await p.click("#tab-timer"); await p.waitForTimeout(100); await p.screenshot({path:"test/out/site.png", fullPage:false});
await p.click("#tab-tasks"); await p.waitForTimeout(100); await p.screenshot({path:"test/out/site-tasks.png"});
await p.click("#tab-stats"); await p.waitForTimeout(100); await p.screenshot({path:"test/out/site-stats.png", fullPage:true});
// logout
await p.click("#logoutBtn"); await p.waitForTimeout(100);
console.log("after logout gate:", await p.isVisible("#gate"), "app hidden:", !(await p.isVisible(".app")));
// panel + popup
const pn = await open("panel", 400, 860); await pn.evaluate(()=>window.__login()); await pn.waitForTimeout(150);
await pn.screenshot({path:"test/out/panel.png"});
const sw = await pn.evaluate(()=>document.documentElement.scrollWidth); console.log("panel scrollWidth", sw, "fab visible", await pn.isVisible("#stickyFab"), "open-site visible", await pn.isVisible(".side .open-site"));
const pp = await open("popup", 380, 600); await pp.evaluate(()=>window.__login()); await pp.waitForTimeout(150);
await pp.screenshot({path:"test/out/popup.png", fullPage:true});
console.log("popup side visible", await pp.isVisible(".side"), "popfoot", await pp.isVisible("#popFoot"), "height", await pp.evaluate(()=>document.body.scrollHeight));
const pp2 = await open("popup", 380, 600); await pp2.screenshot({path:"test/out/popup-gate.png", fullPage:true});
console.log("ERRORS:", errs.length? errs : "none");
await browser.close(); srv.close();
