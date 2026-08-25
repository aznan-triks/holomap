// The vehicle encodes the SCOPE of the link, not its content.
//
// Composite-key separator (ASCII unit separator), identical to classify.js:
// never present in a note path nor a continent name, so "a"+SEP+"b" cannot
// collide.
const SEP = String.fromCharCode(31);

// Two continents are neighbors if they SHARE A BORDER: a cell of one touches
// orthogonally (up/down/left/right) a cell of the other.
//
// Replaces the old "coastline" rule: that one counted any cell touching the
// canvas edge as coastline, but this vault has no sea at all — the
// territories fill the whole frame. The boat/plane distance was then
// measured along the canvas perimeter (an artefact), and a landlocked
// continent with no sea, considered "coastless", was never a neighbor of
// anyone even though it touches its enclosing continent along its whole
// perimeter. See task 9 report.
//
// The 3rd argument (PARAMS) is no longer read; it stays in the signature for
// compatibility with the call in view.js.
function adjacents(grid, notes) {
  const { width, height, cells } = grid;
  const continent = i => (i < 0 ? null : notes[i].continent);
  const pairs = new Set();
  // Only look at right and bottom neighbors: each border between two cells
  // is thus examined exactly once.
  for (let gy = 0; gy < height; gy++)
    for (let gx = 0; gx < width; gx++) {
      const here = continent(cells[gy * width + gx]);
      if (here === null) continue;
      if (gx + 1 < width) {
        const neighbor = continent(cells[gy * width + gx + 1]);
        if (neighbor !== null && neighbor !== here) pairs.add([here, neighbor].sort().join(SEP));
      }
      if (gy + 1 < height) {
        const neighbor = continent(cells[(gy + 1) * width + gx]);
        if (neighbor !== null && neighbor !== here) pairs.add([here, neighbor].sort().join(SEP));
      }
    }
  return pairs;
}

// Angular gap between two notes, in radians on the sphere: 0 = same spot,
// PI = antipodal. It's the only distance measure that makes sense on a
// sphere (a map-pixel distance stretches near the poles).
function angularGap(a, b) {
  if (!a.v || !b.v) return null;
  const cos = Math.max(-1, Math.min(1, a.v[0] * b.v[0] + a.v[1] * b.v[1] + a.v[2] * b.v[2]));
  return Math.acos(cos);
}

// Beyond this gap, no SURFACE route makes sense: no rail, no crossing, take
// the plane. ~60 degrees of arc, a sixth of the way around the world — the
// scale of a sea or a continent, not an ocean.
//
// This is now only a CEILING. User feedback from 07/27, "there's no more
// planes", measured on the real vault before touching anything: zero
// planes, and not by accident — the longest link in the vault is 50 degrees
// of arc, so the 60-degree threshold was UNREACHABLE by construction,
// exactly like the boat threshold before 07/26.
//
// The cause is structural, and that's what needed to be seen: the placer
// ATTRACTS linked notes towards each other (layout.attraction). What makes
// a link exist is therefore precisely what makes it short. An absolute
// distance threshold can't tell "near" from "far" in a world where every
// link is pulled towards near — measured: between two ARBITRARY notes the
// median gap is 48 degrees, but between two LINKED notes it ranges 9 to 50.
//
// The threshold is therefore RELATIVE to the vault, just like note density
// already is (weigh.denser, which compares to the vault median, never to a
// byte count): a link is a plane if it's long FOR THIS VAULT. Two guardrails
// bound the quantile, so it stays a geography measure and not an imposed
// proportion:
//   — PLANE_FLOOR: below this length, no route is a flight, even if it's
//     the longest in the vault. A vault where every link is ten degrees is
//     a vault with no planes, and that's the truth of its map.
//   — BOAT_THRESHOLD: beyond it, it's a flight no matter what the quantile
//     says.
const BOAT_THRESHOLD = 1.05;
const PLANE_SHARE = 0.75;
const PLANE_FLOOR = 25 * Math.PI / 180;

// Below this threshold, two notes are essentially overlapping on screen: the
// arc would be invisible, it's a "street", not a route. ~3 degrees.
const STREET_THRESHOLD = 0.05;

// Share of the route above water below which we consider it reached by dry
// land. Not zero: the coastline is a noisy isoline sampled on a grid, so a
// perfectly overland route can graze a water cell crossing a bay. Ten
// percent is one or two points out of sixty-four — a sampling accident, not
// a sea.
const TRAIN_WATER_SHARE = 0.1;

// Number of points where we check the ground under the route. Enough to not
// miss a strait, and cheap: this measure runs once at mount, on a few dozen
// links — never per frame.
const GROUND_POINTS = 64;

