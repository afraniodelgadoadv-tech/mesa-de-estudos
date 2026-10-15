import { chromium } from "playwright";
import http from "node:http"; import { readFileSync } from "node:fs";
const srv = http.createServer((q,r)=>{ const f = "test/out" + q.url.split("?")[0]; try { const b = readFileSync(f); r.writeHead(200,{"content-type": f.endsWith(".js")?"text/javascript":"text/html"}); r.end(b);} catch(e){ r.writeHead(404); r.end(); } }).listen(8774);
const browser = await chromium.launch({executablePath:"/opt/pw-browsers/chromium"}); const errs=[];
const p = await browser.newPage({viewport:{width:1280,height:950}}); p.on("pageerror", e=>errs.push(e.message));
await p.clock.install({time: new Date("2026-10-15T08:00:00-03:00")});
await p.goto("http://localhost:8774/site.html"); await p.clock.runFor(100);
await p.evaluate(()=>{ const D=window.__docs;
  D.set("users/u1",{categories:[{id:"questoes",name:"Questões",color:0},{id:"jurisprudencia",name:"Jurisprudência",color:1},{id:"flashcards",name:"Flashcards",color:2}],exams:[{id:"dpe",name:"DPE-PB",date:"2027-02-28",time:"",inscFim:"2026-11-13",pag:"2026-11-16"}],dailyGoal:240,running:null});
  D.set("users/u1/tasks/a",{text:"Ler informativo 812 STJ",cat:"jurisprudencia",due:"2026-10-13",done:false,created:1});
  D.set("users/u1/tasks/b",{text:"30 questões de prescrição",cat:"questoes",due:"2026-10-15",time:"09:00",dur:60,done:false,created:2});
  D.set("users/u1/tasks/c",{text:"Revisar flashcards de Civil",cat:"flashcards",due:"2026-10-15",dur:30,done:true,created:3});
  D.set("users/u1/tasks/d",{text:"Montar resumo de licitações",done:false,created:4});
  window.__login(); });
await p.clock.runFor(300);
await p.click("#tab-tasks"); await p.clock.runFor(200);
console.log("title:", await p.textContent("#tTitle"), "| summary:", (await p.textContent("#tSummary")).replace(/\s+/g," "));
console.log("day:", await p.textContent("#tDayTitle"), "|", await p.textContent("#tDaySub"));
console.log("late:", (await p.textContent("#tLate")).replace(/\s+/g," ").slice(0,80), "| inbox:", (await p.textContent("#tInbox")).replace(/\s+/g," ").slice(0,60));
// add repeating task on 17th
await p.fill("#tText","Simulado FGV"); await p.fill("#tDue","2026-10-17"); await p.fill("#tTime","14:00"); await p.selectOption("#tDur","180"); await p.selectOption("#tRepeat","weekly");
await p.click("#tAddForm button[type=submit]"); await p.clock.runFor(300);
console.log("add msg:", await p.textContent("#tAddMsg"), "| tasks now:", await p.evaluate(()=>[...window.__docs.keys()].filter(k=>k.includes("tasks")).length), "| selected:", await p.textContent("#tDayTitle"));
await p.screenshot({path:"test/out/tasks-month.png", fullPage:true});
// drag inbox task to 20th
const src = p.locator("#tInbox .task").first(); const dst = p.locator(".tc:has(.tn:text-is('20'))");
await src.dragTo(dst); await p.clock.runFor(300);
console.log("after drag d.due:", await p.evaluate(()=>window.__docs.get("users/u1/tasks/d").due));
// bring late to today
await p.click("#tLatePanel button:has-text('Trazer todas')"); await p.clock.runFor(300);
console.log("a.due:", await p.evaluate(()=>window.__docs.get("users/u1/tasks/a").due));
// week view
await p.click("#tView button[data-v=week]"); await p.clock.runFor(300);
console.log("week title:", await p.textContent("#tTitle"), "| cols:", await p.locator(".wcol").count());
const wadd = p.locator(".wadd").nth(5); await wadd.fill("Revisão geral"); await wadd.press("Enter"); await p.clock.runFor(300);
console.log("friday:", (await p.locator(".wcol").nth(5).textContent()).replace(/\s+/g," ").slice(0,100));
await p.screenshot({path:"test/out/tasks-week.png", fullPage:true});
// timer quick panel
await p.click("#tab-timer"); await p.clock.runFor(200);
console.log("today panel:", (await p.textContent("#todayTasks")).replace(/\s+/g," ").slice(0,120));
const q = await browser.newPage({viewport:{width:400,height:900}}); q.on("pageerror", e=>errs.push("panel: "+e.message));
await q.goto("http://localhost:8774/panel.html"); await q.waitForTimeout(100);
await q.evaluate(()=>{ window.__docs.set("users/u1",{categories:[{id:"questoes",name:"Questões",color:0}],exams:[],dailyGoal:240,running:null}); window.__docs.set("users/u1/tasks/x",{text:"Tarefa de teste no painel",due:new Date().toISOString().slice(0,10),done:false,created:1}); window.__login(); });
await q.waitForTimeout(300); await q.click("#tab-tasks"); await q.waitForTimeout(300);
console.log("panel scrollWidth:", await q.evaluate(()=>document.documentElement.scrollWidth));
await q.screenshot({path:"test/out/tasks-panel.png", fullPage:true});
console.log("ERRORS:", errs.length?errs:"none"); await browser.close(); srv.close();
