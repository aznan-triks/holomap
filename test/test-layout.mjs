import { check, summary } from "./harness.mjs";
import { PARAMS as PARAMS_PROD } from "../src/config.js";
import { computePositions, partition, extractBorders, cellUnder,
        extractCoast, chainBorders, closeLoops, smoothLine,
        extractContours, extractTerritoryContours, territoryReach,
        toSphere, fromSphere, normalize, distance2,
        coastNoise, reliefNoise, reliefField, seedLights,
        seedTerminals, MAX_PORTS, sampler } from "../src/layout.js";
import * as terrain from "../src/terrain.js";
// Test skin at a 2:1 ratio, like any projection of the globe. Settings are
// expressed as a chord on the unit sphere, not in pixels.
const PARAMS = {
  layout: { iterations: 60, repulsion: 0.0005, attraction: 0.02, cohesion: 0.10, step: 0.55 },
  // weightToArea deliberately modest: at too generous a reach, the heavy note
  // in the test set fully swallows its light neighbor (measured: 0 cell out
  // of 1250), the territory disappears and the region/country hierarchy
  // collapses for lack of a second cut. That's not a code defect — it's the
  // behavior of a power diagram — but a test set shouldn't trigger it, or it
  // no longer tests what it claims to test.
  grid: { cellWorld: 8, cellCountry: 4, lloyd: 1, weightToArea: 0.03, seaRadius: 0.02 },
  skin: { width: 400, height: 200 },
};

const build = () => ([
  { path: "a.md", links: ["b.md"], weight: 3, continent: "C1", country: "P1", region: "R1" },
  { path: "b.md", links: ["a.md"], weight: 1, continent: "C1", country: "P1", region: "R2" },
  { path: "c.md", links: [], weight: 1, continent: "C2", country: "P2", region: "R3" },
  // Second country in C1: without it, the "continent" and "country" cuts
  // would be identical and the hierarchy invariant would be empty.
  { path: "d.md", links: [], weight: 1, continent: "C1", country: "P3", region: "R4" },
]);

const n1 = computePositions(build(), PARAMS);
const n2 = computePositions(build(), PARAMS);
check("determinism", n1.every((n, i) => n.x === n2[i].x && n.y === n2[i].y));
check("positions on the skin", n1.every(n => n.x >= 0 && n.x <= 400 && n.y >= 0 && n.y <= 200));
// Each note really is a DIRECTION on the ball, not a point on a plane.
check("each note sits on the unit sphere",
  n1.every(n => n.v && Math.abs(Math.hypot(n.v[0], n.v[1], n.v[2]) - 1) < 1e-9));
// Round trip skin -> sphere -> skin: this is the correspondence everything
// else depends on (contours, hit-testing, rendering). If it drifts,
// everything drifts.
check("skin and sphere correspond exactly",
  n1.every(n => {
    const p = fromSphere(toSphere(n.x, n.y, PARAMS), PARAMS);
    return Math.abs(p[0] - n.x) < 1e-6 && Math.abs(p[1] - n.y) < 1e-6;
  }));

const g = partition(n1, PARAMS, PARAMS.grid.cellWorld);
// Areas are counted in REAL SURFACE, not cell count: on the ball, a cell
// near a pole is much smaller than one at the equator. Counting cells would
// overrate polar notes.
const areas = [0, 0, 0, 0];
for (let k = 0; k < g.cells.length; k++)
  if (g.cells[k] >= 0) areas[g.cells[k]] += g.areas[k];
check("area grows with weight", areas[0] > areas[1]);
check("the grid delivers the real surface of each cell",
  g.areas && g.areas.length === g.cells.length);
check("every cell is either owned or sea", g.cells.every(c => c >= -1 && c < 4));
// Fine but deliberate margin: the sea represents only a few cells out of
// 1500 in this test set. Without this check, removing the sea rule would go
// unnoticed.
check("the sea exists", g.cells.some(c => c === -1));

const fContinent = extractBorders(g, n1, "continent");
const f = extractBorders(g, n1, "country");
const fRegion = extractBorders(g, n1, "region");
check("country borders exist", f.length > 0);
check("strict border hierarchy: continent < country < region",
  fContinent.length < f.length && f.length < fRegion.length);
check("consistent hit-testing", cellUnder(g, n1[0].x, n1[0].y) === 0);
check("hit-testing: each note falls on its own territory",
  n1.every((n, i) => cellUnder(g, n.x, n.y) === i));
// On the sphere there's no more "off canvas" in longitude: the world wraps
// on itself. A point one full turn further therefore points to the exact
// same cell. In latitude, however, beyond a pole there is nothing.
const L = PARAMS.skin.width, Hp = PARAMS.skin.height;
check("hit-testing: longitude wraps onto itself",
  cellUnder(g, n1[0].x, n1[0].y) === cellUnder(g, n1[0].x + L, n1[0].y) &&
  cellUnder(g, n1[0].x, n1[0].y) === cellUnder(g, n1[0].x - L, n1[0].y));
check("hit-testing: beyond a pole returns -1",
  cellUnder(g, 10, -10) === -1 && cellUnder(g, 10, Hp + 100) === -1);

// --- Chaining and smoothing coastlines ------------------------------------
// extractBorders returns only isolated bits of cell edge, all grid-aligned:
// drawn as-is, they look like a staircase. Chaining stitches them into
// polylines, smoothing rounds the steps.

const square = [ // 4 sides of a 10-unit cell, given out of order
  { x1: 10, y1: 0,  x2: 10, y2: 10 },
  { x1: 0,  y1: 0,  x2: 10, y2: 0  },
  { x1: 0,  y1: 10, x2: 10, y2: 10 },
  { x1: 0,  y1: 0,  x2: 0,  y2: 10 },
];
const cs = chainBorders(square);
check("chaining: a square gives a single line", cs.length === 1);
check("chaining: the loop is closed (5 points, first = last)",
  cs[0].length === 5 && cs[0][0][0] === cs[0][4][0] && cs[0][0][1] === cs[0][4][1]);

// No segment must be lost or counted twice: the sum of edges in the
// resulting lines equals the number of input segments.
const enL = [
  { x1: 0, y1: 0, x2: 10, y2: 0 },
  { x1: 10, y1: 0, x2: 10, y2: 10 },
  { x1: 10, y1: 10, x2: 20, y2: 10 },
];
const cl = chainBorders(enL);
check("chaining: open line stitched back into a single stroke",
  cl.length === 1 && cl[0].length === 4);
check("chaining: no segment lost or duplicated",
  chainBorders(square.concat(enL)).reduce((s, l) => s + l.length - 1, 0) === 7);

// A T junction (3 segments on the same vertex) has no unique continuation:
// chaining must stop there rather than pick one at random.
const tJunction = [
  { x1: 0, y1: 0, x2: 10, y2: 0 },
  { x1: 10, y1: 0, x2: 20, y2: 0 },
  { x1: 10, y1: 0, x2: 10, y2: 10 },
];
check("chaining: stops at a T junction",
  chainBorders(tJunction).length === 3);

const smoothSquare = smoothLine(cs[0], 2);
check("smoothing: the loop stays closed",
  smoothSquare[0][0] === smoothSquare[smoothSquare.length - 1][0] &&
  smoothSquare[0][1] === smoothSquare[smoothSquare.length - 1][1]);