// Is there land under this direction? The partition grid is the only thing
// that knows: it carries -1 for water and the note index for land. It's the
// same source as the lights, buildings and terminals — a second formula
// would eventually drift and put ports in the fields.
//
// The extent of the skin is derived from the grid itself (width x cell
// size): no need to pass it PARAMS, it knows its own frame.
function onLand(grid, v) {
  const skinWidth = grid.width * grid.cellSize;
  const skinHeight = grid.height * grid.cellSize;
  const px = (Math.atan2(v[1], v[0]) / (2 * Math.PI) + 0.5) * skinWidth;
  const py = (0.5 - Math.asin(Math.max(-1, Math.min(1, v[2]))) / Math.PI) * skinHeight;
  const gy = Math.floor(py / grid.cellSize);
  if (gy < 0 || gy >= grid.height) return false;             // beyond a pole
  const gx = Math.floor(px / grid.cellSize);
  const gxWrap = ((gx % grid.width) + grid.width) % grid.width;  // longitude wrap
  return grid.cells[gy * grid.width + gxWrap] >= 0;
}

// What share of the route has water underneath? We follow the GREAT CIRCLE,
// i.e. the arc actually drawn on screen: measuring along a different path
// than the one shown would describe a journey nobody sees.
function waterShare(grid, a, b) {
  if (!grid || !a.v || !b.v) return null;
  let water = 0;
  for (let i = 0; i <= GROUND_POINTS; i++) {
    const t = i / GROUND_POINTS;
    const x = a.v[0] + (b.v[0] - a.v[0]) * t;
    const y = a.v[1] + (b.v[1] - a.v[1]) * t;
    const z = a.v[2] + (b.v[2] - a.v[2]) * t;
    const n = Math.hypot(x, y, z) || 1;                 // back onto the sphere
    if (!onLand(grid, [x / n, y / n, z / n])) water++;
  }
  return water / (GROUND_POINTS + 1);
}

// Angular radius of each note's territory, in radians.
//
// Serves one question only: are the two notes of a link NEIGHBORS to the
// point that a vehicle would have nowhere to run? We read the area the note
// actually occupies on the partition grid and convert it to the radius of a
// spherical cap of equal area — a measure of the map as drawn, not an
// estimate from weight.
//
// What this replaces: "same continent AND same city -> it's a street". That
// rule read a classification LABEL, and was the last place in this module
// still reading one. Measured on the real vault before removing it: it
// discarded 14 of the vault's 19 links — three quarters of the network —
// and did so with no relation to geography, since the discarded arcs (9 to
// 29 degrees) overlapped the ones it kept (18 to 50). A "city" is a
// classification group: one of them here spans 35 degrees of arc, a fifth
// of a hemisphere. Those are not streets.
function territoryRadii(grid) {
  if (!grid || !grid.areas) return null;
  const areas = new Map();
  let sphere = 0;
  for (let k = 0; k < grid.cells.length; k++) {
    sphere += grid.areas[k];
    const i = grid.cells[k];
    if (i >= 0) areas.set(i, (areas.get(i) || 0) + grid.areas[k]);
  }
  if (!(sphere > 0)) return null;
  const radii = new Map();
  // Area of a cap of half-angle r on the unit sphere: 2π(1 − cos r).
  // Relative to the full sphere (4π), the share is (1 − cos r) / 2.
  for (const [i, A] of areas)
    radii.set(i, Math.acos(Math.max(-1, Math.min(1, 1 - 2 * A / sphere))));
  return radii;
}

