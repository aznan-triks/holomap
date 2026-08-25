// VISUAL verification harness.
//
// Builds a standalone page that loads this folder's real modules with
// synthetic notes, then lets itself be photographed by headless Chrome. It's
// the only way to LOOK at the render without opening Obsidian — and looking
// is the only way to catch visual defects (stray grid lines, washed-out
// land, dark bands, hairline gaps between fills: all found this way, none by
// the tests).
//
// It lives here, in the vault, not in the session's temp folder: it got
// rebuilt three times in a row because it kept disappearing on close.
//
// Usage:
//   node harness-capture.mjs                    writes carte.html alongside
//   then, to photograph it:
//   chrome --headless=new --disable-gpu --allow-file-access-from-files \
//          --virtual-time-budget=30000 --window-size=900,700 \
//          --screenshot=carte.png "file:///<path>/carte.html"
//
// `--allow-file-access-from-files`: the page loads its modules via real
// `<script type="module">` imports (see below), and Chrome refuses
// cross-origin fetches for those — including plain file:// reads of a
// sibling file — unless this flag is set. Without it: a CORS error, and a
// blank canvas with nothing in the log.
//
// The view is tuned via URL parameters: ?zoom=4&camx=520&camy=260
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
// `actions.js` isn't listed: it's no longer loaded by the map (right-click
// menu removed on 27/07, see main.js/mount.js). The harness photographs what
// the user sees, so it loads what the map loads — no more, no less.
//
// ⚠️ Loaded as REAL ES modules (`<script type="module">` + `import`), not
// injected source text: these files end in `export { ... }`, which
// `new Function(src)()` (the old loading method) cannot parse — `export` is
// only legal at the top level of a module. Real imports also mean each
// module's own top-level `const`/state stays properly scoped, instead of
// being re-evaluated inside a throwaway function body.
const SRC_MODULES = ["classify.js", "weigh.js", "layout.js", "render.js",
                     "routes.js", "terrain.js", "player.js"];

// Kept as plain text (not executed) purely for the static source-scan check
// further down, which greps a function body rather than running it.
const playerSource = readFileSync(join(HERE, "..", "src", "player.js"), "utf8");
const cssModule = readFileSync(join(HERE, "..", "styles.css"), "utf8");

const DOMAINS = ["Dev et IA", "Contenu et création", "Relations",
                  "Professionnel", "Études", "Terra Incognita"];
const TYPES = ["projet", "journal", "lecture", "contact", "tache", "idee"];

