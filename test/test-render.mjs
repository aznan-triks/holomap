import { readFileSync } from "node:fs";
import { check, summary } from "./harness.mjs";
import { PARAMS as PARAMS_PROD } from "../src/config.js";
import { COLORS, levelFromZoom, architecture, tint, placer,
        anchorNetwork, measureCanvas, textScale, turnTowards, clampCamera, clampToDisk,
        progress, ease, approach, phase, growBuildings,
        cityShape, cityUnit, cityHeight, labelPoint } from "../src/render.js";
const P = { zoom: { continentThreshold: 1.5, countryThreshold: 4 } };

check("low zoom → world", levelFromZoom(1, P) === "world");
check("mid zoom → continent", levelFromZoom(2, P) === "continent");
check("high zoom → country", levelFromZoom(9, P) === "country");

// The thresholds themselves: scripted zooms (click, Escape) land at
// threshold + margin, right next to the boundary. A `<` mutated into `<=`
// must fail.
check("zoom exactly at continent threshold → continent", levelFromZoom(1.5, P) === "continent");
check("zoom exactly at country threshold → country", levelFromZoom(4, P) === "country");
check("zoom just under continent threshold → world", levelFromZoom(1.4999, P) === "world");

// The thresholds really come from PARAMS and aren't copied into the body.
const P2 = { zoom: { continentThreshold: 10, countryThreshold: 20 } };
check("thresholds are read from PARAMS", levelFromZoom(2, P2) === "world");

check("idée → tent", architecture("idée") === "tent");
check("projet → citadel", architecture("projet") === "citadel");
check("lecture → library", architecture("lecture") === "library");
check("contact → embassy", architecture("contact") === "embassy");
check("journal → lighthouse", architecture("journal") === "lighthouse");
check("tâche → construction", architecture("tâche") === "construction");
check("unknown type → generic", architecture("zzz") === "generic");

// tint must be deterministic: a continent's color can't change from one
// frame to the next.
check("tint is deterministic", tint("Dev et IA") === tint("Dev et IA"));

const names = ["Dev et IA", "Contenu et création", "Terra Incognita", "", "Vie perso", "zzz"];
check("tint stays within COLORS", names.every(n => COLORS.includes(tint(n))));

// Two real continents side by side must be visually distinguishable.
check("Dev et IA ≠ Contenu et création",
         tint("Dev et IA") !== tint("Contenu et création"));

// --- Label decluttering --------------------------------------------------
// Under tilt, the distance compresses against the horizon and names stack up
// there. The placer lets the first candidate through (the closest, since
// candidates are sorted) and rejects anything that overlaps it.
const p = placer();
check("placer: the first box always passes", p(10, 10, 50, 14) === true);
check("placer: an overlapping box is rejected", p(30, 15, 50, 14) === false);
check("placer: a box next to it passes", p(70, 10, 50, 14) === true);
check("placer: mere contact doesn't count as overlap",
  p(120, 10, 20, 14) === true);
// A rejected box must not claim the spot: otherwise a single cascading
// overlap would empty out a whole area.
const q = placer();
q(0, 0, 10, 10); q(5, 5, 10, 10);
check("placer: a rejected box doesn't reserve space", q(12, 12, 10, 10) === true);

// --- Network view anchoring ------------------------------------------------
// The graph sits ON the note (local view), not at the map's center, but it
// must stay entirely within the frame.
check("network: far from the edges, the anchor stays on the note",
  anchorNetwork(450, 280, 200, 130, 900, 560).join() === "450,280");
check("network: near an edge, the anchor tucks back into the frame",
  anchorNetwork(20, 540, 200, 130, 900, 560).join() === "200,430");
check("network: frame smaller than the star → anchor at the center",
  anchorNetwork(20, 20, 600, 400, 900, 560).join() === "450,280");