check("smoothing: more points than at input", smoothSquare.length > cs[0].length);
check("smoothing: no point leaves the original envelope",
  smoothSquare.every(([x, y]) => x >= 0 && x <= 10 && y >= 0 && y <= 10));
// The real goal: no more right angles. On the smoothed square, every vertex
// must form a very open angle with its neighbors (rounded steps).
const minAngle = (l) => {
  let m = Math.PI;
  for (let i = 1; i < l.length - 1; i++) {
    const [ax, ay] = l[i - 1], [bx, by] = l[i], [cx, cy] = l[i + 1];
    const a = Math.atan2(ay - by, ax - bx), c = Math.atan2(cy - by, cx - bx);
    let d = Math.abs(a - c); if (d > Math.PI) d = 2 * Math.PI - d;
    m = Math.min(m, d);
  }
  return m;
};
check("smoothing: right angles disappear",
  minAngle(cs[0]) < Math.PI / 2 + 0.01 && minAngle(smoothSquare) > 2.0);

const open = smoothLine(cl[0], 2);
check("smoothing: an open line's endpoints don't move",
  open[0][0] === 0 && open[0][1] === 0 &&
  open[open.length - 1][0] === 20 && open[open.length - 1][1] === 10);
check("smoothing: 0 passes leaves the line unchanged",
  smoothLine(cl[0], 0).length === cl[0].length);
check("smoothing: a 2-point line is left intact",
  smoothLine([[0, 0], [5, 5]], 2).length === 2);

// On the real grid: contours stay within the canvas and cover just as much
// land as the raw segments (nothing lost in chaining). The coast
// (land/sea) is a strict subset of the continent borders: same segments on
// the sea side, but no interior border.
const coast = extractCoast(g);
const segKey = s => [s.x1, s.y1, s.x2, s.y2].join(",");
const continentSet = new Set(fContinent.map(segKey));
check("coast: at least one land/sea segment", coast.length > 0);
// The essential point: no INTERIOR border. A line between two neighboring
// continents (two land cells) has nothing to do in a silhouette.
const coastSet = new Set(coast.map(segKey));
// This test needs two continents that TOUCH. The four notes of the general
// test set, spread over a whole sphere, are far too distant to meet
// (measured: no shared border). So it gets its own set: two neighboring
// notes from different continents, with a reach that makes them meet.
{
  const NEIGHBOR = { layout: { iterations: 0, repulsion: 0, attraction: 0, cohesion: 0, step: 0 },
                   grid: { cellWorld: 8, lloyd: 0, weightToArea: 0.05, seaRadius: 0.02,
                             seaIrregularity: 0 },
                   skin: { width: 400, height: 200 } };
  const coast2 = [
    { path: "v1.md", links: [], weight: 1, continent: "CA", country: "PA", region: "RA" },
    { path: "v2.md", links: [], weight: 1, continent: "CB", country: "PB", region: "RB" },
  ];
  [[180, 100], [220, 100]].forEach(([x, y], i) => {
    coast2[i].x = x; coast2[i].y = y; coast2[i].v = toSphere(x, y, NEIGHBOR);
  });
  const gV = partition(coast2, NEIGHBOR, NEIGHBOR.grid.cellWorld);
  const fCV = extractBorders(gV, coast2, "continent");
  const coastV = new Set(extractCoast(gV).map(segKey));
  const betweenTwoLands = fCV.filter(s => {
    const mx = (s.x1 + s.x2) / 2, my = (s.y1 + s.y2) / 2, e = gV.size / 2;
    return s.x1 === s.x2
      ? cellUnder(gV, mx - e, my) >= 0 && cellUnder(gV, mx + e, my) >= 0
      : cellUnder(gV, mx, my - e) >= 0 && cellUnder(gV, mx, my + e) >= 0;
  });
  check("coast: two neighboring continents do touch", betweenTwoLands.length > 0);
  // The essential point: a line between two land cells has nothing to do in
  // a land/sea silhouette.
  check("coast: ignores borders between two lands",
    betweenTwoLands.every(s => !coastV.has(segKey(s))));
}
// Except for the polar rows (where the coast closes by construction, while
// extractBorders emits nothing there), the coast is a subset of continent
// borders. There's no more side edge: longitude wraps.
const onPole = s => s.y1 === 0 && s.y2 === 0
  || s.y1 >= PARAMS.skin.height && s.y2 >= PARAMS.skin.height;
check("coast: outside polar rows, every segment is a continent border",
  coast.filter(s => !onPole(s)).every(s => continentSet.has(segKey(s))));
// The real trap: a coastline that crossed through land would cut the
// silhouette and leave a hole in the fill.
const atSea = (x, y) => cellUnder(g, x, y) < 0;
check("coast: every segment truly separates from the sea",
  coast.every(s => {
    const mx = (s.x1 + s.x2) / 2, my = (s.y1 + s.y2) / 2, e = g.size / 2;
    return s.x1 === s.x2 ? atSea(mx - e, my) !== atSea(mx + e, my)
                         : atSea(mx, my - e) !== atSea(mx, my + e);
  }));

// The land fill is clipped against these contours: a single open line and
// the continent's silhouette would fall apart into pieces.
const loops = closeLoops(chainBorders(coast));
const isClosed = l => l[0][0] === l[l.length - 1][0] && l[0][1] === l[l.length - 1][1];
// Two land cells that only touch at a corner: four coastline pieces meet at
// that vertex, chaining stops there and returns open lines. This is the
// case closeLoops exists to catch.
const atCorner = [
  { x1: 0, y1: 0, x2: 10, y2: 0 }, { x1: 10, y1: 0, x2: 10, y2: 10 },
  { x1: 10, y1: 10, x2: 20, y2: 10 }, { x1: 10, y1: 10, x2: 10, y2: 20 },
  { x1: 0, y1: 20, x2: 10, y2: 20 }, { x1: 0, y1: 0, x2: 0, y2: 20 },
];
const raw = chainBorders(atCorner);
check("gluing: a 4-branch vertex leaves open lines",
  raw.some(l => !isClosed(l)));
check("gluing: those pieces become a closed loop again",
  closeLoops(raw).every(isClosed));
check("gluing: a line that can't close is forced closed",
  closeLoops([[[0, 0], [10, 0], [10, 10]]]).every(isClosed));
check("coast: all loops are closed after gluing",
  loops.length > 0 && loops.every(isClosed));
check("coast: gluing loses no segment",
  loops.reduce((s, l) => s + l.length - 1, 0) >= coast.length);
check("coast: the delivered contours are closed, smoothing included",
  extractContours(g, n1, "coast", 2).every(isClosed));

// THE test that matters: rendering fills the land by clipping against these
// contours. If they don't enclose the land cells, the map empties out —
// exactly what happened when the canvas-wrap was missing (512 cells
// recognized out of 11,926). Same rule as the canvas: evenodd.
const coastContours = extractContours(g, n1, "coast", 2);
const insideContour = (px, py) => {
  let crossings = 0;
  for (const l of coastContours)
    for (let i = 0; i < l.length - 1; i++) {
      const [x1, y1] = l[i], [x2, y2] = l[i + 1];
      if ((y1 > py) === (y2 > py)) continue;
      if (x1 + (py - y1) / (y2 - y1) * (x2 - x1) > px) crossings++;
    }
  return crossings % 2 === 1;
};
let landCells = 0, inside = 0;
for (let gy = 0; gy < g.height; gy++)
  for (let gx = 0; gx < g.width; gx++) {
    if (g.cells[gy * g.width + gx] < 0) continue;
    landCells++;
    if (insideContour(gx * g.size + g.size / 2, gy * g.size + g.size / 2)) inside++;
  }
