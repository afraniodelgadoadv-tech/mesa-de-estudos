import { chromium } from "playwright";
import path from "node:path";
const ext = path.resolve("extension");
const ctx = await chromium.launchPersistentContext("/tmp/claude-0/-home-claude/c8ec4ea5-de57-5af4-afd2-a23c13a27d86/scratchpad/chprof"+Date.now(), {executablePath:"/opt/pw-browsers/chromium", headless:true, args:[`--disable-extensions-except=${ext}`,`--load-extension=${ext}`,"--headless=new"]});
let [sw] = ctx.serviceWorkers(); if (!sw) sw = await ctx.waitForEvent("serviceworker", {timeout:15000});
console.log("SW url:", sw.url());
const id = sw.url().split("/")[2];
console.log("ID matches fixed:", id === "ejjpplgdkllkdomlapcmpnlliakjfabb");
const errs=[];
for (const pg of ["sidepanel","float"]){
  const p = await ctx.newPage(); p.on("pageerror", e=>errs.push(pg+": "+e.message)); p.on("console", m=>{ if(m.type()==="error") errs.push(pg+" console: "+m.text().slice(0,200)); });
  await p.goto(`chrome-extension://${id}/${pg}.html`); await p.waitForTimeout(2500);
  console.log(pg, "gate visible:", await p.isVisible("#gate"), "msg:", await p.textContent("#gateMsg"));
  await p.screenshot({path:`test/out/ext-${pg}.png`});
}
// badge via message
const r = await sw.evaluate(async () => { await chrome.storage.local.set({running:{cat:"questoes",start:Date.now()-25*60000,acc:0}}); return true; });
const p2 = await ctx.newPage(); await p2.goto(`chrome-extension://${id}/float.html`); await p2.waitForTimeout(3000);
await p2.evaluate(() => chrome.runtime.sendMessage({type:"running", running:{cat:"questoes", start: Date.now()-65*60000, acc:0, taskText:"Revisar prescrição"}}));
await p2.waitForTimeout(300);
console.log("badge:", await sw.evaluate(() => chrome.action.getBadgeText({})), "| title:", await sw.evaluate(() => chrome.action.getTitle({})));
await p2.evaluate(() => chrome.runtime.sendMessage({type:"running", running:{cat:"questoes", mode:"pomodoro", start: Date.now()-10*60000, acc:0, blockAcc:0, phase:"focus", cycles:0, cfg:{focus:25,short:5,long:15,every:4,auto:true,label:"25/5"}}}));
await p2.waitForTimeout(400);
console.log("pomo badge:", await sw.evaluate(() => chrome.action.getBadgeText({})), "| title:", await sw.evaluate(() => chrome.action.getTitle({})), "| alarm:", JSON.stringify(await sw.evaluate(async () => { const a = await chrome.alarms.get("phase"); return a ? Math.round((a.scheduledTime-Date.now())/60000) : null; })));
console.log("panel behavior:", JSON.stringify(await sw.evaluate(() => chrome.sidePanel.getPanelBehavior()))); console.log("ERRORS:", errs.length ? errs : "none");
await ctx.close();