// --- Canvas size ------------------------------------------------------------
// The map follows the Obsidian panel's width. These checks lock in the rule:
// it must grow with the panel, never exceed the window in height, and never
// return a zero size when measurement fails.
const T = { canvas: { width: 900, height: 560, ratio: 0.62, screenShare: 0.8,
                     minWidth: 420, minHeight: 300 } };

check("canvas: follows the container's width",
  measureCanvas(1600, 1400, T).width === 1600);
check("canvas: height derived from width",
  measureCanvas(1000, 1200, T).height === 620);
// The case that motivates all of this: a large screen must give a bigger
// map than the old fixed 900×560.
check("canvas: a large panel gives bigger than the old fixed size",
  measureCanvas(1800, 1100, T).width > 900 && measureCanvas(1800, 1100, T).height > 560);
// The height ceiling: without it, a very wide panel overflows the screen and
// scrolling is needed to see the bottom of the globe.
check("canvas: height never exceeds the allowed screen share",
  measureCanvas(2400, 900, T).height === 720);
// And when that ceiling kicks in, width comes back down with it: otherwise
// the globe (sized by the smaller side) floats between two black bars.
check("canvas: width brought back to the ratio when the window caps it",
  measureCanvas(2400, 900, T).width === 1161);
check("canvas: the ratio holds in both cases",
  Math.abs(measureCanvas(2400, 900, T).width * T.canvas.ratio
           - measureCanvas(2400, 900, T).height) < 2);
check("canvas: a narrow panel stops at the readable minimum",
  measureCanvas(200, 1200, T).width === 420);
check("canvas: height never under the readable minimum",
  measureCanvas(420, 200, T).height === 300);
// Measurement impossible (block not yet displayed): falls back to the
// rescue size, never a 0px canvas — which would be a black screen with no
// error.
check("canvas: with no measurement, falls back to the rescue size",
  measureCanvas(0, 0, T).width === 900 && measureCanvas(0, 0, T).height === 558);
// Guardrail on the settings themselves: the real production values must stay
// plausible (a ratio of 0 would flatten the map with no error).
const REAL = PARAMS_PROD.canvas;
check("canvas settings: plausible ratio and bounds",
  REAL.ratio > 0.3 && REAL.ratio < 1.2 &&
  REAL.screenShare > 0.4 && REAL.screenShare <= 1 &&
  REAL.minWidth >= 320 && REAL.minHeight >= 240);

// --- Globe manipulation (zoom and drag) -----------------------------------
// `turnTowards(c, vb, va)` applies to direction `c` the rotation that brings
// `vb` onto `va`. This replaces the flat-map formulas that used to make the
// zoom "move" and the drag drift.
const unit = v => { const n = Math.hypot(v[0], v[1], v[2]); return [v[0]/n, v[1]/n, v[2]/n]; };
const near = (a, b, eps) => Math.abs(a[0]-b[0]) < eps && Math.abs(a[1]-b[1]) < eps
                            && Math.abs(a[2]-b[2]) < eps;

const vb = unit([1, 0.2, -0.1]), va = unit([0.7, -0.4, 0.3]);
// The property that makes it all work: applied to the grabbed point itself,
// the rotation lands it exactly on the target point. That's "the point stays
// under the cursor".
check("globe: the rotation brings the grabbed point onto the target point",
  near(turnTowards(vb, vb, va), va, 1e-12));
check("globe: the rotated direction stays unit length",
  Math.abs(Math.hypot(...turnTowards(unit([0.3, 0.9, 0.2]), vb, va)) - 1) < 1e-12);
// Nothing to correct = camera untouched. Without this case, a plain click
// with no movement would micro-jump the map.
check("globe: two coincident points leave the camera in place",
  near(turnTowards(vb, va, va), vb, 1e-12));
check("globe: two opposite points leave the camera in place (undefined axis)",
  near(turnTowards(vb, va, [-va[0], -va[1], -va[2]]), vb, 1e-12));
