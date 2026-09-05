// Continent palette, deliberately COLD and tight.
//
// Diagnosed appearance gap: the old palette (saturated purple/orange/green/pink)
// read as a political map, each area painted its own color. The reference is a
// night satellite pass: blue-gray/cyan everywhere, with LIGHTS (density, warmth)
// distinguishing zones — not the ground.
//
// The six tints stay distinct (verified, and the graph uses it for buildings),
// but now live in the same cold family, low saturation.
const COLORS = ["#5ad3c4", "#7fb0e0", "#93a6cf", "#a2c6d6", "#68b9ad", "#9db3c4"];

// Chrome colors (outside the continent palette).
// WARNING: `bg` and `accent` are duplicated in view.css (canvas background,
// border). Changing one without the other silently desyncs the map and its
// frame — both files carry a cross-reference comment.
const PALETTE = {
  bg:              "#04080c",
  bgCenter:        "#0a1c26", // center halo: gradient runs from here to `bg` at the edges
  accent:          "#4ff0d0",
  text:            "#9fe8dd",
  alert:           "#ffb86b",
  borderSecondary: "#2a7f8f",
  // The coastline gets its own color, paler and colder than the accent: in
  // thick saturated green it was the brightest object on the map and drowned
  // everything else — relief, city lights, links. The reference has only a
  // subtle white-cyan rim where land meets sea.
  coast:           "#a6e2f2",
};

function levelFromZoom(zoom, PARAMS) {
  if (zoom < PARAMS.zoom.continentThreshold) return "world";
  if (zoom < PARAMS.zoom.countryThreshold) return "continent";
  return "country";
}

// The note's type decides the building silhouette.
function architecture(type) {
  const table = { "idée": "tent", "projet": "citadel", "lecture": "library",
                  "contact": "embassy", "journal": "lighthouse", "tâche": "construction" };
  return table[type] || "generic";
}

// City drawing unit, in pixels, by zoom: sketched at continent level, tall and
// crisp at country level. Kept module-level because TWO layers depend on it —
// buildings (decor) and particles (live layer), which must start from the
// building roofs and not from the ground.
function cityUnit(zoom) {
  return Math.min(34, Math.max(5, zoom * 3.4));
}

// A note's city height. Driven by WEIGHT (links, status, quest) — density, by
// contrast, only affects building count and spread.
function cityHeight(note, u) {
  return u * (1.6 + Math.min(3.2, (note.weight || 1) * 0.9));
}

// A note's CITY: its list of buildings, computed once then cached.
//
// Three distinct signals feed this, deliberately kept separate:
//   - DENSITY (word count, weigh.js) sets the NUMBER of buildings and the
//     city's spread;
//   - WEIGHT (links, status, quest) sets the HEIGHT, applied at render time;
//   - TYPE sets the profile (central keep, colonnade, lone tower…).
//
// The `r` draw is seeded from the note's path: a note must keep its silhouette
// across sessions, as a mental landmark.
//
// Each building also carries a WIDTH and a RANK (background or foreground).
// At constant width on a single row, a city isn't a city, it's a comb — the
// visible flaw from earlier captures. Two staggered rows give depth, uneven
// widths give the silhouette.
function cityShape(note, PARAMS, r) {
  const type = architecture(note.type);
  // (PARAMS.buildings, not PARAMS.city: the latter controls how notes GROUP
  // into cities on the map, unrelated to how a city is drawn.)
  const D = (PARAMS && PARAMS.buildings) || {};
  const perDensity = D.perDensity !== undefined ? D.perDensity : 6;
  const base        = D.base        !== undefined ? D.base        : 2;
  const max         = D.max         !== undefined ? D.max         : 26;
  const dens = note.density === undefined ? 1 : note.density;
  const nb = Math.max(2, Math.min(max, Math.round(base + dens * perDensity)));
  const towers = [];
  for (let i = 0; i < nb; i++) {
    // Even spread plus jitter: a perfectly regular step gives a comb, purely
    // random positions leave gaps.
    const d = nb === 1 ? 0 : (i / (nb - 1) - 0.5) * 2 + (r() - 0.5) * (1.4 / nb);
    let hf = 0.35 + r() * 0.65;
    if (type === "citadel") hf *= 1.25 - 0.55 * Math.abs(d);        // central keep
    else if (type === "library") hf = 0.55 + (i % 2) * 0.12;        // regular colonnade
    else if (type === "lighthouse") hf = i === 0 ? 1.9 : hf * 0.32; // one tower, a hamlet
    else if (type === "embassy") hf = 0.4 + r() * 0.25;             // low, wide building
    else if (type === "construction") hf = i === nb - 1 ? 1.35 : hf * 0.7;
    // Width: tall towers are thin, low buildings are wide. The opposite gave
    // a "barcode" look.
    const wf = (0.75 + r() * 0.9) * (1.35 - 0.45 * Math.min(1.4, hf));
    // Rank: one building in three goes to the back, darker and higher on
    // screen. Never the lead tower of a lighthouse or construction site.
    const key = type === "lighthouse" ? 0 : type === "construction" ? nb - 1 : -1;
    const rank = (i !== key && r() < 0.34) ? 1 : 0;
    towers.push({ d: type === "lighthouse" && i === 0 ? 0 : d, hf, wf, rank });
  }
  // Ground spread: a dense city covers more terrain than a hamlet.
  const width = (type === "embassy" ? 1.1 : 0.8) * (0.6 + 0.5 * Math.min(2, dens));
  return { type, dens, width, towers };
}

// Label placer: accepts a box if it doesn't overlap any already accepted,
// refuses otherwise. Under tilt, distant terrain compresses toward the
// horizon and names stack up to the point of illegibility; showing fewer,
// legibly, wins. Candidates must be presented nearest-first: first come,
// first served, and it's the foreground that must win.
function placer() {
  const claimed = [];
  return (x, y, w, h) => {
    for (const b of claimed)
      if (x < b.x + b.w && x + w > b.x && y < b.y + b.h && y + h > b.y) return false;
    claimed.push({ x, y, w, h });
    return true;
  };
}

// Network-view anchor: it lands ON the note, not at the map center, then
// re-centers so the card star fits entirely in frame. Without this, a note
// near an edge would show half its neighbors drawn off-screen. Re-centering
// keeps the middle when space is short on both sides (window smaller than
// the star), otherwise the anchor would jump.
function anchorNetwork(x, y, rx, ry, width, height) {
  const fit = (v, r, size) => size < 2 * r ? size / 2
                             : Math.max(r, Math.min(size - r, v));
  return [fit(x, rx, width), fit(y, ry, height)];
}

// Where to place the name of a group (continent, country, city).
//
// The centroid of its notes isn't enough — a defect reported from Obsidian:
// "world-of-trois shows up as text in the sea". A group whose notes straddle
// a strait has its centroid IN THE MIDDLE OF THE WATER — the name then
// floats on the ocean, with no territory under it.
//
// Rule: keep the centroid if it lands on land belonging to the group;
// otherwise fall back to the heaviest note, which is always on its own
// territory (the guaranteed core from partition makes this a certainty, not
// a hope).
//
// `members` = the group's notes; `inGroup` (note index → bool) says whether a
// cell belongs to the group; `noteAt` reads the note at a map point.
function labelPoint(members, inGroup, noteAt) {
  let x = 0, y = 0;
  for (const n of members) { x += n.x; y += n.y; }
  x /= members.length; y /= members.length;
  const i = noteAt(x, y);
  if (i >= 0 && inGroup(i)) return [x, y];
  let heaviest = members[0];
  for (const n of members) if ((n.weight || 1) > (heaviest.weight || 1)) heaviest = n;
  return [heaviest.x, heaviest.y];
}

function tint(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return COLORS[h % COLORS.length];
}

// --- Small live-layer arithmetic ------------------------------------------
//
// These five functions are deliberately kept OUT of `mount`'s body: they need
// no canvas, so they're testable outside a browser. The rest of the animation
// is just drawing on top.

// 0→1 progress of an animation started at `t0` lasting `duration`. Clamped at
// both ends: a finished animation returns 1, never 1.7 — otherwise a card
// would keep growing forever after it unfolds.
function progress(t, t0, duration) {
  if (!(duration > 0)) return 1;
  return Math.max(0, Math.min(1, (t - t0) / duration));
}

// Smoothstep: no jerk at start or end (zero derivative both ends). It's what
// distinguishes "unfolding" from "jumping".
function ease(p) {
  const x = Math.max(0, Math.min(1, p));
  return x * x * (3 - 2 * x);
}

// Exponential approach to a target, FRAME-RATE INDEPENDENT. A plain
// `v += (target - v) * 0.2` per frame runs twice as fast at 120fps as at
// 60fps: hover would feel twitchier on a fast screen. Here `constant` is a
// duration, so the result only depends on elapsed time.
function approach(v, target, dt, constant) {
  if (!(constant > 0) || !(dt > 0)) return constant > 0 ? v : target;
  return v + (target - v) * (1 - Math.exp(-dt / constant));
}

// A note's own phase, in [0,1[. Deterministic: a city must keep its rhythm
// frame to frame AND session to session. Drawn at random, it would resync
// with every other note on every redraw — the whole planet pulsing together.
function phase(key) {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) { h ^= key.charCodeAt(i); h = Math.imul(h, 16777619); }
  return ((h >>> 0) % 10007) / 10007;
}

// Building growth around the "continent" threshold.
//
// Replaces the old all-or-nothing (`if (level === "world") return`), where a
// whole city popped in at once at the threshold crossing. Here stems rise
// before the threshold and finish growing after: during a dive, where zoom
// slides frame by frame, growth is continuous.
function growBuildings(zoom, PARAMS) {
  const s = PARAMS.zoom.continentThreshold, p = PARAMS.live.growth;
  const start = s * p.start, end = s * p.end;
  return ease(progress(zoom, start, end - start));
}

// Canvas size for a given container width. Isolated here to be testable
// outside a browser: this is the only rule that decides the frame.
//
// `availableWidth` or `screenHeight` at zero = measurement impossible (block
// not yet displayed): fall back to the default size rather than a 0px
// canvas, which would be a silent black screen.
function measureCanvas(availableWidth, screenHeight, PARAMS) {
  const T = PARAMS.canvas;
  let width = Math.round(availableWidth > 0 ? availableWidth : T.width);
  if (width < T.minWidth) width = T.minWidth;
  let height = Math.round(width * T.ratio);
  const ceiling = screenHeight > 0 ? Math.round(screenHeight * T.screenShare) : T.height;
  if (height > ceiling) {
    // When the window bounds the height, WIDTH must follow, otherwise the
    // ratio deforms and the map ends up with black bars left and right: the
    // globe is sized by the smaller side, so more width without more height
    // adds only empty space.
    height = ceiling;
    width = Math.max(T.minWidth, Math.min(width, Math.round(ceiling / T.ratio)));
  }
  if (height < T.minHeight) height = T.minHeight;
  return { width, height };
}

// Factor by which ALL map font sizes pass, and every plate that carries them.
//
// Sizes used to be hardcoded (9-13px) while the canvas has followed the
// Obsidian panel width since 25/07: on a wide panel, a note name stayed
// calibrated for the original 900px — the "text size doesn't adapt well"
// report. See `PARAMS.text` (view.js) for the bounds and why a root, not a
// straight proportion, is used.
//
// Module-level rather than tucked inside the render: a pure function of a
// number, testable without mounting a whole map.
function textScale(canvasWidth, PARAMS) {
  const T = PARAMS.text;
  const e = Math.pow(Math.max(1, canvasWidth) / T.reference, T.exponent);
  return Math.max(T.min, Math.min(T.max, e));
}

// Can a projection-grid cell be interpolated instead of computed pixel by
// pixel? `corners` = the 4 corners, each `[skin x, skin y, lighting, depth]`,
// or `null` if the corner falls off the globe.
//
// Three refusals, each for a lived reason:
//   — a corner off the globe: the cell straddles the edge, nothing to
//     interpolate on one side;
//   — the cell crosses the date-line meridian, where longitude jumps from
//     +180 to -180: interpolating between the two scrolls the whole planet
//     inside an eight-pixel cell;
//   — the cell is too close to the limb, where the sphere folds back: the
//     only place interpolation visibly drifts.
function interpolatable(corners, L, minDepth) {
  if (corners.some(c => !c)) return false;
  const xs = corners.map(c => c[0]);
  if (Math.max(...xs) - Math.min(...xs) > L / 2) return false;
  return corners.every(c => c[3] >= minDepth);
}

// Rotates direction `c` by the rotation that brings `vb` onto `va` (three
// unit vectors). The building block of globe manipulation: "bring this point
// under the cursor" is a rotation, not an offset.
//
// Rodrigues' formula around axis vb×va. Returns `c` unchanged when the two
// points coincide or are diametrically opposite (undefined axis).
function turnTowards(c, vb, va) {
  const axis = [vb[1] * va[2] - vb[2] * va[1],
               vb[2] * va[0] - vb[0] * va[2],
               vb[0] * va[1] - vb[1] * va[0]];
  const n = Math.sqrt(axis[0] * axis[0] + axis[1] * axis[1] + axis[2] * axis[2]);
  if (n < 1e-12) return c.slice();
  const cos = Math.max(-1, Math.min(1, vb[0] * va[0] + vb[1] * va[1] + vb[2] * va[2]));
  const angle = Math.atan2(n, cos);
  const u = [axis[0] / n, axis[1] / n, axis[2] / n];
  const co = Math.cos(angle), si = Math.sin(angle);
  const ps = u[0] * c[0] + u[1] * c[1] + u[2] * c[2];
  const cr = [u[1] * c[2] - u[2] * c[1], u[2] * c[0] - u[0] * c[2], u[0] * c[1] - u[1] * c[0]];
  const r = [c[0] * co + cr[0] * si + u[0] * ps * (1 - co),
             c[1] * co + cr[1] * si + u[1] * ps * (1 - co),
             c[2] * co + cr[2] * si + u[2] * ps * (1 - co)];
  const m = Math.sqrt(r[0] * r[0] + r[1] * r[1] + r[2] * r[2]) || 1;
  return [r[0] / m, r[1] / m, r[2] / m];
}

// How far in latitude the camera can aim.
//
// Fixes "zoom drifts near a pole", a defect predating all these sessions.
// Measured at the harness: the point under the cursor, meant to stay pinned
// during a zoom, drifted 127px at 86° latitude, vs 0.00px at the equator.
//
// The cause isn't a calculation error but a SINGULARITY. The camera frame is
// rebuilt on world-north every frame (see `frame()`): that's what keeps north
// up, a property the map reading and every label depend on. But at the pole,
// north becomes parallel to the view axis: "right" is then the cross product
// of two aligned vectors, i.e. numeric noise amplified by 1/cos(latitude).
// Any camera rotation there rolls the image by an unbounded angle, and
// `realign()`'s solver has no fixed point to converge to.
//
// With north fixed up, NO orientation is defined at the pole: no formula can
// produce it. So instead of fixing the singularity, it's made UNREACHABLE —
// what every north-fixed map does (Google Maps stops at ±85° for exactly
// this reason). The world loses nothing: land is confined to ±55°
// (layout.latitudeBand), beyond which there's only ocean and a visual anchor
// that collapses anyway.
function clampCamera(y, PARAMS) {
  const H = PARAMS.skin.height;
  const lat = (PARAMS.zoom && PARAMS.zoom.latitudeMax) || 78;
  // Latitude ≥ 90: no bound requested, just stay within the skin.
  const margin = Math.max(0, H * (0.5 - lat / 180));
  if (!Number.isFinite(y)) return H / 2;      // lost camera: center, not NaN
  return Math.max(margin, Math.min(H - margin, y));
}

// Brings a screen point back into the zone where the globe can be GRABBED: a
// disk slightly smaller than the globe itself. Same family of guard-rail as
// clampCamera, for the same kind of reason.
//
// At the disk's edge, a point on the sphere is seen edge-on: a screen pixel
// there is worth a rotation tending to infinity (in 1/cos). And BEYOND the
// edge, there's no world at all — toMap then returns the nearest limb point,
// i.e. a target the drag can never reach since it moves with the camera on
// every solver pass.
//
// Measured at the probe, cursor moved outside the disk without leaving the
// frame:
//   - approaching the limb: camera jumps 25 then 73 units for the same 27px
//     mouse move (1/cos runaway);
//   - outside: a first jump of 206 units throws the camera from the equator
//     to -72°, then the map FREEZES — going all the way around the disk with
//     the mouse no longer moves it a pixel;
//   - except once per lap, where it flips 180° in one go.
// Exactly the "it does weird stuff" report.
//
// The grab can't be "fixed" at the limb: it isn't defined there. So it's
// clamped to a fraction of the radius (PARAMS.zoom.grab), keeping the
// cursor's DIRECTION — which keeps the gesture alive when the mouse leaves
// the disk (the globe keeps turning, following the angle) instead of
// freezing.
function clampToDisk(sx, sy, cx, cy, R, PARAMS) {
  const share = (PARAMS && PARAMS.zoom && PARAMS.zoom.grab) || 0.9;
  const dx = sx - cx, dy = sy - cy;
  const d = Math.hypot(dx, dy);
  const max = R * share;
  if (!(d > max)) return [sx, sy];             // inside (and NaN-safe: untouched)
  if (!(d > 0)) return [cx, cy];
  return [cx + dx * max / d, cy + dy * max / d];
}