// Which vehicle for which link.
//
// Rule REWORKED: the previous version said "continents that touch -> boat,
// else plane". It dated from the flat map, where the vault had no sea at
// all and some criterion had to be invented. It became absurd once the
// planet got an ocean: a boat CROSSES water, it doesn't care about touching
// land — and since the real map has very few shared borders between
// domains, it produced in practice ONLY planes (confirmed by the user in
// Obsidian: no train, no boat visible).
//
// Rule REWORKED A SECOND TIME, for a measured reason: the continent-based
// version above produced, on the real vault (75 notes), **10 links, 10 of
// them trains** — zero boats, zero planes. Two distinct causes:
//
//   1. "same continent -> train" reads a CLASSIFICATION label, not
//      geography. 53 of 75 notes have no `area_liee` and fall back into
//      "Terra Incognita", which is not a land but a catch-all scattered
//      across the whole planet. Two of its notes at antipodes shared a
//      "continent", hence a rail link: measured, one train of 93 degrees of
//      arc, another spending 58% of its route above the ocean.
//   2. The boat was UNREACHABLE by construction: it required two
//      non-neighboring continents less than 0.9 rad apart. But two
//      non-neighboring continents are, by definition, far apart — measured
//      minimum gap 1.08 rad. The window was empty: no boat could ever be
//      born, neither in the test fixture nor in Obsidian. The harness
//      masked this by injecting artificial crossings into its test notes.
//
// The rule therefore no longer reads ANY label. It looks at the route
// itself, on the partition grid — the only source that knows where the land
// is:
//
//   — beyond BOAT_THRESHOLD, no surface route makes sense       -> plane;
//   — below it, if the route stays on dry land                  -> train;
//   — below it, if it crosses water                              -> boat.
//
// A single distance and a single question ("is there water underneath?"),
// where there used to be three criteria, one of them unreachable. Intended
// side effect: all three vehicles now appear regardless of note
// classification, which was the original promise — a vault with no
// `area_liee` used to show an entirely rail-only network.
//
// `grid` is optional: without it (caller that hasn't partitioned yet,
// historical tests), we fall back to the old continent-based rule rather
// than invent a geography.
function computeTransports(notes, adjacency, grid) {
  const index = new Map(notes.map(n => [n.path, n]));
  const rank = new Map(notes.map((n, i) => [n.path, i]));
  const radii = territoryRadii(grid);
  const seen = new Set();

  // First pass: the RETAINED links, with their gap and the water under them.
  // The type is decided in the second pass — the plane threshold depends on
  // the length of the other links, so it can't be settled link by link.
  const candidates = [];
  for (const n of notes)
    for (const l of n.links || []) {
      const m = index.get(l);
      if (!m) continue;
      const key = [n.path, m.path].sort().join(SEP);
      if (seen.has(key)) continue;
      seen.add(key);
      const gap = angularGap(n, m);
      // FIXED threshold: below 0.05 rad (~3°), two notes are essentially
      // overlapping and the arc would be invisible — it's a "street".
      //
      // The old test `gap <= ra + rb` (sum of territory radii) discarded
      // almost every link in the vault because Lloyd relaxation ATTRACTS
      // linked notes, which makes the angular gap shorter than the sum of
      // territories for almost every linked pair. Measured on the real
      // vault: 14 of 19 links discarded, and the kept arcs (18-50°)
      // overlapped the rejected ones (9-29°). A fixed 3° threshold only
      // rejects the arcs that are truly invisible — where both notes are
      // drawn in the same spot.
      if (gap !== null && gap < STREET_THRESHOLD) continue;
      candidates.push({ n, m, gap, water: waterShare(grid, n, m) });
    }

  // Plane threshold: the PLANE_SHARE quantile of the gaps actually present,
  // bounded by the floor and ceiling (see their comments). Computed once, at
  // mount — never per frame.
  const gaps = candidates.map(c => c.gap).filter(e => e !== null).sort((a, b) => a - b);
  const quantile = gaps.length
    ? gaps[Math.min(gaps.length - 1, Math.floor(PLANE_SHARE * gaps.length))]
    : BOAT_THRESHOLD;
  const planeThreshold = Math.max(PLANE_FLOOR, Math.min(BOAT_THRESHOLD, quantile));

  const routes = [];
  for (const { n, m, gap, water } of candidates) {
    let type;
    if (water === null) {
      // No grid, or no position: don't guess a terrain.
      const pair = [n.continent, m.continent].sort().join(SEP);
      type = n.continent === m.continent || adjacency.has(pair) ? "train"
           : gap === null || gap > BOAT_THRESHOLD ? "avion" : "bateau";
    } else {
      type = gap === null || gap > planeThreshold ? "avion"
           : water <= TRAIN_WATER_SHARE ? "train" : "bateau";
    }
    routes.push({ type, a: n.path, b: m.path });
  }
  return routes;
}

// Vehicle silhouette, drawn at the origin and facing right: the caller
// handles translation and rotation. Replaces the old white dot — concept
// art needs to show what's actually moving, and that's what tells a living
// network apart from a string of fireflies.
//
// All shapes fit in a box about 2·t long: `t` is the half-length, the only
// size setting.
function drawVehicle(ctx, type, t) {
  ctx.beginPath();
  if (type === "avion") {
    // Delta: nose forward, swept wings towards the back, tail.
    ctx.moveTo(t, 0);
    ctx.lineTo(-t * 0.15, t * 0.28);
    ctx.lineTo(-t * 0.55, t * 0.85);
    ctx.lineTo(-t * 0.8, t * 0.75);
    ctx.lineTo(-t * 0.55, t * 0.16);
    ctx.lineTo(-t, t * 0.42);
    ctx.lineTo(-t, -t * 0.42);
    ctx.lineTo(-t * 0.55, -t * 0.16);
    ctx.lineTo(-t * 0.8, -t * 0.75);
    ctx.lineTo(-t * 0.55, -t * 0.85);
    ctx.lineTo(-t * 0.15, -t * 0.28);
  } else if (type === "bateau") {
    // Hull: pointed bow, square stern, superstructure on top.
    ctx.moveTo(t, 0);
    ctx.lineTo(t * 0.1, t * 0.5);
    ctx.lineTo(-t, t * 0.5);
    ctx.lineTo(-t, -t * 0.5);
    ctx.lineTo(t * 0.1, -t * 0.5);
  } else {
    // Train: a glowing capsule, like on the continental views.
    ctx.moveTo(t * 0.55, -t * 0.42);
    ctx.lineTo(t, 0);
    ctx.lineTo(t * 0.55, t * 0.42);
    ctx.lineTo(-t, t * 0.42);
    ctx.lineTo(-t, -t * 0.42);
  }
  ctx.closePath();
  ctx.fill();
  // The boat carries a bright bridge, otherwise its hull blends with the
  // plane's delta at this size.
  if (type === "bateau") {
    // Glow cut: otherwise the bridge casts its own halo onto the hull right
    // below it and gets a dark fringe.
    const glow = ctx.shadowBlur;
    ctx.shadowBlur = 0;
    ctx.beginPath();
    ctx.rect(-t * 0.45, -t * 0.28, t * 0.5, t * 0.56);
    ctx.fill();
    ctx.shadowBlur = glow;
  }
}