// The rotation preserves angles: the globe's geometry isn't distorted by the
// manipulation, only turned.
{
  const p = unit([0.1, -0.6, 0.8]), q = unit([-0.5, 0.5, 0.7]);
  const before = p[0]*q[0] + p[1]*q[1] + p[2]*q[2];
  const p2 = turnTowards(p, vb, va), q2 = turnTowards(q, vb, va);
  check("globe: the rotation preserves angles",
    Math.abs((p2[0]*q2[0] + p2[1]*q2[1] + p2[2]*q2[2]) - before) < 1e-12);
}

// --- A territory's name doesn't float on the water ------------------------
// Reported from Obsidian: "world-of-trois shows up as text in the sea". A
// group whose notes border a strait has its centroid in the middle of the
// water.
{
  const members = [{ x: 0, y: 10, weight: 1 }, { x: 100, y: 10, weight: 5 }];
  // Centroid at (50,10). Case 1: it's land belonging to the group → keep it.
  check("label: centroid kept when it lands on the territory",
    labelPoint(members, () => true, () => 0)[0] === 50);
  // Case 2: sea (no note under the point) → fall back to the heaviest note.
  check("label: centroid in the sea → the heaviest note",
    labelPoint(members, () => true, () => -1)[0] === 100);
  // Case 3: land, but belonging to ANOTHER group → same fallback. Otherwise a
  // country's name would display in the middle of its neighbor.
  check("label: another group's land → the heaviest note",
    labelPoint(members, () => false, () => 0)[0] === 100);
}

// --- Where the ground-plated layers get painted ----------------------------
// Source check, for lack of a way to draw outside a browser. Layers painted
// on the skin (grounds, coasts, borders) must go through `project`, never
// `toScreen`: with the screen projection, they used to be laid where the
// camera saw them at that instant then wrapped as if they belonged to the
// map — coasts that no longer follow the coasts, and a map that changes
// look after every zoom.
{
  const src = readFileSync(new URL("../src/render.js", import.meta.url), "utf8");
  const body = name => {
    const start = src.indexOf("function " + name + "(");
    const end = src.indexOf("\n  }", start);
    return src.slice(start, end);
  };
  check("coasts: painted in map coordinates, not screen",
    body("coasts").includes("project(x, y)") && !body("coasts").includes("toScreen("));
  check("grounds: painted in map coordinates, not screen",
    body("buildPath").includes("project(x, y)") && !body("buildPath").includes("toScreen("));
  // Links, on the other hand, are the opposite: they FLY OVER the ball, so
  // they need the 3D point projector — the only one that renders depth,
  // without which a line cuts through the planet instead of passing behind
  // it.
  // `linksCtx`, not the backdrop context: links have their own layer,
  // separate from the live layer, so hover can fade them without repainting
  // the backdrop.
  check("links: projected with depth, not flat",
    body("refreshBackdrop").includes("drawLinks(linksCtx, state, toScreenPoint"));
  check("vehicles: same projector as their traces",
    body("present").includes("f(ctx, state, toScreenPoint)"));
  // City lights are POINTS, not a terrain texture: painted on the skin, they
  // used to scale up with it and turn into large blurry squares at country
  // level (the skin has a fixed resolution). So they're projected to screen
  // instead, like the buildings, and the skin no longer paints them.
  check("lights: projected to screen, not plated on the skin",
    body("lights").includes("toScreenPoint(l.v)")
    && !body("lights").includes("project("));
  check("lights: absent from the skin",
    !body("refreshSkin").includes("lights("));
}

// =========================================================================
// THE FIVE PURE FUNCTIONS OF THE LIVE LAYER
// =========================================================================
//
// They were written alongside the micro-interactions and shipped without any
// verification. Yet they're the only parts of the animation that can be
// checked outside a browser: everything else is just drawing on top, so if
// one of these five is wrong, the mistake shows up everywhere and can't be
// explained anywhere.