const page = `<meta charset="utf-8">
<style>
  body { margin:0; background:#05070c; color:#9fe; font:12px monospace }
  .carte-atlas canvas { display:block; background:#05070c }
  #log { padding:6px 10px; white-space:pre }
/* The module's real stylesheet, injected as-is: without it, the right-click
   menu and the modal exist in the DOM but look like nothing on a
   screenshot — their presence would be verified without ever seeing their
   appearance. */
${cssModule}
</style>
<div id="host"></div>
<pre id="log"></pre>
<script type="module">
// A module script fails silently in headless Chrome (nothing painted, no
// console visible on a screenshot) unless something routes the error into
// the page itself.
window.addEventListener("error", e => {
  document.getElementById("log").textContent =
    "MODULE ERROR: " + (e.error && e.error.stack || e.message);
});

import * as classify from "../src/classify.js";
import * as weigh from "../src/weigh.js";
import * as layout from "../src/layout.js";
import * as render from "../src/render.js";
import * as routes from "../src/routes.js";
import * as terrain from "../src/terrain.js";
import * as player from "../src/player.js";
import { PARAMS } from "../src/config.js";
const mods = { classify, weigh, layout, render, routes, terrain, player };

// The player.js source, as plain text, for the static "no wake trace" check
// further down — read at build time in Node (see PLAYER_SOURCE below), since
// this page can no longer read its own sibling files' text at runtime the
// way a source-injecting harness could.
const PLAYER_SOURCE = ${JSON.stringify(playerSource)};

// ?setting=render.terrain.active:false&setting=render.terrain.forceRelief:3
//
// Tweaks a setting BEFORE mounting — so before geography and terrain are
// built, which the view parameters read further down don't allow. This is
// what makes possible the only comparison that matters for an appearance
// decision: the SAME view with and without the setting in question.
for (const r of new URLSearchParams(location.search).getAll("setting")) {
  const i = r.lastIndexOf(":");
  const path = r.slice(0, i).split("."), raw = r.slice(i + 1);
  let o = PARAMS;
  for (let k = 0; k < path.length - 1; k++) o = o[path[k]];
  o[path[path.length - 1]] =
    raw === "true" ? true : raw === "false" ? false : parseFloat(raw);
}

// Reference date of the test data set, FROZEN. Everything that depends on
// the calendar — the player layer's trail — is read relative to it, never
// relative to the day of the capture: otherwise two captures of the same
// scene taken a week apart wouldn't show the same thing.
const TEST_DATE = 1769472000000;   // 27/01/2026, arbitrary and unimportant
function rand(g){let s=g||1;return()=>{s^=s<<13;s^=s>>>17;s^=s<<5;s>>>=0;return s/4294967296;};}
const r = rand(20260725);
const DOMAINS = ${JSON.stringify(DOMAINS)};
const TYPES = ${JSON.stringify(TYPES)};
const notes = [];
for (let i = 0; i < 58; i++) {
  const d = DOMAINS[i % DOMAINS.length];
  notes.push({
    // ⚠️ name and not title: that's the field the real collector (collect.js)
    // produces and the render reads. The old test data only set title, so
    // anything that displays a note's name would have shown blank here while
    // still working in Obsidian — or the other way around.
    // (No backticks in this file: the page is itself a template delimited by
    // backticks.)
    path: "01. Notes/" + d + "/note-" + i + ".md",
    name: "Note " + i,
    continent: d,
    country: d + " / p" + (i % 3),
    region: d + " / r" + (i % 5),
    type: TYPES[i % TYPES.length],
    tags: ["tag" + (i % 7)],
    // Bytes written. Spread over two orders of magnitude like a real vault
    // (from the one-line note to the multi-page document): that's what
    // density is supposed to make legible, a uniform test set would show 58
    // identical cities and prove nothing.
    size: 250 + Math.round(80 * Math.pow(2, r() * 7)),
    // Last-touched date, spread over five weeks around TEST_DATE: the trail
    // should only pick up a handful of notes (the past week), not the whole
    // vault. Without mtime, they all read as zero and the thread linked
    // EVERY note — seen on capture, a green web over the whole planet.
    mtime: TEST_DATE - Math.round(r() * 35 * 86400000),
    status: r() < 0.45 ? "actif" : "à trier",
    inArchive: r() < 0.12,
    quete: false,
    links: [],
  });
}
for (let i = 0; i < notes.length; i++)
  if (i % 3 === 0) notes[i].links.push(notes[(i * 7 + 1) % notes.length].path);
mods.weigh.weighNotes(notes, PARAMS);
mods.layout.computePositions(notes, PARAMS);
const t0 = performance.now();
const grid = mods.layout.partition(notes, PARAMS, PARAMS.grid.cellWorld);
const msPartition = performance.now() - t0;
mods.layout.seedTerminals(grid, notes, PARAMS);
const adjacency = mods.routes.adjacents(grid, notes, PARAMS);

// ⚠️ There used to be a CRUTCH here, removed: since the test data produced
// no boats (measured: 10 trains, 10 planes, 0 crossings), the harness added
// five artificial crossing links so the maritime render could be
// photographed. That hid the defect instead of showing it — the rule at the
// time made the boat literally unreachable, and the harness was the only
// place from which anyone could have noticed.
//
// The rule now reads the ground under the route, so the three vehicle types
// arise from the test data the same way they arise from the vault: nothing
// left to fake.
const transports = mods.routes.computeTransports(notes, adjacency, grid);

// Fake Obsidian root: the render module only needs these two.
const host = document.getElementById("host");
host.addClass = c => host.classList.add(c);
host.createEl = (tag) => { const e = document.createElement(tag); host.appendChild(e); return e; };

const model = { mods, notes, grid, transports,
                 domaines: DOMAINS, cities: [], weight: {}, taxonomy: {}, paths: {} };
const say = [];
let view;
try {
  const t1 = performance.now();
  view = mods.render.mount(host, model, PARAMS, null);
  say.push("mount          : " + (performance.now() - t1).toFixed(0) + " ms");
} catch (e) {
  document.getElementById("log").textContent = "MOUNT ERROR: " + e.message + "\\n" + e.stack;
  throw e;
}
// DRIVEN clock: without it, a capture catches the live layer at some
// arbitrary instant, and two captures of the same scene aren't comparable.
// Tunable via ?t=, in milliseconds.
// 3000 ms and not 1000: the opening sweep lasts 1.5s, and at 1000ms it's
// still crossing the image. The "at rest" capture therefore showed a bright
// vertical band that was mistaken for a background defect. The default
// default is the steady state; to photograph the sweep, use ?t=400.
let currentClock = 3000;
model.PARAMS = PARAMS;
model.overlays = [(ctx, state, toScreen) =>
  mods.routes.animate(ctx, state, toScreen, transports, notes, currentClock, PARAMS)];

// --- The PLAYER layer -------------------------------------------------------
// ?quete=<index>  puts the quest on a note
// ?note=<index>   states which note is "open in Obsidian"
//
// ⚠️ The quest is set AFTER weighing and placement, never in the note set:
// 'quete' is one of the weighing factors (weigh.weighNotes), so setting it
// upstream would shift the whole partition and every reference capture would
// change at once, for a reason unrelated to what's being photographed.
{
  const pj = new URLSearchParams(location.search);
  if (pj.has("quete") && notes[+pj.get("quete")]) notes[+pj.get("quete")].quete = true;
  const openNote = pj.has("note") && notes[+pj.get("note")]
    ? notes[+pj.get("note")].path : null;
  // FIXED date, never Date.now(): the trail depends on the gap between "today"
  // and the notes' mtime, so a capture taken tomorrow would show a different
  // thread. The test data sets its mtimes around this same date.
  model.overlays.push((ctx, state, toScreen) =>
    mods.player.drawPlayer(ctx, state, toScreen, model, openNote,
                               currentClock, TEST_DATE));
}

const p = new URLSearchParams(location.search);
// ?resize=1100 : shrinks the container AFTER mounting and replays the
// measurement, to photograph the resizing path (Obsidian panel resized) and
// not just the starting size. The call is direct: the size observer waits
// for a delay that the capture doesn't wait for.
if (p.has("resize")) {
  host.style.width = p.get("resize") + "px";
  view.resize();
  say.push("resize         : " + view.canvas.width + "x" + view.canvas.height);
}
if (p.has("zoom")) view.state.zoom = parseFloat(p.get("zoom"));
if (p.has("camx")) view.state.camX = parseFloat(p.get("camx"));
if (p.has("camy")) view.state.camY = parseFloat(p.get("camy"));
// --- Live layer: to photograph it in a chosen state ------------------------
// ?t=<ms>          target instant (0 = mount ; the opening sweep lasts ~1.5s)
// ?hover=<index>   note under the cursor (edges, halo, highlighted links)
// ?mouse=x,y       cursor position on screen (halo, parallax)
if (p.has("t")) currentClock = parseFloat(p.get("t"));
// ⚠️ The "controlled" clock was only HALF controlled, and it cost a whole
// session of hunting: the harness composes its images by passing the instant
// to present(), but not every repaint comes from it. Gesture coalescing
// (render.requestRedraw) reschedules a present() with NO argument, which
// runs AFTER this script and repaints on the browser's real clock — around
// 1.3s of page life, i.e. right in the middle of the opening sweep. The
// capture then showed a green band along the right edge, mistaken for a
// render defect when it was the entry animation photographed mid-flight. So
// the clock is frozen at the render level: wherever it comes from, a repaint
// paints the SAME instant. The check at the end of the file fails if that
// stops being true.
view.freezeClock(currentClock);
if (p.has("hover")) view.state.hover = parseInt(p.get("hover"), 10);
if (p.has("mouse")) {
  const [sx, sy] = p.get("mouse").split(",").map(Number);
  Object.assign(view.state.anim.mouse, { x: sx, y: sy, inside: true });
} else if (p.has("hover")) {
  // A hover without a cursor is a highlighted note with the halo left in the
  // corner: half of what we want to photograph. Absent a given position, the
  // cursor is placed ON the hovered note — the only position a real hover
  // could have, and it makes the capture reproducible.
  const n = notes[view.state.hover];
  if (n) {
    const [sx, sy] = view.toScreen(n.x, n.y);
    Object.assign(view.state.anim.mouse, { x: sx, y: sy, inside: true });
    say.push("mouse placed on note " + view.state.hover
              + " : " + sx.toFixed(0) + "," + sy.toFixed(0));
  }
}
const t2 = performance.now();
view.redraw();
const msBackdrop = performance.now() - t2;
const t3 = performance.now();
view.state.backdropDirty = true; view.redraw();
const msBackdrop2 = performance.now() - t3;

// THE measurement that matters for comfort: a redraw after MOVING the
// camera, i.e. what gets paid every frame during a drag or zoom. A redraw at
// an unchanged camera falls back on cached tables and gives a flattering
// number too low to trust — that was the figure shown until now.
const camStart = view.state.camX;
let msMove = 0, msMoveBackdrop = 0, msMoveCompo = 0, worstFrame = 0;
for (let i = 0; i < 8; i++) {
  view.state.camX = camStart + 3 * (i + 1);
  const t = performance.now();
  view.redraw();
  const dt = performance.now() - t;
  msMove += dt;
  worstFrame = Math.max(worstFrame, dt);
  // ⚠️ The detail shown until now ('state.times') only covered rebuilding
  // the BACKDROP. At country level it reported 26ms when a frame actually
  // cost 54: layer compositing — recopying the backdrop, veil, links, texts,
  // live layer, vehicles — accounted for the other half and appeared in no
  // log line. That measurement gap left "it lags" without a visible cause
  // for whole sessions.
  if (view.state.frameTimes) {
    msMoveBackdrop += view.state.frameTimes.backdrop;
    msMoveCompo += view.state.frameTimes.composition;
  }
}
view.state.camX = camStart;
view.redraw();

// THE SAME MOVE, BUT LIGHTENED LIKE DURING A REAL GESTURE.
//
// ⚠️ The loop above moves 'state.camX' by hand, so it measures a frame AT
// REST with a camera that has moved — not what actually gets paid while
// spinning the planet. It's the event handler that cuts the halos
// (render.startGesture), and nothing here went through it: the 27/07
// lightening would have been timed nowhere, and the "it lags" report would
// have stayed without a number. So the same eight steps are replayed with a
// gesture's glow budget.
let msGesture = 0;
view.setGlowFactor((PARAMS.render.gesture && PARAMS.render.gesture.glow) || 0);
for (let i = 0; i < 8; i++) {
  view.state.camX = camStart + 3 * (i + 1);
  const t = performance.now();
  view.redraw();
  msGesture += performance.now() - t;
}
view.setGlowFactor(1);
view.state.camX = camStart;
view.redraw();

// The other measurement that matters: the cost of a frame when NOTHING moves
// except the vehicles. That's what runs constantly, 60 times a second, map
// open and sitting there — so what heats the CPU without anyone touching
// anything. The backdrop is already up to date: only the recopy and the
// vehicles are paid for.
// Does the zoom really pin the point under the cursor? Real wheel notches
// off-center are replayed (the only place where the old flat-map formula was
// accurate), then we look at where the targeted point landed. Expected: it
// hasn't moved. Before the fix, it drifted by several hundred pixels — the
// "zoom that moves" reported by the user.
if (p.get("zoomtest") !== "0") {
  // ⚠️ The measurement point goes through view.grab(): the pinning promise
  // only covers the point actually GRABBED. Outside the grab disk, the globe
  // offers no point to target (render.grabInDisk) — measuring a drift there
  // would amount to blaming the zoom for not following a point that doesn't
  // exist.
  const [zx, zy] = view.grab(Math.round(view.canvas.width * 0.72),
                             Math.round(view.canvas.height * 0.30)).map(Math.round);
  const memory = { zoom: view.state.zoom, x: view.state.camX, y: view.state.camY };
  const [cx0, cy0] = view.toMap(zx, zy);
  let worst = 0;
  for (let i = 0; i < 6; i++) {
    view.zoom(zx, zy, i < 3 ? 1 : -1);
    const [ex, ey] = view.toScreen(cx0, cy0);
    worst = Math.max(worst, Math.hypot(ex - zx, ey - zy));
  }
  const back = Math.abs(view.state.zoom - memory.zoom);
  say.push("zoom : drift of targeted point " + worst.toFixed(2)
            + " px (max over 6 notches)  |  return to starting zoom " + back.toFixed(4));
  say.push("  camera before " + memory.x.toFixed(1) + "," + memory.y.toFixed(1)
            + " -> after " + view.state.camX.toFixed(1) + "," + view.state.camY.toFixed(1));

  // ⚠️ The measurement above was done ONLY at the starting latitude, i.e. the
  // equator, and had read 0.00px there for months: the "zoom drifts near a
  // pole" defect couldn't show up. Latitude is now swept, and the harness
  // FAILS instead of printing a number nobody reads. Measured before the
  // fix: 0.00px at the equator, 2.9px at 76 degrees, 127px at 86 degrees.
  //
  // The sweep stays within the reachable band (render.clampCamera): testing
  // beyond it would amount to checking a state the user can't reach.
  //
  // ⚠️ The sweep sat EXACTLY on the edge of the band, and had only ever been
  // played at the starting (low) zoom. Replayed at country level, it failed
  // at 4.1px — but on only one side (+75: 4.10px; −75: 0.05px), while the
  // measurement point is above center. That's the CLAMP talking, not a
  // projection defect: camera stuck to the north edge, zooming onto a point
  // further north asks it to leave the band, clampCamera refuses, and the
  // targeted point necessarily slips. Verified by loosening the clamp to 85
  // degrees: the drift drops to 0.14px everywhere, including at the new
  // edge. The zoom has nothing to fix there — a point the camera isn't
  // allowed to reach can't be pinned, exactly like a point outside the grab
  // disk (render.grabInDisk), already excluded from the measurement above.
  //
  // So the measurement is taken a degree and a half INSIDE the band, and
  // above all it DISCARDS samples where the camera ends up PINNED to the
  // edge: it's the only fair criterion, and it self-adjusts. A fixed margin
  // wasn't enough — at MAXIMUM zoom, one wheel notch asks the camera to move
  // two degrees, so it still hit the wall (measured: clamp at 75 → failure
  // at −74; clamp loosened to 85 → the failure follows the edge and
  // reappears at −83, while −70 is clean at 0.04px; and raising the
  // solver's ceiling from 128 to 2000 changes NOTHING, 2.01px to the pixel:
  // the solver isn't iterating into the void, it's blocked). The safeguard
  // stays intact — the polar cliff, itself, drifts WITHOUT pinning the
  // camera to the edge (re-verified by loosening to 89.5).
  {
    const H = PARAMS.skin.height;
    const edge = Math.max(0, H * (0.5 - (PARAMS.zoom.latitudeMax || 78) / 180));
    const margin = edge + H * (1.5 / 180);
    const THRESHOLD = 1;                       // beyond one pixel, it shows
    let worstLat = 0, atLat = 0, outOfBand = 0, clamped = 0;
    for (let k = 0; k <= 12; k++) {
      const cy = margin + (H - 2 * margin) * k / 12;
      view.state.zoom = memory.zoom; view.state.camX = memory.x; view.state.camY = cy;
      view.redraw();
      const [ax, ay] = view.toMap(zx, zy);
      let worstHere = 0;
      for (let i = 0; i < 6; i++) {
        view.zoom(zx, zy, i < 3 ? 1 : -1);
        const [ex, ey] = view.toScreen(ax, ay);
        worstHere = Math.max(worstHere, Math.hypot(ex - zx, ey - zy));
      }
      // The clamp must hold DURING the manipulation, not just at the start.
      // (the band check is against the REAL edge, not the measurement
      // margin: the camera is perfectly entitled to sit between the two.)
      if (view.state.camY < edge - 0.001 || view.state.camY > H - edge + 0.001) outOfBand++;
      // Camera pinned to the edge on arrival: it tried to leave the band and
      // was refused. The targeted point then CANNOT stay pinned — holding
      // that against it would demand a camera outside its band. Same
      // exclusion as for a point outside the grab disk, above.
      const pinned = Math.abs(view.state.camY - edge) < 0.01
                  || Math.abs(view.state.camY - (H - edge)) < 0.01;
      if (pinned) clamped++;
      else if (worstHere > worstLat) { worstLat = worstHere; atLat = cy; }
      // ?latprofile=1 : the full profile instead of only the worst case. A
      // single maximum doesn't say whether the defect is a spike at the
      // band's edge or a drift that climbs with latitude — and those two
      // don't share the same cause.
      if (p.get("latprofile") === "1")
        say.push("    lat " + ((0.5 - cy / H) * 180).toFixed(0).padStart(4)
                  + " deg : " + worstHere.toFixed(2) + " px"
                  + (pinned ? "  (camera pinned, excluded)" : ""));
    }
    const lat = y => ((0.5 - y / H) * 180).toFixed(0);
    say.push((worstLat <= THRESHOLD && !outOfBand ? "  ok   " : "  FAIL ")
              + " zoom pins at every latitude : worst " + worstLat.toFixed(2)
              + " px at " + lat(atLat) + " deg (threshold " + THRESHOLD + ")"
              + (clamped ? "  |  " + clamped + " latitude(s) excluded: camera pinned" : "")
              + (outOfBand ? "  |  camera left the band " + outOfBand + " times" : ""));
  }
  view.state.zoom = memory.zoom; view.state.camX = memory.x; view.state.camY = memory.y;
  view.redraw();
  // STABILITY check: after this zoom round trip, the map must be exactly the
  // one it started as. The skin as it stands is compared to the skin a
  // forced repaint would produce — zero difference expected.
  //
  // This check is what caught coastlines painted in SCREEN coordinates on
  // the skin: a defect neither the tests nor the eye had caught over several
  // sessions, because it only shows up by comparing two states.
  {
    const pc = view.skin.getContext("2d");
    const read = () => pc.getImageData(0, 0, view.skin.width, view.skin.height).data;
    const before = read();
    view.state.skinDirty = true; view.redraw();
    const after = read();
    let n = 0;
    for (let i = 0; i < before.length; i += 4)
      if (Math.abs(before[i] - after[i]) + Math.abs(before[i + 1] - after[i + 1])
          + Math.abs(before[i + 2] - after[i + 2]) > 6) n++;
    say.push("  map stable after zoom round trip : " + n + " px of difference (0 expected)");
  }
}

// --- The drag, including outside the disk -----------------------------------
//
// User feedback: "a drag that leaves the disk (but not the frame) does weird
// things". No check was watching the drag — only the zoom was measured — so
// this defect couldn't show up here.
//
// REAL mouse events are replayed (the handler isn't exposed any other way)
// along a full turn, cursor held outside the disk, and we verify the two
// failures measured before the fix:
//   - FROZEN map: going all the way around no longer moved the camera by a
//     single pixel;
//   - FLIP: once per turn, a jump of 512 units, i.e. 180 degrees.
{
  const T = view.canvas, memory = { zoom: view.state.zoom, x: view.state.camX, y: view.state.camY };
  view.state.zoom = 1; view.state.camX = 512; view.state.camY = PARAMS.skin.height / 2;
  view.redraw();
  const cx = T.width / 2, cy = T.height / 2, R = Math.min(T.width, T.height) * 0.46;
  const b = T.getBoundingClientRect();
  const mouse = (type, sx, sy) => T.dispatchEvent(new MouseEvent(type,
    { clientX: b.left + sx, clientY: b.top + sy, buttons: 1, bubbles: true }));
  mouse("mousedown", Math.round(cx + R * 0.3), Math.round(cy));
  let moved = 0, worst = 0, prev = [view.state.camX, view.state.camY];
  const STEPS = 48;
  for (let k = 1; k <= STEPS; k++) {
    const a = -Math.PI / 2 + 2 * Math.PI * k / STEPS;
    mouse("mousemove", Math.round(cx + R * 1.25 * Math.cos(a)),
                        Math.round(cy + R * 1.25 * Math.sin(a)));
    const dx = Math.abs(view.state.camX - prev[0]);
    const jump = Math.hypot(Math.min(dx, PARAMS.skin.width - dx),
                            view.state.camY - prev[1]);
    if (jump > 0.5) moved++;
    if (k > 1) worst = Math.max(worst, jump);   // step 1 teleports the cursor
    prev = [view.state.camX, view.state.camY];
  }
  mouse("mouseup", 0, 0);
  // A 48-step turn must turn the globe at EVERY step, and in small jumps: a
  // half-turn of skin is 512, an honest step is under 60.
  const JUMP_THRESHOLD = 60;
  const ok = moved >= STEPS - 2 && worst <= JUMP_THRESHOLD && Number.isFinite(view.state.camX);
  say.push((ok ? "  ok   " : "  FAIL ")
            + " drag outside the disk : " + moved + "/" + STEPS
            + " steps followed, worst jump " + worst.toFixed(1)
            + " (threshold " + JUMP_THRESHOLD + ")");
  view.state.zoom = memory.zoom; view.state.camX = memory.x; view.state.camY = memory.y;
  view.redraw();
}

// --- Gesture coalescing: "it lags" ------------------------------------------
//
// The user feedback was "the map trails behind the cursor", and the cause
// was NOT the cost of drawing: every 'mousemove' repainted SYNCHRONOUSLY
// (100 to 125 events per second) while a frame costs several dozen
// milliseconds. The event queue built up a lag that kept accumulating — the
// exact symptom.
//
// The promise kept by 'render.requestRedraw': a gesture updates state on
// every event, but only PAINTS once per animation frame. That's a structural
// promise, so it's measurable independent of the machine: count backdrop
// rebuilds ('state.rebuilds') during a burst of mousemove. Expected: ZERO
// during the burst, the camera having nonetheless followed. Putting a single
// synchronous repaint back into the handlers fails this check (verified by
// putting it back).
let coalOk = false, coalRebuilds = 0, coalSteps = 0;
{
  const T = view.canvas, memory = { zoom: view.state.zoom, x: view.state.camX, y: view.state.camY };
  const b = T.getBoundingClientRect();
  const mouse = (type, sx, sy) => T.dispatchEvent(new MouseEvent(type,
    { clientX: b.left + sx, clientY: b.top + sy, buttons: 1, bubbles: true }));
  const cx = T.width / 2, cy = T.height / 2;
  mouse("mousedown", Math.round(cx), Math.round(cy));
  view.state.rebuilds = 0;
  const BURST = 40;
  let start = view.state.camX;
  for (let k = 1; k <= BURST; k++) {
    mouse("mousemove", Math.round(cx + k), Math.round(cy));
    if (view.state.camX !== start) { coalSteps++; start = view.state.camX; }
  }
  mouse("mouseup", 0, 0);
  coalRebuilds = view.state.rebuilds;
  // The camera must have followed the burst: without that, "zero rebuilds"
  // would just mean a gesture that simply does nothing anymore.
  coalOk = coalRebuilds === 0 && coalSteps >= BURST - 2;
  view.state.zoom = memory.zoom; view.state.camX = memory.x; view.state.camY = memory.y;
  view.redraw();
}
say.push((coalOk ? "  ok   " : "  FAIL ")
          + " gesture coalescing : " + coalRebuilds + " backdrop rebuild(s)"
          + " for 40 mousemove (0 expected), camera followed " + coalSteps + "/40");

// PERMANENT CHECK — the block produces ONLY ONE canvas.
//
// There was, for a few hours on 27/07, a right-click menu and a panel of
// unattached notes below the map. Removed on request: "I want the planet."
// This check holds that decision — if something ever starts pushing under
// the canvas again, it says so instead of letting it slide.
//
// It also keeps the trace of the trap that cost a frozen map: the menu was
// built with Obsidian's components, taken from require("obsidian"), a module
// reserved for PLUGINS. The exception fired at mount and the animation loop
// never started. If those pieces ever come back, they come back with their
// own check INSIDE a browser: no node test can judge them, lacking a DOM and
// require.
{
  const extra = [...host.children].filter(e => e.tagName !== "CANVAS");
  const floating = document.querySelectorAll(".carte-atlas-menu, .carte-atlas-modale-fond");
  say.push((extra.length === 0 && floating.length === 0 ? "  ok   " : "  FAIL ")
            + " the map produces only one canvas : " + extra.length
            + " extra element(s) under the block, " + floating.length + " floating");
}

let msIdle = 0;
for (let i = 0; i < 20; i++) {
  const t = performance.now();
  view.present(currentClock + i * 16);
  msIdle += performance.now() - t;
}
say.push("idle frame          : " + (msIdle / 20).toFixed(1) + " ms / frame (60 fps target: < 16)");

// THE PHOTOGRAPHED IMAGE, at a controlled clock. It's played from mount time
// across about forty frames: the live layer needs a bit of elapsed time to
// converge (hover rises in ~130ms), and a single-frame capture would always
// show it at zero. The animation counter is reset first, otherwise the
// performance measurements above would already have set the mount instant on
// the browser's real clock.
view.state.anim.started = false;
const FRAMES = 40;
for (let i = 1; i <= FRAMES; i++) view.present(currentClock * i / FRAMES);
say.push("live layer : t=" + currentClock + " ms"
          + (p.has("hover") ? "  hover note " + p.get("hover") : "")
          + "  intensity " + view.state.anim.entering.k.toFixed(2));
say.push("moved-camera frame : " + (msMove / 8).toFixed(1) + " ms / frame (average of 8)"
          + "  of which backdrop " + (msMoveBackdrop / 8).toFixed(1)
          + " + composition " + (msMoveCompo / 8).toFixed(1));
// PERMANENT CHECK — a gesture must cost less than idle, never more.
//
// ⚠️ Threshold deliberately WIDE, and it's worth knowing why: how much the
// halos weigh in a frame depends on what's on screen (at world level there
// are almost no coasts or towers to shine, at country level that's nearly
// all there is) and on the window size. Measured at country level on 1400px:
// 44.2ms idle vs 25.2 with halos off, i.e. 57%. Measured at world level on
// 1200px: 91%, for a two-millisecond gap that's just noise. A tight
// threshold here would be a check that fails depending on the scene — so a
// check that eventually gets ignored. This one only catches an INVERSION (a
// gesture become more expensive than idle); it's the no-resize verification
// below that holds the visible promise.
{
  const share = msMove > 0 ? msGesture / msMove : 1;
  const SHARE_THRESHOLD = 1.05;
  say.push((share <= SHARE_THRESHOLD ? "  ok   " : "  FAIL ")
            + " frame lightened during a gesture : " + (msGesture / 8).toFixed(1)
            + " ms against " + (msMove / 8).toFixed(1) + " idle ("
            + (100 * share).toFixed(0) + " %, ceiling " + (100 * SHARE_THRESHOLD).toFixed(0) + " %)");
}

// PERMANENT CHECK — "when I move the planet everything turns big and
// blurry."
//
// That's the 27/07 user feedback, word for word, and it pointed to a precise
// mechanism: the backdrop was painted onto a buffer 40% smaller during a
// gesture, then stretched back by the browser. Text, note names and
// buildings all got run through the same mill.
//
// Nothing was watching it: no check looked at the canvas size during a drag,
// and a capture is taken AT REST, so always sharp. So real mouse events are
// replayed and we verify that no dimension moves — neither the buffer
// (width/height) nor the displayed box (style). Verified to actually catch
// something by putting a resize back into startGesture: FAIL.
{
  const T = view.canvas, memory = { x: view.state.camX, y: view.state.camY };
  const before = { w: T.width, h: T.height, sw: T.style.width, sh: T.style.height };
  const b = T.getBoundingClientRect();
  const mouse = (type, sx, sy, buttons) => T.dispatchEvent(new MouseEvent(type,
    { clientX: b.left + sx, clientY: b.top + sy, buttons: buttons, bubbles: true }));
  const cx = T.width / 2, cy = T.height / 2;
  mouse("mousedown", Math.round(cx), Math.round(cy), 1);
  let sharp = true;
  for (let k = 1; k <= 10; k++) {
    mouse("mousemove", Math.round(cx + k * 3), Math.round(cy), 1);
    if (T.width !== before.w || T.height !== before.h
        || T.style.width !== before.sw || T.style.height !== before.sh) sharp = false;
  }
  mouse("mouseup", 0, 0, 0);
  say.push((sharp ? "  ok   " : "  FAIL ")
            + " map SHARP during a gesture : canvas "
            + before.w + "x" + before.h + " unchanged (neither buffer nor style)");
  view.state.camX = memory.x; view.state.camY = memory.y;
  view.redraw();
}
// PERMANENT CHECK — "the green streaks that aren't links are useless and
// clutter the view" (27/07).
//
// That was the trail: a green thread linking notes touched in the past week,
// drawn as full arcs from one end of the planet to the other, unrelated to
// the geography it ran over. The stroke was removed from drawPlayer.
//
// ⚠️ COUNTING GREEN PIXELS DOESN'T WORK, and that's measured, not assumed.
// The thread is drawn at 12-57% opacity, so its green already arrives on
// screen mixed with the ground: measured on captures, its green minus
// max(red, blue) tops out at 42-54 — while the map WITHOUT the thread
// already reaches 39-48 with what's supposed to stay there (the atmosphere's
// turquoise #4ff0d0, the rail lines' cyan #7fe9ff, text halos). The two
// populations overlap: no threshold separates them, and a check that cries
// wolf over the planet's ring ends up ignored. So the SOURCE is checked
// instead, as with require("obsidian") in actions.js: drawPlayer's body must
// no longer request the trail. The computation itself stays in the module
// with its own checks — it's the STROKE that's no longer wanted, not the
// data.
//
// ⚠️ No backticks in this block: this page is itself a template delimited by
// backticks, a single one is enough to cut it in two.
{
  const src = PLAYER_SOURCE || "";
  const i = src.indexOf("function drawPlayer");
  const body = i < 0 ? "" : src.slice(i);
  // Plain substring search, no regular expression: a backslash in this block
  // would be swallowed by the page's template, which would then fail with a
  // syntax error — a black screen, nothing in the log (experienced while
  // writing this check).
  const found = i >= 0 && body.indexOf("wake(") >= 0;
  say.push(((i >= 0 && !found) ? "  ok   " : "  FAIL ")
            + " no trace of the trail : drawPlayer "
            + (i < 0 ? "NOT FOUND in player.js"
                     : (found ? "still calls wake()" : "no longer requests the trail")));
}

// PERMANENT CHECK — "text size doesn't adapt well enough."
//
// User feedback from 27/07. Every font size was hardcoded (9 to 13px) while
// the canvas has followed the Obsidian panel's width since 25/07: on a wide
// panel, note names stayed calibrated for the original 900px. Nothing could
// see it — no check compared two canvas sizes, and a capture is always taken
// at a single size.
//
// So the INK is measured, not the setting: the actual pixel height of the
// legend's letters, read from the text layer (transparent everywhere else,
// so every opaque pixel there is a letter — on the composited image the text
// would have to be told apart from the terrain behind it). Two canvas
// widths, two letter heights. Verified to actually catch something by
// putting a hardcoded size back: FAIL.
{
  // Height of the legend's letters, in pixels, on the text layer. The legend
  // is the only ink in the bottom-left corner.
  function legendHeight() {
    const c = view.textLayer;
    const g = c.getContext("2d");
    const band = Math.min(c.height, Math.round(44));
    const wide = Math.min(c.width, Math.round(460));
    const d = g.getImageData(0, c.height - band, wide, band).data;
    let top = -1, bottom = -1;
    for (let y = 0; y < band; y++)
      for (let x = 0; x < wide; x++)
        if (d[(y * wide + x) * 4 + 3] > 40) { if (top < 0) top = y; bottom = y; break; }
    return top < 0 ? 0 : bottom - top + 1;
  }
  // ⚠️ Measurement taken at WORLD level, and that's not a detail: the legend
  // must be the only ink in the bottom-left corner, but at other levels a
  // note's name can fall right above it — seen on capture at zoom 2.5, the
  // measured box went from 9 to 33px and the check cried regression over
  // otherwise-correct code. At world level, noteNames paints nothing and
  // continent names stay on the globe, centered.
  const zoomStart = view.state.zoom;
  const widthStart = host.style.width;
  view.state.zoom = 1;
  host.style.width = "700px"; view.resize(); view.present(currentClock);
  const small = { canvas: view.canvas.width, e: view.state.textScale, h: legendHeight() };
  host.style.width = "1600px"; view.resize(); view.present(currentClock);
  const big = { canvas: view.canvas.width, e: view.state.textScale, h: legendHeight() };
  // Both measurements must EXIST: a legend never painted would give 0 and 0,
  // i.e. "no growth", i.e. a FAIL — and that's exactly the intended
  // behavior, but it's worth saying so in the verdict.
  const legible = small.h > 3 && big.h > 3;
  const grows = big.h > small.h;
  say.push(((legible && grows) ? "  ok   " : "  FAIL ")
            + " text follows the canvas : letters " + small.h + " px at "
            + small.canvas + " px wide, " + big.h + " px at " + big.canvas
            + " (factor " + (small.e || 0).toFixed(2) + " → "
            + (big.e || 0).toFixed(2) + ")");
  // ⚠️ We go back to the view REQUESTED by the URL, not the one found on
  // arrival here: the checks above play zooms and gestures, and one of them
  // may leave a transition in progress. Restoring "whatever it was when I
  // started" would then photograph the whole globe for a capture requested
  // at continent level — seen on capture.
  view.state.zoom = p.has("zoom") ? parseFloat(p.get("zoom")) : zoomStart;
  view.state.inTransition = false;
  host.style.width = widthStart;
  view.resize(); view.redraw(); view.present(currentClock);
}

// COST CEILING PER FRAME, in motion — the figure that decides comfort.
//
// ⚠️ Threshold deliberately wide, and it's worth knowing why: the harness
// runs in SOFTWARE rendering (--disable-gpu), so more expensive than real
// Obsidian, and the figure closely follows the canvas surface (700px wide:
// 28ms; 1400px: 54ms). A tight threshold would be a test that fails
// depending on the machine and the window, so a test that eventually gets
// ignored. This one doesn't claim to measure smoothness: it catches a
// collapse (a lost cache, a layer repainted every frame), not a drift of a
// few milliseconds. Real smoothness is held by the coalescing check above
// and by the idle frame.
const FRAME_CEILING_MS = 250;
say.push((worstFrame <= FRAME_CEILING_MS ? "  ok   " : "  FAIL ")
          + " cost per frame in motion : worst " + worstFrame.toFixed(1)
          + " ms (ceiling " + FRAME_CEILING_MS + " ms, software render)");
if (view.state.times)
  say.push("  detail : " + Object.entries(view.state.times)
    .sort((a, b) => b[1] - a[1]).filter(([, v]) => v >= 0.2)
    .map(([k, v]) => k + " " + v.toFixed(1)).join("  ")
    + "  | total " + Object.values(view.state.times).reduce((a, b) => a + b, 0).toFixed(1));

// ?loupe=x,y,width[,factor] : an ENLARGED copy of a piece of the map, placed
// under it. The live layer plays out small — hover halo, confirmation ring,
// crosshair, particles, vehicle trail are all under 60px across. On a
// full-page capture they fit in a handful of pixels: there's no way to say
// whether they're there, nor whether they're correct.
// Interpolation turned off: we want to see the actual pixels, not a smear.
if (p.has("loupe")) {
  const [lx, ly, lw, lf] = p.get("loupe").split(",").map(Number);
  const f = lf || 4;
  const lh = Math.round(lw * 0.62);
  const zoomCanvas = document.createElement("canvas");
  zoomCanvas.width = lw * f; zoomCanvas.height = lh * f;
  zoomCanvas.style.cssText = "display:block;margin:8px 0;border:1px solid #0af";
  const zc = zoomCanvas.getContext("2d");
  zc.imageSmoothingEnabled = false;
  zc.drawImage(view.canvas, lx, ly, lw, lh, 0, 0, lw * f, lh * f);
  document.body.insertBefore(zoomCanvas, document.getElementById("log"));
  say.push("loupe : " + lx + "," + ly + " " + lw + "x" + lh + " at " + f + "x");
}

let land = 0, tot = 0;
for (let k = 0; k < grid.cells.length; k++) {
  tot += grid.areas[k];
  if (grid.cells[k] >= 0) land += grid.areas[k];
}
say.push("partition      : " + msPartition.toFixed(0) + " ms");
say.push("full backdrop  : " + msBackdrop.toFixed(0) + " ms (skin included)");
say.push("next backdrop  : " + msBackdrop2.toFixed(0) + " ms (skin already painted)");
say.push("land / sphere  : " + (100 * land / tot).toFixed(0) + " %");
say.push("zoom " + view.state.zoom.toFixed(2) + "  level " + view.state.level);
{
  const c = {};
  for (const r of transports) c[r.type] = (c[r.type] || 0) + 1;
  const t = mods.routes.visibleTerminals(view.state, transports, notes);
  const ct = {};
  for (const x of t) ct[x.type] = (ct[x.type] || 0) + 1;
  say.push("network        : " + JSON.stringify(c) + "  terminals " + JSON.stringify(ct));
  // ?gares=1 : where the terminals are ON SCREEN. Without this, aiming the
  // loupe at a port is a treasure hunt — they're eight pixels across on a
  // whole planet. Only those that are IN the frame: a list of off-screen
  // terminals is no use for aiming the loupe, and that's exactly the point.
  if (p.get("gares") === "1") {
    let n = 0;
    for (const x of t) {
      if (n >= 14) break;
      const [px, py] = mods.layout.fromSphere(x.v, PARAMS);
      const [sx, sy] = view.toScreen(px, py);
      if (sx < 0 || sy < 0 || sx > view.canvas.width || sy > view.canvas.height) continue;
      say.push("  " + x.type.padEnd(7) + " screen " + sx.toFixed(0) + "," + sy.toFixed(0));
      n++;
    }
  }
}
// PERMANENT CHECK — "the photographed image really is the one that was
// composed."
//
// It didn't exist, and that's why the green band could pass for a render
// defect: between the last frame composed by this script and the moment the
// photo is triggered, any deferred repaint (coalescing rAF, gesture-end
// timer) can repaint the canvas on another clock. So two animation frames
// are let through, then the canvas is compared to itself. Any difference is
// reported as a FAIL: either the clock is no longer frozen, or a repaint is
// escaping the harness — either way, no capture is comparable to another
// anymore.
function signature() {
  const g = view.canvas.getContext("2d");
  const d = g.getImageData(0, 0, view.canvas.width, view.canvas.height).data;
  let s = 0;
  for (let i = 0; i < d.length; i += 997) s = (s * 31 + d[i]) >>> 0;
  return s;
}
const before = signature();
document.getElementById("log").textContent = say.join("\\n");
requestAnimationFrame(() => requestAnimationFrame(() => {
  const after = signature();
  const ok = after === before;
  document.getElementById("log").textContent = say.join("\\n") + "\\n"
    + (ok ? "  ok    " : "  FAIL  ")
    + " image stable after 2 frames (deferred repaint: "
    + (ok ? "none" : "canvas changed, clock not frozen?") + ")";
  window.__ready = true;
}));
</script>`;

writeFileSync(join(HERE, "carte.html"), page);
console.log("harness written : " + join(HERE, "carte.html"));