// Not 100%: smoothing planes off corners, so a few edge cells fall outside.
// That's expected — beyond 2% it means the silhouette is leaking.
check("coast: the silhouette encloses the land (>= 98% of cells)",
  landCells > 0 && inside / landCells >= 0.98);

const contours = extractContours(g, n1, "continent", 2);
check("contours: at least one line on the real grid", contours.length > 0);
check("contours: every point stays within the canvas",
  contours.every(l => l.every(([x, y]) =>
    x >= -1 && y >= -1 && x <= PARAMS.skin.width + 1 && y <= PARAMS.skin.height + 1)));
check("contours: more points than raw segments (subdivision)",
  contours.reduce((s, l) => s + l.length, 0) > fContinent.length);

// --- A smoothed outline per territory --------------------------------------
// The coast settles the outer silhouette; internally, this is the outline
// that replaces the cell-by-cell fill and removes the staircase on borders
// between neighbors.
const terr = extractTerritoryContours(g, n1, 2, PARAMS);
check("territories: one contour bundle per note", terr.length === n1.length);
check("territories: every outline is closed",
  terr.every(ls => ls.every(isClosed)));
check("territories: every occupied note has at least one outline",
  terr.every((ls, i) => ls.length > 0 || !g.cells.includes(i)));
// The outline must enclose ITS note's cells and not another's, or two
// territories would overlap on screen.
const insideOutline = (lines, px, py) => {
  let n = 0;
  for (const l of lines)
    for (let i = 0; i < l.length - 1; i++) {
      const [x1, y1] = l[i], [x2, y2] = l[i + 1];
      if ((y1 > py) === (y2 > py)) continue;
      if (x1 + (py - y1) / (y2 - y1) * (x2 - x1) > px) n++;
    }
  return n % 2 === 1;
};
let own = 0, total = 0, atOthers = 0;
for (let gy = 0; gy < g.height; gy += 2)
  for (let gx = 0; gx < g.width; gx += 2) {
    const i = g.cells[gy * g.width + gx];
    if (i < 0) continue;
    const px = gx * g.size + g.size / 2, py = gy * g.size + g.size / 2;
    total++;
    if (insideOutline(terr[i], px, py)) own++;
    for (let j = 0; j < terr.length; j++)
      if (j !== i && insideOutline(terr[j], px, py)) { atOthers++; break; }
  }
check("territories: the outline encloses its own note's cells (>= 97%)",
  total > 0 && own / total >= 0.97);
check("territories: it doesn't encroach on neighbors (<= 3%)",
  atOthers / total <= 0.03);

// --- Interior borders stick to the exact bisector --------------------------
//
// The partition is a power diagram: between two notes, the boundary is a
// LINE. The grid rasterizes it into a staircase, and corner-cutting only
// planes off the angle — measured on the real map, the offset from the
// ten-cell chord stops moving past 2 passes (1.04 px at 2 passes, 1.03 at
// 4, 1.02 at 8). Hence snapping to the bisector, the only thing able to
// remove the step itself.

// Exact case: two notes of equal weight, no sea, oblique bisector (so
// rasterized into a staircase). After snapping, every interior vertex must
// be equidistant from the two notes.
// On the sphere, the locus of points equidistant in score between two
// notes is the intersection of a PLANE with the ball, so a circle. With
// |a| = |b| = 1, the condition |p-a|^2 - wa = |p-b|^2 - wb reduces to
// 2(b-a).p = wa - wb. The quantity to measure is therefore the point's
// distance to that plane.
const FLAT = { layout: { iterations: 0, repulsion: 0, attraction: 0, cohesion: 0, step: 0.1 },
               grid: { cellWorld: 8, lloyd: 0, weightToArea: 0, seaRadius: 5, seaIrregularity: 0 },
               skin: { width: 400, height: 200 } };
const duo = [
  { path: "g.md", links: [], weight: 1, continent: "C", country: "PG", region: "R" },
  { path: "h.md", links: [], weight: 1, continent: "C", country: "PD", region: "R" },
];
// Two well-spaced notes, but far from the poles: there the skin's cells
// degenerate into slivers and the measurement would no longer mean much.
[[110, 70], [300, 130]].forEach(([x, y], i) => {
  duo[i].x = x; duo[i].y = y; duo[i].v = toSphere(x, y, FLAT);
});
const gDuo = partition(duo, FLAT, FLAT.grid.cellWorld);
// Only polar vertices are excluded: longitude wraps, there's no more side
// edge where the border would be truncated.
const onPoleDuo = ([, y]) => y <= 0 || y >= FLAT.skin.height - 1e-9;
const bisectorGap = ([x, y]) => {
  const p = toSphere(x, y, FLAT);
  const u = [duo[1].v[0] - duo[0].v[0], duo[1].v[1] - duo[0].v[1], duo[1].v[2] - duo[0].v[2]];
  const n = Math.hypot(u[0], u[1], u[2]);
  return Math.abs(2 * (u[0] * p[0] + u[1] * p[1] + u[2] * p[2])) / (2 * n);
};
const duoRaw = chainBorders(extractBorders(gDuo, duo, "country"));
const duoSnapped = extractContours(gDuo, duo, "country", 0, FLAT);
check("bisector: the raw border really is a staircase",
  Math.max(...duoRaw.flat().filter(p => !onPoleDuo(p)).map(bisectorGap)) > 0.005);
check("bisector: after snapping, every interior vertex is on the exact circle",
  duoSnapped.flat().filter(p => !onPoleDuo(p)).every(p => bisectorGap(p) < 1e-9));

// On the real grid: the step disappears where smoothing alone plateaued.
// Offset from the ten-cell chord, median over all vertices.
const roughness = (lines, cells) => {
  const k = Math.max(1, Math.round(cells * lines.step));
  const e = [];
  for (const l of lines.lines) {
    if (l.length < 2 * k + 1) continue;
    for (let i = k; i < l.length - k; i++) {
      const [ax, ay] = l[i - k], [bx, by] = l[i + k], [px, py] = l[i];
      const dx = bx - ax, dy = by - ay, n = Math.hypot(dx, dy) || 1;
      e.push(Math.abs((px - ax) * dy - (py - ay) * dx) / n);
    }
  }
  e.sort((a, b) => a - b);
  return e[e.length >> 1];
};
// At equal passes, a starting point weighs 2^passes points: the window is
// expressed in grid cells to compare the same length of coast.
const PASSES = 2;
// Measured on a DENSE set, and this is essential: snapping only moves
// borders between two lands, never coasts (their irregularity is
// deliberate). On the four-note set, spread over a whole sphere, 46 border
// segments out of 51 are actually coasts — the measurement would be
// drowned out by vertices snapping is instructed not to touch, and the
// test would no longer say anything about what it claims to verify.
const DENSE = { layout: { iterations: 120, repulsion: 0.0005, attraction: 0.02,
                          cohesion: 0.10, step: 0.55 },
                grid: { cellWorld: 4, cellCountry: 4, lloyd: 1, weightToArea: 0.05,
                          seaRadius: 0.004, seaIrregularity: 1.5 },
                skin: { width: 400, height: 200 } };