// progress: bounded at BOTH ends. Unbounded at the top, a card would keep
// growing after it unfolds; unbounded at the bottom, an animation not yet
// started would begin backwards.
check("progress: before start → 0", progress(50, 100, 200) === 0);
check("progress: mid-course → 0.5", progress(200, 100, 200) === 0.5);
check("progress: after the end → 1", progress(9000, 100, 200) === 1);
check("progress: zero duration → already done",
  progress(0, 0, 0) === 1 && progress(0, 0, -5) === 1);

// ease: zero derivative at both ends. That's what distinguishes "it unfolds"
// from "it jumps". The middle must stay at the middle (no bias).
check("ease: keeps 0, 0.5 and 1 in place",
  ease(0) === 0 && ease(0.5) === 0.5 && ease(1) === 1);
check("ease: starts slowly", ease(0.1) < 0.1 * 0.5);
check("ease: arrives slowly", ease(0.9) > 1 - 0.1 * 0.5);
check("ease: bounded even outside [0,1]", ease(-3) === 0 && ease(4) === 1);
check("ease: increasing", [0.1, 0.3, 0.5, 0.7, 0.9]
  .every((x, i, a) => i === 0 || ease(x) > ease(a[i - 1])));

// approach: THE function that makes hover independent of frame rate. A
// `v += (target - v) * 0.2` per frame climbs twice as fast at 120fps as at
// 60fps; here, only elapsed time counts. The check that carries this promise
// is the last one: same total duration, two different frame rates.
check("approach: reaches ~63% in one time constant",
  Math.abs(approach(0, 1, 130, 130) - (1 - Math.exp(-1))) < 1e-12);
check("approach: ~95% in three time constants",
  approach(0, 1, 390, 130) > 0.95 && approach(0, 1, 390, 130) < 0.96);
check("approach: never overshoots its target", approach(0, 1, 1e9, 130) <= 1);
check("approach: comes back down too", approach(1, 0, 130, 130) < 0.4);
check("approach: zero dt → nothing moves", approach(0.42, 1, 0, 130) === 0.42);
check("approach: zero time constant → immediate jump", approach(0, 1, 16, 0) === 1);
{
  // 6 frames of 16ms vs. 12 of 8ms: same elapsed time, same result.
  const play = (n, dt) => { let v = 0; for (let i = 0; i < n; i++) v = approach(v, 1, dt, 130); return v; };
  check("approach: same value at 60 and 120 fps",
    Math.abs(play(6, 16) - play(12, 8)) < 1e-9);
}

// phase: deterministic, otherwise the whole planet would start blinking
// together on every redraw. And well spread, otherwise dispersion disperses
// nothing.
check("phase: within [0,1[", ["a", "01. Notes/x.md", ""].every(c => {
  const p = phase(c); return p >= 0 && p < 1;
}));
check("phase: deterministic", phase("01. Notes/Dev et IA/note-3.md")
                              === phase("01. Notes/Dev et IA/note-3.md"));
check("phase: two neighboring notes don't land in phase",
  Math.abs(phase("01. Notes/note-3.md") - phase("01. Notes/note-4.md")) > 0.02);
{
  // Over 200 paths, no tenth of the interval should stay empty: a function
  // that packed every city into three values would pass the three checks
  // above and still make the map pulse in lockstep.
  const buckets = new Set();
  for (let i = 0; i < 200; i++) buckets.add(Math.floor(phase("01. Notes/note-" + i + ".md") * 10));
  check("phase: spread across the whole interval", buckets.size === 10);
}