// Cadence specific to a link: a start offset and a speed factor, derived
// from the pair of notes it connects.
//
// Without this, all vehicles of the same type share the clock AND the
// starting point: they move at the same instant, at the same pace, and loop
// back together — a metronome, not a living network.
//
// Deterministic by construction (derived from note paths): a link keeps its
// cadence from one frame to the next and one session to the next. A random
// draw would make it jump on every redraw.
function cadence(r) {
  const key = r.a + "|" + r.b + "|" + r.type;
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) { h ^= key.charCodeAt(i); h = Math.imul(h, 16777619); }
  const u = ((h >>> 0) % 10000) / 10000;              // start, spread over the whole route
  const v = (((h >>> 13) >>> 0) % 10000) / 10000;     // pace, independent of start
  return { start: u, factor: 0.55 + 0.9 * v };
}

// Network palette aligned with the concept art: the big inter-continental
// links (plane, boat) run in bright orange, internal trains stay cyan.
// `width`/`glow`/`alpha` give the neon look.
//
// `altitude`: how much the arc rises above the sphere, in planet radii.
// This replaces the old `courbe` (screen-pixel bulge): a plane flies high
// and clearly bulges past the limb, a train hugs the ground.
const STYLE = {
  avion:  { couleur: "#ffb86b", tirets: [5, 5], altitude: 0.16,  vitesse: 0.00018, epaisseur: 1.4, lueur: 8, alpha: 0.55, taille: 6 },
  bateau: { couleur: "#ffcf8f", tirets: [],     altitude: 0.035, vitesse: 0.00010, epaisseur: 1.4, lueur: 7, alpha: 0.5,  taille: 5 },
  // The train used to be INVISIBLE, and it's the most common vehicle in the
  // real vault (6 links out of 10). Measured by repainting it magenta on a
  // capture: at 5x zoom its track was just a row of isolated one-pixel
  // dots. Three causes stacked, all here — a dash pattern at 33% fill (2
  // on, 4 off), a thinner line than the others, and the lowest opacity of
  // the three — on a vehicle whose color is also that of the graticule and
  // the land. The two orange vehicles stood out because they contrast with
  // the blue, not because they were better tuned.
  //
  // Cyan is kept (internal links stay cool, that's the intended palette)
  // and given back the WEIGHT of the other two: mostly-solid dashes, line
  // width and opacity aligned. Altitude stays the same — a train hugging the
  // ground is what sets it apart at a glance.
  train:  { couleur: "#7fe9ff", tirets: [7, 4], altitude: 0.012, vitesse: 0.00006, epaisseur: 1.6, lueur: 8, alpha: 0.8, taille: 5 },
};
// All types are visible at ALL zoom levels.
//
// Previously each level only showed two (plane and boat at world scale,
// train at country scale). The intent was progressive detail; the actual
// effect, reported from Obsidian: "zooming in makes the planes disappear".
// A network that fades as you get closer reads as a bug, not a choice —
// even more so since the real vault has mostly long links, so diving in
// emptied the map of all motion.
const VISIBLE = { world: ["avion", "bateau", "train"],
                  continent: ["avion", "bateau", "train"],
                  country: ["avion", "bateau", "train"] };