const dense = Array.from({ length: 40 }, (_, i) => ({
  path: "D/c" + (i % 4) + "/n" + i + ".md",
  continent: "c" + (i % 4), country: "c" + (i % 4) + "-p" + (i % 7),
  region: "c" + (i % 4) + "-r" + (i % 11),
  weight: 0.5 + ((i * 29) % 100) / 100 * 2.5, links: [],
}));
computePositions(dense, DENSE);
const gDense = partition(dense, DENSE, DENSE.grid.cellWorld);
const withoutSnap = { lines: chainBorders(extractBorders(gDense, dense, "country"))
                                .map(l => smoothLine(l, PASSES)), step: 2 ** PASSES / 2 };
const withSnap = { lines: extractContours(gDense, dense, "country", PASSES, DENSE),
                      step: 2 ** PASSES / 2 };
// SHORT measurement window, and that's what makes the test valid.
//
// Measured over ten cells, the median roughness didn't budge by a
// thousandth: only fifteen lines out of ninety-two are long enough to enter
// such a window, and those are the coasts — which snapping is specifically
// told not to touch. Interior borders, meanwhile, are short and were never
// measured. The test therefore seemed to record a snapping failure while it
// was looking in the wrong place.
check("bisector: residual roughness drops at least 3x on the real grid",
  roughness(withoutSnap, 1) / roughness(withSnap, 1) >= 3);

// The coast, on the other hand, is NOT a bisector but the rippled sea
// threshold: its vertices must stay exactly where the grid puts them, or
// the deliberate coastline irregularity would be destroyed.
check("bisector: coast vertices are not moved",
  extractContours(g, n1, "coast", 0, PARAMS).flat()
    .every(([x, y]) => Math.abs(x / g.size - Math.round(x / g.size)) < 1e-9
                    && Math.abs(y / g.size - Math.round(y / g.size)) < 1e-9));

// --- A closed world, and nobody forgotten ----------------------------------
//
// The question "is the land cut by the edge" no longer makes sense: a
// sphere has no edge. The whole margin apparatus it used to justify is gone
// from the code.
//
// The risk has changed nature. On a closed map, what can be lost is no
// longer a piece of land, it's a NOTE: a light note stuck to a heavy
// neighbor can be fully swallowed and end up with no territory at all — so
// invisible and unreachable on the map. Measured by calibrating settings:
// this is exactly what happens when the reach is too generous.
const REAL = PARAMS_PROD;
const DOMAINS_T = ["Dev et IA", "Contenu et création", "Relations",
                    "Professionnel", "Études", "Terra Incognita"];
const many = Array.from({ length: 58 }, (_, i) => ({
  path: "T/" + DOMAINS_T[i % 6] + "/n" + i + ".md",
  continent: DOMAINS_T[i % 6], country: DOMAINS_T[i % 6] + "-p" + (i % 3),
  region: DOMAINS_T[i % 6] + "-r" + (i % 5),
  weight: 0.4 + ((i * 37) % 100) / 100 * 3.2, links: [],
}));
computePositions(many, REAL);
const gr = partition(many, REAL, REAL.grid.cellWorld);
const surface = new Float64Array(many.length);
let landT = 0, totT = 0;
for (let k = 0; k < gr.cells.length; k++) {
  totT += gr.areas[k];
  const i = gr.cells[k];
  if (i >= 0) { surface[i] += gr.areas[k]; landT += gr.areas[k]; }
}
check("world: no note is entirely swallowed by its neighbors",
  Array.from(surface).every(a => a > 0));
// There must still be sea: a world entirely covered in land has no more
// coasts or silhouette, and the map loses its readability.
check("world: the sea occupies a sizeable share of the globe",
  landT / totT > 0.15 && landT / totT < 0.75);

// A domain must form a CONTINENT, not a string of round islets. This is an
// explicit user requirement, and the defect was real: at too short a reach,
// each note becomes an isolated dot surrounded by sea.
// We count the single-piece land chunks (longitude wrapping), and require
// there not to be much more of them than there are domains.
{
  const domains = new Set(many.map(n => n.continent)).size;
  const seen = new Int8Array(gr.cells.length);
  let pieces = 0;
  for (let k = 0; k < gr.cells.length; k++) {
    if (seen[k] || gr.cells[k] < 0) continue;
    pieces++;
    const stack = [k]; seen[k] = 1;
    while (stack.length) {
      const c = stack.pop(), cy = (c / gr.width) | 0, cx = c % gr.width;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = ((cx + dx) % gr.width + gr.width) % gr.width, ny = cy + dy;
        if (ny < 0 || ny >= gr.height) continue;
        const j = ny * gr.width + nx;
        if (!seen[j] && gr.cells[j] >= 0) { seen[j] = 1; stack.push(j); }
      }
    }
  }
  check("world: domains form continents, not an archipelago of dots",
    pieces <= domains * 1.5);
  // And the territories touch each other: without adjacency, no interior
  // border to trace, and the map loses all structure.
  let adjacencies = 0;
  for (let gy = 0; gy < gr.height; gy++)
    for (let gx = 0; gx < gr.width; gx++) {
      const a = gr.cells[gy * gr.width + gx];
      if (a < 0) continue;
      const b = gr.cells[gy * gr.width + (gx + 1) % gr.width];
      if (b >= 0 && b !== a) adjacencies++;
    }
  check("world: neighboring territories touch each other", adjacencies > 50);
}