// growBuildings: the continuous growth that replaced the all-or-nothing
// (`if (level === "world") return`), where a whole city used to appear all
// at once when the threshold was crossed.
{
  const PP = { zoom: { continentThreshold: 1.5 }, live: { growth: { start: 0.8, end: 1.25 } } };
  check("buildings: nothing before growth starts", growBuildings(1.0, PP) === 0);
  check("buildings: full after the end", growBuildings(2.5, PP) === 1);
  check("buildings: already rising BEFORE the continent threshold",
    growBuildings(1.4, PP) > 0 && growBuildings(1.4, PP) < 1);
  check("buildings: not yet full AT the continent threshold",
    growBuildings(1.5, PP) > 0 && growBuildings(1.5, PP) < 1);
  check("buildings: monotonic growth", [1.2, 1.3, 1.5, 1.7, 1.9]
    .every((z, i, a) => i === 0 || growBuildings(z, PP) >= growBuildings(a[i - 1], PP)));
  // The threshold comes from PARAMS, it isn't copied into the body: moving
  // the continent threshold must move the growth curve with it.
  const PP2 = { zoom: { continentThreshold: 10 }, live: { growth: { start: 0.8, end: 1.25 } } };
  check("buildings: growth follows PARAMS' threshold", growBuildings(1.5, PP2) === 0);
}

// The gridlines' parallax was BROUGHT DOWN TO ZERO after review on zoomed-in
// captures: the offset layer is the globe's own graticule, and at 4px it
// read as a doubled grid, not as depth. The setting stays in place (the
// offset code is correct), but it must stay at zero until someone judges it
// good by eye.
{
  const PARAMS = PARAMS_PROD;
  check("parallax: zero amplitude (doubling observed on capture)",
    PARAMS.live.parallax.amplitude === 0);
}

// --- The camera can no longer aim at a pole --------------------------------
//
// Fix for "the zoom moves near a pole", predating recent sessions. Not a
// calculation error but a singularity: with north up, no orientation is
// defined at the pole, so the camera must not be able to go there (see
// render.clampCamera). The drift measurement itself lives in the harness —
// it needs a real canvas; here we lock in the bound, its setting, and the
// fact that it leaves the whole habitable world reachable.
{
  const Q = { skin: { width: 1024, height: 512 }, zoom: { latitudeMax: 75 } };
  const H = Q.skin.height, margin = H * (0.5 - 75 / 180);
  const lat = y => (0.5 - y / H) * 180;

  check("camera: a polar aim is pulled back into the band",
    Math.abs(lat(clampCamera(0, Q)) - 75) < 1e-9
    && Math.abs(lat(clampCamera(H, Q)) + 75) < 1e-9);
  check("camera: an aim already within the band is untouched",
    clampCamera(H / 2, Q) === H / 2 && clampCamera(margin + 1, Q) === margin + 1);
  check("camera: the band covers the whole habitable world (±55 degrees)",
    Math.abs(lat(clampCamera(H * (0.5 - 55 / 180), Q)) - 55) < 1e-9);
  // A camera gone NaN would paint a black screen without raising any error —
  // the costliest failure to diagnose, and the least visible.
  check("camera: a lost position falls back to center, never NaN",
    clampCamera(NaN, Q) === H / 2 && clampCamera(undefined, Q) === H / 2);
  check("camera: with no setting, a default bound still applies",
    clampCamera(0, { skin: Q.skin }) > 0);
  // The real setting must stay well UNDER the cliff measured in the harness
  // (80 degrees: 0.3px at 79, 4.9px at 80, 27px at 81) and ABOVE the land.
  {
    const PARAMS = PARAMS_PROD;
    check("camera: the real setting stays under the cliff and above the land",
      PARAMS.zoom.latitudeMax <= 79 && PARAMS.zoom.latitudeMax >= 60);
  }
}

