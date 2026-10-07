// Verifies the right-edge panels (Aircraft detail + Controls) do NOT overlap,
// using the REAL built stylesheet and the same DOM the app renders.
import pw from "/opt/node22/lib/node_modules/playwright/index.js";
import { readFileSync, readdirSync } from "node:fs";
const { chromium } = pw;

const cssFile = readdirSync("dist/assets").find((f) => f.endsWith(".css"));
const css = readFileSync(`dist/assets/${cssFile}`, "utf8");

// Mirror App.tsx: a .stage with the .rail--right wrapping the detail panel
// (tall, flight selected) and the controls panel.
const html = `<!doctype html><html><head><meta charset="utf8"><style>
:root{--stage-w:1300px;--stage-h:720px}
*{margin:0}
${css}
</style></head><body>
<div class="stage">
  <div class="rail rail--right">
    <div class="panel panel--right">
      <div class="panel__head"><div class="panel__title">IBE07SC</div>
        <button class="follow-btn">Follow</button></div>
      <div class="detail-grid">
        <span>Route</span><b class="route">MAD → DUS</b>
        <span>Airline</span><b>Iberia Airlines</b>
        <span>Aircraft</span><b>A320 251NSL</b>
        <span>Origin</span><b>Spain</b>
        <span>ICAO24</span><b>345601</b>
        <span>Position</span><b>51.07°, -3.79°</b>
        <span>Altitude</span><b>39,625 ft</b>
        <span>Ground speed</span><b>662 km/h</b>
        <span>Heading</span><b>41°</b>
        <span>State</span><b>cruising</b>
      </div>
    </div>
    <div class="panel panel--controls">
      <div class="panel__title">Controls</div>
      <label class="ctl"><span>Animation speed</span><input type="range"></label>
      <label class="ctl"><span>Marker size</span><input type="range"></label>
      <div class="ctl"><span>Color by</span><div class="band-row"><button class="band">Country</button><button class="band">Altitude</button></div></div>
      <div class="ctl"><span>Lighting</span><div class="band-row"><button class="band">Auto</button><button class="band">Day</button><button class="band">Night</button></div></div>
      <label class="ctl ctl--row"><span>Flight paths</span><input type="checkbox"></label>
      <label class="ctl ctl--row"><span>Airports</span><input type="checkbox"></label>
      <label class="ctl ctl--row"><span>Auto-orbit</span><input type="checkbox"></label>
      <div class="source-tag">● LIVE · Fabric</div>
    </div>
  </div>
</div></body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1300, height: 720 } });
await page.setContent(html);

const rects = await page.evaluate(() => {
  const r = (sel) => {
    const el = document.querySelector(sel);
    const b = el.getBoundingClientRect();
    return { top: Math.round(b.top), bottom: Math.round(b.bottom), right: Math.round(b.right), left: Math.round(b.left) };
  };
  return { detail: r(".panel--right"), controls: r(".panel--controls"), stageH: 720 };
});

const gap = rects.controls.top - rects.detail.bottom;
const overlap = rects.detail.bottom > rects.controls.top;
console.log("detail :", JSON.stringify(rects.detail));
console.log("controls:", JSON.stringify(rects.controls));
console.log("gap between detail bottom and controls top:", gap, "px");
console.log("controls bottom vs stage:", 720 - rects.controls.bottom, "px from bottom edge");
console.log(overlap ? "❌ OVERLAP" : "✅ NO OVERLAP — panels stack cleanly");

await page.screenshot({ path: "scripts/rail-verify.png" });
await browser.close();
process.exit(overlap ? 1 : 0);