// --- An arc belongs to the SPHERE, not the screen -------------------------
//
// Bug fixed here, the most visible one on the globe: the arc was a Bezier
// curve drawn between the two SCREEN projections. But a note on the far
// side also projects into the disk — so the line crossed straight through
// the planet, and the curve's bulge pushed it out of the disk. Nothing in
// this calculation knew what was in front or behind.
//
// An arc is now the shortest path on the sphere (great circle), flown over
// at an altitude set by type, and every point knows whether it's visible.
//
// Spherical interpolation: p(t) = (sin((1−t)Ω)·va + sin(tΩ)·vb) / sinΩ. It
// moves at constant speed along the arc, unlike a renormalized straight-line
// interpolation which bunches up in the middle — the vehicle would slow
// down mid-route for no reason.
//
// The altitude profile is a sine: zero at both ends (the line touches the
// ground at its terminals) and maximal in the middle.
function arcPoints(va, vb, altitude, n) {
  const cos = Math.max(-1, Math.min(1, va[0] * vb[0] + va[1] * vb[1] + va[2] * vb[2]));
  const omega = Math.acos(cos);
  const sin = Math.sin(omega);
  const points = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    let p;
    // Two coincident (or diametrically opposed) notes: the arc is undefined.
    // Return a usable path rather than NaNs, which would wipe out the whole
    // canvas with no error at all.
    if (sin < 1e-9) p = [va[0], va[1], va[2]];
    else {
      const ka = Math.sin((1 - t) * omega) / sin, kb = Math.sin(t * omega) / sin;
      p = [va[0] * ka + vb[0] * kb, va[1] * ka + vb[1] * kb, va[2] * ka + vb[2] * kb];
    }
    const r = 1 + altitude * Math.sin(Math.PI * t);
    const m = Math.hypot(p[0], p[1], p[2]) || 1;
    points.push([p[0] / m * r, p[1] / m * r, p[2] / m * r]);
  }
  return points;
}

// Is a projected point in front of the sphere? `p` = [screen x, screen y,
// component towards the eye, distance to the view axis in radii].
//
// Behind the sphere (negative component) AND inside the disk: the planet
// hides it. Behind but OUTSIDE the disk: visible — the case of a high arc
// that passes back behind the globe while bulging past the limb, which must
// be kept, otherwise links would cut off sharply at the edge.
//
// With no depth supplied (a caller from before the globe existed), nothing
// is hidden: better an extra stroke than a whole layer silently vanishing.
function frontOfGlobe(p) {
  if (p.length < 4) return true;
  return p[2] >= 0 || p[3] > 1;
}

// Geometry shared by the line and the vehicle: the already-projected arc
// points. Written once so the line's stroke and the vehicle's placement
// can't drift apart — they read the same array.
//
// `proj` projects an arbitrary 3D point (radius >= 1 to fly over) and
// returns [screen x, screen y, component towards the eye, axis distance].
// WHERE it starts from. Feedback from Obsidian: "boats should leave from
// the coast".
//
// This wasn't just a placement detail — a maritime arc drawn from the
// center of the territory starts by CROSSING its own land before reaching
// the water, which contradicts the one thing a boat is supposed to say.
// And since all three transport types started from the same point, a
// territory with a port, an airport and a station only ever showed one of
// them.
//
// Each type therefore has its own terminal (seeded by layout.seedTerminals):
//   — train   -> the station, at the heart of the city;
//   — plane   -> the airport, set back inland;
//   — boat    -> the port FACING the destination, chosen here among the
//                note's own ports: a territory with several coastlines
//                doesn't board from the coast opposite its crossing.
//
// `target` may be missing (a caller not drawing a specific link): we then
// take the first port. Terminal seeding not run: fall back to the note's
// position, i.e. the old behavior, rather than nothing.
function terminal(note, type, target) {
  const g = note.terminals;
  if (!g) return note.v;
  if (type === "bateau") {
    if (!g.ports || !g.ports.length) return g.station || note.v;
    if (!target) return g.ports[0];
    let best = g.ports[0], score = -Infinity;
    for (const p of g.ports) {
      const s = p[0] * target[0] + p[1] * target[1] + p[2] * target[2];
      if (s > score) { score = s; best = p; }
    }
    return best;
  }
  if (type === "avion") return g.airport || g.station || note.v;
  return g.station || note.v;
}

const ARC_STEPS = 28;
function arc(r, a, b, proj) {
  const s = STYLE[r.type];
  if (!a.v || !b.v) return null;
  return { s, points: arcPoints(terminal(a, r.type, b.v), terminal(b, r.type, a.v),
                                 s.altitude, ARC_STEPS).map(proj) };
}

function visibleRoutes(state, transports, notes) {
  const index = new Map(notes.map(n => [n.path, n]));
  const result = [];
  for (const r of transports) {
    if (!VISIBLE[state.level].includes(r.type)) continue;
    const a = index.get(r.a), b = index.get(r.b);
    if (a && b) result.push([r, a, b]);
  }
  return result;
}