// --- The globe can only be grabbed where it lets itself be grabbed ---------
//
// User report: "a drag that leaves the disk (but not the frame) does weird
// things". Reproduced with a probe: the camera used to jump 72 units in one
// step near the limb, then FREEZE completely outside, then flip 180 degrees
// once per lap. Same nature as the polar singularity: at the limb a point is
// seen edge-on, and beyond it there is no world — so no target the drag can
// reach.
//
// The gesture measurement lives in the harness (it needs a real canvas);
// here we lock in the bound itself, its setting, and above all the property
// that distinguishes this fix from a plain "ignore the gesture": the
// cursor's DIRECTION is preserved, so the globe keeps turning when the mouse
// leaves the disk instead of locking up.
{
  const Q = { zoom: { grab: 0.9 } };
  const p = (x, y) => clampToDisk(x, y, 100, 100, 200, Q);
  const d = ([x, y]) => Math.hypot(x - 100, y - 100);

  check("grab: a point well inside is untouched",
    p(140, 100)[0] === 140 && p(140, 100)[1] === 100);
  check("grab: a point outside the disk comes back onto the grab circle",
    Math.abs(d(p(900, 100)) - 180) < 1e-9);
  check("grab: the cursor's direction is preserved (the globe follows the angle)",
    Math.abs(p(700, 700)[0] - p(400, 400)[0]) < 1e-9
    && Math.abs(p(700, 700)[1] - p(400, 400)[1]) < 1e-9
    && p(700, 700)[0] > 100 && p(700, 700)[1] > 100);
  // Two different angles must give two different points: that's exactly what
  // was missing — the map stayed frozen no matter where the mouse wandered
  // outside the disk.
  check("grab: two directions outside the disk don't give the same point",
    d([p(900, 100)[0] - p(100, 900)[0], p(900, 100)[1] - p(100, 900)[1]]) > 1);
  check("grab: the point right at the center doesn't divide by zero",
    Number.isFinite(p(100, 100)[0]) && Number.isFinite(p(100, 100)[1]));
  check("grab: with no setting, a default bound still applies",
    Math.abs(d(clampToDisk(900, 100, 100, 100, 200, {})) - 180) < 1e-9);
  // The setting must stay well under the limb: amplifying one mouse pixel
  // into rotation is worth 1/sqrt(1-share²), i.e. 2.3x at 0.9 and already 7x
  // at 0.99 — the runaway the user felt.
  {
    const PARAMS = PARAMS_PROD;
    check("grab: the real setting bounds the runaway under 3x",
      1 / Math.sqrt(1 - PARAMS.zoom.grab ** 2) < 3 && PARAMS.zoom.grab > 0.5);
  }
}