// --- Lock: smaller territories, wider straits -------------------------------
//
// User feedback from 07/26: "territories are too big for 58 notes".
// Measured with a scratch scan before touching the code:
// weightToArea/seaRadius brought down (0.022/0.004 -> 0.012/0.0020) reduce
// land from 39.8% to 26.7% on this same 58-note set, WITHOUT hurting the
// area correlations (they go up), and freely widen the straits between
// neighboring continents (median 24.9deg -> 37.8deg).
//
// This lock freezes the result, not the method: if a future setting
// inflates territories again below this floor, it's the setting that
// should be revisited, not this check.
{
  // Strait width between two neighboring continents: shortest angular
  // distance (in degrees of arc) between a COAST cell of one and a COAST
  // cell of the other. We only look at coast cells (land with at least one
  // sea neighbor): comparing all land cells would give the same answer but
  // cost far more for nothing.
  const sea = (gx, gy) => {
    if (gy < 0 || gy >= gr.height) return true;
    const x = ((gx % gr.width) + gr.width) % gr.width;
    return gr.cells[gy * gr.width + x] < 0;
  };
  const coastByContinent = new Map();
  for (const name of new Set(many.map(n => n.continent))) coastByContinent.set(name, []);
  let landLatMax = 0;
  for (let gy = 0; gy < gr.height; gy++)
    for (let gx = 0; gx < gr.width; gx++) {
      const i = gr.cells[gy * gr.width + gx];
      if (i < 0) continue;
      const lat = Math.abs((0.5 - ((gy + 0.5) * gr.size) / REAL.skin.height) * 180);
      if (lat > landLatMax) landLatMax = lat;
      if (sea(gx + 1, gy) || sea(gx - 1, gy) || sea(gx, gy + 1) || sea(gx, gy - 1)) {
        const p = toSphere(gx * gr.size + gr.size / 2, gy * gr.size + gr.size / 2, REAL);
        coastByContinent.get(many[i].continent).push(p);
      }
    }
  // Subsampling: only the comparative measurement matters, not the last
  // degree of precision, and the real grid is 512 x 256 cells.
  const SAMPLE = 250;
  for (const [name, arr] of coastByContinent) {
    if (arr.length <= SAMPLE) continue;
    const step = arr.length / SAMPLE, sub = [];
    for (let i = 0; i < SAMPLE; i++) sub.push(arr[Math.floor(i * step)]);
    coastByContinent.set(name, sub);
  }
  const names = [...coastByContinent.keys()];
  const straits = [];
  for (let a = 0; a < names.length; a++)
    for (let b = a + 1; b < names.length; b++) {
      const A = coastByContinent.get(names[a]), B = coastByContinent.get(names[b]);
      if (!A.length || !B.length) continue;
      let dmin = Infinity;
      for (const p of A)
        for (const q of B) {
          const dot = Math.max(-1, Math.min(1, p[0]*q[0] + p[1]*q[1] + p[2]*q[2]));
          const d = Math.acos(dot) * 180 / Math.PI;
          if (d < dmin) dmin = d;
        }
      straits.push(dmin);
    }
  straits.sort((x, y) => x - y);
  const straitMedian = straits[(straits.length / 2) | 0];

  // Upper bound on land latitude: measured at 55.2deg with the settings in
  // use (landLatitude 64deg, the land doesn't reach the set limit on this
  // set). 60deg leaves a comfortable margin without falling back into the
  // old defect (land climbing to 57-58deg or higher).
  check("world: land no longer climbs past 60 degrees of latitude",
    landLatMax <= 60);
  // Floor on the median strait width: measured at 37.8deg after tightening
  // territories, versus 24.9deg before. 30deg leaves margin while
  // forbidding a silent return to bigger territories.
  check("world: median strait width stays above 30 degrees",
    straitMedian >= 30);
}
// --- The poles remain ocean -------------------------------------------------
// Reported from Obsidian: "some continents are at the poles". It's the
// worst spot on the map (squashed skin, camera with no north reference).
// Land is now confined to a latitude band.
{
  const limit = Math.asin(REAL.layout.latitudeBand) * 180 / Math.PI;
  const lat = n => Math.asin(Math.max(-1, Math.min(1, n.v[2]))) * 180 / Math.PI;
  // 8-degree margin: link attraction can pull a note a bit past its
  // domain's anchor, which is healthy — what's forbidden is a continent ON
  // the pole.
  check("poles: no note settles beyond the habitable band",
    many.every(n => Math.abs(lat(n)) < limit + 8));
  check("poles: the band still leaves two thirds of the globe",
    limit > 45 && limit < 70);
  // And the polar cap is indeed free of land.
  {
    const rows = Math.max(1, Math.round(gr.height * 0.06));
    let polarLand = 0;
    for (let gy = 0; gy < rows; gy++)
      for (let gx = 0; gx < gr.width; gx++) {
        if (gr.cells[gy * gr.width + gx] >= 0) polarLand++;
        if (gr.cells[(gr.height - 1 - gy) * gr.width + gx] >= 0) polarLand++;
      }
    check("poles: the caps are ocean", polarLand === 0);
  }
}

check("reach: a territory's reach grows with weight",
  territoryReach({ weight: 5 }, REAL) > territoryReach({ weight: 1 }, REAL));

// --- The coast is not a circle ----------------------------------------------
// The sea threshold is a constant radius: without noise, an isolated note
// gives a perfect disk, and the world looks like a string of bubbles.
// The noise is now evaluated on the DIRECTION, in three dimensions:
// evaluated in latitude/longitude it would seam at the antimeridian and
// squash at the poles.
const noise = coastNoise(REAL);
const onSphere = (lat, lon) => {
  const cl = Math.cos(lat);
  return [cl * Math.cos(lon), cl * Math.sin(lon), Math.sin(lat)];
};
const bs = (lat, lon) => noise(...onSphere(lat, lon));
check("coast noise: deterministic", bs(0.3, 0.7) === bs(0.3, 0.7));
check("coast noise: bounded between -1 and 1",
  Array.from({ length: 500 }, (_, k) => bs(k * 0.013 - 3, k * 0.031)).every(v => v >= -1 && v <= 1));
check("coast noise: continuous (two neighboring points look alike)",
  Math.abs(bs(0.3, 0.7) - bs(0.3, 0.703)) < 0.05);
check("coast noise: varies over the scale of a coastline",
  Math.abs(bs(0.3, 0.7) - bs(0.5, 1.0)) > 0.05);
// The antimeridian seam must not show: it's the same place in the world
// seen from both sides of the skin.
check("coast noise: no seam at the antimeridian",
  Math.abs(bs(0.2, Math.PI - 1e-4) - bs(0.2, -Math.PI + 1e-4)) < 1e-3);

// A single note: measure the radius of its land in every direction around
// it, on the skin. A disk would give the same everywhere.
const alone = [{ path: "s.md", links: [], weight: 2, continent: "C", country: "P", region: "R" }];
alone[0].x = REAL.skin.width / 2; alone[0].y = REAL.skin.height / 2;
alone[0].v = toSphere(alone[0].x, alone[0].y, REAL);
const gAlone = partition(alone, REAL, REAL.grid.cellWorld);
const radii = [];
for (let a = 0; a < 64; a++) {
  const dx = Math.cos(a * Math.PI / 32), dy = Math.sin(a * Math.PI / 32);
  let r = 0;
  while (r < 400 && cellUnder(gAlone, alone[0].x + dx * r, alone[0].y + dy * r) >= 0) r += 1;
  radii.push(r);
}
const rMin = Math.min(...radii), rMax = Math.max(...radii);
check("coast: the line ripples (min/max radius differ by at least 15%)",
  rMin > 0 && (rMax - rMin) / rMax > 0.15);
check("coast: the ripple stays measured (no more than 60% spread)",
  (rMax - rMin) / rMax < 0.6);