// Network LINES are painted with the backdrop, not every frame.
//
// They only depend on the camera: redrawing them sixty times a second
// meant redoing, for nothing, the most expensive layer of the whole render
// — a neon halo (`shadowBlur`) per link, whose cost grows with map size.
// That was the real cause of "bigger map = more lag": invisible in the
// backdrop's own timing, since it was paid for outside of it. Only the
// vehicles actually move (see `animate`).
function drawLinks(ctx, state, proj, transports, notes) {
  // The network view fades out the geography; the transports must fade
  // with it. Without this fade they scratched dashed lines across the
  // cards.
  const fade = 1 - (state.network || 0);
  if (fade <= 0.02) return;
  for (const [r, a, b] of visibleRoutes(state, transports, notes)) {
    const trace = arc(r, a, b, proj);
    if (!trace) continue;
    const { s, points } = trace;
    const c = cadence(r);
    ctx.save();
    ctx.strokeStyle = s.couleur;
    ctx.globalAlpha = s.alpha * fade;
    ctx.lineWidth = s.epaisseur;
    ctx.setLineDash(s.tirets);
    // Dashes from one link to the next no longer fall in the same place:
    // aligned, they read as a single pattern flickering as a block.
    ctx.lineDashOffset = c.start * 20;
    // Glow budget: these lines are painted WITH the backdrop, so they count
    // towards a frame's cost during a drag gesture. `state.lueur` (set by
    // render.js) brings it to zero for the duration of the gesture — see
    // the glow budget comment in render.js for the measurement behind it.
    ctx.shadowBlur = s.lueur * (state.lueur === undefined ? 1 : state.lueur);
    ctx.shadowColor = s.couleur;
    ctx.beginPath();
    // The pen LIFTS as soon as a point goes behind the planet: that clipping
    // is what stops a line from crossing straight through the globe. An arc
    // can therefore be drawn in two pieces (it dives behind and comes back
    // out), which is exactly what a network laid on a sphere should look
    // like.
    let open = false;
    for (const p of points) {
      if (!frontOfGlobe(p)) { open = false; continue; }
      if (!open) { ctx.moveTo(p[0], p[1]); open = true; } else ctx.lineTo(p[0], p[1]);
    }
    ctx.stroke();
    ctx.restore();
  }
}

// --- Terminals, drawn ------------------------------------------------------
//
// Three clearly different silhouettes, not three colored dots: the map is
// also read from far away and at small size, and two neighboring warm tints
// (the plane's orange, the boat's sand) stop being distinguishable at five
// pixels. Shape stays legible regardless.
//
//   — airport: two crossed runways, plus a beacon;
//   — port:    an elbowed jetty reaching into the water, plus a mooring buoy;
//   — station: a platform, two rail crossties.
//
// Drawn at the origin, unoriented: on a sphere a terminal has no "front",
// and rotating these glyphs would make them unreadable near the limb.
function drawStation(ctx, type, t) {
  ctx.lineCap = "round";
  ctx.lineWidth = Math.max(1, t * 0.22);
  ctx.beginPath();
  if (type === "avion") {
    ctx.moveTo(-t, -t * 0.75); ctx.lineTo(t, t * 0.75);
    ctx.moveTo(-t * 0.55, t * 0.9); ctx.lineTo(t * 0.9, -t * 0.5);
    ctx.stroke();
    ctx.beginPath(); ctx.arc(t, -t * 0.75, Math.max(1, t * 0.28), 0, Math.PI * 2); ctx.fill();
  } else if (type === "bateau") {
    // The jetty leaves the shore and elbows out to sea: that elbow is what
    // makes it read as a structure and not just another link line.
    ctx.moveTo(-t, t * 0.6); ctx.lineTo(t * 0.35, t * 0.6); ctx.lineTo(t * 0.35, -t * 0.7);
    ctx.stroke();
    ctx.beginPath(); ctx.arc(t * 0.35, -t * 0.7, Math.max(1, t * 0.3), 0, Math.PI * 2); ctx.fill();
  } else {
    ctx.moveTo(-t, t * 0.5); ctx.lineTo(t, t * 0.5);          // the platform
    ctx.moveTo(-t * 0.5, t * 0.5); ctx.lineTo(-t * 0.5, -t * 0.6);
    ctx.moveTo(t * 0.5, t * 0.5); ctx.lineTo(t * 0.5, -t * 0.6);
    ctx.stroke();
  }
}

// Appear fade, matched to the buildings' (render.pousseBatiments): terminals
// rise from the ground WITH the city they serve. At world scale they'd have
// nothing to say — a few extra pixels on a planet already covered in
// lights — and a hard pop at the threshold would read as a flicker.
function terminalAppear(zoom, PARAMS) {
  const s = (PARAMS && PARAMS.zoom && PARAMS.zoom.continentThreshold) || 1.5;
  const p = Math.max(0, Math.min(1, ((zoom || 1) - s * 0.8) / (s * 0.45)));
  return p * p * (3 - 2 * p);
}