function mount(root, model, PARAMS, app) {
  root.addClass("carte-atlas");
  const canvas = root.createEl("canvas");
  // The canvas has a 1px rim (view.css) on each side: without subtracting it,
  // the canvas overflows its container by 2px, which can trigger a scrollbar
  // — which shrinks the container, and restarts the measurement loop.
  const BORDER = 2;
  function measureSize() {
    const available = root.clientWidth ? root.clientWidth - BORDER : 0;
    const screen = (typeof window !== "undefined" && window.innerHeight) || 0;
    return measureCanvas(available, screen, PARAMS);
  }
  {
    const t = measureSize();
    canvas.width = t.width;
    canvas.height = t.height;
  }
  const ctx = canvas.getContext("2d");
  // FULL size (what the Obsidian panel actually measures), kept apart from
  // `canvas.width/height`: during a gesture (drag, wheel) the latter are
  // reduced to paint fewer pixels — see `setGlowFactor` below — and the code
  // needs both sizes to stay consistent (one to style the on-screen canvas,
  // the other to rescale mouse coordinates, in CSS pixels, into buffer
  // space, in real pixels).
  let fullWidth = canvas.width, fullHeight = canvas.height;

  // Off-screen backdrop: background, territories, borders and labels only
  // change on zoom or camera move. Paint them ONCE onto this memory canvas,
  // then each frame only recopies that snapshot and paints moving transports
  // on top. Without this, the animation loop would repaint the whole map 60
  // times a second to move a handful of points (~2M ops/s for 0.03% useful —
  // see task 9).
  // The planet's SKIN: the rectangular map carrying everything plastered to
  // the ground (territory floors, relief, coasts, borders, city lights). It's
  // painted in map coordinates, then wrapped onto the globe.
  //
  // Its great virtue: it does NOT depend on the camera. Rotating the globe or
  // approaching it doesn't change it — only the displayed level of detail
  // (country borders, region borders) forces a repaint. Turning the planet
  // therefore only costs the projection.
  const skin = document.createElement("canvas");
  skin.width = PARAMS.skin.width;
  skin.height = PARAMS.skin.height;
  const skinCtx = skin.getContext("2d");

  const backdrop = document.createElement("canvas");
  backdrop.width = canvas.width;
  backdrop.height = canvas.height;
  const backdropCtx = backdrop.getContext("2d");

  // Second memory canvas, dedicated to territory floors. Cells are painted
  // WITHOUT a mask, then the whole image is composited onto the backdrop
  // through the coast cutout. Passing cells one by one through the cutout
  // was very expensive: 172ms per refresh at world level (126,000 masked
  // rectangles one by one) vs a few ms here — hovering the map felt sluggish.
  const ground = document.createElement("canvas");
  ground.width = PARAMS.skin.width;
  ground.height = PARAMS.skin.height;
  const groundCtx = ground.getContext("2d");

  // Two layers pulled out of the backdrop, each for a precise reason — and in
  // both cases the reason is wanting to MODULATE them per frame without
  // repainting the backdrop's 30ms.
  //
  // `veil`: the globe's graticule. Painted with the backdrop (so not replayed
  // while the camera sleeps), but kept apart so a very slow flicker and a
  // few pixels of parallax can be added each frame, at the cost of a single
  // image recopy.
  //
  // `links`: the network strokes. Apart because hover must be able to FADE
  // them as a block — "the hovered note's links come forward, the rest fade
  // out". Fading them within the backdrop would mean repainting the whole
  // backdrop on every hovered-cell change, exactly the waste removed here
  // (hover no longer dirties anything).
  //
  // `texts`: every label (badges, note names, group names, legend). Apart for
  // a STACKING reason, not cost: network strokes and terminal shapes were
  // painted on top of the backdrop, i.e. above the names — a terminal stem
  // could cross a note name, and links passed over the legend. Text must
  // stay at the top of the stack, it's the layer people read. Cost: one more
  // image recopy per frame (measured under 0.2ms).
  const veil = document.createElement("canvas");
  const links = document.createElement("canvas");
  const texts = document.createElement("canvas");
  const veilCtx = veil.getContext("2d");
  const linksCtx = links.getContext("2d");
  const textsCtx = texts.getContext("2d");
  function sizeLayers() {
    for (const c of [veil, links, texts]) { c.width = canvas.width; c.height = canvas.height; }
  }
  sizeLayers();

  const state = { zoom: 1, camX: PARAMS.skin.width / 2, camY: PARAMS.skin.height / 2,
                 hover: -1, level: "world", backdropDirty: true, network: 0,
                 // The skin is far more stable than the backdrop: it only
                 // repaints on a detail-level change, not on camera movement.
                 skinDirty: true, skinLevel: null,
                 // Zoom transition: target + flag. While inTransition is
                 // true, advance() moves zoom/camera toward the target each
                 // frame, giving a glide instead of a jump.
                 inTransition: false, targetZoom: 1,
                 targetX: PARAMS.skin.width / 2, targetY: PARAMS.skin.height / 2 };

  const LIVE = PARAMS.live;
  // All live-layer state in one place. NEVER read by the backdrop: this
  // guarantees no micro-interaction can accidentally trigger a full repaint.
  //
  // `entering` / `leaving`: hover is two-way. When the cursor moves from one
  // territory to another, the old one must fade while the new one lights up
  // — with a single intensity, the first would vanish instantly and every
  // crossed border would flicker.
  const anim = {
    t: 0, dt: 0, mountTime: 0, started: false,
    mouse: { x: 0, y: 0, inside: false },
    entering: { i: -1, k: 0 }, leaving: { i: -1, k: 0 },
    tick: -1e9,                 // instant of the last hover change
    cascade: null,              // { sx, sy, t0 } origin of a dive
    network: { focus: null, t0: 0, cards: [] },
    hoverCard: -1,
  };
  state.anim = anim;

  const { notes, grid, mods } = model;
  const OPACITY = PARAMS.render.opacity;

  // Plane tilt: flat at world level, tilts into 3D as you zoom (like the
  // video: flat overview → extruded region). Returns the tilt strength
  // 0..TILT_MAX for the current zoom.
  // --- The globe -------------------------------------------------------
  //
  // The world is a ball viewed head-on. The camera aims a direction (that of
  // map point camX/camY) and the apparent radius grows with zoom: at world
  // level the planet fits the frame; diving in, it grows beneath us, we only
  // see a piece of it, and curvature erases itself. So there is NO scripted
  // handoff between overview and close-up: continuity is a consequence of
  // the geometry.
  //
  // Orthographic projection. Chosen over a perspective one for two concrete
  // reasons: its inverse is closed-form and fits in three lines (mouse
  // picking must be exact), and a map point keeps the same scale in both
  // directions — text on it is neither sheared nor stretched.
  const { toSphere, fromSphere, normalize } = mods.layout;
  // Recomputed on every call rather than fixed at mount: the canvas can
  // resize mid-session (panel resize), and a cached radius would leave the
  // globe at its original size in a now-bigger frame.
  function baseRadius() { return Math.min(canvas.width, canvas.height) * 0.46; }
  function radius() { return baseRadius() * state.zoom; }

  // Camera frame: "forward" aims at the view center, "right" and "up"
  // complete the basis. Rebuilt on every camera change, not per point — a
  // handful of operations for an entire frame.
  let base = null, baseKey = "";
  function frame() {
    const key = state.camX + ":" + state.camY;
    if (key === baseKey && base) return base;
    const forward = toSphere(state.camX, state.camY, PARAMS);
    // World north is the reference for the horizontal axis. When the camera
    // aims at a pole, it becomes parallel to "forward" and defines nothing:
    // switch to another axis then, or the frame collapses.
    let ref = [0, 0, 1];
    if (Math.abs(forward[2]) > 0.999) ref = [1, 0, 0];
    const right = normalize([ref[1] * forward[2] - ref[2] * forward[1],
                               ref[2] * forward[0] - ref[0] * forward[2],
                               ref[0] * forward[1] - ref[1] * forward[0]]);
    const up = [forward[1] * right[2] - forward[2] * right[1],
                  forward[2] * right[0] - forward[0] * right[2],
                  forward[0] * right[1] - forward[1] * right[0]];
    base = { forward, right, up };
    baseKey = key;
    return base;
  }

  // --- Text scale ------------------------------------------------------
  //
  // Single factor by which ALL font sizes pass, and every plate that carries
  // them. See `PARAMS.text` (view.js) for the why and the bounds.
  //
  // Recomputed on every call, not fixed at mount, like `baseRadius()`: the
  // canvas resizes as the Obsidian panel resizes, and a cached factor would
  // leave text calibrated for the old width.
  const TS = () => textScale(canvas.width, PARAMS);
  // Pixel size on the current canvas, for a given reference size.
  const toPx = px => px * TS();
  // Monospace font at a given reference size. The single way to set a font
  // anywhere in this module: guarantees no text stays hardcoded and skips
  // the scale.
  function font(px, style) {
    return `${style ? style + " " : ""}${toPx(px).toFixed(1)}px monospace`;
  }

  // Projects a map point. Returns [screen x, screen y, depth], depth positive
  // on the visible face and negative behind the ball — it's what lets the
  // far face be hidden.
  function toScreen3(x, y) {
    const { forward, right, up } = frame();
    const v = toSphere(x, y, PARAMS);
    const R = radius();
    return [canvas.width / 2 + R * (v[0] * right[0] + v[1] * right[1] + v[2] * right[2]),
            canvas.height / 2 - R * (v[0] * up[0] + v[1] * up[1] + v[2] * up[2]),
            v[0] * forward[0] + v[1] * forward[1] + v[2] * forward[2]];
  }
  function toScreen(x, y) { const p = toScreen3(x, y); return [p[0], p[1]]; }

  // Screen point actually usable to MANIPULATE the globe (drag, wheel). Hover
  // and click keep the raw point instead: there, we want to know what's
  // under the cursor, not spin anything.
  function grab(sx, sy) {
    return clampToDisk(sx, sy, canvas.width / 2, canvas.height / 2, radius(), PARAMS);
  }

  // Projects ANY 3D point, at any radius: this is what lets a transport arc
  // hover above the planet, where toScreen3 can only project points sitting
  // on the ground.
  //
  // Returns [screen x, screen y, component toward the eye, distance from the
  // view axis in radii]. The last two say whether the point is hidden by the
  // ball: behind (negative component) AND within one radius of the axis.
  // Without this distance, a high arc that passes behind the globe while
  // bulging past the limb would be cut off when it should stay visible.
  function toScreenPoint(v) {
    const { forward, right, up } = frame();
    const R = radius();
    const d = v[0] * forward[0] + v[1] * forward[1] + v[2] * forward[2];
    const a = v[0] * right[0] + v[1] * right[1] + v[2] * right[2];
    const b = v[0] * up[0] + v[1] * up[1] + v[2] * up[2];
    return [canvas.width / 2 + R * a, canvas.height / 2 - R * b, d, Math.hypot(a, b)];
  }

  // Exact inverse: the screen point designates a ray hitting the ball.
  // Outside the disk, there's no world — return the nearest limb point
  // instead of nothing, so a mouse drag leaving the globe doesn't snap the
  // camera.
  function toMap(sx, sy) {
    const { forward, right, up } = frame();
    const R = radius();
    let a = (sx - canvas.width / 2) / R, b = -(sy - canvas.height / 2) / R;
    const d2 = a * a + b * b;
    if (d2 > 1) { const n = Math.sqrt(d2); a /= n; b /= n; }
    const p = Math.sqrt(Math.max(0, 1 - (a * a + b * b)));
    const v = [a * right[0] + b * up[0] + p * forward[0],
               a * right[1] + b * up[1] + p * forward[1],
               a * right[2] + b * up[2] + p * forward[2]];
    return fromSphere(normalize(v), PARAMS);
  }
  // Is a map point on the visible face? The threshold is slightly positive:
  // right at the limb, a point is so squashed it no longer reads.
  function visible(x, y) { return toScreen3(x, y)[2] > 0.02; }

  // --- The GLOW BUDGET ---------------------------------------------------
  //
  // The #1 expense of the backdrop, invisible in every earlier timing pass.
  // Measured at the harness (country level, 1400px window, software render),
  // neutralizing all `shadowBlur` calls and nothing else:
  //   with halos: 44.2ms per frame in motion (backdrop 17.8 + composite 26.5)
  //   without:    25.2ms                     (backdrop 17.7 + composite  7.5)
  // 43% of a frame's cost. Per-layer timing didn't show it: canvas stacks
  // draw calls and only rasterizes them when the backdrop is read, so coast,
  // tower, and link blur was billed later, on the "composite" line, with
  // nothing to tie it back to its cause.
  //
  // Hence this budget, replacing the old RESOLUTION reduction during a
  // gesture: that painted the whole canvas 40% smaller before re-stretching
  // it, which also blurred and enlarged text, names, and buildings —
  // "moving the planet makes everything big and blurry". Lowering halos costs
  // almost as much and touches no geometry: during a drag the map stays
  // pixel-sharp, it just glows less.
  //
  // `glowFactor` is 1 at rest. Every backdrop site that sets a halo goes
  // through `setGlow()` — never `shadowBlur` directly — and `state.glow`
  // carries the same factor down to routes.js, which paints its links and
  // terminals with the backdrop. The live layer keeps its halos: it costs
  // 0.3ms.
  let glowFactor = 1;
  function setGlow(g, radius, color) {
    const r = radius * glowFactor;
    g.shadowBlur = r;
    if (r > 0 && color) g.shadowColor = color;
  }

  // Brings map point (ax, ay) back under screen point (sx, sy).
  //
  // THE globe manipulation: both drag and wheel-zoom reduce to this. Both
  // used to reuse the FLAT-map formula from before the globe (`camX -= dx /
  // zoom`), which assumes a screen pixel is a fixed map-space offset. On a
  // ball that's only true at the center: hence a map that skewed on drag,
  // ran away near the poles, and a zoom that "moved" instead of staying
  // pinned to the cursor.
  //
  // The camera frame rebuilds on world-north, so applying the rotation
  // leaves a residual roll: repeat the operation, each pass halving the gap.
  //
  // The turn count was FIXED (8), too few away from the equator: the
  // residual roll decays more slowly the higher the latitude, amplified by
  // 1/cos(latitude). Measured at the harness at 76°: 2.88px drift with 8
  // turns, 0.16px with 40. A fixed count calibrated at the equator couldn't
  // hold elsewhere.
  //
  // Now loops on the REAL screen-pixel RESIDUAL: exactly what the promise
  // says ("the aimed point doesn't move"), and what the harness measures.
  // The turn cap is just a guard-rail. Cost is negligible: a handful of
  // vector ops, and only on user gesture — never per frame.
  // The cap was 32, and 32 still isn't enough: at 900x700, the latitude
  // sweep fails at 1.53px (threshold 1) — a defect PREDATING the grab clamp,
  // confirmed by replaying the old zoomer, which gives the same number. It
  // hadn't surfaced because the sweep had only been run at one window size,
  // where the measurement point happened to fall closer to center, where
  // convergence is fast.
  //
  // Not a divergence but SLOW convergence, measured by varying only the cap:
  // 32 → 1.53px | 64 → 0.43 | 96 → 0.16 | 128 → 0.15 | 400 → 0.15. Plateau at
  // 128. Nothing extra to pay for this: the loop exits on the real residual
  // as soon as it's met (two or three turns near the disk center), and it
  // only runs on gesture, never per frame.
  const REALIGN_TURNS = 128, REALIGN_RESIDUAL = 0.05;
  function realign(ax, ay, sx, sy) {
    const va = toSphere(ax, ay, PARAMS);
    for (let i = 0; i < REALIGN_TURNS; i++) {
      const e = toScreen3(ax, ay);
      // Point behind the ball: screen distance is meaningless, let the other
      // stop criterion decide.
      if (e[2] > 0 && Math.hypot(e[0] - sx, e[1] - sy) < REALIGN_RESIDUAL) return;
      const [bx, by] = toMap(sx, sy);
      const vb = toSphere(bx, by, PARAMS);
      // No gap: no point shaking the camera for nothing.
      if (Math.abs(vb[0] - va[0]) + Math.abs(vb[1] - va[1]) + Math.abs(vb[2] - va[2]) < 1e-9) return;
      const c = turnTowards(toSphere(state.camX, state.camY, PARAMS), vb, va);
      const p = fromSphere(c, PARAMS);
      state.camX = p[0]; state.camY = clampCamera(p[1], PARAMS);
    }
  }

  // Smoothed contours, computed ONCE at mount (a few ms): grid-edge
  // fragments are stitched into polylines then their stair-steps sanded
  // down. Without this, coasts stair-step as soon as you zoom in — the
  // partition works on a 2px grid, each cell becoming a big screen square.
  // Pass count comes from PARAMS (more passes = smoother, more points to
  // trace); regions, drawn as a thin dashed line, get by with one.
  const SMOOTHING = PARAMS.render.smoothing;
  const contours = {
    coast: mods.layout.extractContours(grid, notes, "coast", SMOOTHING.continent, PARAMS),
    // Each territory's outline: used as the ground fill.
    territories: mods.layout.extractTerritoryContours(grid, notes, SMOOTHING.country, PARAMS),
    continent: mods.layout.extractContours(grid, notes, "continent", SMOOTHING.continent, PARAMS),
    country: mods.layout.extractContours(grid, notes, "country", SMOOTHING.country, PARAMS),
    region: mods.layout.extractContours(grid, notes, "region", SMOOTHING.region, PARAMS),
  };
  const byPath = new Map(notes.map(n => [n.path, n]));

  // --- Terrain relief -----------------------------------------------------
  //
  // Shading is computed ONCE at mount, in map coordinates, then kept as an
  // image: a black layer where the slope is in shadow, light where it's lit.
  // Rendering just composites it onto the ground — no noise computed per
  // frame.
  const RELIEF = PARAMS.render.relief;
  const relief = mods.layout.reliefField(PARAMS, RELIEF.scale);
  const reliefImage = document.createElement("canvas");
  reliefImage.width = relief.width;
  reliefImage.height = relief.height;
  {
    const rctx = reliefImage.getContext("2d");
    const img = rctx.createImageData(relief.width, relief.height);
    for (let k = 0; k < relief.shade.length; k++) {
      const v = relief.shade[k];
      const clear = v > 0;
      // Cold light on lit slopes, hard black in the hollows: two tints
      // suffice, alpha does the modulation.
      //
      // Lit slopes are deliberately TWICE as subtle as the hollows: at
      // parity, light eats the continent's tint and the terrain turns marble
      // white — continent membership stops reading. Relief that carves more
      // than it lights keeps the color.
      img.data[k * 4]     = clear ? 170 : 0;
      img.data[k * 4 + 1] = clear ? 225 : 0;
      img.data[k * 4 + 2] = clear ? 245 : 8;
      img.data[k * 4 + 3] = Math.min(255, Math.abs(v) * RELIEF.strength * (clear ? 0.5 : 1) * 255);
    }
    rctx.putImageData(img, 0, 0);
  }

  // Composites shading onto the ground, following the tilt.
  //
  // Sliced by ROW BAND: under tilt, a map row is stretched horizontally by a
  // factor that only depends on its depth — so at fixed y, screen space is a
  // simple affine transform of the map. One source band per row suffices,
  // and `drawImage` handles the stretch. Flat, it's a single band for the
  // whole map.
  //
  // `source-atop`: shading only paints where ground has already been
  // painted. Without it relief would bleed onto the sea and neighboring
  // territories.
  // On the skin, shading is applied in one shot: both images cover the same
  // world, up to a scale factor. All the row-band slicing the tilted plane
  // used to need disappears — along with the stripe comb it took to fix,
  // caused by a one-pixel overlap between bands.
  function applyRelief(g) {
    g.save();
    g.globalCompositeOperation = "source-atop";
    g.globalAlpha = RELIEF.opacity;
    g.drawImage(reliefImage, 0, 0, relief.width, relief.height,
                0, 0, PARAMS.skin.width, PARAMS.skin.height);
    g.restore();
  }

  // --- Faceted TERRAIN ------------------------------------------------------
  //
  // The replacement for image wrapping. Only mounted if the module is
  // present AND the setting allows it: both paths coexist until the mesh has
  // been validated in real Obsidian, on a real machine. See `terrain.js`'s
  // header for what it brings.
  const TERRAIN = (PARAMS.render && PARAMS.render.terrain) || { active: false };
  const probe = mods.terrain && TERRAIN.active
    ? mods.layout.sampler(notes, PARAMS, PARAMS.grid.cellWorld) : null;
  const terrain = probe ? mods.terrain.createTerrain(probe, PARAMS, notes) : null;

  // The CLICKABLE ground must be the PAINTED ground. The partition grid (2px)
  // is the model's truth, but once terrain is active it's the coarser Voronoi
  // mesh the user actually sees — resolving hover/click on the grid made the
  // cursor follow an invisible edge, offset by roughly half a facet (~34px
  // aimed). Without terrain, nothing changes: falls straight through to the
  // grid exactly as before.
  function noteAtMap(mx, my) {
    if (!terrain) return mods.layout.cellUnder(grid, mx, my);
    const v = toSphere(mx, my, PARAMS);
    return terrain.paintedOwnerAt(v, canvas.width, canvas.height);
  }
  // One color per note, in `notes` order: the mesh doesn't need to know
  // statuses or the palette, it only receives triplets.
  //
  // Computed on the FIRST frame, not here: `groundColorRGB` relies on a
  // cache declared later in the file, still in the dead zone at this point
  // of mount. Calling it now fails the whole mount with a "Cannot access
  // before initialization" — seen on capture.
  let groundColors = null, seaRGB = null;
  function terrainPalette() {
    if (groundColors) return;
    groundColors = notes.map(groundColorRGB);
    const read = i => parseInt(PALETTE.bg.slice(1 + i * 2, 3 + i * 2), 16);
    seaRGB = [read(0), read(1), read(2)];
  }

  // Paints the ground by facets, directly onto the canvas.
  //
  // The WHOLE canvas isn't re-read: the zone is bounded to the globe's disk,
  // relief silhouette included. On a wide panel, empty space around the
  // globe is half the pixels — exactly the saving the old image-wrap had to
  // learn to make.
  //
  // The buffer from `getImageData` is indexed from the zone's corner: shift
  // the globe CENTER accordingly, rather than dragging an offset through
  // all of rasterization.
  function paintTerrain(g) {
    terrainPalette();
    const { forward, right, up } = frame();
    const R = radius();
    const Rmax = R * (1 + Math.max(0, TERRAIN.amplitude)) + 2;
    const cx = canvas.width / 2, cy = canvas.height / 2;
    const x0 = Math.max(0, Math.floor(cx - Rmax)), x1 = Math.min(canvas.width, Math.ceil(cx + Rmax));
    const y0 = Math.max(0, Math.floor(cy - Rmax)), y1 = Math.min(canvas.height, Math.ceil(cy + Rmax));
    const w = x1 - x0, h = y1 - y0;
    if (w <= 0 || h <= 0) return null;
    const img = g.getImageData(x0, y0, w, h);
    // `canvas.width/height`, NOT `w/h`: those are only the zone cropped to
    // the visible disk (grows/shrinks with zoom), passed here purely to
    // paint fewer pixels. Site count must be pinned to the panel's STABLE
    // size — otherwise it recomputes on every zoom regardless (user report
    // 28/07, see terrain.js).
    const info = terrain.paint(img, w, h,
                                 { forward: forward, right: right, up: up, R, cx: cx - x0, cy: cy - y0 },
                                 groundColors, seaRGB, null, canvas.width, canvas.height);
    g.putImageData(img, x0, y0);
    return info;
  }

  // Coasts and borders drawn ON SCREEN when terrain is active.
  //
  // TWO PATHS — chosen at mount, not per frame:
  //
  // (A) VORONOI EDGES (terrain.edges): the pavement's REAL edges, extracted
  //     by terrain.js. They follow the ground by construction — the whole
  //     point of the 27/07 evening rework (the old lines used to float BELOW
  //     the relief because they came from a different geography). Projected
  //     in 3D, at relief altitude, with back-face test.
  //
  // (B) GRID CONTOURS (traceMap): the old path, kept as a fallback when
  //     terrain isn't active or when `bords` returned nothing.
  //
  // Grid contours (A) [sic — these remain the (B) grid contours] stay
  // computed at mount: hover (animated outline), the land path, and ground
  // fills still read them. Do not remove.

  // Draws a batch of 3D segments (flat array [x0,y0,z0, x1,y1,z1, …]) onto the
  // 2D canvas, lifting the pen behind the ball. Projected at the relief's
  // REAL altitude (radius baked into the coordinates), using the same frame
  // as the terrain — no possible offset.
  function drawEdges3D(g, segs) {
    if (!segs || segs.length < 6) return;
    const { forward, right, up } = frame();
    const R = radius(), cx = canvas.width / 2, cy = canvas.height / 2;
    const [ax, ay, az] = forward;
    g.beginPath();
    for (let k = 0; k < segs.length; k += 6) {
      const p0x = segs[k], p0y = segs[k + 1], p0z = segs[k + 2];
      const p1x = segs[k + 3], p1y = segs[k + 4], p1z = segs[k + 5];
      // Both ends must be in front of the ball.
      if (p0x * ax + p0y * ay + p0z * az <= 0) continue;
      if (p1x * ax + p1y * ay + p1z * az <= 0) continue;
      const sx0 = cx + R * (p0x * right[0] + p0y * right[1] + p0z * right[2]);
      const sy0 = cy - R * (p0x * up[0] + p0y * up[1] + p0z * up[2]);
      const sx1 = cx + R * (p1x * right[0] + p1y * right[1] + p1z * right[2]);
      const sy1 = cy - R * (p1x * up[0] + p1y * up[1] + p1z * up[2]);
      g.moveTo(sx0, sy0);
      g.lineTo(sx1, sy1);
    }
    g.stroke();
  }

  // Per-note outlines from the LAST backdrop, or `null` if terrain isn't
  // active / nothing computed yet (falls back to grid contours). Triggers NO
  // computation: this is called by the live layer, every frame.
  function currentEdges() {
    if (!terrain || !terrain.lastEdges) return null;
    const b = terrain.lastEdges();
    return b && b.byNote ? b.byNote : null;
  }

  function screenContours(g) {
    // Path (A): Voronoi pavement edges.
    if (terrain) {
      const { forward, right, up } = frame();
      const R = radius();
      const b = terrain.edges(canvas.width, canvas.height,
                              { forward: forward, right: right, up: up, R,
                                cx: canvas.width / 2, cy: canvas.height / 2 },
                              notes);
      if (b) {
        g.save();
        g.lineJoin = "round"; g.lineCap = "round";
        g.setLineDash([]);
        // Coasts (continent + coast): one stroke with a light halo.
        g.strokeStyle = PALETTE.coast;
        g.lineWidth = 1;
        setGlow(g, 5, PALETTE.coast);
        drawEdges3D(g, b.coast);
        drawEdges3D(g, b.continent);
        g.shadowBlur = 0;
        // Countries.
        if (state.level !== "world") {
          g.strokeStyle = PALETTE.borderSecondary;
          g.lineWidth = 1;
          drawEdges3D(g, b.country);
        }
        // Regions.
        if (state.level === "country") {
          g.lineWidth = 0.6;
          g.setLineDash([3, 3]);
          drawEdges3D(g, b.region);
          g.setLineDash([]);
        }
        g.restore();
        return;
      }
    }
    // Path (B) — fallback: grid contours.
    g.save();
    g.lineJoin = "round"; g.lineCap = "round";
    g.strokeStyle = PALETTE.coast;
    g.lineWidth = 1;
    setGlow(g, 5, PALETTE.coast);
    g.setLineDash([]);
    traceMap(g, contours.continent);
    g.shadowBlur = 0;
    if (state.level !== "world") {
      g.strokeStyle = PALETTE.borderSecondary;
      traceMap(g, contours.country);
    }
    if (state.level === "country") {
      g.lineWidth = 0.6;
      g.setLineDash([3, 3]);
      traceMap(g, contours.region);
      g.setLineDash([]);
    }
    g.restore();
  }

  // Every backdrop layer receives the context `g` to paint on: the memory
  // canvas during a refresh, never the visible canvas. Two layers depend
  // ONLY on canvas size: the background and the vignette. Recomputing them
  // per frame would be two full-surface gradients for an identical result.
  // They're painted once on a memory canvas, then recopied — and discarded
  // when the canvas resizes.
  const statics = { width: 0, height: 0 };
  function cached(name, paint) {
    if (statics.width !== canvas.width || statics.height !== canvas.height) {
      statics.width = canvas.width; statics.height = canvas.height;
      statics.background = null; statics.vignette = null;
    }
    if (!statics[name]) {
      const c = document.createElement("canvas");
      c.width = canvas.width; c.height = canvas.height;
      paint(c.getContext("2d"));
      statics[name] = c;
    }
    return statics[name];
  }

  function background(g) {
    // Radial gradient: a cold halo at the center fading toward the edges,
    // giving the hologram depth rather than a flat black.
    // `bg` stays the edge color — it's the one that must stay in sync with
    // view.css (canvas background), not the center halo.
    g.drawImage(cached("background", h => {
      const cx = canvas.width / 2, cy = canvas.height / 2;
      const halo = h.createRadialGradient(cx, cy, 0, cx, cy,
                                          Math.max(canvas.width, canvas.height) * 0.72);
      halo.addColorStop(0, PALETTE.bgCenter);
      halo.addColorStop(1, PALETTE.bg);
      h.fillStyle = halo;
      h.fillRect(0, 0, canvas.width, canvas.height);
    }), 0, 0);
  }

  // Holographic grid floor, traced in MAP coordinates rather than screen.
  //
  // The whole difference from the scanline grid it replaces: that one was
  // always screen-horizontal, so the floor stayed flat even when the plane
  // tilted. Here the grid belongs to the world, so it recedes toward the
  // horizon with it — the "perspective floor" of the concept art.
  //
  // Two points suffice per line: under our projection, depth only depends on
  // y, giving sx = cx + rx·(1 + a·(sy − cy)/VC). A map line therefore stays a
  // screen LINE regardless of tilt. No need to chop it into segments.
  // GLOBE grid: meridians and parallels, like an armillary sphere. Replaces
  // the flat map's rectangular grid, meaningless once the world became
  // round.
  //
  // Drawn on screen, after wrapping, and clipped to the visible face: each
  // line is followed point by point, and the stroke breaks as soon as it
  // passes behind the ball. Without this clipping, far-side meridians would
  // fold back over the visible face and the map would become unreadable.
  //
  // The grid is drawn TWICE, deliberately: very faint everywhere, then
  // retraced a bit stronger in the globe's outer ring. The reference only
  // hints at it near the edge; uniform across the whole surface, it covered
  // the background in a regular pattern that killed depth and competed with
  // city lights. Two passes cost ~1ms and avoid inventing a per-point alpha
  // (the stroke is a single path, it only has one opacity).
  // Fraction of the disk beyond which the grid shows plainly.
  const RING = 0.55;
  function gridlines(g) {
    const Q = PARAMS.render.gridlines;
    // Adaptive step, in degrees: aim for a constant on-screen spacing. Up
    // close, a 15° step would leave only one line in frame.
    const R = radius();
    let step = 30;
    while (step > 1 && R * (step * Math.PI / 180) > Q.targetScreen * 1.8) step /= 2;
    while (step < 45 && R * (step * Math.PI / 180) < Q.targetScreen * 0.7) step *= 2;

    const L = PARAMS.skin.width, H = PARAMS.skin.height;
    const toSkin = (lat, lon) => [(lon / 360 + 0.5) * L, (0.5 - lat / 180) * H];
    // Each line is drawn as TWO paths: the near-center piece, barely
    // visible, and the outer-ring piece, stronger.
    //
    // Two paths rather than two clip-masked passes: the masked version
    // (`clip` on a ring) drove the grid cost from 1.2 to 7.5ms per camera
    // move — a mask composites the whole stroke over the whole canvas.
    // Here only the second stroke is paid for, point projection being done
    // once for both.
    const cx = canvas.width / 2, cy = canvas.height / 2;
    const trace = (points, width, alpha, glow) => {
      const paths = [new Path2D(), new Path2D()];
      const open = [false, false];
      const R = radius();
      let previous = null, prevZone = -1;
      for (const [lat, lon] of points) {
        const [x, y] = toSkin(lat, lon);
        const p = toScreen3(x, y);
        // Behind the ball: lift the pen rather than joining two points that
        // don't see each other.
        if (p[2] <= 0.01) { open[0] = false; open[1] = false; previous = null; continue; }
        const zone = Math.hypot(p[0] - cx, p[1] - cy) > R * RING ? 1 : 0;
        // On a zone change, the new path restarts from the PREVIOUS point:
        // without this one-segment overlap, a gap would appear at the seam.
        if (zone !== prevZone && previous) {
          paths[zone].moveTo(previous[0], previous[1]);
          open[zone] = true;
        }
        if (!open[zone]) { paths[zone].moveTo(p[0], p[1]); open[zone] = true; }
        else paths[zone].lineTo(p[0], p[1]);
        previous = p; prevZone = zone;
      }
      g.save();
      g.strokeStyle = PALETTE.accent;
      g.lineWidth = width;
      if (glow) setGlow(g, glow, PALETTE.accent);
      g.globalAlpha = alpha * 0.4;
      g.stroke(paths[0]);
      g.globalAlpha = alpha;
      g.stroke(paths[1]);
      g.restore();
    };

    // Only walk the slice of planet ACTUALLY in frame. Up close, the window
    // shows barely twenty degrees: following the globe's full 179 parallels
    // and 360 meridians meant projecting tens of thousands of points, almost
    // all off-screen — at a one-degree step, the grid became the second
    // biggest render expense after the globe itself.
    const camLon = (state.camX / L - 0.5) * 360, camLat = (0.5 - state.camY / H) * 180;
    const visibleRadius = Math.hypot(canvas.width, canvas.height) / 2 / R;
    const halfAngle = (visibleRadius >= 1 ? 90 : Math.asin(visibleRadius) * 180 / Math.PI) + step + 3;
    const latMin = Math.max(-90, camLat - halfAngle), latMax = Math.min(90, camLat + halfAngle);
    // Near a pole, all meridians converge in frame: there's no longitude
    // window left to cut.
    const polar = halfAngle >= 89 || Math.abs(camLat) + halfAngle >= 90;
    const lonWidth = polar ? 180
      : Math.min(180, halfAngle / Math.max(0.15, Math.cos(camLat * Math.PI / 180)));
    const inWindow = lon => {
      if (lonWidth >= 180) return true;
      let d = lon - camLon;
      while (d > 180) d -= 360;
      while (d < -180) d += 360;
      return Math.abs(d) <= lonWidth;
    };

    // Parallels. The equator is emphasized — the reference that gives the
    // globe its footing.
    const first = Math.ceil((latMin + 90) / step) * step - 90;
    for (let lat = first; lat < latMax; lat += step) {
      if (lat <= -90 || lat >= 90) continue;
      const pts = [];
      for (let lon = -180; lon <= 180; lon += 3) if (inWindow(lon)) pts.push([lat, lon]);
      if (pts.length < 2) continue;
      const major = Math.abs(lat) < 1e-9;
      trace(pts, major ? 1.4 : 0.7, major ? Q.opacity * 3 : Q.opacity, major ? 6 : 0);
    }
    // Meridians, pole to pole.
    for (let lon = -180; lon < 180; lon += step) {
      if (!inWindow(lon)) continue;
      const pts = [];
      for (let lat = Math.max(-90, latMin); lat <= latMax; lat += 3) pts.push([lat, lon]);
      if (pts.length < 2) continue;
      trace(pts, 0.7, Q.opacity, 0);
    }
  }

  // The limb and its halo: the planet's edge, underlined with a neon stroke
  // and a slightly overflowing atmosphere.
  //
  // The halo stays CONFINED to the edge. Spread toward the center, it
  // whitens the sea and the whole globe turns uniform blue-gray — defect
  // seen on capture.
  function limb(g) {
    const cx = canvas.width / 2, cy = canvas.height / 2, R = radius();
    g.save();
    const halo = g.createRadialGradient(cx, cy, R * 0.99, cx, cy, R * 1.16);
    halo.addColorStop(0, "rgba(90,200,255,0.26)");
    halo.addColorStop(1, "rgba(90,200,255,0)");
    g.fillStyle = halo;
    g.beginPath(); g.arc(cx, cy, R * 1.16, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2);
    g.strokeStyle = PALETTE.accent;
    g.lineWidth = 1.6;
    setGlow(g, 16, PALETTE.accent);
    g.stroke();
    g.restore();
  }

  // Progressively darkens the edges: frames the eye toward the center and
  // reinforces the "projection" effect. Applied to the backdrop BEFORE text,
  // so labels and the legend stay crisp on top.
  function vignette(g) {
    g.drawImage(cached("vignette", h => {
      const cx = canvas.width / 2, cy = canvas.height / 2;
      const v = h.createRadialGradient(cx, cy, Math.min(canvas.width, canvas.height) * 0.35,
                                       cx, cy, Math.max(canvas.width, canvas.height) * 0.75);
      v.addColorStop(0, "rgba(0,0,0,0)");
      v.addColorStop(1, "rgba(0,0,0,0.55)");
      h.fillStyle = v;
      h.fillRect(0, 0, canvas.width, canvas.height);
    }), 0, 0);
  }

  // Land silhouette, in screen coordinates. Rebuilt on every backdrop
  // refresh since the camera moved. Used twice in land(): it paints the dark
  // base in one shot, and above all it CUTS the tints — without it the edge
  // of the land stays the staircase of partition-grid cells, even once the
  // coastline itself is smoothed. Fill rule "evenodd": an inland sea (a loop
  // inside a loop) is carved regardless of the contours' winding order.
  // Which coordinate space to paint in.
  //
  // Layers plastered to the ground (floors, relief, coasts, borders, lights)
  // are painted ON THE SKIN, so untransformed: the skin IS the map. They get
  // wrapped onto the ball afterward.
  //
  // Layers with relief or carrying text (buildings, badges, names, cards)
  // are painted AFTER wrapping, directly on screen: plastered onto the skin
  // they'd be warped by the projection and a name would become illegible
  // near the limb.
  const ON_SKIN = (x, y) => [x, y];
  let project = ON_SKIN;

  // Map polylines → closed path, in whichever space we're painting.
  function buildPath(lines) {
    const p = new Path2D();
    for (const line of lines) {
      let first = true;
      for (const [x, y] of line) {
        const [sx, sy] = project(x, y);
        if (first) { p.moveTo(sx, sy); first = false; } else p.lineTo(sx, sy);
      }
      p.closePath();
    }
    return p;
  }
  const landPath = () => buildPath(contours.coast);

  // A note's ground color: its continent tint, ALREADY blended with the
  // background, in the proportion encoding its status (active, archived,
  // Terra). Then painted OPAQUE, which matters: cells overlap by one pixel
  // (to avoid gaps under tilt), and a semi-transparent tint would layer onto
  // itself — a glowing grid appeared over all land, more visible the more
  // you zoomed. Blend computed once per tint/opacity pair.
  const blends = new Map();
  function groundColorRGB(n) {
    const a = n.continent === mods.classify.TERRA ? OPACITY.terra
            : n.inArchive ? OPACITY.archived
            : n.status === "actif" ? OPACITY.active : OPACITY.normal;
    const c = tint(n.continent);
    const key = c + "|" + a;
    let m = blends.get(key);
    if (!m) {
      const read = (s, i) => parseInt(s.slice(1 + i * 2, 3 + i * 2), 16);
      const val = i => Math.round(read(PALETTE.bg, i) * (1 - a) + read(c, i) * a);
      m = [val(0), val(1), val(2)];
      blends.set(key, m);
    }
    return m;
  }
  function groundColor(n) {
    const [r, v, b] = groundColorRGB(n);
    return `rgb(${r},${v},${b})`;
  }

  function land(g) {
    // 1. Floors, on their own canvas, without any mask: one fill per
    // territory, traced on its smoothed outline.
    //
    // Replaces the old cell-by-cell fill: painting the grid's 126,000 cells
    // was both slow and blocky — borders between two neighbors kept their
    // stair-step even once the coast was smoothed. One fill per note is a
    // few dozen shapes instead of six digits of rectangles, and not a single
    // stair-step left anywhere.
    groundCtx.clearRect(0, 0, ground.width, ground.height);
    for (let i = 0; i < notes.length; i++) {
      const lines = contours.territories[i];
      if (!lines || !lines.length) continue;
      const p = buildPath(lines);
      groundCtx.fillStyle = groundColor(notes[i]);   // already blended with bg, so opaque
      groundCtx.fill(p, "evenodd");
      // Two neighbors don't meet pixel-perfect: each rounds its own corners,
      // leaving a dark hairline between fills. A stroke of the same color on
      // the outline closes it.
      groundCtx.strokeStyle = groundCtx.fillStyle;
      groundCtx.lineWidth = 1.2;
      groundCtx.stroke(p);
    }
    // 1b. Terrain shading, applied to the floors and ONLY the floors
    // (`source-atop`): it replaces the flat fill with slopes and valleys. It
    // comes BEFORE compositing, so it too passes through the coast cutout
    // and doesn't bleed onto the sea.
    applyRelief(groundCtx);
    // 2. Dark base then floors composited, both cut by the smoothed coast.
    // The base masks the scanline grid under land (it only stays visible on
    // the sea, like a holographic ocean) and gives a "night ground" that
    // makes city lights pop.
    const cut = landPath();
    g.save();
    g.globalAlpha = OPACITY.base;
    g.fillStyle = PALETTE.bg;
    g.fill(cut, "evenodd");
    g.globalAlpha = 1;
    g.clip(cut, "evenodd");
    g.drawImage(ground, 0, 0);
    g.restore();
  }

  // Light seeding, computed ONCE at mount (see layout.seedLights), then
  // converted to DIRECTIONS on the ball, once and for all.
  //
  // The direction is essential: lights are painted after wrapping, on
  // screen, and caching it avoids redoing two trig functions per point on
  // every camera move — there are a few thousand. Projecting then only costs
  // dot products.
  // The canvas exists here (we're inside mount): the seeding confirms against
  // the mesh ACTUALLY painted, not three guessed sizes. See layout.js §
  // "Confirmation against the terrain mesh".
  const lightSeeds = mods.layout.seedLights(grid, notes, PARAMS, mods.terrain,
                                            { width: canvas.width, height: canvas.height })
    .map(pack => pack.map(([x, y, warm, shine]) =>
      ({ v: toSphere(x, y, PARAMS), warm, shine })));

  // City lights: a tight CLUSTER of points per note, placed on its
  // territory. This is what gives the "seen from orbit at night" grain of
  // the reference.
  //
  // What changed, and why: there used to be only one point per note, so
  // about sixty fireflies scattered across the whole planet, sitting on a
  // flat tint. The texture that reads a territory as inhabited wasn't there
  // at all — the biggest remaining appearance gap.
  //
  // Two measured cost rules: no per-point glow (`shadowBlur`) — a halo per
  // light is a thousand blurs per repaint — and a one-pixel square rather
  // than a circle, avoiding a path trace per point. Glow is paid ONCE per
  // note, as an urban halo.
  //
  // Terra Incognita stays dark: no attachment, no city. Gold dominates,
  // cold white punctuates: the reference's reading (cities seen at night),
  // not a neon-lit political map.
  const WARM = "#ffb45f", WARM_BRIGHT = "#ffd28a", COOL = "#dff6ff";
  //
  // Painted ON SCREEN, after wrapping, not on the skin like floors.
  // Counter-intuitive — a light does sit on the ground — but the skin has a
  // FIXED resolution: at country level it's magnified tenfold, and each
  // point became a big blurry twenty-pixel square (seen on capture). A
  // light is a point, not a terrain texture: it must keep its on-screen
  // size regardless of zoom, like buildings and badges.
  function lights(g) {
    g.save();
    // 1. The urban halo: one soft blotch per note, that sets the city onto
    // the ground. It's what gives the glow, the points themselves only add
    // grain. Its size follows zoom (a close-up city takes more room), but
    // stays bounded so it doesn't flood the screen at max zoom.
    const scale = Math.min(3, Math.max(0.8, state.zoom * 0.9));
    for (let i = 0; i < notes.length; i++) {
      const n = notes[i];
      if (n.continent === mods.classify.TERRA) continue;
      const [sx, sy, depth] = toScreen3(n.x, n.y);
      if (depth <= 0.02) continue;                      // far side
      if (sx < 0 || sy < 0 || sx > canvas.width || sy > canvas.height) continue;
      const active = n.status === "actif";
      const glowRadius = (5 + Math.min(16, (n.weight || 1) * 5)) * scale;
      const halo = g.createRadialGradient(sx, sy, 0, sx, sy, glowRadius);
      halo.addColorStop(0, active ? "rgba(255,190,110,0.30)" : "rgba(190,235,255,0.18)");
      halo.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = halo;
      g.fillRect(sx - glowRadius, sy - glowRadius, glowRadius * 2, glowRadius * 2);
    }
    // 2. The grain: the lights themselves. An active note pulls toward warm
    // gold, a dormant one toward cold white — status reads in the color of
    // its windows.
    //
    // No per-point glow (`shadowBlur`) and a square rather than a circle: a
    // halo and a path trace per light is a few thousand blurs per repaint.
    // Glow is paid once per note, above.
    for (let i = 0; i < notes.length; i++) {
      const n = notes[i];
      if (n.continent === mods.classify.TERRA) continue;
      const active = n.status === "actif";
      const pale = n.inArchive;
      for (const l of lightSeeds[i]) {
        const p = toScreenPoint(l.v);
        if (p[2] <= 0.02) continue;                    // behind the ball
        if (p[0] < 0 || p[1] < 0 || p[0] > canvas.width || p[1] > canvas.height) continue;
        // Fade toward the limb (`p[2]`, the toward-the-eye component) is
        // what gives the ball its VOLUME: painted on screen, lights escape
        // the wrap's spherical shading, and without this an edge city would
        // shine as bright as a face-on one — the planet would flatten into
        // a sticker.
        g.globalAlpha = (pale ? 0.4 : 1) * (0.55 + 0.45 * l.shine) * (0.35 + 0.65 * p[2]);
        g.fillStyle = !l.warm ? COOL : (active ? WARM_BRIGHT : WARM);
        // The brightest ones are two pixels: without this handful of bigger
        // dots, the city becomes a uniform haze instead of a scatter.
        const t = (l.shine > 0.86 ? 2.2 : 1.3) * (state.level === "world" ? 1 : 1.6);
        // A warm puddle under the brightest golden lights. Without it, a
        // pixel-and-a-half dot reads WHITE regardless of its color — the
        // reference's golden cast didn't come through at all, even though
        // the color was right in the code. The puddle, wider, covers enough
        // area to tint.
        if (l.warm && l.shine > 0.66) {
          const alpha = g.globalAlpha;
          g.globalAlpha = alpha * 0.3;
          g.fillRect(p[0] - t * 1.5, p[1] - t * 1.5, t * 3, t * 3);
          g.globalAlpha = alpha;
        }
        g.fillRect(p[0] - t / 2, p[1] - t / 2, t, t);
      }
    }
    g.restore();
  }

  // A building bar rising from the ground (baseY) upward, with a bright rim
  // at the top — the "night skyscraper" grain.
  //
  // User feedback: "can't they be 3D?" — the core of the "ugly" report: the
  // ground has been tilted and projected onto a ball for a while, but
  // buildings stayed flat rectangles sitting on it. Each tower is now a BOX:
  // front face, side, roof.
  //
  // Volume comes from a constant screen-space offset (`dx`, `dy`), not a
  // real projection: the camera looks nearly straight down (tilt 0.14), so
  // every tower in a city shares almost the same vanishing direction. A
  // per-vertex projection would cost eight transformed points per building,
  // up to 1500 buildings per redraw, for an invisible gain.
  //
  // The three faces read by LIGHT, not by three different colors: bright
  // roof (catches the sky), front face at the note's color, side face
  // recessed (less alpha on a dark background = darker, and avoids
  // computing a darkened tint per building). The base stays black to plant
  // the tower on the ground.
  // `shade` (0..1) darkens back-row buildings.
  const DEPTH = 0.62;               // apparent depth, in width units
  function buildingBar(g, x, baseY, w, h, color, shade) {
    const k = shade === undefined ? 1 : shade;
    const left = x - w / 2, right = x + w / 2, roof = baseY - h;
    const p = Math.max(1, w * DEPTH);
    const dx = p * 0.62, dy = -p * 0.5;  // vanishing toward the back: up-right
    // Right side: the face that gives the volume.
    g.fillStyle = color; g.globalAlpha = 0.42 * k;
    g.beginPath();
    g.moveTo(right, roof); g.lineTo(right + dx, roof + dy);
    g.lineTo(right + dx, baseY + dy); g.lineTo(right, baseY);
    g.closePath(); g.fill();
    // Front face: black foot, note-colored body.
    g.fillStyle = "#031018"; g.globalAlpha = 0.85 * k;
    g.fillRect(left, baseY - h * 0.45, w, h * 0.45);
    g.fillStyle = color; g.globalAlpha = 0.92 * k;
    g.fillRect(left, roof, w, h * 0.6);
    // Roof: the brightest, replacing the old white edge line.
    g.fillStyle = "#eaffff"; g.globalAlpha = 0.85 * k;
    g.beginPath();
    g.moveTo(left, roof); g.lineTo(left + dx, roof + dy);
    g.lineTo(right + dx, roof + dy); g.lineTo(right, roof);
    g.closePath(); g.fill();
  }

  // A note's city, computed once then cached. The rule lives in `cityShape`
  // (module-level, testable); here we just seed the draw from the note's
  // path and cache the result.
  const cityCache = new Map();
  function cityOf(n) {
    let g = cityCache.get(n.path);
    if (g) return g;
    g = cityShape(n, PARAMS, mods.layout.random(mods.layout.hash(n.path)));
    cityCache.set(n.path, g);
    return g;
  }

  // A note's silhouette: its city, plus its type accent.
  //
  // User feedback: "not visible enough" and "ugly". Both traced to the same
  // drawing — identical bars, aligned, no ground, sitting on a bruised blue
  // relief that swallowed them. Three changes:
  //   - a dark BASE under the city, detaching it from the terrain (this does
  //     more for visibility than a brighter glow);
  //   - two ROWS, the back one darkened and raised, giving volume;
  //   - uneven widths and a base darker than the top, so it reads as a
  //     skyline, not a barcode.
  function silhouette(g, x, y, u, h, gr, color, force) {
    const spread = u * gr.width;
    const wBase = Math.max(1.2, u * 0.155);
    if (gr.type === "tent") { // idea: a simple tent, not a city
      setGlow(g, 6, color);
      g.fillStyle = color; g.globalAlpha = 0.9;
      g.beginPath(); g.moveTo(x, y - h * 0.75); g.lineTo(x - u * 0.5, y); g.lineTo(x + u * 0.5, y);
      g.closePath(); g.fill();
      g.globalAlpha = 1; g.shadowBlur = 0; return;
    }
    // Base: a dark puddle, then a glow in the note's color. Without it the
    // city blends into the relief; with it, it sits on top of it.
    const rs = spread * 1.25 + u * 0.35;
    g.shadowBlur = 0;
    g.globalAlpha = 0.55;
    g.fillStyle = "#02060c";
    g.beginPath(); g.ellipse(x, y, rs, Math.max(2, u * 0.3), 0, 0, Math.PI * 2); g.fill();
    const glow = g.createRadialGradient(x, y - h * 0.15, 0, x, y - h * 0.15, rs * 1.5);
    glow.addColorStop(0, color); glow.addColorStop(1, "rgba(0,0,0,0)");
    g.globalAlpha = 0.22 * force;
    g.fillStyle = glow;
    g.fillRect(x - rs * 1.5, y - h * 1.4, rs * 3, h * 1.4 + rs * 0.8);
    g.globalAlpha = 1;

    // Background first (otherwise it covers the foreground), darkened and
    // raised a notch: that offset is what reads as depth.
    setGlow(g, 5, color);
    for (const rank of [1, 0])
      for (const t of gr.towers) {
        if (t.rank !== rank) continue;
        const back = rank ? u * 0.22 : 0;
        buildingBar(g, x + t.d * spread * (rank ? 0.86 : 1), y - back,
              wBase * t.wf, h * t.hf * (rank ? 0.88 : 1), color, rank ? 0.45 : 1);
      }
    if (gr.type === "lighthouse") { // orange beacon atop the tower
      g.fillStyle = PALETTE.alert; setGlow(g, 10, PALETTE.alert);
      g.beginPath(); g.arc(x, y - h * 1.9, Math.max(1.4, wBase * 1.1), 0, Math.PI * 2); g.fill();
    } else if (gr.type === "embassy") { // pale dome on the building
      g.fillStyle = "#eaffff"; setGlow(g, 8, "#eaffff");
      g.beginPath(); g.arc(x, y - h * 0.6, Math.max(2, u * 0.28), Math.PI, 0); g.fill();
    } else if (gr.type === "construction") { // crane arm above the tall stem
      const cx = x + gr.towers[gr.towers.length - 1].d * spread;
      g.strokeStyle = PALETTE.alert; g.globalAlpha = 0.85; g.lineWidth = 1;
      g.beginPath(); g.moveTo(cx, y - h * 1.35); g.lineTo(cx + u * 0.55, y - h * 1.55); g.stroke();
    }
    g.globalAlpha = 1; g.shadowBlur = 0;
  }

  // Level of detail by zoom: at world level only lights show; diving in,
  // each note grows into a building whose shape follows its type. LOD, but
  // PROGRESSIVE: stems rise from the ground instead of popping in all at
  // once at the threshold. Height is multiplied by `growBuildings`, which is
  // 0 slightly before the threshold and 1 slightly after; during a dive,
  // where zoom slides frame by frame, the city visibly grows.
  function buildings(g) {
    const grow = growBuildings(state.zoom, PARAMS);
    if (grow <= 0.01) return;
    g.save();
    // Building size grows with zoom: sketched at continent level, tall and
    // crisp at country level.
    const u = cityUnit(state.zoom);
    // Footprint grows slower than height: a stem widening as fast as it
    // rises reads as a zoom on the image, not as construction.
    const ue = u * (0.55 + 0.45 * grow);
    for (const n of notes) {
      if (n.continent === mods.classify.TERRA) continue;
      const [sx, sy, depth] = toScreen3(n.x, n.y);
      // Nothing behind the ball should appear in front of it.
      if (depth <= 0.05) continue;
      if (sx < -60 || sy < -120 || sx > canvas.width + 60 || sy > canvas.height) continue;
      const color = n.status === "actif" ? PALETTE.alert : tint(n.continent);
      const h = cityHeight(n, u) * grow;
      // …and so does brightness: a central note should read from afar, an
      // archived one should stay recessed.
      const force = Math.min(1.6, 0.55 + (n.weight || 1) * 0.45) * (n.inArchive ? 0.5 : 1);
      silhouette(g, sx, sy, ue, h, cityOf(n), color, force);
    }
    g.restore();
  }

  // Skill badges: at country level, a pill label above each note shows its
  // first tag (or its type failing that), like the "Python / Neural
  // Networks" badges in the video.
  // Note NAMES, without having to hover them.
  //
  // User feedback: "have to zoom too much to see the names". True, and
  // worse — no label had EVER carried a note's name. The only per-note
  // labels were the badges below, showing a tag and only appearing at max
  // zoom; everything else is a GROUP name (continent, country, city).
  //
  // They now appear one notch earlier, from "continent" level on. At "world"
  // level we stick to continents: 58 names on a whole globe don't read,
  // they overlap.
  //
  // Space is contested, so there needs to be an arbitration rule: the note's
  // WEIGHT, not its distance to the camera — the map has always encoded
  // importance through size, now it also encodes it through the right to
  // carry its name. Lighter notes get theirs back on zooming in — space
  // frees up on its own.
  function noteNames(g) {
    if (state.level === "world") return;
    g.save();
    g.font = font(11);
    g.textAlign = "center";
    const free = placer();
    const seen = notes.filter(n => n.continent !== mods.classify.TERRA)
                     .map(n => ({ n, p: toScreen3(n.x, n.y) }))
                     .filter(o => o.p[2] > 0.10)
                     .sort((a, b) => (b.n.weight || 0) - (a.n.weight || 0));
    for (const { n, p } of seen) {
      const [sx, sy] = p;
      if (sx < 0 || sy < 0 || sx > canvas.width || sy > canvas.height) continue;
      const txt = noteName(n);
      if (!txt) continue;
      // Seen on capture at country level: the name came out DOUBLED, once
      // here and once twenty pixels above. At this level, the group key is
      // "city or note name" — so for a note that names its own city, or has
      // none, the group label is already its own name. Don't rewrite what's
      // already written.
      if (groupKey(n) === txt) continue;
      const w = g.measureText(txt).width + toPx(10), h = toPx(14);
      // Below the note: the top is already taken by tag badges, and a
      // building rises upward.
      const bx = sx - w / 2, by = sy + toPx(8);
      if (!free(bx, by, w, h)) continue;
      g.globalAlpha = 0.86; g.fillStyle = "rgba(4,16,22,0.9)";
      g.fillRect(bx, by, w, h);
      g.globalAlpha = 1;
      g.fillStyle = PALETTE.text;
      setGlow(g, 6, PALETTE.accent);
      g.fillText(txt, sx, by + toPx(10.5));
    }
    g.restore();
  }

  function badges(g) {
    if (state.level !== "country") return;
    g.save();
    g.font = font(10); g.textAlign = "center";
    const free = placer();
    // Nearest to farthest: under tilt, the foreground must win the space,
    // not the background bunched on the horizon.
    const seen = notes.filter(n => n.continent !== mods.classify.TERRA)
                     .map(n => ({ n, p: toScreen3(n.x, n.y) }))
                     .filter(o => o.p[2] > 0.08)          // far side excluded
                     .sort((a, b) => b.p[2] - a.p[2]);    // nearest keeps the spot
    for (const { n, p } of seen) {
      const [sx, sy] = p;
      if (sx < 0 || sy < 0 || sx > canvas.width || sy > canvas.height) continue;
      const txt = (n.tags && n.tags.length ? n.tags[0] : n.type) || "";
      if (!txt) continue;
      const w = g.measureText(txt).width + toPx(12), h = toPx(15);
      // The vertical offset stays in screen pixels, NOT scaled with text: it
      // must clear the city, whose height is set by zoom, not letter size.
      const bx = sx - w / 2, by = sy - 54 - (h - 15);
      if (!free(bx, by, w, h)) continue;
      g.globalAlpha = 0.9; g.fillStyle = "rgba(4,16,22,0.92)";
      g.fillRect(bx, by, w, h);
      g.globalAlpha = 1; g.strokeStyle = PALETTE.accent; g.lineWidth = 0.8;
      g.strokeRect(bx, by, w, h);
      g.fillStyle = PALETTE.text;
      g.fillText(txt, sx, by + toPx(11));
    }
    g.restore();
  }

  // Network view (like the end of the video): at max zoom, the note under
  // the camera becomes the core of a graph of its linked notes. Fades in
  // progressively from the threshold.
  //
  // It's LOCAL: the graph lands on the note, at its map position, and only
  // darkens its neighborhood. The first version blackened the whole window
  // and planted the star at the center — you'd lose track of where you were,
  // and the map, the actual subject, disappeared.
  const NETWORK_THRESHOLD = () => PARAMS.zoom.countryThreshold * 1.6;
  // Registry index for the core (focused) card, distinct from both a
  // neighbor's loop index (0, 1, 2…) and `anim.hoverCard`'s "nothing hovered"
  // sentinel (-1).
  const CORE_CARD_I = -2;

  // Network-view strength (0 = not yet, 1 = full). Kept apart from drawing
  // because the BACKDROP needs it — it tells the network strokes to fade
  // under the cards — while the drawing itself is animated and lives in the
  // live layer. Without this split, cards would have to be drawn in the
  // backdrop for links to know how to fade, losing any chance of animating
  // the unfold.
  function networkIntensity() {
    const threshold = NETWORK_THRESHOLD();
    if (state.zoom < threshold) return 0;
    return Math.min(1, (state.zoom - threshold) / (PARAMS.zoom.max - threshold));
  }

  // The graph's core note: the closest to the camera center (we've dived
  // onto it). This is what makes point 18 nearly free — clicking a neighbor
  // card just AIMS at that note, and the core switches on its own as the
  // camera arrives, sliding instead of jumping.
  function centerNote() {
    let focus = null, best = Infinity;
    for (const n of notes) {
      if (n.continent === mods.classify.TERRA) continue;
      const dx = n.x - state.camX, dy = n.y - state.camY, d = dx * dx + dy * dy;
      if (d < best) { best = d; focus = n; }
    }
    return focus;
  }

  function network(g, t) {
    const a = networkIntensity();
    anim.network.cards = [];
    if (a <= 0.01) { anim.network.focus = null; return; }
    const focus = centerNote();
    if (!focus) { anim.network.focus = null; return; }
    // Core change (arriving on a new note) = new unfold.
    if (anim.network.focus !== focus.path) { anim.network.focus = focus.path; anim.network.t0 = t; }
    const F = LIVE.cards;
    const neighbors = (focus.links || []).map(l => byPath.get(l)).filter(Boolean);
    // Two alternating radii: at a single radius, (wide) cards on a circle
    // overlap as soon as there are more than six neighbors, and the placer
    // would refuse half of them.
    const R = Math.min(canvas.width, canvas.height) * 0.24;
    const [ancX, ancY] = toScreen(focus.x, focus.y);
    const [cx, cy] = anchorNetwork(ancX, ancY, R * 1.45 + 72, R + 32,
                                  canvas.width, canvas.height);
    g.save();
    // LOCAL darkening: a radial halo around the core, that sets the cards on
    // a calm backdrop without erasing the map around it.
    const halo = g.createRadialGradient(cx, cy, R * 0.2, cx, cy, R * 2.1);
    halo.addColorStop(0, PALETTE.bg);
    halo.addColorStop(1, "rgba(0,0,0,0)");
    g.globalAlpha = Math.min(0.9, a * 1.2);
    g.fillStyle = halo;
    g.fillRect(0, 0, canvas.width, canvas.height);
    // Neighbors keep their geographic ORDER around the note (who's
    // northeast, who's southwest), but are spread at a constant angular
    // step: placing them at their exact bearing crammed three into the same
    // sector, which the placer then refused — losing two neighbors out of
    // five. The overall rotation is the one that best matches the real
    // bearings (circular mean of the offsets), so the graph stays oriented
    // like the map.
    neighbors.sort((u, v) => Math.atan2(u.y - focus.y, u.x - focus.x)
                         - Math.atan2(v.y - focus.y, v.x - focus.x));
    const step = 2 * Math.PI / Math.max(1, neighbors.length);
    let sx = 0, sy = 0;
    neighbors.forEach((v, i) => {
      const e = Math.atan2(v.y - focus.y, v.x - focus.x) - i * step;
      sx += Math.cos(e); sy += Math.sin(e);
    });
    const align = (sx || sy) ? Math.atan2(sy, sx) : -Math.PI / 2;
    // Wide ellipse, and only HEIGHT alternates row to row. Alternating width
    // too pulled every other card against the core: the closest one at the
    // horizontal covered it and got refused (one neighbor in five lost, seen
    // on capture). The alternation stays mild (0.78) for the same reason: at
    // 0.62, a diagonal card bit into the core's corner.
    const position = i => [cx + Math.cos(align + i * step) * R * 1.45,
                      cy + Math.sin(align + i * step) * R * (i % 2 ? 0.78 : 1)];
    // A card: dark translucent cardboard, light rim, title and two faded
    // text lines. The concept-art reading — a graph node is a document, not
    // a dot.
    // Scaled with text too: a card is a cardboard FULL of text (title + two
    // lines). Enlarging letters without the card would overflow it, and
    // leaving it fixed on a big panel would give tiny cards where there's
    // the most room.
    const CARD = { w: toPx(132), h: toPx(50), wFocus: toPx(158), hFocus: toPx(58) };
    const truncate = (txt, max) => {
      if (g.measureText(txt).width <= max) return txt;
      let t = txt;
      while (t.length > 1 && g.measureText(t + "…").width > max) t = t.slice(0, -1);
      return t + "…";
    };
    // `k`: unfold progress (0 = collapsed to its point, 1 = open). Scaling
    // happens around the card's CENTER, not its corner: otherwise it slides
    // diagonally instead of opening in place.
    // `hot`: card under the cursor — it gets relief, the others dim (the
    // caller lowers their opacity).
    function card(x, y, n, focus, k, hot) {
      const w = focus ? CARD.wFocus : CARD.w, h = focus ? CARD.hFocus : CARD.h;
      const bx = x - w / 2, by = y - h / 2;
      const color = focus ? PALETTE.alert : PALETTE.accent;
      g.save();
      if (k < 1) { g.translate(x, y); g.scale(k, k); g.translate(-x, -y); }
      g.shadowBlur = hot ? 22 : (focus ? 16 : 8); g.shadowColor = color;
      g.fillStyle = hot ? "rgba(10,32,42,0.97)" : "rgba(6,20,28,0.94)";
      g.fillRect(bx, by, w, h);
      g.shadowBlur = 0;
      g.strokeStyle = color; g.lineWidth = hot ? 1.8 : (focus ? 1.4 : 0.9);
      g.strokeRect(bx, by, w, h);
      // Header band: gives the card its document silhouette.
      g.fillStyle = color; g.globalAlpha = a * (hot ? 0.38 : 0.22);
      g.fillRect(bx, by, w, toPx(15));
      g.globalAlpha = a;
      g.textAlign = "left";
      g.font = font(11, focus ? "bold" : "");
      g.fillStyle = PALETTE.text;
      g.fillText(truncate(n.name || n.path, w - toPx(12)), bx + toPx(6), by + toPx(11));
      // Two faded lines: the note's address, then its type and first tag.
      // Real content, not decorative filler.
      g.font = font(9);
      g.globalAlpha = a * 0.55;
      const lines = [`${n.country || "—"} › ${n.region || "—"}`,
                      `${n.type || "note"}${n.tags && n.tags.length ? " · " + n.tags[0] : ""}`];
      lines.forEach((l, j) => g.fillText(truncate(l, w - toPx(12)), bx + toPx(6), by + toPx(28 + j * 12)));
      // Link count on the CORE: how many notes leave from here. As a pill
      // in the corner, it's the graph's only numeric readout.
      if (focus) {
        const nb = String((focus.links || []).length);
        g.globalAlpha = a;
        g.font = font(10, "bold"); g.textAlign = "center";
        g.fillStyle = PALETTE.alert;
        g.beginPath(); g.arc(bx + w - toPx(11), by + h - toPx(11), toPx(8.5), 0, Math.PI * 2); g.fill();
        g.fillStyle = "#06141c";
        g.fillText(nb, bx + w - toPx(11), by + h - toPx(7.5));
        g.textAlign = "left";
      }
      g.globalAlpha = a;
      g.restore();
      return { bx, by, w, h };
    }
    // The core first: it must keep its center spot no matter what.
    const free = placer();
    free(cx - CARD.wFocus / 2 - 6, cy - CARD.hFocus / 2 - 6, CARD.wFocus + 12, CARD.hFocus + 12);
    const kept = [];
    for (let i = 0; i < neighbors.length; i++) {
      const [x, y] = position(i);
      // 6px margin around each card: two cards grazing each other are as
      // unreadable as two overlapping.
      if (!free(x - CARD.w / 2 - 6, y - CARD.h / 2 - 6, CARD.w + 12, CARD.h + 12)) continue;
      kept.push({ v: neighbors[i], x, y });
    }
    // FAN unfold: each card starts a notch after the previous one
    // (`stagger`). All at once, it would just read as a fade; staggered, you
    // see the graph build, which hints at reading order.
    const start = i => anim.network.t0 + i * F.stagger;
    // Line first (it must reach the card before it opens), card next: the
    // line has its own start, and the card its own, offset by the line's
    // duration.
    const lineProgress = i => ease(progress(t, start(i), F.line));
    const cardProgress = i => ease(progress(t, start(i) + F.line * 0.6, F.unfold));

    // Orange edges, drawn before the cards so they pass underneath. They
    // DRAW OUT from the core: the line is only stroked up to the fraction
    // already covered, giving a reading direction (core to neighbors)
    // instead of a network appearing all at once.
    g.globalAlpha = a;
    g.strokeStyle = PALETTE.alert; g.lineWidth = 1.3;
    g.shadowBlur = 6; g.shadowColor = PALETTE.alert;
    kept.forEach(({ x, y }, i) => {
      const p = lineProgress(i);
      if (p <= 0.001) return;
      g.beginPath(); g.moveTo(cx, cy);
      g.lineTo(cx + (x - cx) * p, cy + (y - cy) * p);
      g.stroke();
    });
    // The cards, and along the way, recording their boxes: this registry is
    // what hover and click query. It only keeps cards open enough to be
    // clickable — targeting a half-unfolded card would give a target moving
    // under the cursor.
    kept.forEach(({ v, x, y }, i) => {
      const k = cardProgress(i);
      if (k <= 0.001) return;
      const hot = anim.hoverCard === i;
      // A card dims when another is hovered: it's the contrast that makes
      // the targeted one pop, not just its own brightness.
      g.globalAlpha = anim.hoverCard >= 0 && !hot ? a * 0.45 : a;
      const b = card(x, y, v, false, k, hot);
      g.globalAlpha = a;
      if (k > 0.85) anim.network.cards.push({ ...b, note: v, i });
    });
    // The core card must be pushed into the SAME registry as its neighbors,
    // the same way (open enough to be clickable, k > 0.85): it used to be
    // drawn without ever being recorded, so a click inside its own visible
    // edges found nothing there and fell through to whatever note sits on
    // the map underneath it. Hover-dim styling is untouched on purpose — the
    // `hot` argument stays `false`, exactly as before this fix; that's a
    // separate visual concern, not what was reported broken.
    const coreK = ease(progress(t, anim.network.t0, F.unfold));
    const coreBox = card(cx, cy, focus, true, coreK, false);
    if (coreK > 0.85) anim.network.cards.push({ ...coreBox, note: focus, i: CORE_CARD_I });
    g.restore();
  }

  // =========================================================================
  // THE LIVE LAYER
  // =========================================================================
  //
  // Everything that moves while the camera doesn't. Painted on the VISIBLE
  // canvas, after the backdrop is copied over, and never into the backdrop
  // itself: that's the rule that keeps a still map at ~0.1 ms per frame.
  //
  // Each function below is a point on the list validated on 25/07; the
  // number in brackets refers to that list (implementation log).

  // Screen-space MAP polylines, pen lifted behind the ball. Without this
  // clipping, a far-side territory's outline would fold back over the
  // visible face.
  function traceMap(g, lines) {
    g.beginPath();
    for (const line of lines) {
      let open = false;
      for (const [x, y] of line) {
        const p = toScreen3(x, y);
        if (p[2] <= 0.02) { open = false; continue; }
        if (!open) { g.moveTo(p[0], p[1]); open = true; } else g.lineTo(p[0], p[1]);
      }
    }
    g.stroke();
  }

  // Advances the animation state by one frame. Kept separate from drawing:
  // values must progress with ELAPSED TIME, not frame count — otherwise
  // hover would be twice as jumpy on a 120 Hz screen.
  function advanceAnim(t) {
    if (!anim.started) { anim.started = true; anim.mountTime = t; anim.t = t; }
    anim.dt = Math.min(100, t - anim.t);   // clamped: a backgrounded tab
    anim.t = t;                            // would otherwise give multi-second gaps
    const S = LIVE.hover;
    // Two tracks: the note lighting up, the one fading out.
    if (anim.entering.i !== state.hover) {
      anim.leaving = { i: anim.entering.i, k: anim.entering.k };
      anim.entering = { i: state.hover, k: 0 };
      anim.tick = t;
    }
    anim.entering.k = approach(anim.entering.k, anim.entering.i >= 0 ? 1 : 0, anim.dt, S.rise);
    anim.leaving.k = approach(anim.leaving.k, 0, anim.dt, S.rise);
  }

  // [5] Opening sweep: a bright band crosses the map once, when the panel
  // appears. It never repeats — it's an entrance, and an entrance that loops
  // becomes a beacon.
  function scan(g, t) {
    const S = LIVE.scan;
    const p = progress(t, anim.mountTime, S.duration);
    if (p >= 1) return;
    const wide = canvas.width * S.width;
    const x = -wide + p * (canvas.width + 2 * wide);
    const d = g.createLinearGradient(x - wide, 0, x + wide, 0);
    d.addColorStop(0, "rgba(79,240,208,0)");
    d.addColorStop(0.5, `rgba(79,240,208,${(S.opacity * (1 - p * 0.4)).toFixed(3)})`);
    d.addColorStop(1, "rgba(79,240,208,0)");
    g.save();
    g.globalCompositeOperation = "lighter";
    g.fillStyle = d;
    g.fillRect(x - wide, 0, wide * 2, canvas.height);
    g.restore();
  }

  // [4] Central reticle, purely decorative: it gives the image the look of a
  // targeting instrument. Deliberately subtle by construction — it must not
  // point at anything.
  function reticle(g) {
    const R = LIVE.reticle, cx = canvas.width / 2, cy = canvas.height / 2;
    g.save();
    g.strokeStyle = PALETTE.accent;
    g.globalAlpha = R.opacity;
    g.lineWidth = 1;
    g.beginPath();
    g.arc(cx, cy, R.radius, 0, Math.PI * 2);
    g.moveTo(cx - R.radius * 1.9, cy); g.lineTo(cx - R.radius * 0.55, cy);
    g.moveTo(cx + R.radius * 0.55, cy); g.lineTo(cx + R.radius * 1.9, cy);
    g.moveTo(cx, cy - R.radius * 1.9); g.lineTo(cx, cy - R.radius * 0.55);
    g.moveTo(cx, cy + R.radius * 0.55); g.lineTo(cx, cy + R.radius * 1.9);
    g.stroke();
    g.restore();
  }

  // [1] City breathing and [21] rising particles.
  //
  // A single pass for both: they walk the same notes and project to the same
  // spot. The pulsing halo is added ON TOP of the backdrop's own (additive
  // compositing) — the city isn't repainted, it's made to breathe. The light
  // points themselves are left untouched: there are twenty-five hundred of
  // them, and redoing them every frame would cost more than the rest of the
  // layer combined.
  function liveCities(g, t) {
    const P = LIVE.pulse, Q = LIVE.particles;
    g.save();
    g.globalCompositeOperation = "lighter";
    const scale = Math.min(3, Math.max(0.8, state.zoom * 0.9));
    for (const n of notes) {
      if (n.continent === mods.classify.TERRA) continue;
      const [sx, sy, depth] = toScreen3(n.x, n.y);
      if (depth <= 0.05) continue;
      if (sx < -40 || sy < -40 || sx > canvas.width + 40 || sy > canvas.height + 40) continue;
      const ph = phase(n.path);
      // Breathing: a half sine beat, never negative — a city dimming below
      // its resting glow would read as flickering.
      const beat = 0.5 + 0.5 * Math.sin(2 * Math.PI * (t / P.period + ph * P.dispersion));
      const r = (5 + Math.min(16, (n.weight || 1) * 5)) * scale;
      const halo = g.createRadialGradient(sx, sy, 0, sx, sy, r);
      const active = n.status === "actif";
      const alpha = P.amplitude * beat * (0.35 + 0.65 * depth) * (n.inArchive ? 0.35 : 1);
      halo.addColorStop(0, active ? `rgba(255,190,110,${(alpha * 0.5).toFixed(3)})`
                                 : `rgba(150,215,255,${(alpha * 0.3).toFixed(3)})`);
      halo.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = halo;
      g.fillRect(sx - r, sy - r, r * 2, r * 2);
      // [21] Particles: reserved for ACTIVE notes. That's their only role —
      // telling what's alive from what's dormant at a glance, without reading
      // a word.
      if (!active || n.inArchive) continue;
      // Start ABOVE the ROOFS, not at ground level: buildings are painted in
      // the backdrop, so they're always in front of the live layer — a
      // particle starting from the ground would spend half its run hidden
      // behind them. So it's pinned to that note's city height, not to a
      // pixel count: otherwise it crawls at the foot of big cities and floats
      // in midair above small ones.
      const hv = cityHeight(n, cityUnit(state.zoom));
      const low = (Q.start !== undefined ? Q.start : 0.9) * hv;
      const rise = (Q.heightShare !== undefined ? Q.heightShare : 0.8) * hv;
      const size = (Q.size || 1.6) * (0.6 + 0.4 * scale / 3);
      const trail = Q.trail || 0;
      for (let k = 0; k < Q.count; k++) {
        const u = ((t / Q.period + ph + k / Q.count) % 1 + 1) % 1;
        const h = low + u * rise;
        // Fades at both ends: the particle is born from the ground and dies
        // out as it rises.
        const av = Math.sin(Math.PI * u) * Q.opacity * (0.35 + 0.65 * depth);
        g.globalAlpha = av;
        const d = size * (1 - u * 0.45);
        // Deterministic lateral drift: three perfectly vertical streaks would
        // read as a display glitch.
        const dx = sx + Math.sin(u * 4 + ph * 6) * 2.5;
        // Short trail under the particle: at this size, a lone dot reads as
        // sensor dust; a streak reads as an ascent.
        if (trail > 0) {
          g.globalAlpha = av * 0.35;
          g.fillStyle = "#ff9d3c";
          g.fillRect(dx - d * 0.3, sy - h + d / 2, d * 0.6, trail * scale * 0.5);
        }
        // Warm pool under the dot, then the dot. Same reason as the city
        // lights: a two-pixel square in additive compositing reads WHITE
        // regardless of its color — it's the pool, larger, that carries the
        // orange tint and reads as an ember rather than sensor dust.
        g.globalAlpha = av * 0.4;
        g.fillStyle = "#ff9d3c";
        g.fillRect(dx - d * 1.4, sy - h - d * 1.4, d * 2.8, d * 2.8);
        g.globalAlpha = av;
        g.fillStyle = "#ffe6bd";
        g.fillRect(dx - d / 2, sy - h - d / 2, d, d);
      }
      g.globalAlpha = 1;
    }
    g.restore();
  }

  // [6][7][8][10][12] All of hover.
  //
  // None of this touches the backdrop: that's what lets hover be
  // PROGRESSIVE. It used to be that changing the hovered cell repainted 30 ms
  // of backdrop just to update a tooltip — a smooth transition would have
  // been unthinkable.
  function liveHover(g, t) {
    const S = LIVE.hover;
    // [6] Halo under the cursor, present as soon as the mouse is over the map
    // and that GROWS as it nears a note. It precedes the label: you feel
    // there's something there before you know what.
    if (anim.mouse.inside) {
      const k = anim.entering.k;
      const r = S.halo + (S.haloTarget - S.halo) * k;
      const halo = g.createRadialGradient(anim.mouse.x, anim.mouse.y, 0,
                                          anim.mouse.x, anim.mouse.y, r);
      halo.addColorStop(0, `rgba(79,240,208,${(0.05 + 0.10 * k).toFixed(3)})`);
      halo.addColorStop(1, "rgba(79,240,208,0)");
      g.save();
      g.globalCompositeOperation = "lighter";
      g.fillStyle = halo;
      g.fillRect(anim.mouse.x - r, anim.mouse.y - r, r * 2, r * 2);
      g.restore();
    }

    // [7] Outline of the hovered territory, and [8] outlines of its neighbors
    // via LINKS (not geography: "who's connected", not "who's next door").
    // Both tracks — the one lighting up, the one fading out — are drawn
    // together, hence no flicker when crossing a border.
    //
    // WARNING: the outline must read THE SAME GEOGRAPHY AS THE GROUND. It
    // used to trace `contours.territories` (polylines from the partition
    // grid, laid on the unit sphere) while the ground had become the Voronoi
    // pavement at relief altitude: two different worlds superimposed, hence
    // the report "hover doesn't outline the same places". So it reads the
    // PAVEMENT's outlines when terrain is active, with the old path kept as
    // a fallback.
    const outlines = currentEdges();
    const outline = (j, weight) => {
      if (outlines) {
        const t = outlines.get(j);
        if (t && t.length) { g.lineWidth = weight; drawEdges3D(g, t); }
        return;
      }
      const l = contours.territories[j];
      if (l && l.length) { g.lineWidth = weight; traceMap(g, l); }
    };

    const tracks = [anim.entering, anim.leaving];
    for (const track of tracks) {
      if (track.i < 0 || track.k <= 0.01) continue;
      const n = notes[track.i];
      g.save();
      // Neighbors first: they pass UNDER the targeted territory.
      g.strokeStyle = PALETTE.accent;
      g.globalAlpha = track.k * 0.34;
      g.shadowBlur = 5; g.shadowColor = PALETTE.accent;
      for (const l of n.links || []) {
        const v = byPath.get(l);
        if (!v) continue;
        const j = notes.indexOf(v);
        if (j < 0) continue;
        outline(j, 1.1);
      }
      g.globalAlpha = track.k * 0.95;
      g.shadowBlur = 4 + 12 * track.k;
      g.strokeStyle = PALETTE.coast;
      g.shadowColor = PALETTE.coast;
      outline(track.i, 1.2 + 1.4 * track.k);
      g.restore();
    }

    // [8b] The NAME of linked zones, lighting up along with their outline.
    //
    // The outline said "those are connected" without saying which: you had
    // to hover each territory one by one to read its name. So the ask is to
    // complete the gesture, not add a layer — hence the same animation track
    // (`track.k`) as the outline, and the same fade-out when the cursor
    // leaves.
    //
    // Three deliberate differences from the hovered note's own name:
    //   — SMALLER (the backdrop's size, 11, against 13 to 17 for the hovered
    //     one): the name of what's being pointed at must stay the biggest
    //     thing on screen;
    //   — a different COLOR (the accent turquoise, that of the lighting-up
    //     outlines, instead of the white-cyan of names): the link then reads
    //     as a single gesture, text and outline from the same family;
    //   — no halo, so as not to compete with the main label.
    //
    // WARNING: same size and same spot as the name painted in the BACKDROP,
    // on purpose: the backdrop isn't repainted on hover (that's what keeps
    // the image at 0.3 ms), so its small name is always there. A smaller or
    // offset label wouldn't cover it and the same name would be read twice —
    // the bug already fixed on the hover label on 26/07.
    {
      const free = placer();
      g.save();
      g.font = font(11);
      g.textAlign = "center";
      // The hovered note first: it reserves its spot, its own label is
      // painted further below and must win on overlap.
      if (anim.entering.i >= 0) {
        const p = toScreen3(notes[anim.entering.i].x, notes[anim.entering.i].y);
        free(p[0] - 60, p[1] + toPx(8) - 4, 120, toPx(14) + 8);
      }
      for (const track of tracks) {
        if (track.i < 0 || track.k <= 0.01) continue;
        for (const l of notes[track.i].links || []) {
          const v = byPath.get(l);
          if (!v || v === notes[track.i]) continue;
          const txt = noteName(v);
          if (!txt) continue;
          const [sx, sy, depth] = toScreen3(v.x, v.y);
          if (depth <= 0.10) continue;               // far side
          if (sx < 0 || sy < 0 || sx > canvas.width || sy > canvas.height) continue;
          const w = g.measureText(txt).width + toPx(10), h = toPx(14);
          const bx = sx - w / 2, by = sy + toPx(8);
          if (!free(bx, by, w, h)) continue;
          g.globalAlpha = track.k * 0.9;
          g.fillStyle = "rgba(4,16,22,0.9)";
          g.fillRect(bx, by, w, h);
          g.globalAlpha = track.k * 0.85;
          g.fillStyle = PALETTE.accent;
          g.fillText(txt, sx, by + toPx(10.5));
        }
      }
      g.restore();
    }

    // [10] Confirmation tick: a ring that opens and fades on the note just
    // reached. Visual feedback only — no sound, a deliberate choice.
    if (anim.entering.i >= 0) {
      const p = progress(t, anim.tick, S.tick);
      if (p < 1) {
        const n = notes[anim.entering.i];
        const [sx, sy, depth] = toScreen3(n.x, n.y);
        if (depth > 0.02) {
          g.save();
          g.strokeStyle = PALETTE.accent;
          g.globalAlpha = (1 - p) * 0.7;
          g.lineWidth = 2 - p;
          g.beginPath(); g.arc(sx, sy, 6 + ease(p) * 26, 0, Math.PI * 2); g.stroke();
          g.restore();
        }
      }
    }

    // [12] The hovered NOTE'S NAME, placed on it.
    //
    // WARNING: this label used to show `groupKey(note)` — so the continent,
    // country, or city depending on zoom, never the note itself. Three of the
    // four user reports traced back to this: "hover shows no name" (it showed
    // a name, just not the one being pointed at); "it refreshes the domain
    // name" (moving from a note to its neighbor in the same country replayed
    // the entry animation on identical text, hence a flicker with no visible
    // cause); and "you have to zoom in too much to see names". The note's own
    // name only existed in the browser's native tooltip, invisible in
    // practice inside Obsidian.
    //
    // It's anchored on the NOTE, not on the group's centroid: that's what
    // makes it follow the cursor from note to note instead of staying pinned
    // in place replaying itself.
    //
    // The group is still shown, smaller, under the name: it says where you
    // are, and that was the only information the old label carried.
    if (anim.entering.i >= 0 && anim.entering.k > 0.02) {
      const k = anim.entering.k;
      const n = notes[anim.entering.i];
      const [sx, sy, depth] = toScreen3(n.x, n.y);
      const txt = noteName(n);
      if (depth > 0.12 && txt) {
        const sub = groupKey(n) || "";
        // WARNING: `k` (the entry animation) and canvas scale MULTIPLY: the
        // first says by how much the label grows as it appears, the second
        // at what size it's read. Adding them would grow the animation by a
        // fixed notch on a large panel, i.e. by nothing at all.
        const size = toPx(13 + 4 * k);
        const subSize = toPx(9.5);
        g.save();
        g.textAlign = "center";
        g.font = `${size.toFixed(1)}px monospace`;
        const w1 = g.measureText(txt).width;
        g.font = `${subSize.toFixed(1)}px monospace`;
        const w2 = sub ? g.measureText(sub).width : 0;
        const w = Math.max(w1, w2);
        // Placed JUST BELOW the note, exactly where the backdrop already
        // wrote its name small — and large enough to cover it. The backdrop
        // isn't repainted on hover (that's what keeps the image at 0.3 ms),
        // so the small name is always there: without covering it, the same
        // name would be read twice. That's the plate's whole purpose, not
        // decoration. The top is taken anyway by the building, which pushes
        // upward, and by the tag badge.
        const h = size + (sub ? subSize + toPx(4) : 0) + toPx(10);
        const hb = sy + toPx(4);
        const margin = toPx(8);
        g.globalAlpha = Math.min(1, k * 1.4);
        g.fillStyle = PALETTE.bg;
        g.fillRect(sx - w / 2 - margin, hb, w + 2 * margin, h);
        g.strokeStyle = PALETTE.accent; g.lineWidth = 0.8;
        g.globalAlpha = Math.min(1, k * 1.4) * 0.5;
        g.strokeRect(sx - w / 2 - margin, hb, w + 2 * margin, h);
        g.globalAlpha = k;
        g.fillStyle = PALETTE.text;
        g.font = `${size.toFixed(1)}px monospace`;
        g.shadowBlur = 12; g.shadowColor = PALETTE.accent;
        g.fillText(txt, sx, hb + size + toPx(3));
        if (sub) {
          g.shadowBlur = 0;
          g.globalAlpha = k * 0.65;
          g.font = `${subSize.toFixed(1)}px monospace`;
          g.fillText(sub, sx, hb + size + subSize + toPx(6));
        }
        g.restore();
      }
    }
  }

  // [9] The hovered note's links pass in front.
  //
  // The other half of the rule — "the others fade out" — is applied in
  // present(), by lowering the opacity of the WHOLE link-line layer at once.
  // That's precisely what justified pulling it out of the backdrop.
  function hoveredLinks(g) {
    const i = anim.entering.i;
    if (i < 0 || anim.entering.k <= 0.02 || !mods.routes.drawLinks) return;
    const path = notes[i].path;
    const own = (model.transports || []).filter(r => r.a === path || r.b === path);
    if (!own.length) return;
    // Two passes of the same stroke: the layer already knows how to paint a
    // link with its color, dash, and glow — repainting it makes it crisp
    // without duplicating a style line, so with no risk of divergence.
    const fake = { level: state.level, network: 0 };
    g.save();
    g.globalAlpha = anim.entering.k;
    mods.routes.drawLinks(g, fake, toScreenPoint, own, notes);
    mods.routes.drawLinks(g, fake, toScreenPoint, own, notes);
    g.restore();
  }

  // [13] Interior borders light up in a cascade from the click point during
  // the dive. A glowing ring spreads: what it touches lights up, what it has
  // passed fades back. It shows where the motion came from.
  function cascade(g, t) {
    if (!anim.cascade) return;
    const C = LIVE.cascade;
    const p = progress(t, anim.cascade.t0, C.duration);
    if (p >= 1) { anim.cascade = null; return; }
    const range = Math.hypot(canvas.width, canvas.height);
    const r = ease(p) * range;
    const { sx, sy } = anim.cascade;
    const within = (x, y) => {
      const d = Math.hypot(x - sx, y - sy);
      return d < r && d > r - C.band;
    };
    g.save();
    g.strokeStyle = PALETTE.accent;
    g.globalAlpha = (1 - p) * 0.75;
    g.lineWidth = 1.4;
    g.shadowBlur = 8; g.shadowColor = PALETTE.accent;
    g.beginPath();
    for (const lines of [contours.country, contours.region])
      for (const line of lines) {
        let open = false;
        for (const [x, y] of line) {
          const q = toScreen3(x, y);
          if (q[2] <= 0.02 || !within(q[0], q[1])) { open = false; continue; }
          if (!open) { g.moveTo(q[0], q[1]); open = true; } else g.lineTo(q[0], q[1]);
        }
      }
    g.stroke();
    g.restore();
  }

  // The live layer's order, back to front: what belongs to the world first
  // (cities, hover, cascade), then the instrument dressing (reticle, scan),
  // then the graph that covers everything when it opens.
  function live(g, t) {
    liveCities(g, t);
    liveHover(g, t);
    hoveredLinks(g);
    cascade(g, t);
    reticle(g);
    scan(g, t);
    network(g, t);
  }

  // Targets a new camera position to reach by gliding (click, Escape).
  function aim(zoom, x, y) {
    state.targetZoom = Math.max(PARAMS.zoom.min, Math.min(PARAMS.zoom.max, zoom));
    // The target is clamped HERE and not in advance(): the camera glides
    // between two points of the band, so it stays there without needing to
    // be caught up every frame. A click on a polar note thus targets the
    // nearest lookable point, instead of dragging the camera to where the
    // frame collapses.
    state.targetX = x; state.targetY = clampCamera(y, PARAMS);
    state.inTransition = true;
  }

  // Nudges zoom/camera toward the target by one notch; returns true while
  // it's still moving. Exponential approach: fast at first, gentle on
  // arrival.
  function advance() {
    if (!state.inTransition) return false;
    const k = 0.22;
    const L = PARAMS.skin.width;
    state.zoom += (state.targetZoom - state.zoom) * k;
    // In longitude, the world wraps on itself: targeting a point just past
    // the wrap meridian used to cross the whole planet the wrong way. We
    // always take the shortest path.
    let dx = state.targetX - state.camX;
    if (dx > L / 2) dx -= L; else if (dx < -L / 2) dx += L;
    state.camX = (state.camX + dx * k + L) % L;
    state.camY += (state.targetY - state.camY) * k;
    if (Math.abs(state.targetZoom - state.zoom) < 0.01
        && Math.abs(dx) < 0.5
        && Math.abs(state.targetY - state.camY) < 0.5) {
      state.zoom = state.targetZoom; state.camX = state.targetX; state.camY = state.targetY;
      state.inTransition = false;
    }
    state.backdropDirty = true;
    return true;
  }

  // Draws already-smoothed polylines (see layout.extractContours). A single
  // path for all the lines: one beginPath/stroke per line would cost one
  // draw call per coastline. `lineJoin: round` avoids spikes at the rare
  // remaining corners.
  function coasts(g, lines, color, weight, dashes, glow) {
    g.save();
    g.strokeStyle = color;
    g.lineWidth = weight;
    g.lineJoin = "round";
    g.lineCap = "round";
    g.setLineDash(dashes || []);
    // glow (px of blur): neon on important borders. Reserved for continents;
    // country/region borders stay crisp and cheap.
    if (glow) setGlow(g, glow, color);
    g.beginPath();
    for (const line of lines) {
      let first = true;
      for (const [x, y] of line) {
        // WARNING: `project`, not `toScreen`. These strokes are painted onto
        // the SKIN, so in map coordinates, like the ground right next to them
        // (`path`). With the screen projection, they used to be placed where
        // the CAMERA saw them at that instant, then wrapped as if they
        // belonged to the map: coastlines stopped following coastlines, and
        // the map changed shape after every zoom. Found by comparing two
        // skins repainted at the same detail level but at two different
        // zooms — 152,000 pixels of drift where there should have been zero.
        const [sx, sy] = project(x, y);
        if (first) { g.moveTo(sx, sy); first = false; }
        else g.lineTo(sx, sy);
      }
    }
    g.stroke();
    g.restore();
  }

  // The name of the group a note belongs to, at the current detail level.
  const groupKey = n => state.level === "world" ? n.continent
                       : state.level === "continent" ? n.country : (n.city || n.name);

  // A note's name, as displayed. `name` is the field produced by collection;
  // `title` is accepted as a fallback because that's what the test fixtures
  // use. The extension is stripped: "Holographic Map.md" says nothing more
  // than "Holographic Map", and costs four characters of space.
  const noteName = n => String((n && (n.name || n.title)) || "").replace(/\.md$/i, "");

  // Where each group's name is placed. Computed once per detail level and
  // CACHED: the live layer needs it every frame (to grow the hovered name),
  // and recomputing a centroid per group sixty times a second would be an
  // expensive way to get a result that never changes.
  //
  // The name is placed by labelPoint, which refuses a centroid that lands in
  // the sea — see its own header for why.
  let pointsCache = null, pointsKey = "";
  function groupPoints() {
    if (pointsCache && pointsKey === state.level) return pointsCache;
    const groups = new Map();
    for (const n of notes) {
      const key = groupKey(n);
      if (!key) continue;
      const g = groups.get(key);
      if (g) g.push(n); else groups.set(key, [n]);
    }
    const totals = new Map();
    for (const [key, members] of groups) {
      const [x, y] = labelPoint(members, i => groupKey(notes[i]) === key,
                                    (x, y) => mods.layout.cellUnder(grid, x, y));
      totals.set(key, { x, y, n: 1 });
    }
    pointsCache = totals; pointsKey = state.level;
    return totals;
  }

  function labels(g) {
    const totals = groupPoints();
    g.save();
    g.fillStyle = PALETTE.text;
    // Continents (world level) are shown in spaced capitals, like the
    // concept art ("DEV & AI", "PROFESSIONAL"); countries and cities stay in
    // normal case, more discreet.
    const world = state.level === "world";
    g.font = font(world ? 13 : 12);
    if ("letterSpacing" in g) g.letterSpacing = world ? `${toPx(2).toFixed(1)}px` : "0px";
    g.textAlign = "center";
    // Cold halo behind each label: detaches it from the territories and
    // gives it the "lit display" grain without hurting legibility.
    setGlow(g, world ? 10 : 8, PALETTE.accent);
    // On the globe, everything nearing the limb compresses: names pile up
    // there into mush, and far-side ones have no business on screen. Three
    // safeguards:
    //  — what's behind the ball isn't shown at all;
    //  — what grazes the limb fades instead of competing for attention;
    //  — of two overlapping names, only the nearer one is shown.
    const free = placer();
    const spots = [...totals]
      .map(([key, c]) => ({ key, p: toScreen3(c.x / c.n, c.y / c.n) }))
      .filter(o => o.p[2] > 0.12)                    // far side: nothing to say
      .sort((a, b) => b.p[2] - a.p[2]);              // the nearest keeps the spot
    for (const { key, p } of spots) {
      const [sx, sy, depth] = p;
      if (sx < 0 || sy < 0 || sx > canvas.width || sy > canvas.height) continue;
      const txt = world ? key.toUpperCase() : key;
      const w = g.measureText(txt).width, h = toPx(14);
      // WARNING: at country level, a group's centroid often lands ON a note,
      // i.e. at the foot of its city. Since buildings grew taller (26/07),
      // the plate ended up in the middle of the towers instead of in front
      // of them. It's dropped below the base: a city grows upward, the free
      // spot is below it. Elsewhere, the name floats on bare ground, nothing
      // to offset.
      const by = sy + (state.level === "country" ? 22 : 0);
      if (!free(sx - w / 2, by - h + toPx(3), w, h)) continue;
      g.globalAlpha = Math.min(1, (depth - 0.12) * 4);
      // WARNING: seen on capture at country level: at this zoom, the name
      // lands in the middle of the building's towers and the stems cross
      // through it — the name is there but unreadable, which amounts to no
      // name at all. A dark plate lifts it off. Reserved for this level: at
      // world and continent level, the name floats above bare ground and the
      // plate would only clutter the map.
      if (state.level === "country") {
        const bg = g.fillStyle, shadow = g.shadowBlur;
        g.fillStyle = "rgba(4,16,22,0.82)"; g.shadowBlur = 0;
        g.fillRect(sx - w / 2 - toPx(5), by - h + toPx(2), w + toPx(10), h + toPx(3));
        g.fillStyle = bg; g.shadowBlur = shadow;
      }
      g.fillText(txt, sx, by);
    }
    g.globalAlpha = 1;
    if ("letterSpacing" in g) g.letterSpacing = "0px";
    g.restore();
  }

  function legend(g) {
    // The second line sits exactly one line-height above the first: the two
    // offsets are linked, not independent.
    const MARGIN = toPx(12);
    const LINE_HEIGHT = toPx(16);
    g.fillStyle = PALETTE.text;
    g.font = font(11);
    g.fillText(`level ${state.level} · zoom ${state.zoom.toFixed(1)} · ${notes.length} notes`, MARGIN, canvas.height - MARGIN);
    const orphans = notes.filter(n => n.continent === mods.classify.TERRA).length;
    if (orphans / notes.length > PARAMS.alert.unknownLandShare) {
      g.fillStyle = PALETTE.alert;
      g.fillText(`⚠ Terra Incognita: ${orphans} unassigned notes`, MARGIN, canvas.height - (MARGIN + LINE_HEIGHT));
    }
  }

  // Repaints the SKIN: everything laid flat on the ground, in map
  // coordinates.
  //
  // It doesn't depend on the camera — spinning the globe or moving closer
  // doesn't change it. Only the detail level (country borders, region
  // borders) triggers a repaint, hence the `skinLevel` tracking.
  function refreshSkin() {
    project = ON_SKIN;
    skinCtx.clearRect(0, 0, skin.width, skin.height);
    // The skin's background is the SEA: the deep black that land sits on. It
    // becomes the ocean color once wrapped.
    skinCtx.fillStyle = PALETTE.bg;
    skinCtx.fillRect(0, 0, skin.width, skin.height);
    land(skinCtx);
    // Continent coasts and borders in crisp neon: it's the stroke that draws
    // the landmasses onto the black sea.
    coasts(skinCtx, contours.continent, PALETTE.coast, 1, null, 5);
    if (state.level !== "world") coasts(skinCtx, contours.country, PALETTE.borderSecondary, 1);
    if (state.level === "country") coasts(skinCtx, contours.region, PALETTE.borderSecondary, 0.6, [3, 3]);
    project = toScreen;
    // The skin's pixel readback goes stale the moment it's repainted.
    // Forgetting this here would show the old detail level with no error at
    // all.
    skinPixels = null;
    state.skinDirty = false;
    state.skinLevel = state.level;
  }

  // Wraps the skin onto the ball.
  //
  // For each pixel of the disk, we trace back to the map point it shows and
  // go read its color there. A lookup table makes this very cheap (measured:
  // 2ms), but it only holds for a given camera — so it's rebuilt when the
  // camera moves, not every frame.
  // WARNING: this block is the HOT spot of the whole render: it's what gets
  // expensive when the map is large, and what made the enlarged panel
  // stutter. Three wastes were removed (measured, not assumed):
  //   — a table the size of the canvas was ALLOCATED on every camera move
  //     (5MB per frame at 1400px wide) then filled entirely with -1, when
  //     only the globe's disk is ever used;
  //   — wrapping re-read and rewrote the WHOLE canvas, including the empty
  //     space around the globe, which it never touches;
  //   — spherical lighting was recomputed pixel by pixel every frame, when it
  //     only depends on position within the disk, just like the table
  //     itself.
  // The table and the lighting therefore live in two reused buffers, filled
  // together, and only the disk's zone is walked and copied back.
  let table = null, lightTable = null, tableKey = "", zone = null;
  function buildTable() {
    // The canvas size is PART of the key: the table is indexed as
    // `sy * canvas.width + sx`. Read back after a resize, a table built for
    // the old width shifts every row by a notch — continents disappear and
    // only horizontal stripes remain. Seen on capture, not assumed.
    const key = state.camX + ":" + state.camY + ":" + state.zoom
              + ":" + canvas.width + "x" + canvas.height;
    if (key === tableKey && table) return table;
    const { forward, right, up } = frame();
    const R = radius(), cx = canvas.width / 2, cy = canvas.height / 2;
    const L = PARAMS.skin.width, H = PARAMS.skin.height;
    const N = canvas.width * canvas.height;
    if (!table || table.length !== N) {
      table = new Int32Array(N);
      lightTable = new Uint8Array(N);
      zone = null;
    }
    // Only clear what was filled on the previous pass: sweeping the whole
    // canvas to clear it costs as much as drawing it.
    if (zone) {
      for (let sy = zone.y0; sy < zone.y1; sy++)
        table.fill(-1, sy * canvas.width + zone.x0, sy * canvas.width + zone.x1);
    }
    const x0 = Math.max(0, Math.floor(cx - R)), x1 = Math.min(canvas.width, Math.ceil(cx + R) + 1);
    const y0 = Math.max(0, Math.floor(cy - R)), y1 = Math.min(canvas.height, Math.ceil(cy + R) + 1);

    // Exact point: where does this pixel look at on the skin, and with what
    // lighting? Returns null outside the globe. This is where the two
    // trig functions live that used to cost the whole render time when
    // called per pixel.
    function exact(sx, sy) {
      const a = (sx - cx) / R, b = -(sy - cy) / R;
      const r2 = a * a + b * b;
      if (r2 > 1) return null;                      // outside the disk: no world here
      const p = Math.sqrt(1 - r2);
      const vx = a * right[0] + b * up[0] + p * forward[0];
      const vy = a * right[1] + b * up[1] + p * forward[1];
      const vz = a * right[2] + b * up[2] + p * forward[2];
      const lat = Math.asin(Math.max(-1, Math.min(1, vz)));
      const lon = Math.atan2(vy, vx);
      // Spherical lighting: it DARKENS the edge of the globe, never
      // brightening past the painted color — otherwise the black sea greys
      // out and the whole globe flattens into sameness. `p`, the component
      // toward the eye, is already available: storing it avoids one square
      // root per pixel per frame.
      return [(lon / (2 * Math.PI) + 0.5) * L, (0.5 - lat / Math.PI) * H,
              0.34 + 0.66 * Math.max(0, -a * 0.40 + b * 0.42 + p * 0.81), p];
    }
    function place(sx, sy, fx, fy, light) {
      let tx = fx | 0, ty = fy | 0;
      tx = ((tx % L) + L) % L;
      ty = ty < 0 ? 0 : ty >= H ? H - 1 : ty;
      const k = sy * canvas.width + sx;
      table[k] = ty * L + tx;
      lightTable[k] = light * 255;
    }

    // Coarse grid: the exact point is only computed at the nodes, and the
    // space between them is filled by interpolation. The projection varies
    // smoothly inside a cell — except at the globe's edge and on the wrap
    // meridian, where it falls back to the exact computation (see
    // `interpolatable`).
    const G = PARAMS.render.globe;
    for (let ay = y0; ay < y1; ay += G.step) {
      const by = Math.min(ay + G.step, y1);
      for (let ax = x0; ax < x1; ax += G.step) {
        const bx = Math.min(ax + G.step, x1);
        const c00 = exact(ax, ay), c10 = exact(bx, ay),
              c01 = exact(ax, by), c11 = exact(bx, by);
        const h = by - ay, w = bx - ax;
        if (!interpolatable([c00, c10, c01, c11], L, G.minDepth)) {
          for (let sy = ay; sy < by; sy++)
            for (let sx = ax; sx < bx; sx++) {
              const c = exact(sx, sy);
              if (c) place(sx, sy, c[0], c[1], c[2]);
            }
          continue;
        }
        // Inner loop deliberately kept flat: it's the one that runs a
        // million times per frame. No function call, no division, and a
        // simple test instead of the double modulo to close longitude — the
        // interpolated values can only drift by at most one wrap.
        const iw = 1 / w, ih = 1 / h;
        for (let sy = ay; sy < by; sy++) {
          const v = (sy - ay) * ih;
          const gx = c00[0] + (c01[0] - c00[0]) * v, dx = c10[0] + (c11[0] - c10[0]) * v;
          const gy = c00[1] + (c01[1] - c00[1]) * v, dy = c10[1] + (c11[1] - c10[1]) * v;
          const gl = c00[2] + (c01[2] - c00[2]) * v, dl = c10[2] + (c11[2] - c10[2]) * v;
          const px = (dx - gx) * iw, py = (dy - gy) * iw, pl = (dl - gl) * iw;
          let fx = gx, fy = gy, fl = gl;
          let k = sy * canvas.width + ax;
          for (let sx = ax; sx < bx; sx++, k++) {
            let tx = fx | 0, ty = fy | 0;
            if (tx >= L) tx -= L; else if (tx < 0) tx += L;
            if (ty >= H) ty = H - 1; else if (ty < 0) ty = 0;
            table[k] = ty * L + tx;
            lightTable[k] = fl * 255;
            fx += px; fy += py; fl += pl;
          }
        }
      }
    }
    zone = { x0, x1, y0, y1 };
    tableKey = key;
    return table;
  }

  // The skin read back as pixels. It only changes when the skin repaints
  // (detail-level change), not on camera movement: reading it every frame
  // would be half a million pixels transferred for nothing.
  let skinPixels = null;
  function readSkin() {
    if (!skinPixels) skinPixels = skinCtx.getImageData(0, 0, skin.width, skin.height).data;
    return skinPixels;
  }

  function wrap(g) {
    const t = buildTable();
    if (!zone || zone.x1 <= zone.x0 || zone.y1 <= zone.y0) return;
    const src = readSkin();
    // We start from what's ALREADY painted (the gradient background), and
    // only touch the disk's pixels: with a fresh image, everything outside
    // the globe would be cleared to transparent black and the background
    // would vanish. Reads and writes are bounded to the globe's square, not
    // the whole canvas — on a wide panel, the empty space around it is half
    // the pixels.
    const w = zone.x1 - zone.x0, h = zone.y1 - zone.y0;
    const img = g.getImageData(zone.x0, zone.y0, w, h);
    const d = img.data;
    const INV = 1 / 255;
    for (let sy = zone.y0; sy < zone.y1; sy++) {
      let k = sy * canvas.width + zone.x0;
      let o = ((sy - zone.y0) * w) * 4;
      for (let sx = zone.x0; sx < zone.x1; sx++, k++, o += 4) {
        const s = t[k];
        if (s < 0) continue;
        const light = lightTable[k] * INV;
        const q = s * 4;
        d[o] = src[q] * light; d[o + 1] = src[q + 1] * light; d[o + 2] = src[q + 2] * light;
        d[o + 3] = 255;
      }
    }
    g.putImageData(img, zone.x0, zone.y0);
  }

  // Repaints the full backdrop onto the memory canvas. Expensive, called only
  // when the camera has moved (state.backdropDirty set true by redraw()).
  // Each step is timed into `state.times`. A dozen clock readings per repaint
  // cost nothing, and without them any question of slowness gets settled by
  // gut feeling: it's this measurement that showed the cost was concentrated
  // in two layers, not spread across ten.
  function refreshBackdrop() {
    // Backdrop REBUILD counter, exposed for the test harness. It's the only
    // number that says whether gesture coalescing is holding: a drag emits
    // 100 to 125 events per second, and the promise is "at most one rebuild
    // per animation frame", not "one per event". Without this counter, a
    // regression is measured by feel — which is to say, not measured.
    state.rebuilds = (state.rebuilds || 0) + 1;
    const T = {}; let m = performance.now();
    const mark = name => { const t = performance.now(); T[name] = t - m; m = t; };
    state.level = levelFromZoom(state.zoom, PARAMS);
    // Two paths for the GROUND, never both at once: the faceted mesh
    // (terrain.js) or the image-skin wrap. The second stays in place until
    // the first has been validated in real Obsidian.
    if (terrain) {
      mark("skin");                                  // nothing to prepare
      background(backdropCtx);       mark("background");
      state.mesh = paintTerrain(backdropCtx);
      mark("globe");
      screenContours(backdropCtx);       mark("coasts");
    } else {
      if (state.skinDirty || state.skinLevel !== state.level) refreshSkin();
      mark("skin");
      background(backdropCtx);         mark("background");
      wrap(backdropCtx);     mark("globe");
    }
    // Everything below is painted AFTER wrapping, on screen: these layers
    // carry text or height, and would be warped by the projection.
    //
    // The grid goes through ITS OWN layer: it's deferred here, to its spot
    // in the stack (under the lights and names), and the layer is kept so
    // presentation can add, every frame, a very slow flicker and a few
    // pixels of parallax — without ever re-projecting a single meridian.
    veilCtx.clearRect(0, 0, veil.width, veil.height);
    gridlines(veilCtx);
    backdropCtx.drawImage(veil, 0, 0);
    mark("gridlines");
    lights(backdropCtx);     mark("lights");
    limb(backdropCtx);        mark("limb");
    buildings(backdropCtx);    mark("buildings");
    vignette(backdropCtx);     mark("vignette");
    // Text goes to ITS OWN layer, laid down last at presentation: otherwise
    // network strokes and stations, drawn after the backdrop, would pass over
    // the names (a station stem crossing a note's name, a link crossing the
    // legend — both seen on capture).
    textsCtx.clearRect(0, 0, texts.width, texts.height);
    badges(textsCtx);       mark("badges");
    noteNames(textsCtx);    mark("names");
    labels(textsCtx);   mark("labels");
    legend(textsCtx);      mark("legend");
    // Network view intensity: computed HERE because the network strokes,
    // painted right after, must know to fade under the cards. The DRAWING of
    // the cards, itself, is animated and lives in the live layer.
    state.network = networkIntensity() * 0.75;
    // Network strokes: painted with the backdrop, because they only move
    // with the camera — but on THEIR OWN layer, so hovering a note can fade
    // them as a block without repainting the whole backdrop.
    linksCtx.clearRect(0, 0, links.width, links.height);
    if (mods.routes && mods.routes.drawLinks)
      mods.routes.drawLinks(linksCtx, state, toScreenPoint, model.transports || [], notes);
    // Terminals over the strokes, on the same layer: they mark the end of
    // each link, and fade with it when a note is hovered.
    if (mods.routes && mods.routes.drawTerminals)
      mods.routes.drawTerminals(linksCtx, state, toScreenPoint, model.transports || [], notes, PARAMS);
    mark("links");
    state.times = T;
    state.backdropDirty = false;
  }

  // One frame: recopy the backdrop (rebuilt only if stale) then overlay the
  // animated transports. This is what the rAF loop calls 60 times a second;
  // only a stale backdrop triggers a real repaint.
  // `clock`: passed by the test harness to capture a precise instant of an
  // animation. In real use, it's read from the browser's clock.
  //
  // WARNING: `frozenClock` exists for a precise reason, found on the "green
  // band at the right edge": the harness plays a series of frames on a
  // controlled clock, but not every repaint goes through it.
  // `requestRedraw` (gesture coalescing) reschedules a `present()` with NO
  // argument, which runs after the harness script and repaints on the
  // browser's REAL clock — at ~1.3s of page life, i.e. right in the middle
  // of the opening sweep (1.5s). The last captured frame therefore wasn't
  // the one that had been composed, and the sweep read as a render defect.
  // Freezing the clock makes the instant controlled for EVERY repaint,
  // wherever it comes from. Never set in real use: `freezeClock` is only
  // called by the harness.
  let frozenClock = null;
  function freezeClock(t) { frozenClock = t; }
  function present(clock) {
    const t = clock !== undefined ? clock
            : frozenClock !== null ? frozenClock
            : (typeof performance !== "undefined" ? performance.now() : 0);
    // WARNING: timing of the WHOLE FRAME, not just the backdrop.
    // `state.times` only covers `refreshBackdrop`: at country level it
    // reported 26ms when a frame actually cost 54 — layer compositing
    // (recopying the backdrop, veil, links, texts, live layer, vehicles)
    // accounted for the other half and showed up NOWHERE. A cost that no
    // measurement shows is a cost that never gets fixed: that's what let
    // "it lags" slip through. Two clock reads per frame cost nothing.
    const tFrame = typeof performance !== "undefined" ? performance.now() : 0;
    // Published on `state` for layers written outside this module (player.js
    // writes its status line onto the same canvas): without this their text
    // would stay stuck at its original size on a large panel, which reads as
    // an oversight rather than a choice.
    state.textScale = TS();
    advanceAnim(t);
    if (state.backdropDirty) refreshBackdrop();
    const tBackdrop = typeof performance !== "undefined" ? performance.now() : 0;
    ctx.drawImage(backdrop, 0, 0);
    // [3] Grid flicker and [20] parallax. A single image recopy for both:
    // the layer already exists, we're just repositioning it slightly offset
    // and with a breathing opacity.
    //
    // WARNING: the parallax stays a few pixels. This grid isn't a decorative
    // background: it's the GLOBE's graticule (meridians and parallels). Too
    // offset, it visibly peels away from the planet it dresses.
    const SC = LIVE.flicker, PX = LIVE.parallax;
    const beat = 0.5 + 0.5 * Math.sin(2 * Math.PI * t / SC.period);
    const ox = anim.mouse.inside ? (anim.mouse.x / canvas.width - 0.5) * 2 * PX.amplitude : 0;
    const oy = anim.mouse.inside ? (anim.mouse.y / canvas.height - 0.5) * 2 * PX.amplitude : 0;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = SC.amplitude * beat;
    ctx.drawImage(veil, ox, oy);
    ctx.restore();
    // [9] Network strokes, faded AS A BLOCK during a hover: the targeted
    // note's links will be repainted over them by the live layer, and will
    // stand out all the more as the others recede.
    ctx.save();
    ctx.globalAlpha = 1 - (1 - LIVE.hover.fade) * anim.entering.k;
    ctx.drawImage(links, 0, 0);
    ctx.restore();
    // Text over the strokes: a name crossed by a station stem is a name you
    // can't read.
    ctx.drawImage(texts, 0, 0);
    live(ctx, t);
    // Overlays receive the 3D POINT projector, the same one used by network
    // strokes: vehicles and strokes must share the exact same geometry, or
    // one drifts from the other.
    //
    // WARNING: each is isolated. An overlay throwing here would interrupt
    // `present()` BEFORE the loop reschedules itself: the map would freeze
    // on its current frame, without so much as a message. That's exactly the
    // symptom seen on 27/07 ("it's running but frozen"), caused back then at
    // mount time. A faulty overlay is reported ONCE — at sixty times a
    // second, the console would become unusable — then removed, and the rest
    // of the map keeps going.
    if (model.overlays)
      for (let k = 0; k < model.overlays.length; k++) {
        const f = model.overlays[k];
        if (!f) continue;
        try { f(ctx, state, toScreenPoint); }
        catch (e) {
          model.overlays[k] = null;
          console.error("holomap: overlay removed after an error", e);
        }
      }
    const tEnd = typeof performance !== "undefined" ? performance.now() : 0;
    state.frameTimes = { backdrop: tBackdrop - tFrame, composition: tEnd - tBackdrop, total: tEnd - tFrame };
  }

  // Event handlers mark the backdrop stale then present right away, for an
  // immediate response even while the loop is paused.
  // WARNING: reserved for ONE-OFF calls (harness, resize, end of
  // transition): a continuous gesture (drag, wheel) must NEVER call it
  // directly, see `requestRedraw` just below.
  function redraw() {
    state.backdropDirty = true;
    present();
  }

  // Gesture coalescing. User report: "it lags". Diagnosed with the harness:
  // `redraw()` was being called SYNCHRONOUSLY on every `mousemove`/`wheel` —
  // 100 to 125 events per second with a mouse — while a redraw costs 54 to
  // 68ms at country level. The event queue then fell behind at an
  // accumulating rate, and the map trailed far behind the cursor: that's
  // exactly the symptom.
  //
  // A gesture must no longer PAINT, only mark state and request a frame. We
  // reuse the already-running rAF loop (`present` runs 60 times a second for
  // the live layer, see the loop in view.js) instead of opening a second one:
  // `requestRedraw` simply adds, if one isn't already pending, ONE catch-up
  // frame. At most one redraw is thus played per frame, and it's the mouse's
  // latest state that wins — intermediate events are simply overwritten
  // without ever being painted, as intended. No latency is added relative to
  // that loop: while it's running, `requestRedraw` arrives before the next
  // `present()` anyway; while it's paused (panel off-screen), `requestRedraw`
  // schedules its own frame and so stays responsive.
  let redrawRequested = false;
  function requestRedraw() {
    state.backdropDirty = true;
    if (redrawRequested) return;
    redrawRequested = true;
    requestAnimationFrame(() => { redrawRequested = false; present(); });
  }

  // --- What gets lightened during a gesture --------------------------------
  //
  // WARNING: REPLACES the resolution drop (removed on 27/07). That approach
  // painted the whole canvas at 60% of its size during a drag or zoom and let
  // the browser stretch it back: the backdrop, but ALSO note names, badges,
  // the legend, and buildings. User report, unambiguous: "when I move the
  // planet everything gets big and blurry". The complaint was accurate — it
  // was the mechanism itself, not a setting to tune: at 0.6, 10px text was
  // rendered at 6px then upscaled.
  //
  // So something else is lightened instead — measured as the REAL cost
  // center: the halos (see the glow budget at the top of this file).
  // Comparable gain — 44.2 → 25.2ms per frame in motion, against roughly
  // 2.8× fewer pixels for the old method — and no geometry is touched: during
  // a gesture the map stays pixel-sharp, it just glows less.
  //
  // The gesture no longer resizes anything: no more downscaled buffer, so no
  // more mouse-coordinate conversion to do (the old `toBuffer`).
  const GESTURE_SETTING = PARAMS.render.gesture || { glow: 0, idle: 80 };
  let gestureEndTimer = 0;
  function setGlowFactor(f) {
    if (f === glowFactor) return;
    glowFactor = f;
    state.glow = f;                 // routes.js paints its links with the backdrop
    state.backdropDirty = true;
  }
  // Starts (or extends) a gesture: cuts the glow budget and cancels any
  // restoration already scheduled.
  function startGesture() {
    clearTimeout(gestureEndTimer);
    setGlowFactor(GESTURE_SETTING.glow === undefined ? 0 : GESTURE_SETTING.glow);
  }
  // Clean END of a gesture (mouse release): immediate restoration, no
  // waiting — unlike the wheel, a release is an unambiguous event.
  function endGestureClean() {
    clearTimeout(gestureEndTimer);
    setGlowFactor(1);
    requestRedraw();
  }
  // The wheel has no end event: we restore after a short idle period with no
  // new notch (PARAMS.render.gesture.idle), to avoid relighting the halos
  // between two notches of the same gesture.
  function scheduleGestureEnd() {
    clearTimeout(gestureEndTimer);
    gestureEndTimer = setTimeout(() => {
      setGlowFactor(1);
      requestRedraw();
    }, GESTURE_SETTING.idle);
  }

  // One wheel notch. Pulled out of the event handler to be testable outside
  // the browser: the capture harness can replay a real zoom and measure how
  // much the targeted point drifted (zero expected). Called directly by the
  // harness, so WITHOUT going through the gesture's reduced resolution (that
  // one is only triggered by the real `wheel` handler below) — the zoom
  // pinning measurement stays unaffected.
  function zoom(sx, sy, direction) {
    // Anchored on the cursor: the map point under the mouse must stay under
    // the mouse after the zoom, or the target slips away while zooming onto
    // it.
    const [px, py] = grab(sx, sy);
    const [ax, ay] = toMap(px, py);
    const f = PARAMS.zoom.factor;
    // Zoom-out = exactly 1 / factor, so that a wheel round trip returns to
    // the starting zoom instead of drifting.
    const before = state.zoom;
    state.zoom = Math.max(PARAMS.zoom.min,
                Math.min(PARAMS.zoom.max, state.zoom * (direction > 0 ? f : 1 / f)));
    if (state.zoom !== before) realign(ax, ay, px, py);
    // The wheel is a direct manipulation: it cuts short any transition in
    // progress and realigns the target on the current position.
    state.inTransition = false;
    state.targetZoom = state.zoom; state.targetX = state.camX; state.targetY = state.camY;
    // Coalesced like the drag: see requestRedraw above, this is no longer a
    // real synchronous redraw.
    requestRedraw();
  }

  canvas.addEventListener("wheel", e => {
    e.preventDefault();
    startGesture();
    zoom(e.offsetX, e.offsetY, e.deltaY < 0 ? 1 : -1);
    scheduleGestureEnd();
  });

  // A drag also fires a `click` on release. Without this distance check, a
  // simple map pan at "country" level would open the note under the release
  // point.
  const CLICK_THRESHOLD_PX = 4;
  let drag = null;
  let dragDistance = 0;
  canvas.addEventListener("mousedown", e => {
    // Glow budget cut from the very first instant of the drag, so the
    // gesture's first frame is already at its reduced cost.
    startGesture();
    // We remember the grabbed MAP point, not just the cursor position: the
    // drag then consists of keeping that point under the finger, as you
    // would spinning a real globe. Recomputing a pixel-by-pixel delta would
    // drift, each small step adding its error to the last.
    const [px, py] = grab(e.offsetX, e.offsetY);
    const [ax, ay] = toMap(px, py);
    drag = { x: e.offsetX, y: e.offsetY, ax, ay };
    dragDistance = 0;
  });
  // Clean END of the drag: a mouse release is an unambiguous event, full
  // resolution is restored right away (see endGestureClean) — no waiting
  // like for the wheel, which has no end event.
  canvas.addEventListener("mouseup", () => { if (drag) endGestureClean(); drag = null; });
  // No listener on `window`: it would never be removed, and every re-render
  // of the block by Obsidian (opening a note, toggling edit mode) would leave
  // behind a closure holding onto the notes, the grid, and the context.
  canvas.addEventListener("mouseleave", () => {
    if (drag) endGestureClean();
    drag = null; anim.mouse.inside = false;
  });
  canvas.addEventListener("mouseenter", () => { anim.mouse.inside = true; });

  // Which network-view card is under this point? The registry is filled
  // every frame by network(), and only holds cards unfolded enough to be
  // targeted — a target still growing would dodge the cursor.
  function cardAt(x, y) {
    const f = anim.network.cards;
    for (let k = 0; k < f.length; k++) {
      const b = f[k];
      if (x >= b.bx && x <= b.bx + b.w && y >= b.by && y <= b.by + b.h) return b;
    }
    return null;
  }

  canvas.addEventListener("mousemove", e => {
    // Safety net: a `mouseup` released OUTSIDE the canvas doesn't always
    // reach us (platform-dependent). `buttons === 0` during an ongoing drag
    // catches it after the fact — without this the halos would stay off
    // indefinitely.
    if (e.buttons === 0 && drag) endGestureClean();
    if (e.buttons === 0) drag = null;
    anim.mouse.x = e.offsetX; anim.mouse.y = e.offsetY; anim.mouse.inside = true;
    if (drag) {
      dragDistance += Math.abs(e.offsetX - drag.x) + Math.abs(e.offsetY - drag.y);
      drag.x = e.offsetX; drag.y = e.offsetY;
      // WARNING: the target is clamped to the grab disk: outside the globe
      // there's no point to target, and the solver used to spin out there
      // (see clampToDisk). The drag then follows the cursor's DIRECTION.
      const [px, py] = grab(e.offsetX, e.offsetY);
      realign(drag.ax, drag.ay, px, py);
      state.inTransition = false; // the drag takes over from any transition
      // Coalesced: see requestRedraw. This IS the lag fix — before, each of
      // the 100 to 125 mousemove/s called redraw() synchronously (54 to
      // 68ms at country level), and the event queue fell further and
      // further behind.
      requestRedraw();
      return;
    }
    // [17] Hovering a graph card: it takes precedence over hovering the map,
    // which sits beneath it.
    const b = cardAt(e.offsetX, e.offsetY);
    anim.hoverCard = b ? b.i : -1;
    // WARNING: hover no longer DIRTIES the backdrop. It changed nothing of
    // what's painted there (verified: `state.hover` was read by no layer)
    // yet still cost a full repaint on every cell change — for a single
    // tooltip. All of hover's visual feedback now lives in the live layer,
    // which incidentally makes it progressive instead of all-or-nothing.
    const [mx, my] = toMap(e.offsetX, e.offsetY);
    state.hover = b ? notes.indexOf(b.note) : noteAtMap(mx, my);
    canvas.style.cursor = b ? "pointer" : "";
    canvas.title = state.hover >= 0
      ? `${notes[state.hover].name}\n${notes[state.hover].continent} › ${notes[state.hover].country} › ${notes[state.hover].region}`
      : "";
  });

  canvas.addEventListener("click", e => {
    if (dragDistance > CLICK_THRESHOLD_PX) return;
    // [18] Click on a neighboring card: it becomes the new focus. Nothing
    // special to animate — we simply AIM at its note, and since the graph's
    // focus is always the note nearest the camera, it changes on its own as
    // the camera arrives. The graph glides instead of jumping, and the
    // unfold restarts on its own around the new neighborhood.
    const b = cardAt(e.offsetX, e.offsetY);
    if (b) { aim(state.zoom, b.note.x, b.note.y); return; }
    const [mx, my] = toMap(e.offsetX, e.offsetY);
    const i = noteAtMap(mx, my);
    if (i < 0) return;
    if (state.level === "country") {
      app.workspace.openLinkText(notes[i].path, "", false);
    } else {
      // Animated dive toward the clicked note (glide, not jump).
      const z = (state.level === "world" ? PARAMS.zoom.continentThreshold : PARAMS.zoom.countryThreshold)
              + PARAMS.zoom.margin;
      aim(z, notes[i].x, notes[i].y);
      // [13] The cascade starts from the CLICK POINT, not the center: that's
      // what makes it informative — it shows where the motion came from.
      anim.cascade = { sx: e.offsetX, sy: e.offsetY, t0: anim.t };
    }
  });

  root.tabIndex = 0;
  root.addEventListener("keydown", e => {
    if (e.key !== "Escape") return;
    // Animated pull-back by one notch (country → continent → world).
    const z = state.level === "country" ? PARAMS.zoom.continentThreshold + PARAMS.zoom.margin : 1;
    aim(z, state.camX, state.camY);
  });

  // --- Panel size tracking --------------------------------------------------
  //
  // Resizing replays NONE of the geography: the skin, the relief, and the
  // contours are computed in map coordinates and know nothing of the canvas.
  // Only the visible canvas, the backdrop canvas, and the apparent radius
  // change — hence a cost on the order of a redraw, not a remount.
  //
  // The delay smooths out bursts: dragging a panel divider emits dozens of
  // measurements per second, and each one resizes two canvases (which clears
  // them) then repaints the whole backdrop.
  const RESIZE_DELAY_MS = 120;
  let resizeTimer = 0;
  function resize() {
    const { width, height } = measureSize();
    // 2px threshold: below that, the gain is invisible and it risks an
    // oscillation where the resized canvas changes the width of the
    // container that just measured it.
    if (Math.abs(width - fullWidth) < 2 && Math.abs(height - fullHeight) < 2) return;
    fullWidth = width; fullHeight = height;
    // A real panel resize outranks a gesture's lightening: start fresh, with
    // halos back on.
    clearTimeout(gestureEndTimer);
    setGlowFactor(1);
    canvas.width = width;
    canvas.height = height;
    // The backdrop is the off-screen buffer recopied every frame: if it kept
    // its old size, the map would display in a corner of the new frame.
    backdrop.width = width;
    backdrop.height = height;
    // Same off-screen buffers, same reason: kept at the old size, the grid
    // and the network strokes would end up recopied into a corner of the new
    // frame.
    sizeLayers();
    redraw();
  }
  // Same precaution as the animation loop: the observer is retained so it
  // can be disconnected when Obsidian discards the block, otherwise every
  // re-render would leave one more of them hanging onto a detached canvas.
  let sizeObserver = null;
  if (typeof ResizeObserver !== "undefined") {
    sizeObserver = new ResizeObserver(() => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(resize, RESIZE_DELAY_MS);
    });
    sizeObserver.observe(root);
  }
  function detach() {
    if (sizeObserver) { sizeObserver.disconnect(); sizeObserver = null; }
    clearTimeout(resizeTimer);
    clearTimeout(gestureEndTimer);
  }

  redraw();
  return { state, redraw, present, advance, toScreen, toMap, canvas, ctx,
           zoom, resize, detach, freezeClock,
           // Exposed for the harness: measuring zoom pinning against the
           // RAW cursor point would lie as soon as it leaves the grab disk —
           // the promise only covers the point actually grabbed.
           grab,
           // Exposed for the harness: the cost of a frame DURING a gesture
           // can't be measured by moving `state.camX` by hand, since it's
           // the event handler that cuts the halos. Without this entry
           // point, the harness would always time the resting version and
           // the lightening would never be verified anywhere.
           setGlowFactor,
           // Exposed for the verification harness: it's the only way to
           // tell "the skin is painted wrong" from "the skin is painted
           // right but read back wrong". The two look alike on screen.
           skin,
           // Exposed for the harness: the TEXT layer alone, transparent
           // everywhere else. On the composited image, measuring a text's
           // real size would require distinguishing it from the terrain
           // behind it — on this layer, every opaque pixel is ink.
           textLayer: texts };
}

export { COLORS, levelFromZoom, architecture, cityShape, cityUnit, cityHeight,
         tint, placer, anchorNetwork,
         labelPoint,
         progress, ease, approach, phase, growBuildings,
         measureCanvas, textScale, turnTowards, clampCamera, clampToDisk, mount };