// --- Area is earned by content ----------------------------------------------
//
// This is the promise of the chosen partition (power diagram): a
// territory's area must follow its note's weight, and a continent's area
// the cumulative weight of its notes. It had been silently lost — the
// FIXED share of the sea threshold represented 87% of a territory's reach,
// so a note sixteen times heavier only had a radius 1.4 times bigger. A
// large stretch of land showed nothing more than a small one: emptiness.
{
  const cont = [["A", 12], ["B", 8], ["C", 5]];
  let g = 4242;
  const r = () => { g = (Math.imul(g, 1664525) + 1013904223) >>> 0; return g / 4294967296; };
  const nn = [];
  for (const [c, nb] of cont)
    for (let i = 0; i < nb; i++)
      nn.push({ path: c + "/" + i, continent: c, country: "p" + (i % 3), region: "r",
                links: [], status: r() < 0.5 ? "active" : "to sort",
                inArchive: r() < 0.1, quest: false });
  for (const a of nn) {
    const d = Math.floor(r() * 5);
    for (let j = 0; j < d; j++) { const b = nn[Math.floor(r() * nn.length)]; if (b !== a) a.links.push(b.path); }
  }
  for (const n of nn) n.weight = 1 + 0.5 * n.links.length * (n.status === "active" ? 1.3 : 1);

  computePositions(nn, REAL);
  const gr = partition(nn, REAL, REAL.grid.cellWorld);
  // REAL surface, not cell count: on the ball a polar cell is tiny,
  // counting it like an equatorial one would skew the whole block.
  const areas = new Array(nn.length).fill(0);
  for (let k = 0; k < gr.cells.length; k++)
    if (gr.cells[k] >= 0) areas[gr.cells[k]] += gr.areas[k];

  const correlation = (x, y) => {
    const n = x.length, mx = x.reduce((a, b) => a + b) / n, my = y.reduce((a, b) => a + b) / n;
    let sxy = 0, sxx = 0, syy = 0;
    for (let i = 0; i < n; i++) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) ** 2; syy += (y[i] - my) ** 2; }
    return sxy / Math.sqrt(sxx * syy);
  };
  check("area: a territory's area follows its note's weight (correlation >= 0.65)",
    correlation(nn.map(n => n.weight), areas) >= 0.65);

  const byCont = new Map();
  nn.forEach((n, i) => {
    const e = byCont.get(n.continent) || { p: 0, a: 0 };
    e.p += n.weight; e.a += areas[i]; byCont.set(n.continent, e);
  });
  const cc = [...byCont.values()];
  check("area: a continent's area follows the cumulative weight of its notes (correlation >= 0.9)",
    correlation(cc.map(e => e.p), cc.map(e => e.a)) >= 0.9);

  // The ratio itself, not just the trend: between the lightest third and
  // the heaviest third, the area gap must be of the same order as the
  // weight gap. Too small = unearned area (the fixed defect); too big =
  // light notes disappear from the map.
  const sorted = nn.map((n, i) => ({ p: n.weight, a: areas[i] })).sort((x, y) => x.p - y.p);
  const t = Math.floor(sorted.length / 3);
  const avg = l => ({ p: l.reduce((s, e) => s + e.p, 0) / l.length,
                      a: l.reduce((s, e) => s + e.a, 0) / l.length });
  const low = avg(sorted.slice(0, t)), high = avg(sorted.slice(-t));
  const weightRatio = high.p / low.p, areaRatio = high.a / low.a;
  check("area: a heavier third occupies at least as much land, proportionally",
    areaRatio >= weightRatio * 0.8);
  check("area: without crushing light notes either (less than 3x the proportion)",
    areaRatio <= weightRatio * 3);

  // Guard on the SETTINGS themselves: it's the fixed share that had
  // drowned everything (it was then worth 87% of a territory's reach). It
  // must stay, at most, of the same order as the weight-dependent share.
  // The two terms compare directly: both are squared chords on the unit
  // sphere.
  //
  // The threshold loosened from "strictly smaller" to "not bigger" on
  // 07/25: more land was needed for domains to stop being isolated islands
  // (reported from Obsidian). The real invariant isn't in this settings
  // ratio but in the three area checks above, which measure the result —
  // they stay green.
  check("area: a territory's fixed share doesn't exceed the weight share",
    REAL.grid.seaRadius <= REAL.grid.weightToArea);
}

// --- Terrain relief ----------------------------------------------------------
// Shading must bring NEW visual information: if it hugs the coast, it only
// draws what's already visible. Hence the different octaves.
const bRelief = reliefNoise();
const br = (lat, lon) => bRelief(...onSphere(lat, lon));
check("relief: deterministic", br(0.4, 1.1) === br(0.4, 1.1));
check("relief: bounded between -1 and 1",
  Array.from({ length: 500 }, (_, k) => br(k * 0.0057 - 1.4, k * 0.023)).every(v => v >= -1 && v <= 1));
// Correlation between the coast field and the relief field, sampled on the
// sphere: two similar fields would give a strong correlation.
let sc = 0, sr = 0, scc = 0, srr = 0, scr = 0, nSamp = 0;
for (let j = 1; j < 60; j++)
  for (let i = 0; i < 120; i++) {
    const lat = (j / 60 - 0.5) * Math.PI, lon = (i / 120 * 2 - 1) * Math.PI;
    const a = bs(lat, lon), b = br(lat, lon);
    sc += a; sr += b; scc += a * a; srr += b * b; scr += a * b; nSamp++;
  }
const correl = (scr / nSamp - (sc / nSamp) * (sr / nSamp))
             / Math.sqrt((scc / nSamp - (sc / nSamp) ** 2) * (srr / nSamp - (sr / nSamp) ** 2));
check("relief: decorrelated from the coast (|r| < 0.3), or mountains would hug bays",
  Math.abs(correl) < 0.3);

const relief = reliefField(REAL, 2);
check("relief: image at half the skin's resolution",
  relief.width === Math.ceil(REAL.skin.width / 2)
  && relief.height === Math.ceil(REAL.skin.height / 2));
// Shading must glue back together at the antimeridian: the last column and
// the first describe the same place in the world. A sharp difference there
// would be a cliff invented in the middle of a continent.
{
  const l = relief.width, mid = relief.height >> 1;
  check("relief: no cliff at the antimeridian",
    Math.abs(relief.shade[mid * l] - relief.shade[mid * l + l - 1]) < 0.5);
}
check("relief: shading bounded between -1 and 1",
  Array.from(relief.shade).every(v => v >= -1 && v <= 1));
// A flat (or fully black) shading would draw no relief at all: we want
// both lit slopes AND slopes in shadow.
const lit = Array.from(relief.shade).filter(v => v > 0.2).length;
const dark = Array.from(relief.shade).filter(v => v < -0.2).length;
check("relief: there are lit slopes and slopes in shadow",
  lit > relief.shade.length * 0.05 && dark > relief.shade.length * 0.05);
check("relief: deterministic from one mount to the next",
  reliefField(REAL, 2).shade[5000] === relief.shade[5000]);
// The whole mount must not become sluggish because of relief: it's
// computed only once, but a single slow computation shows at opening.
const tRelief0 = Date.now();
reliefField(REAL, 2);
check("relief: computed in under 150 ms at mount", Date.now() - tRelief0 < 150);

// --- City lights -------------------------------------------------------------
//
// Look gap diagnosed then left uncoded for a while: the reference shows a
// DENSE texture of small tight golden dots, city-lights-at-night style, and
// that's what gives territories their visual relief. Rendering only had one
// per note (some sixty over the whole planet): the texture didn't read at
// all.
//
// The sample is computed once at mount time. It lives here, not in the
// renderer, to be checkable outside the browser — the only way to guarantee
// the invariant that matters: no light must fall outside its territory
// (otherwise a city glows on the sea or at the neighbor's).
{
  const tLight0 = Date.now();
  const sample = seedLights(gr, many, REAL);
  const msLight = Date.now() - tLight0;

  check("lights: one bundle per note", sample.length === many.length);
  check("lights: every note is lit",
    sample.every(p => p.length > 0));
  // The central invariant: a light belongs to ITS note's territory.
  check("lights: none falls outside its territory",
    sample.every((bundle, i) => bundle.every(([x, y]) => cellUnder(gr, x, y) === i)));
  check("lights: finite coordinates within the skin",
    sample.every(p => p.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y)
      && x >= 0 && x < REAL.skin.width && y >= 0 && y < REAL.skin.height)));
  // Density must follow content, like area: a heavy note is a big city, a
  // light one a hamlet.
  {
    const byWeight = many.map((n, i) => [n.weight, sample[i].length])
                             .sort((a, b) => a[0] - b[0]);
    check("lights: more lights on heavy notes",
      byWeight[byWeight.length - 1][1] > byWeight[0][1]);
  }
  // Dense enough to read as a texture, but not so much it whites out the
  // map: both bounds were found on captures.
  {
    const total = sample.reduce((s, p) => s + p.length, 0);
    check("lights: a few thousand lights across the planet",
      total > 1500 && total < 9000);
  }
  // A sample clustered on the note's center would make a dot, not a city.
  {
    const i = many.reduce((m, n, k) => (n.weight > many[m].weight ? k : m), 0);
    const spread = sample[i].some(([x, y]) =>
      Math.hypot(x - many[i].x, y - many[i].y) > 6);
    check("lights: spread over the territory, not stacked at the center", spread);
  }
  check("lights: deterministic from one mount to the next",
    JSON.stringify(seedLights(gr, many, REAL)) === JSON.stringify(sample));
  check("lights: seeded in under 100 ms at mount", msLight < 100);
}