// The terminals ACTUALLY used, and only those.
//
// We don't draw "the port of every note" but the departure point of each
// visible link: a note with no maritime crossing has no port, and a note
// embarking in two opposite directions rightly shows its TWO ports. That's
// exactly what the feedback asked for: "separate airports, ports and
// stations when a single territory has several".
//
// Deduplication key on the rounded position: two links of the same type
// leaving from the same dock must only be painted once (otherwise the halo
// would stack and that dock would glow brighter than the others for no
// reason).
function visibleTerminals(state, transports, notes) {
  const points = new Map();
  for (const [r, a, b] of visibleRoutes(state, transports, notes))
    for (const [n, other] of [[a, b], [b, a]]) {
      if (!n.v || !other.v) continue;
      const v = terminal(n, r.type, other.v);
      if (!v) continue;
      points.set(r.type + "|" + v[0].toFixed(4) + "|" + v[1].toFixed(4) + "|" + v[2].toFixed(4),
                 { type: r.type, v });
    }
  return [...points.values()];
}

// Painted with the BACKDROP, like the network lines: a terminal only moves
// with the camera. Repainting it sixty times a second would redo, for
// nothing, the most expensive layer (one halo per facility) — the same bug
// fixed on 07/25 for the links, not to be reintroduced here.
function drawTerminals(ctx, state, proj, transports, notes, PARAMS) {
  const fade = (1 - (state.network || 0)) * terminalAppear(state.zoom, PARAMS);
  if (fade <= 0.02) return;
  const t = Math.max(2.6, Math.min(9, (state.zoom || 1) * 1.5));
  for (const { type, v } of visibleTerminals(state, transports, notes)) {
    const p = proj(v);
    if (!frontOfGlobe(p)) continue;
    const s = STYLE[type];
    ctx.save();
    ctx.globalAlpha = fade * 0.85;
    ctx.strokeStyle = s.couleur; ctx.fillStyle = s.couleur;
    ctx.setLineDash([]);
    // Same budget as the lines: terminals are painted with the backdrop.
    ctx.shadowBlur = 6 * (state.lueur === undefined ? 1 : state.lueur);
    ctx.shadowColor = s.couleur;
    ctx.translate(p[0], p[1]);
    drawStation(ctx, type, t);
    ctx.restore();
  }
}

// Zoom speed compensation.
//
// Without it, a vehicle goes faster and faster on screen as you zoom in: it
// moves at constant angular speed on the sphere, and the sphere's apparent
// radius grows with zoom. That's the opposite of what's wanted — up close
// you want to see a train run, not a streak fly by.
//
// `exponent`: 0 = no compensation (the old behavior), 1 = strictly constant
// on-screen speed. In between, some sense of scale is kept while the motion
// stays readable up close.
function zoomSpeed(zoom, exponent) {
  const e = exponent === undefined ? 0.7 : exponent;
  return Math.pow(Math.max(0.2, zoom || 1), -e);
}