// --- A NOTE'S CITY (user feedback from 07/26) -------------------------------
// Two measures, two readings, and they must not mix:
//   density (written volume) -> NUMBER of buildings and the city's spread;
//   weight (links, status)   -> HEIGHT of the city.
// That's the decision made with the user at the start of the session; what
// follows guards against a later setting silently recoupling them.
{
  const PV = { buildings: { base: 2, perDensity: 6, max: 26 } };
  // Deterministic draw, INDEPENDENT of the note's content: two notes that
  // only differ by density must be comparable.
  const seed = () => { let s = 12345;
    return () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; }; };
  const city = (note) => cityShape(note, PV, seed());

  const hamlet = city({ type: "note", density: 0.25 });
  const town   = city({ type: "note", density: 1 });
  const metro  = city({ type: "note", density: 3 });
  check("city: the denser a note, the more buildings it has",
    hamlet.towers.length < town.towers.length && town.towers.length < metro.towers.length);
  check("city: the building cap is held",
    city({ type: "note", density: 99 }).towers.length === 26);
  check("city: never fewer than two buildings",
    city({ type: "note", density: 0 }).towers.length >= 2);
  check("city: a dense note spreads out more on the ground",
    hamlet.width < town.width && town.width < metro.width);
  check("city: with no density (a note from before the measure), reads as the median",
    city({ type: "note" }).towers.length === town.towers.length);

  // ⚠️ The guardrail for the separation: WEIGHT must change NOTHING about
  // the shape. Before 07/26, it was weight that gave the stem count — two
  // notes with the same content and different weights had different cities,
  // and density was nowhere.
  check("city: weight doesn't touch the shape",
    JSON.stringify(city({ type: "note", density: 1, weight: 0.2 })) ===
    JSON.stringify(city({ type: "note", density: 1, weight: 9 })));

  // Same note, two openings: same silhouette. It's a mental landmark, it
  // must not reshuffle on every mount.
  check("city: stable shape from one opening to the next",
    JSON.stringify(city({ type: "projet", density: 1.4 })) ===
    JSON.stringify(city({ type: "projet", density: 1.4 })));

  // The type stays legible despite density: a journal keeps its single
  // tower.
  const lighthouse = city({ type: "journal", density: 3 });
  check("city: the type survives density (journal = a single tower at center)",
    lighthouse.type === "lighthouse" && lighthouse.towers[0].d === 0
    && lighthouse.towers.every((t, i) => i === 0 || t.hf < lighthouse.towers[0].hf));
  // ...and the back rank never swallows the lead tower.
  check("city: the lead tower stays in the foreground",
    lighthouse.towers[0].rank === 0);
  check("city: widths are uneven (otherwise it's a comb)",
    new Set(town.towers.map(t => t.wf.toFixed(3))).size > 1);

  // Height: it's weight, and only weight.
  const u = cityUnit(6);
  check("city height: grows with weight",
    cityHeight({ weight: 3 }, u) > cityHeight({ weight: 1 }, u));
  check("city height: indifferent to density",
    cityHeight({ weight: 1, density: 3 }, u) === cityHeight({ weight: 1, density: 0.25 }, u));
  check("city height: bounded (a heavily-linked note doesn't pierce the screen)",
    cityHeight({ weight: 999 }, u) < u * 5);
  check("city unit: grows with zoom then plateaus",
    cityUnit(2) < cityUnit(6) && cityUnit(50) === cityUnit(99));
  check("city unit: never zero when zoomed out", cityUnit(0) >= 5);
}

// --- Text scale --------------------------------------------------------------
//
// Every font size on the map goes through this single factor. It answers
// the feedback "text size doesn't adapt well enough": sizes used to be
// hardcoded while the canvas follows the Obsidian panel's width.
{
  const PT = { text: { reference: 900, exponent: 0.5, min: 0.92, max: 1.5 } };
  check("text: at the reference width, nothing changes (factor 1)",
           Math.abs(textScale(900, PT) - 1) < 1e-12);
  check("text: a wider canvas gives bigger letters",
           textScale(1400, PT) > textScale(900, PT));
  check("text: a narrower canvas gives smaller letters",
           textScale(600, PT) < textScale(900, PT));
  // The square root, not proportional scaling: that's what distinguishes
  // "the map adapts" from "the map is the same but bigger". Doubling the
  // width must not double the letters, or the screen space gained goes to
  // waste.
  check("text: the growth is damped, not proportional",
           textScale(1800, PT) < 1.6 && textScale(1800, PT) > 1.2);
  // The bounds aren't for comfort: under `min` text becomes unreadable,
  // above `max` labels eat the map.
  check("text: bounded at the bottom", textScale(50, PT) === PT.text.min);
  check("text: bounded at the top", textScale(100000, PT) === PT.text.max);
  // A zero-width canvas (block rendered off-screen by Obsidian) must not
  // produce NaN or zero: that's the degenerate case `measureCanvas` already
  // handles on its own side, and it must not resurface here in another
  // form.
  check("text: a zero-width canvas stays bounded",
           textScale(0, PT) === PT.text.min);
  // The PRODUCTION setting exists and is consistent: without this,
  // `PARAMS.text` missing would crash any text rendering at mount.
  const PROD = PARAMS_PROD;
  check("text (prod): the setting is present and complete",
           PROD.text && PROD.text.reference > 0 && PROD.text.min > 0
             && PROD.text.max >= PROD.text.min);
  check("text (prod): the rescue canvas gives a factor close to 1",
           Math.abs(textScale(PROD.canvas.width, PROD) - 1) < 0.05);
}

summary();