// --- Stations, ports and airports -------------------------------------------
//
// Report from Obsidian: "boats must leave from the coasts", and "separate
// airports, ports and stations when a territory has several". Both come
// down to the same invariant, checkable only outside the browser: a port is
// a COASTAL cell of its note, an airport an INTERIOR cell of its note, and
// a given note's three terminals sit at distinct places.
{
  const tT0 = Date.now();
  const terminals = seedTerminals(gr, many, REAL);
  const msTerminals = Date.now() - tT0;

  const sea = (gx, gy) => {
    if (gy < 0 || gy >= gr.height) return true;
    const x = ((gx % gr.width) + gr.width) % gr.width;
    return gr.cells[gy * gr.width + x] < 0;
  };
  const cellOf = v => {
    const [x, y] = fromSphere(v, REAL);
    return [Math.floor(x / gr.size), Math.floor(y / gr.size), cellUnder(gr, x, y)];
  };

  check("terminals: one bundle per note", terminals.length === many.length);
  check("terminals: also written on the note (routes.js reads them from there)",
    many.every((n, i) => n.terminals === terminals[i]));
  check("terminals: all placed on the unit sphere",
    terminals.every(t => [t.station, t.airport, ...t.ports].every(v =>
      Math.abs(Math.hypot(v[0], v[1], v[2]) - 1) < 1e-9)));

  // The INVARIANT of the user report: a port is at the water's edge, at home.
  check("ports: each is a coast cell of ITS note",
    terminals.every((t, i) => t.ports.every(v => {
      const [gx, gy, note] = cellOf(v);
      return note === i && (sea(gx + 1, gy) || sea(gx - 1, gy) || sea(gx, gy + 1) || sea(gx, gy - 1));
    })));
  check("ports: at least one note has several (otherwise nothing to distinguish)",
    terminals.some(t => t.ports.length > 1));
  check("ports: never more than the cap", terminals.every(t => t.ports.length <= MAX_PORTS));
  // Taken in grid order (read row by row), ports would all crowd onto the
  // same stretch: a territory would only have one seafront.
  check("ports: spread apart from each other, not stacked",
    terminals.filter(t => t.ports.length > 2).every(t => {
      let max = 0;
      for (const a of t.ports) for (const b of t.ports) max = Math.max(max, distance2(a, b));
      return max > 1e-4;
    }));

  // A runway at the water's edge would be a port: the airport is inland.
  check("airports: placed on an interior cell of their note",
    terminals.every((t, i) => {
      const [gx, gy, note] = cellOf(t.airport);
      if (note !== i) return false;
      return !(sea(gx + 1, gy) || sea(gx - 1, gy) || sea(gx, gy + 1) || sea(gx, gy - 1));
    }));
  // User report: "some planes land too close to the edge". The old rule
  // took the cell furthest along a direction, so the last one before the
  // sea by construction. We now require a real setback.
  {
    // FIXED radius, not the setting: a check that re-reads the setting it's
    // monitoring always passes no matter what's put there.
    //
    // Honesty about what this check proves: on THIS test set, the old rule
    // already satisfied the setback (measured with a probe — the furthest
    // cell falls at the territory's edge, and most edges are land borders,
    // not coasts). It doesn't reproduce the reported case; it locks the
    // invariant so it can no longer depend on the luck of the cut.
    const r = 3;
    const offshore = (gx, gy) => {
      for (let dy = -r; dy <= r; dy++)
        for (let dx = -r; dx <= r; dx++) if (sea(gx + dx, gy + dy)) return false;
      return true;
    };
    // Tolerance: a territory too small to hold a (2r+1) square has no
    // choice, and the fallback still places it on land (verified just
    // above). So we require it to be the EXCEPTION, not the rule.
    //
    // Strict equality only held by luck, not by construction: it predated
    // the guaranteed-core fix in the polar fade zone (see
    // partition/sampler in layout.js). A note that BEFORE that fix had no
    // territory at all (so no entry in this test) now gets one, tiny and
    // irregularly shaped — measured on this test set: 1 note out of 58 (67
    // cells, versus 68 for the next one, which passes: it's the shape, not
    // just the size, that decides). This is exactly the "territory too
    // small" case this test already documents as a legitimate exception —
    // requiring zero conflated it with the rule. 5% tolerance, rounded up
    // (a wide bound, not calibrated to this exact test set).
    const withinReach = terminals.filter(t => { const [gx, gy] = cellOf(t.airport); return offshore(gx, gy); });
    const tolerance = Math.ceil(terminals.length * 0.05);
    check("airports: away from the water, not glued to the coast (except for too-small territories, an exception)",
      withinReach.length >= terminals.length - tolerance);
  }
  // The heart of "we can't tell the three apart": if they're at the same
  // point, no drawing will ever separate them.
  check("terminals: airport and station at distinct places",
    terminals.every(t => distance2(t.airport, t.station) > 1e-8));
  check("terminals: no port confused with the station",
    terminals.every(t => t.ports.every(p => distance2(p, t.station) > 1e-8)));

  check("terminals: deterministic from one mount to the next",
    JSON.stringify(seedTerminals(gr, many, REAL)) === JSON.stringify(terminals));
  check("terminals: seeded in under 150 ms at mount", msTerminals < 150);

  // User report (07/28): ports/airports/lights off the coast as seen from
  // the ACTUALLY PAINTED terrain mesh — a defect the tests above couldn't
  // see, since they only check the fine grid, never the coarser mesh from
  // `terrain.js`. This test replays the mesh at a size that's in NONE of
  // the reference sizes used by `createTerrainConfirmer` (see layout.js) —
  // otherwise the check would lie to itself by confirming against the
  // exact geography it used to pick the candidates.
  {
    const confirmedTerminals = seedTerminals(gr, many, REAL, terrain);
    const confirmedLights = seedLights(gr, many, REAL, terrain);
    const probeT = sampler(many, REAL, REAL.grid.cellWorld);
    const nV = terrain.siteLevel(1650, 980, REAL);
    const sitesV = terrain.seedSites(nV);
    const indexV = terrain.buildIndex(sitesV, nV);
    const confirmed = (v, i) => {
      const s = terrain.nearest(sitesV, indexV, v);
      return s < 0 || probeT.owner(sitesV[s * 3], sitesV[s * 3 + 1], sitesV[s * 3 + 2]) === i;
    };
    let dp = 0, tp = 0, da = 0, dl = 0, tl = 0;
    confirmedTerminals.forEach((t, i) => {
      for (const p of t.ports) { tp++; if (!confirmed(p, i)) dp++; }
      if (!confirmed(t.airport, i)) da++;
    });
    confirmedLights.forEach((pts, i) => {
      for (const [x, y] of pts) { tl++; if (!confirmed(toSphere(x, y, REAL), i)) dl++; }
    });
    // Bounds measured after the fix (not picked to look nice): they
    // document that the defect is REDUCED, not eliminated — see
    // SESSIONS.md for why a full elimination would require moving this
    // computation after terrain construction, outside the scope of this
    // file.
    check("terminals: mismatch with the terrain mesh under 40% for ports (measured 54% before the fix)",
      dp / tp < 0.40);
    check("terminals: mismatch with the terrain mesh under 25% for airports (measured 34% before the fix)",
      da / confirmedTerminals.length < 0.25);
    check("lights: mismatch with the terrain mesh under 15% (measured ~14% before the fix)",
      dl / tl < 0.15);
  }
}