// The vehicles, and only them: the only thing that moves from one frame to
// the next. A handful of few-pixel silhouettes.
//
// `PARAMS` is optional: without it, the live-layer settings fall back to
// safe defaults rather than crashing — this module is called from three
// places (the view, the harness, the tests).
function animate(ctx, state, proj, transports, notes, clock, PARAMS) {
  const fade = 1 - (state.network || 0);
  if (fade <= 0.02) return;
  const V = (PARAMS && PARAMS.live) || {};
  const TR = V.trail || { share: 0.05, segments: 8, opacity: 0.5 };
  const VE = V.vehicle || { zoomExponent: 0.7, scaleUp: 0.35 };
  const kz = zoomSpeed(state.zoom, VE.zoomExponent);
  // Up close, the vehicle grows a bit: the counterpart to the slowdown, the
  // closer you get the better you should see what's moving.
  const kt = 1 + VE.scaleUp * Math.min(2, Math.max(0, (state.zoom || 1) - 1) / 4);

  // User feedback (07/28): "every zoom, everything dynamic restarts". `t`
  // used to be computed as `clock * kz`, where `clock` is the ABSOLUTE time
  // elapsed since opening (hundreds of thousands of ms) and `kz` the CURRENT
  // zoom's speed compensation. Changing `kz` — so zooming, even one notch —
  // amounted to re-evaluating the ENTIRE past at the new speed: at 10
  // minutes into a session, one scroll-wheel notch shifts the argument by
  // dozens of dial turns, and modulo 1 that lands anywhere on the route —
  // seen on screen as a vehicle that "restarts" elsewhere. Untested until
  // now: no test called `animate` at two different zooms (see the dedicated
  // test, sharper than guessing).
  //
  // Fix: a COMPENSATED clock, accumulated frame by frame, where `kz` only
  // applies to the DELTA since the last frame — never retroactively. Carried
  // on `state` (persists across frames, unlike this function's local
  // variables); initialized to `clock * kz` so the very first frame doesn't
  // jump either compared to the old behavior.
  if (state._lastVehicleClock === undefined) {
    state._vehicleClock = clock * kz;
  } else {
    state._vehicleClock += (clock - state._lastVehicleClock) * kz;
  }
  state._lastVehicleClock = clock;
  const vehicleClock = state._vehicleClock;

  for (const [r, a, b] of visibleRoutes(state, transports, notes)) {
    const trace = arc(r, a, b, proj);
    if (!trace) continue;
    const { s, points } = trace;
    const c = cadence(r);

    // Each link has its own start and its own pace: vehicles no longer cross
    // the finish line all together.
    const t = ((vehicleClock * s.vitesse * c.factor + c.start) % 1 + 1) % 1;
    // The vehicle sits ON the already-traced arc: we read the points array
    // instead of redoing a parallel calculation. Two formulas for the same
    // route always end up drifting apart — the vehicle would leave its
    // track.
    const k = Math.min(points.length - 2, Math.floor(t * (points.length - 1)));
    const f = t * (points.length - 1) - k;
    const p0 = points[k], p1 = points[k + 1];
    // A vehicle behind the planet has no business on screen.
    if (!frontOfGlobe(p0) || !frontOfGlobe(p1)) continue;
    const px = p0[0] + (p1[0] - p0[0]) * f, py = p0[1] + (p1[1] - p0[1]) * f;
    // Orientation: the direction of the arc's current segment. Read off the
    // trace, so it stays correct even near the limb where the projection
    // flattens everything — no need to remember the previous position to
    // guess a heading (which would make the vehicle jerk at the loop point,
    // when it jumps from the end back to the start).
    // The TRAIL, drawn before the vehicle so it passes underneath.
    //
    // It replaces the old fixed dash pattern once used to suggest motion: a
    // static dash says nothing about direction of travel, while a fading
    // tail shows at a glance where you're coming from and where you're
    // going.
    //
    // Its length is a SHARE OF THE ROUTE, never a pixel length: in pixels it
    // would be oversized when zoomed out (where an arc fits in a hundred
    // pixels) and invisible when zoomed in.
    ctx.save();
    ctx.setLineDash([]);
    ctx.lineCap = "round";
    ctx.strokeStyle = s.couleur;
    ctx.shadowBlur = 6; ctx.shadowColor = s.couleur;
    let qx = px, qy = py;
    for (let j = 1; j <= TR.segments; j++) {
      // Walking back along the arc from the current position. The points
      // array is the SAME one used by the line and the vehicle: the trail
      // therefore cannot leave the track.
      const tj = t - (j / TR.segments) * TR.share;
      if (tj < 0) break;                       // nothing behind at the start
      const kj = Math.min(points.length - 2, Math.floor(tj * (points.length - 1)));
      const fj = tj * (points.length - 1) - kj;
      const q0 = points[kj], q1 = points[kj + 1];
      if (!frontOfGlobe(q0) || !frontOfGlobe(q1)) break;
      const nx = q0[0] + (q1[0] - q0[0]) * fj, ny = q0[1] + (q1[1] - q0[1]) * fj;
      ctx.globalAlpha = fade * TR.opacity * (1 - j / TR.segments);
      ctx.lineWidth = s.epaisseur * 1.6 * (1 - j / (TR.segments * 1.4));
      ctx.beginPath(); ctx.moveTo(qx, qy); ctx.lineTo(nx, ny); ctx.stroke();
      qx = nx; qy = ny;
    }
    ctx.restore();

    ctx.save();
    ctx.globalAlpha = fade;
    ctx.setLineDash([]);
    ctx.fillStyle = "#ffffff";
    ctx.shadowBlur = 12; ctx.shadowColor = s.couleur;
    ctx.translate(px, py);
    ctx.rotate(Math.atan2(p1[1] - p0[1], p1[0] - p0[0]));
    drawVehicle(ctx, r.type, s.taille * kt);
    ctx.restore();
  }
}

export { adjacents, computeTransports, drawVehicle, cadence,
         angularGap, BOAT_THRESHOLD, PLANE_SHARE, PLANE_FLOOR, STREET_THRESHOLD,
         territoryRadii,
         TRAIN_WATER_SHARE, onLand, waterShare, VISIBLE, STYLE,
         arcPoints, frontOfGlobe, drawLinks, animate, zoomSpeed,
         terminal, visibleTerminals, drawStation, terminalAppear, drawTerminals };