// --- No land beyond the latitude limit ---------------------------------------
//
// User report: "some continents go to the poles". Yet the ANCHORS were
// properly confined by `layout.latitudeBand` — but confining the notes
// doesn't confine the LAND: a territory extends around its anchor.
// Measured on the 58-note test set, land climbed to 68.6deg while no note
// exceeded 55deg. Anchor confinement alone couldn't see this defect — it
// only ever looked at notes.
//
// The sea threshold now extinguishes itself toward the poles. These checks
// look at LAND, the only thing the user sees.
{
  const POLAR = {
    layout: { iterations: 60, repulsion: 0.0005, attraction: 0.02, cohesion: 0.10, step: 0.55,
              latitudeBand: 0.95 },   // deliberately permissive: notes can climb to 72deg
    grid: { cellWorld: 4, cellCountry: 4, lloyd: 1, weightToArea: 0.05, seaRadius: 0.02,
              landLatitude: 50, latitudeFade: 10 },
    skin: { width: 400, height: 200 },
  };
  const polar = [
    { path: "p1.md", links: [], weight: 3, continent: "C1", country: "P1", region: "R1" },
    { path: "p2.md", links: [], weight: 3, continent: "C2", country: "P2", region: "R2" },
    { path: "p3.md", links: [], weight: 3, continent: "C3", country: "P3", region: "R3" },
    { path: "p4.md", links: [], weight: 3, continent: "C4", country: "P4", region: "R4" },
  ];
  computePositions(polar, POLAR);
  const gp = partition(polar, POLAR, POLAR.grid.cellWorld);
  const latOf = gy => Math.abs((0.5 - ((gy + 0.5) * gp.size) / POLAR.skin.height) * 180);
  let landLat = 0, land = 0;
  for (let gy = 0; gy < gp.height; gy++)
    for (let gx = 0; gx < gp.width; gx++)
      if (gp.cells[gy * gp.width + gx] >= 0) { land++; landLat = Math.max(landLat, latOf(gy)); }

  check("poles: no land beyond the set limit",
           landLat <= POLAR.grid.landLatitude);
  // The guard must be able to FAIL: without extinction, this same test set
  // puts land much higher. Otherwise this check proves nothing.
  {
    const WITHOUT = JSON.parse(JSON.stringify(POLAR));
    delete WITHOUT.grid.landLatitude;
    const withoutNotes = polar.map(n => ({ ...n, v: undefined, x: undefined, y: undefined }));
    computePositions(withoutNotes, WITHOUT);
    const gs = partition(withoutNotes, WITHOUT, WITHOUT.grid.cellWorld);
    let latWithout = 0;
    for (let gy = 0; gy < gs.height; gy++)
      for (let gx = 0; gx < gs.width; gx++)
        if (gs.cells[gy * gs.width + gx] >= 0) latWithout = Math.max(latWithout, latOf(gy));
    check("poles: without extinction, land climbs much higher (the test bites)",
             latWithout > POLAR.grid.landLatitude);
  }
  // Extinguishing must not empty the planet: a threshold brought down to
  // zero is NOT enough to forbid land (the ownership score is negative
  // near a heavy note, so below zero) — that's the trap that had left land
  // at 66deg despite an announced total extinction at 58deg.
  check("poles: land remains elsewhere", land > 0);
  // The guaranteed core writes unconditionally: it must respect extinction
  // too, or a note placed high replants land past the limit.
  check("poles: the guaranteed core doesn't replant land beyond the limit",
           landLat <= POLAR.grid.landLatitude);
}

// --- The geography probe says the SAME THING as the grid --------------------
//
// This is the invariant that allows terrain to draw the ground facet by
// facet instead of scaling up an image: the probe must replay exactly
// partition's rule. If the two drift apart, a coastline gets painted where
// a click finds no land — and nothing reports it.
{
  const nts = computePositions(build(), PARAMS);
  const g = partition(nts, PARAMS, PARAMS.grid.cellWorld);
  const probe = sampler(nts, PARAMS, PARAMS.grid.cellWorld);
  let seen = 0, gaps = 0;
  for (let gy = 0; gy < g.height; gy++)
    for (let gx = 0; gx < g.width; gx++) {
      const v = toSphere(gx * g.size + g.size / 2, gy * g.size + g.size / 2, PARAMS);
      seen++;
      if (probe.owner(v[0], v[1], v[2]) !== g.cells[gy * g.width + gx]) gaps++;
    }
  check("probe: same verdict as the grid, cell by cell", gaps === 0);
  // Guard: without it, a probe that always returned -1 would pass the
  // check above the day the grid was empty too.
  check("probe: the test bites (the grid isn't empty)",
           seen > 100 && Array.from(g.cells).some(c => c >= 0));

  // With a guaranteed core: the grid places it in cells, the probe in skin
  // pixels — the gap can only be at its EDGE, within half a cell.
  const WITH = JSON.parse(JSON.stringify(PARAMS));
  WITH.grid.core = 2;
  const nn = computePositions(build(), WITH);
  const gn = partition(nn, WITH, WITH.grid.cellWorld);
  const sn = sampler(nn, WITH, WITH.grid.cellWorld);
  let diff = 0, total = 0;
  for (let gy = 0; gy < gn.height; gy++)
    for (let gx = 0; gx < gn.width; gx++) {
      const v = toSphere(gx * gn.size + gn.size / 2, gy * gn.size + gn.size / 2, WITH);
      total++;
      if (sn.owner(v[0], v[1], v[2]) !== gn.cells[gy * gn.width + gx]) diff++;
    }
  check("probe: guaranteed core, gap confined to the disk's edge",
           diff / total < 0.01);

  // Altitude must be a CONTINUOUS FIELD, not just "not too different from
  // one point to the next": chopped noise would pass that kind of test as
  // soon as it's measured finely enough. What sets real terrain apart from
  // static is that the variation is PROPORTIONAL to the step — half the
  // step, half the gap. Without that, terrain facets would contradict each
  // other from one image to the next instead of drawing slopes.
  const maxGap = step => {
    let m = 0;
    for (let i = 0; i < PARAMS.skin.width; i++) {
      const a = toSphere(i, 90, PARAMS), b = toSphere(i + step, 90, PARAMS);
      m = Math.max(m, Math.abs(probe.altitude(a[0], a[1], a[2]) - probe.altitude(b[0], b[1], b[2])));
    }
    return m;
  };
  const e1 = maxGap(0.5), e2 = maxGap(0.25);
  check("probe: altitude bounded in [-1, 1]", e1 <= 2 && (() => {
    const v = toSphere(120, 90, PARAMS);
    return Math.abs(probe.altitude(v[0], v[1], v[2])) <= 1;
  })());
  check("probe: continuous altitude (the gap follows the step)",
           e2 > 0 && Math.abs(e2 / e1 - 0.5) < 0.1);
}

summary();
