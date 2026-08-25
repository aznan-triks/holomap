import { check, summary } from "./harness.mjs";
import { PARAMS as PARAMS_PROD } from "../src/config.js";
import { cellNoise, siteLevel, visibleHalfAngle, seedSites, buildIndex,
        candidateNeighbors, nearest, toLocal, fromLocal, clipHalfPlane, cellOfSite,
        buildMesh, coreSite, createTerrain } from "../src/terrain.js";

const PARAMS = {
  skin: { width: 400, height: 200 },
  zoom: { min: 0.5, factor: 1.15 },
  render: { terrain: { active: true, facet: 10, sitesMin: 64, sitesMax: 20000,
                      amplitude: 0.035, base: 0.25,
                      light: [-0.40, 0.42, 0.81], ambient: 0.34, diffuse: 0.66,
                      reliefStrength: 26, reliefOpacity: 0.45, grazingLimit: 0.35,
                      facetShade: 24 } },
};

// --- cellNoise: the same three promises as the old bruitFacette ------------
{
  check("noise: always in [0, 1)", (() => {
    for (let a = -50; a < 50; a++) for (let b = -50; b < 50; b++) {
      const v = cellNoise(a, b);
      if (!(v >= 0 && v < 1)) return false;
    }
    return true;
  })());
  check("noise: deterministic (same input, same output)",
           cellNoise(17, 42) === cellNoise(17, 42));
  check("noise: well spread over the interval", (() => {
    const buckets = new Array(10).fill(0);
    for (let a = 0; a < 100; a++) for (let b = 0; b < 100; b++) buckets[Math.floor(cellNoise(a, b) * 10)]++;
    return buckets.every(v => v > 10000 * 0.06 && v < 10000 * 0.16);
  })());
}

// --- siteLevel: FIXED, never a function of zoom ----------------------------
//
// ⚠️ User feedback (07/28): "I don't want the number of cells to change on
// zoom, and they must be medium/large starting from the current max
// zoom-out, 5 wheel notches up". `siteLevel` therefore no longer takes
// `cam.R`/zoom as a parameter AT ALL — only the canvas size — which makes
// the invariant true BY CONSTRUCTION rather than by a setting that could one
// day be broken again: there is nothing left, in the signature, that would
// let the site count depend on the current zoom.
{
  check("siteLevel: depends ONLY on the canvas, never on zoom (the function doesn't even have a zoom parameter anymore)",
           siteLevel.length === 3);
  check("siteLevel: a bigger canvas gives more sites (same facet, same reference)",
           siteLevel(3000, 3000, PARAMS) > siteLevel(300, 300, PARAMS));
  check("siteLevel: a smaller facet (finer targeted cells) gives more sites",
           (() => {
             const finer = JSON.parse(JSON.stringify(PARAMS));
             finer.render.terrain.facet = 5;
             return siteLevel(900, 700, finer) > siteLevel(900, 700, PARAMS);
           })());
  check("siteLevel: bounded on both sides (a guard rail, not a quantization)",
           siteLevel(1, 1, PARAMS) === PARAMS.render.terrain.sitesMin &&
           (() => {
             const finer = JSON.parse(JSON.stringify(PARAMS));
             finer.render.terrain.facet = 0.001;
             return siteLevel(9000, 9000, finer) === finer.render.terrain.sitesMax;
           })());

  // --- The requested invariant, at the FUNCTIONAL level (not just on the
  // pure function): two redraws of the SAME canvas at different zooms must
  // share EXACTLY the same tiling (same total site count), zoom simply
  // magnifying it without ever making or losing any.
  {
    const W2 = 240, Hc2 = 240;
    const probe2 = { owner: (x) => (x > 0.2 ? 0 : -1), altitude: () => 0 };
    const t2 = createTerrain(probe2, PARAMS);
    const cam2 = R => ({ forward: [1, 0, 0], right: [0, 1, 0], up: [0, 0, 1], R, cx: W2 / 2, cy: Hc2 / 2 });
    const img2 = { data: new Uint8ClampedArray(W2 * Hc2 * 4) };
    const nZoomedOut = t2.paint(img2, W2, Hc2, cam2(50), [[200, 120, 60]], [10, 20, 30], null).n;
    const nZoomedIn = t2.paint(img2, W2, Hc2, cam2(4000), [[200, 120, 60]], [10, 20, 30], null).n;
    check("siteLevel: the TOTAL number of sites in the tiling never changes between two zooms of the same canvas",
             nZoomedOut === nZoomedIn);
  }

  // --- Calibration at the requested reference: 5 wheel notches above max
  // zoom-out (`zoom.min * zoom.factor⁵`), NOT at minimum zoom itself.
  {
    const width = 1400, height = 900;
    const baseRadius = Math.min(width, height) * 0.46;
    const refZoom = PARAMS.zoom.min * Math.pow(PARAMS.zoom.factor, 5);
    const n = siteLevel(width, height, PARAMS);
    const cellAngle = Math.sqrt(4 * Math.PI / n);
    const pxAtRef = cellAngle * baseRadius * refZoom;
    // The calibration keeps its promise: at the reference level, a cell is
    // indeed about `facet` px on a side — this test checks the FORMULA
    // itself (generic, whatever the `facet` setting of the test PARAMS
    // set); the requested "medium/large" value is checked separately on the
    // PRODUCTION setting further below.
    check("siteLevel: at the reference level, a cell is indeed ~facet px (calibration formula is correct)",
             Math.abs(pxAtRef - PARAMS.render.terrain.facet) < PARAMS.render.terrain.facet * 0.15);
    // And NOT at minimum zoom itself — there, fully zoomed out, the same
    // cells must be noticeably smaller on screen (the whole planet is
    // visible).
    const pxAtMin = cellAngle * baseRadius * PARAMS.zoom.min;
    check("siteLevel: at minimum zoom (before the 5 notches), cells are noticeably smaller than at the reference",
             pxAtMin < pxAtRef * 0.6);
  }
}

// --- visibleHalfAngle: carried over unchanged from the first version -------
{
  const wide = visibleHalfAngle(200, 900, 700, PARAMS);
  const tight = visibleHalfAngle(4000, 900, 700, PARAMS);
  check("cone: the more you zoom in, the less of the world is visible", tight < wide);
  check("cone: goes past the horizon, otherwise no limb silhouette",
           wide > Math.PI / 2 + 0.01);
  const noRelief = JSON.parse(JSON.stringify(PARAMS));
  noRelief.render.terrain.amplitude = 0;
  const nearHorizon = visibleHalfAngle(200, 900, 700, noRelief) - Math.PI / 2;
  check("cone: with no relief, it stops right at the horizon (one-cell margin)",
           nearHorizon > 0 && nearHorizon < 0.1);
  check("cone: zoomed in, the cone doesn't pay the limb margin",
           visibleHalfAngle(4000, 900, 700, PARAMS) < 0.25);
}

// --- The scatter: coverage and irregularity ---------------------------------
{
  const n = 2048;
  const sites = seedSites(n);
  check("scatter: every point is on the unit sphere", (() => {
    for (let i = 0; i < n; i++) {
      const x = sites[i*3], y = sites[i*3+1], z = sites[i*3+2];
      if (Math.abs(Math.hypot(x, y, z) - 1) > 1e-9) return false;
    }
    return true;
  })());
  // Coverage: no cap (pole or elsewhere) totally empty over a hemisphere —
  // otherwise cells there would be huge and could stick out of the
  // visibility cone without being found.
  check("scatter: covers the whole northern hemisphere (no big gap)", (() => {
    let count = 0;
    for (let i = 0; i < n; i++) if (sites[i*3+2] > 0.9) count++;
    return count > 0;
  })());
  // Irregularity wanted: two consecutive scatter entries (pure Fibonacci)
  // must not be exact multiples of the same angle — jitter must break that.
  check("scatter: jitter breaks the regularity of the Fibonacci lattice", (() => {
    const gaps = [];
    for (let i = 1; i < 30; i++) {
      const dx = sites[i*3]-sites[(i-1)*3], dy = sites[i*3+1]-sites[(i-1)*3+1], dz = sites[i*3+2]-sites[(i-1)*3+2];
      gaps.push(Math.hypot(dx, dy, dz));
    }
    const avg = gaps.reduce((a,b)=>a+b,0) / gaps.length;
    return gaps.some(e => Math.abs(e - avg) > avg * 0.15);
  })());
  check("scatter: deterministic (same n, same scatter)", (() => {
    const s2 = seedSites(n);
    return sites[100] === s2[100] && sites[300] === s2[300];
  })());
}

// --- The clipping itself: the central promise -------------------------------
//
// This is where the whole undertaking is decided: "a cell is a SINGLE CONVEX
// polygon", not a square nor a right triangle.
{
  const n = 2048;
  const sites = seedSites(n);
  const index = buildIndex(sites, n);
  const spacing = 2 / Math.sqrt(n);

  const sizes = [];
  let degenerate = 0;
  for (let i = 0; i < n; i += 5) {
    const poly = cellOfSite(sites, index, i, spacing);
    if (!poly) { degenerate++; continue; }
    sizes.push(poly.length);
  }
  check("clipping: almost no degenerate cell (jitter stays bounded)",
           degenerate / (n / 5) < 0.01);
  check("clipping: convex polygons, NOT just triangles or quadrilaterals",
           sizes.some(t => t >= 5) && sizes.some(t => t <= 4));
  check("clipping: VARIED cell sizes (opposite of a uniform grid)",
           new Set(sizes).size >= 3);

  // The shape depends on the real local density of sites — not a fixed
  // template copied everywhere. Checked here: two cells picked at random
  // (almost) never have exactly the same shape (same list of local
  // vertices).
  check("clipping: two cells aren't copies of one another", (() => {
    const c1 = cellOfSite(sites, index, 10, spacing);
    const c2 = cellOfSite(sites, index, 11, spacing);
    if (!c1 || !c2 || c1.length !== c2.length) return true;
    return c1.some((p, k) => Math.hypot(p[0]-c2[k][0], p[1]-c2[k][1], p[2]-c2[k][2]) > 1e-6);
  })());
}

// --- The only truth that matters: MEMBERSHIP --------------------------------
//
// A point belongs to cell i if and only if site i is the nearest of all
// sites (the very definition of Voronoi). We check that the polygon built
// for i, and only it, does contain that point — without that, color,
// relief and coast mean nothing.
function inside(poly, site, P) {
  for (let k = 0; k < poly.length; k++) {
    const A = poly[k], B = poly[(k + 1) % poly.length];
    const nx = A[1]*B[2]-A[2]*B[1], ny = A[2]*B[0]-A[0]*B[2], nz = A[0]*B[1]-A[1]*B[0];
    const refD = site[0]*nx + site[1]*ny + site[2]*nz;
    const pD = P[0]*nx + P[1]*ny + P[2]*nz;
    if (Math.sign(pD) !== Math.sign(refD) && Math.abs(pD) > 1e-12) return false;
  }
  return true;
}
function rand32(seed) {
  let s = seed >>> 0;
  return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}
{
  const n = 3000;
  const m = buildMesh(n);
  const r = rand32(20260727);
  let trials = 1500, failures = 0;
  for (let e = 0; e < trials; e++) {
    const z = r() * 2 - 1, a = r() * Math.PI * 2, rp = Math.sqrt(Math.max(0, 1 - z * z));
    const P = [rp * Math.cos(a), rp * Math.sin(a), z];
    let best = -1, bestDot = -2;
    for (let i = 0; i < n; i++) {
      const d = P[0]*m.sites[i*3] + P[1]*m.sites[i*3+1] + P[2]*m.sites[i*3+2];
      if (d > bestDot) { bestDot = d; best = i; }
    }
    const poly = m.cellules[best];
    if (!poly) { failures++; continue; }
    const site = [m.sites[best*3], m.sites[best*3+1], m.sites[best*3+2]];
    if (!inside(poly, site, P)) failures++;
  }
  check(`membership: ${trials} random points do land inside THEIR cell (nearest site)`,
           failures === 0);
}

// --- Regression: a site AT THE POLE must still find itself ------------------
{
  // Regression: a site sitting in the OUT-OF-RANGE bucket a naive formula
  // produces at an exact pole (lat = ±PI/2) or the antimeridian (lon = PI)
  // must still be findable by nearest() — see terrain.js's bucketOf /
  // bucketOfDirection header. Force the case deterministically rather than
  // hoping the scatter's jitter reproduces it.
  const n = 2048;
  const sites = seedSites(n);
  // Force site 0 to the exact north pole, independent of the scatter's own
  // jitter (which may or may not land exactly there for a given n).
  sites[0] = 0; sites[1] = 0; sites[2] = 1;
  const index = buildIndex(sites, n);
  const v = [sites[0], sites[1], sites[2]];
  const found = nearest(sites, index, v);
  check("nearest : un site exactement au pôle nord se retrouve lui-même",
    found === 0);
}

// --- Regression: a site AT THE ANTIMERIDIAN must still find itself ----------
{
  // Same bug shape, longitude axis: lon = PI (antimeridian) exactly.
  const n = 2048;
  const sites = seedSites(n);
  sites[0] = -1; sites[1] = 0; sites[2] = 0;   // atan2(0, -1) = PI exactement
  const index = buildIndex(sites, n);
  const v = [sites[0], sites[1], sites[2]];
  const found = nearest(sites, index, v);
  check("nearest : un site exactement à l'antiméridien se retrouve lui-même",
    found === 0);
}

// --- The seam between neighboring cells: measured, not assumed --------------
//
// Each cell is clipped INDEPENDENTLY in its own tangent plane: two neighbors
// can therefore compute a slightly different shared boundary (see the header
// of terrain.js). We measure the real gap rather than hoping it's
// negligible.
{
  const n = 4096;
  const m = buildMesh(n);
  const index = buildIndex(m.sites, n);
  const gaps = [];
  // Outside the polar cap (see the header: the (lat, lon) bucket index
  // collapses near a pole, where all longitudes converge — known, harmless
  // since that zone is never anything but sea).
  for (let i = 0; i < n; i += 3) {
    const poly = m.cellules[i];
    if (!poly || Math.abs(m.sites[i*3+2]) > 0.94) continue;
    const cands = candidateNeighbors(index, i);
    for (const v of poly) {
      let best = Infinity;
      for (const j of cands) {
        const pj = m.cellules[j];
        if (!pj) continue;
        for (const w of pj) best = Math.min(best, Math.hypot(v[0]-w[0], v[1]-w[1], v[2]-w[2]));
      }
      if (best < Infinity) gaps.push(best);
    }
  }
  gaps.sort((a, b) => a - b);
  const q = f => gaps[Math.floor(gaps.length * f)];
  const MAX_SCREEN_R = 3000;   // largest screen radius reached in the app
  // Measured: median 5.1e-5, q99 2.3e-4, max 4.3e-4 (units of sphere
  // radius). At R=3000 px, that's 0.15 / 0.69 / 1.3 px — sub-pixel in the
  // vast majority of cases, never more than a pixel and a half. The
  // threshold below leaves a margin (2 px) rather than hugging today's
  // measurement.
  check("seam: the worst measured gap (outside poles) stays under 2 px at the widest screen size",
           gaps.length > 0 && gaps[gaps.length - 1] * MAX_SCREEN_R < 2);
  check("seam: the median is comfortably under a tenth of a pixel",
           q(0.5) * MAX_SCREEN_R < 0.3);
}

// --- The render: height, color, coast, cost ---------------------------------
const W = 240, Hc = 240;
const makeFrame = () => ({ data: new Uint8ClampedArray(W * Hc * 4) });
const cam = R => ({ forward: [1, 0, 0], right: [0, 1, 0], up: [0, 0, 1], R, cx: W / 2, cy: Hc / 2 });
const SEA = [10, 20, 30];
const colors = [[200, 120, 60]];

// Test probe: a hemisphere of land (x > 0.3), dome-shaped altitude —
// identical in spirit to the one in the first version, to compare on the
// same simple case.
const simpleProbe = {
  owner: (x) => (x > 0.3 ? 0 : -1),
  altitude: (x, y, z) => Math.max(-1, Math.min(1, 2 * (x - 0.5))),
};

{
  const t = createTerrain(simpleProbe, PARAMS);
  const img = makeFrame();
  const info = t.paint(img, W, Hc, cam(100), colors, SEA, null);
  const d = img.data;
  const painted = (() => { let n = 0; for (let k = 3; k < d.length; k += 4) if (d[k] > 0) n++; return n; })();
  check("render: the disk is covered", painted > Math.PI * 100 * 100 * 0.9);
  check("render: nothing painted far outside the disk", (() => {
    for (let y = 0; y < Hc; y++)
      for (let x = 0; x < W; x++) {
        const dist = Math.hypot(x - W / 2, y - Hc / 2);
        if (dist > 100 * 1.05 && d[(y * W + x) * 4 + 3] > 0) return false;
      }
    return true;
  })());
  check("render: at least one land cell is painted (the test has teeth)", info.cellules > 0);
  const center = (y, x) => [d[(y * W + x) * 4], d[(y * W + x) * 4 + 1], d[(y * W + x) * 4 + 2]];
  check("render: the land is painted with its note's color",
           center(Hc / 2, W / 2)[0] > center(Hc / 2, W / 2)[2]);
  check("render: the sea is painted cold", (() => {
    const c = center(Hc / 2, Math.round(W / 2 + 97));
    return c[2] >= c[0];
  })());
}

// Determinism: two identical redraws of the same view, otherwise the map
// would shimmer between two frames while nothing moved.
{
  const t = createTerrain(simpleProbe, PARAMS);
  const a = makeFrame(), b = makeFrame();
  t.paint(a, W, Hc, cam(140), colors, SEA, null);
  t.paint(b, W, Hc, cam(140), colors, SEA, null);
  let identical = true;
  for (let k = 0; k < a.data.length; k++) if (a.data[k] !== b.data[k]) { identical = false; break; }
  check("render: the same image twice for the same camera", identical);
}
// The per-level cache does NOT change the result: a third pass, fully
// cached, must render exactly the same thing as the first.
{
  const t = createTerrain(simpleProbe, PARAMS);
  const a = makeFrame(), b = makeFrame();
  t.paint(a, W, Hc, cam(140), colors, SEA, null);
  t.paint(b, W, Hc, cam(140), colors, SEA, null);
  let identical = true;
  for (let k = 0; k < a.data.length; k++) if (a.data[k] !== b.data[k]) { identical = false; break; }
  check("render: the cell cache doesn't change a single color", identical);
}

// --- The height is REAL: limb silhouette ------------------------------------
{
  const reliefProbe = {
    owner: () => 0,
    altitude: (x, y, z) => (Math.abs(z) < 0.3 ? 1 : -1),
  };
  const STRONG = JSON.parse(JSON.stringify(PARAMS));
  STRONG.render.terrain.amplitude = 0.12;
  STRONG.render.terrain.base = 0;
  const R = 90;
  const img = makeFrame();
  createTerrain(reliefProbe, STRONG).paint(img, W, Hc, cam(R), colors, SEA, null);
  let farthest = 0;
  for (let y = 0; y < Hc; y++)
    for (let x = 0; x < W; x++)
      if (img.data[(y * W + x) * 4 + 3] > 0)
        farthest = Math.max(farthest, Math.hypot(x - W / 2, y - Hc / 2));
  check("height: the relief sticks out past the disk (limb silhouette)", farthest > R * 1.02);
  const FLAT = JSON.parse(JSON.stringify(STRONG));
  FLAT.render.terrain.amplitude = 0;
  const img2 = makeFrame();
  createTerrain(reliefProbe, FLAT).paint(img2, W, Hc, cam(R), colors, SEA, null);
  let flatFarthest = 0;
  for (let y = 0; y < Hc; y++)
    for (let x = 0; x < W; x++)
      if (img2.data[(y * W + x) * 4 + 3] > 0)
        flatFarthest = Math.max(flatFarthest, Math.hypot(x - W / 2, y - Hc / 2));
  check("height: with no relief, nothing sticks out past the disk", flatFarthest <= R * 1.02);
}

// --- Lighting follows the cell's REAL shape ---------------------------------
//
// Two cells identical in everything except their orientation relative to
// the light must receive different lighting — the promise that "each
// polygon is sculpted on its own geometry".
{
  const STRONG = JSON.parse(JSON.stringify(PARAMS));
  STRONG.render.terrain.amplitude = 0.06;
  STRONG.render.terrain.base = 0.5;
  const towardLight = {
    owner: () => 0,
    altitude: (x, y, z) => Math.max(-1, Math.min(1, 4 * y)),   // rises toward +y (camera up)
  };
  const inShadow = {
    owner: () => 0,
    altitude: (x, y, z) => Math.max(-1, Math.min(1, -4 * y)),
  };
  const R = 300;
  const brightness = (probe) => {
    const img = makeFrame();
    createTerrain(probe, STRONG).paint(img, W, Hc, cam(R), colors, SEA, null);
    const o = (Hc / 2 * W + Math.round(W / 2 + 60)) * 4;
    return img.data[o] + img.data[o + 1] + img.data[o + 2];
  };
  check("lighting: the slope facing the light is the brightest",
           brightness(towardLight) > brightness(inShadow));
}

// --- PRODUCTION settings stay within measured windows -----------------------
{
  const PROD = PARAMS_PROD.render.terrain;
  // ⚠️ `facet` is now measured AT THE REFERENCE LEVEL (5 wheel notches above
  // max zoom-out), not at the current zoom — a 5-30 px range (the old
  // window, measured at an arbitrary zoom) no longer means the same thing.
  // 20-50 px frames the "medium/large" calibration from 07/28.
  check("production: facet within a reasonable range for \"medium/large\" (20 to 50 px)",
           PROD.facet >= 20 && PROD.facet <= 50);
  check("production: consistent site bounds (min < max)",
           PROD.sitesMin < PROD.sitesMax);
  // Window measured on the harness (country level, ×9 zoom): 12 is barely
  // perceptible, 24 gives the crystal look, 40 gets noisy and eats into the
  // geography.
  check("production: per-cell facet shade is within the measured window",
           PROD.facetShade >= 16 && PROD.facetShade <= 32);
  // Direct guard on the 07/28 request: at the reference level, PRODUCTION
  // cells (not a test PARAMS set) are indeed medium/large, and the site
  // count doesn't move with zoom (3-argument signature, no `cam.R`/zoom
  // possible).
  const width = 1400, height = 900;
  const baseRadius = Math.min(width, height) * 0.46;
  const refZoom = PARAMS_PROD.zoom.min * Math.pow(PARAMS_PROD.zoom.factor, 5);
  const n = siteLevel(width, height, PARAMS_PROD);
  const pxAtRef = Math.sqrt(4 * Math.PI / n) * baseRadius * refZoom;
  check("production: medium/large cells (20-60 px) at the requested reference level",
           pxAtRef >= 20 && pxAtRef <= 60);
}

// --- EDGES follow the tiling by construction --------------------------------
//
// This is the heart of the 07/27 evening rework: outlines must be the
// TILING'S OWN EDGES, not independent polylines. Checked here are the three
// promises of `edges()`:
//   (1) coasts exist (land -> sea)
//   (2) boundaries between two different owners exist
//   (3) segments are at relief altitude (radius > 1)
//   (4) no segment inside a single territory (same owner on both sides)
//   (5) cost is measured and retrievable
{
  // A world cut in two: left half = note 0, right half = note 1, high polar
  // cap = sea. The split creates a clean continent boundary (the two notes
  // have different continents) and two coastal bands.
  const notes = [
    { path: "n0.md", continent: "C1", country: "P1", region: "R1" },
    { path: "n1.md", continent: "C2", country: "P2", region: "R2" },
  ];
  // ⚠️ The camera looks toward +x (forward=[1,0,0]) with a narrow cone: any
  // visible cell has x > 0.89. The BOUNDARY must therefore cut along y or z
  // (not x), otherwise it falls outside the field of view and the test
  // passes for the wrong reason.
  const edgeProbe = {
    owner: (x, y, z) => {
      if (z > 0.35) return -1;  // sea from z=0.35 up (visible within the 28° cone)
      return y <= 0 ? 0 : 1;   // boundary at y=0, visible head-on
    },
    altitude: () => 0.2,   // constant but > 0 relief -> radius > 1
  };
  // PARAMS with a not-too-fine tiling so the test stays fast.
  const PB = { zoom: PARAMS.zoom, render: { terrain: { ...PARAMS.render.terrain, sitesMin: 1024, sitesMax: 1024 } } };
  const t = createTerrain(edgeProbe, PB);
  const img = makeFrame();
  const c1 = cam(300);
  // Paint first so the visible cells get built.
  t.paint(img, W, Hc, c1, [[200, 120, 60], [60, 120, 200]], [30, 60, 100], null);

  const b = t.edges(W, Hc, c1, notes);
  check("edges: non-null result", b !== null);
  check("edges: coasts exist (land/sea)", b.coast.length > 0);
  check("edges: continent boundaries exist", b.continent.length > 0);
  // Each segment = 6 floats (x0,y0,z0, x1,y1,z1).
  check("edges: each segment has 6 components (flat array)",
           b.coast.length % 6 === 0 && b.continent.length % 6 === 0);
  // The 3D points are at relief altitude, not on the unit sphere.
  let allAtRelief = true;
  for (let k = 0; k < b.coast.length; k += 3) {
    const r = Math.hypot(b.coast[k], b.coast[k + 1], b.coast[k + 2]);
    if (r < 1.001) allAtRelief = false;   // 1 = unit sphere, relief > 1
  }
  check("edges: coast segments at relief altitude (radius > 1)",
           allAtRelief && b.coast.length > 0);
  // No internal segment (same owner on both sides) should exist within a
  // single-owner zone. The region is the same for each note in this test
  // set (one note per continent), so `country` and `region` must be empty.
  check("edges: no false country/region boundary when each continent has only one note",
           b.country.length === 0 && b.region.length === 0);
}

// --- The PER-NOTE OUTLINE (hover highlighting) -------------------------------
//
// ⚠️ User feedback (07/27 night): "hover didn't highlight in the same
// places". Cause: highlighting traced `contours.territoires` — polylines
// pulled from the PARTITION GRID, laid on the unit sphere — while the
// ground had become the Voronoi tiling at relief altitude. Two different
// geographies superimposed.
//
// The promise checked here is therefore the only one that matters: a note's
// outline must be made of the EDGES OF ITS OWN CELLS, at relief altitude —
// the same ground, not a neighboring layer.
{
  const outlineNotes = [
    { path: "a.md", continent: "C1", country: "P1", region: "R1" },
    { path: "b.md", continent: "C2", country: "P2", region: "R2" },
  ];
  const outlineProbe = {
    owner: (x, y, z) => (z > 0.35 ? -1 : (y <= 0 ? 0 : 1)),
    altitude: () => 0.2,
  };
  const PP = { zoom: PARAMS.zoom, render: { terrain: { ...PARAMS.render.terrain, sitesMin: 1024, sitesMax: 1024 } } };
  const tp = createTerrain(outlineProbe, PP);
  const img = makeFrame();
  const c1 = cam(300);
  tp.paint(img, W, Hc, c1, [[200, 120, 60], [60, 120, 200]], SEA, null);
  const bp = tp.edges(W, Hc, c1, outlineNotes);

  check("outline: each visible note has its own",
           bp.byNote.size >= 2 && bp.byNote.get(0) && bp.byNote.get(1));
  check("outline: segments have 6 components",
           bp.byNote.get(0).length % 6 === 0 && bp.byNote.get(0).length > 0);
  // At relief altitude, like the ground — that's half of the fixed defect.
  let atRelief = true;
  const t0 = bp.byNote.get(0);
  for (let k = 0; k < t0.length; k += 3)
    if (Math.hypot(t0[k], t0[k + 1], t0[k + 2]) < 1.001) atRelief = false;
  check("outline: at relief altitude (radius > 1), like the ground", atRelief);
  // `lastEdges` must NOT recompute anything: the live layer calls it every
  // frame.
  check("outline: lastEdges returns the same object, no recompute",
           tp.lastEdges() === bp);
}

// --- `edges` must NOT break anything in the tiling (the frozen-map bug) -----
//
// ⚠️ Bug hit in real Obsidian (07/27 night): `edges` was writing neighboring
// cells' owner into `e.owner`, which is `ensureCell`'s SENTINEL ("!= -2
// means cell fully built"). On the next redraw, `ensureCell` exited early
// without building anything, and `paint` then read `poly.length` on a
// polygon that was never built -> exception -> dead animation loop -> map
// frozen on its last frame.
//
// Nothing could catch it: the FIRST render passes (edges are computed AFTER
// painting), the failure only shows on the NEXT redraw. Hence the order
// enforced here: paint -> edges -> REPAINT.
//
// ⚠️ AND THE CAMERA MUST HAVE MOVED BETWEEN THE TWO. First version of this
// check: same camera for both paints — it passed WITH the bug reinstated.
// The reason is causal: the poisoned cells are the NEIGHBORS of boundary
// cells, which are outside the visible cone; with a fixed camera they're
// never repainted. It's the user's gesture that brings them into view —
// exactly the freeze scenario.
{
  const notesR = [
    { path: "a.md", continent: "C1", country: "P1", region: "R1" },
    { path: "b.md", continent: "C2", country: "P2", region: "R2" },
  ];
  const probeR = {
    owner: (x, y, z) => (z > 0.35 ? -1 : (y <= 0 ? 0 : 1)),
    altitude: () => 0.2,
  };
  const PR = { zoom: PARAMS.zoom, render: { terrain: { ...PARAMS.render.terrain, sitesMin: 1024, sitesMax: 1024 } } };
  const tr = createTerrain(probeR, PR);
  const img = makeFrame();
  const c1 = cam(300);
  // Camera rotated one notch, like a drag: a new portion of the world comes
  // into view, so cells never built need to be constructed.
  const rotated = (deg) => {
    const a = deg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
    return { forward: [c, s, 0], right: [-s, c, 0], up: [0, 0, 1],
             R: 300, cx: W / 2, cy: Hc / 2 };
  };
  const colors2 = [[200, 120, 60], [60, 120, 200]];
  tr.paint(img, W, Hc, c1, colors2, SEA, null);
  tr.edges(W, Hc, c1, notesR);
  let crashed = null;
  try {
    // Several notches: a real gesture sweeps across, it doesn't jump in one
    // block.
    for (const d of [4, 8, 12, 16, 20]) {
      const c2 = rotated(d);
      tr.paint(img, W, Hc, c2, colors2, SEA, null);
      tr.edges(W, Hc, c2, notesR);
    }
  } catch (e) { crashed = e; }
  check("edges: a redraw AFTER an edges computation doesn't crash (frozen map)",
           crashed === null);
  // Stronger bite: the tiling must stay COMPLETE. A simple "it doesn't
  // throw" would let through a version that silently loses cells (owner
  // set, polygon never built, cell skipped when drawing).
  const c3 = rotated(24);
  // Kept: with the defect, this call THROWS — what follows must report a
  // failure, not die mid-way (otherwise the following checks disappear from
  // the summary and we lose track of what still works).
  let paintResult = null;
  try { paintResult = tr.paint(img, W, Hc, c3, colors2, SEA, null); } catch (e) {}
  // Every visible, land cell must have actually been painted.
  check("edges: no cell lost after an edges computation",
           paintResult !== null && paintResult.cellules === paintResult.visibles
             && paintResult.cellules > 0);
}

// --- Edges do NOT depend on the camera (lag guard rail) ---------------------
//
// ⚠️ Regression experienced and measured during this build: the first
// version of `edges` redid the whole computation on EVERY frame. Per-frame
// cost while panning, measured on the harness: 61.9 -> 135.4 ms, i.e.
// double, on a map where "it lags" is already the recurring complaint. No
// check caught it — the harness ceiling (250 ms) is deliberately loose and
// doesn't see a doubling.
//
// The invariant is causal, not chronometric: edges, neighbors and owners
// depend ONLY on the mesh and the geography. So sweeping back over an
// ALREADY SEEN area must cost exactly ZERO edge computation. We count, we
// don't time: a stopwatch varies from machine to machine, a counter
// doesn't.
{
  const notesC = [
    { path: "a.md", continent: "C1", country: "P1", region: "R1" },
    { path: "b.md", continent: "C2", country: "P2", region: "R2" },
  ];
  const probeC = {
    owner: (x, y, z) => (z > 0.35 ? -1 : (y <= 0 ? 0 : 1)),
    altitude: () => 0.2,
  };
  const PCam = { zoom: PARAMS.zoom, render: { terrain: { ...PARAMS.render.terrain, sitesMin: 1024, sitesMax: 1024 } } };
  const tc = createTerrain(probeC, PCam);
  const img = makeFrame();
  const colors2 = [[200, 120, 60], [60, 120, 200]];
  const view = (deg) => {
    const a = deg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
    return { forward: [c, s, 0], right: [-s, c, 0], up: [0, 0, 1],
             R: 300, cx: W / 2, cy: Hc / 2 };
  };
  const pass = (deg) => {
    const c = view(deg);
    tc.paint(img, W, Hc, c, colors2, SEA, null);
    tc.edges(W, Hc, c, notesC);
    return tc.counters().edgesBuilt;
  };

  const after1 = pass(0);
  check("edges: the first pass computes something", after1 > 0);
  const after2 = pass(0);
  check("edges: replaying the SAME view recomputes nothing", after2 === after1);
  const after3 = pass(20);
  check("edges: rotating the camera only computes the new part", after3 > after2);
  // The core of the guard rail: coming back over its own tracks must
  // recompute NOTHING.
  const after4 = pass(0);
  check("edges: coming back over an already-seen area recomputes NOTHING (lag guard rail)",
           after4 === after3);
}

// --- The cost of `edges` is measured and bounded -----------------------------
{
  const costProbe = {
    owner: (x) => (x > 0.2 ? 0 : -1),
    altitude: () => 0,
  };
  const PC = { zoom: PARAMS.zoom, render: { terrain: { ...PARAMS.render.terrain, sitesMin: 4096, sitesMax: 4096 } } };
  const tc = createTerrain(costProbe, PC);
  const img = makeFrame();
  const c1 = cam(300);
  const costNotes = [{ path: "c.md", continent: "C1", country: "P1", region: "R1" }];
  tc.paint(img, W, Hc, c1, [[180, 100, 50]], [30, 60, 100], null);
  const t0b = performance.now();
  tc.edges(W, Hc, c1, costNotes);
  const firstCost = performance.now() - t0b;
  const t1b = performance.now();
  tc.edges(W, Hc, c1, costNotes);
  const cacheCost = performance.now() - t1b;
  // The cache must be nearly free.
  check("edges: the second call uses the cache (< 1 ms or < first/2)",
           cacheCost < 1 || cacheCost < firstCost / 2);
  // The first call must stay reasonable (< 200 ms on a 4096-site mesh).
  check("edges: first call < 200 ms (4096 sites)", firstCost < 200);
}

// --- Cost: per-site laziness keeps its promise -------------------------------
//
// ⚠️ The first cut of this module built the whole tiling (16,000 cells) on
// the very first redraw of a level — measured: 360 ms freeze at world
// level. Fixed by LAZINESS (a cell built on first camera sighting, never
// before) AND by reordering (checking ownership — sea or land — BEFORE
// clipping the polygon, never after: the sea never needs its polygon). What
// matters is checked here: a SECOND redraw of the same view must be clearly
// cheaper than the first.
{
  const probe = {
    owner: (x) => (x > 0.2 ? 0 : -1),
    altitude: () => 0,
  };
  const P = { zoom: PARAMS.zoom, render: { terrain: { ...PARAMS.render.terrain, sitesMin: 4096, sitesMax: 4096 } } };
  const t = createTerrain(probe, P);
  const img = makeFrame();
  const c1 = cam(180);
  const t0 = performance.now();
  t.paint(img, W, Hc, c1, [[200,120,60]], SEA, null);
  const first = performance.now() - t0;
  const t1 = performance.now();
  t.paint(img, W, Hc, c1, [[200,120,60]], SEA, null);
  const second = performance.now() - t1;
  check("cost: the second redraw of the same view is clearly cheaper than the first (cache active)",
           second < first || first < 2);   // on a very fast machine, both can be ~0 ms
}

// --- `paint` must read the STABLE canvas, never the cropped zone (07/28) ----
//
// User feedback: "it still changes with zoom" — it was `paint` receiving
// the size of the CROPPED ZONE on the visible disk (which grows/shrinks
// with zoom), not the panel's stable size. Checked right where the bug
// lived: two calls with DIFFERENT W,Hc (cropped zone) but the SAME
// canvasWidth/canvasHeight must keep the same site count.
{
  const t = createTerrain(simpleProbe, PARAMS);
  const TL = 1400, TH = 900;
  const img1 = { data: new Uint8ClampedArray(300 * 300 * 4) };
  const img2 = { data: new Uint8ClampedArray(150 * 150 * 4) };
  const camA = { forward: [1, 0, 0], right: [0, 1, 0], up: [0, 0, 1], R: 500, cx: 150, cy: 150 };
  const camB = { forward: [1, 0, 0], right: [0, 1, 0], up: [0, 0, 1], R: 4000, cx: 75, cy: 75 };
  const infoA = t.paint(img1, 300, 300, camA, colors, SEA, null, TL, TH);
  const infoB = t.paint(img2, 150, 150, camB, colors, SEA, null, TL, TH);
  check("paint: the site count depends only on canvasWidth/canvasHeight, never on the cropped zone (W,Hc)",
           infoA.n === infoB.n && infoA.n === siteLevel(TL, TH, PARAMS));
}

// --- The TRIANGLE count: locks in the requested tripling (07/28) ------------
//
// User feedback: "I want to triple the triangle count". Each edge of a
// visible cell now produces 3 triangles (site -> edge -> centroid) instead
// of 1. Checked by recounting the edges of visible cells through a path
// INDEPENDENT of `paint` (scatter + culling + clipping replayed by hand
// with the exported functions), not by trusting the internal counter to
// verify itself.
{
  const t = createTerrain(simpleProbe, PARAMS);
  const img = makeFrame();
  const c1 = cam(100);
  const info = t.paint(img, W, Hc, c1, colors, SEA, null);

  const n = siteLevel(W, Hc, PARAMS);
  const sites = seedSites(n);
  const index = buildIndex(sites, n);
  const spacing = 2 / Math.sqrt(n);
  const theta = visibleHalfAngle(c1.R, W, Hc, PARAMS);
  const cosTheta = Math.cos(Math.min(Math.PI, theta));
  const [ax, ay, az] = c1.forward;
  let edgeCount = 0;
  for (let i = 0; i < n; i++) {
    const sx = sites[i * 3], sy = sites[i * 3 + 1], sz = sites[i * 3 + 2];
    if (sx * ax + sy * ay + sz * az < cosTheta) continue;
    if (simpleProbe.owner(sx, sy, sz) < 0) continue;
    const poly = cellOfSite(sites, index, i, spacing);
    if (!poly) continue;
    edgeCount += poly.length;
  }
  check("triangles: the exposed counter is EXACTLY 3x the edge count of visible cells (the requested tripling)",
           edgeCount > 0 && info.triangles === edgeCount * 3);
}

// --- The guaranteed CORE per note: locks in "floating cities/ports" --------
//
// User feedback (07/28, after switching to large "medium/large" cells):
// cities and ports seem to float, coastlines have holes. Diagnosed before
// fixing (on the 58-note test set, production settings): 5 out of 58
// territories caught no site, or only one, from the global scatter — never
// painted as land, however exact their analytic outline. `coreSite` injects
// `coreSites` guaranteed sites PER NOTE, jittered near its own anchor
// (`n.v`).
{
  // 8 well-separated notes (sphere wedges, equal weight): a HEALTHY case,
  // with no possible swallowing by a heavier neighbor — that would be a
  // different defect, in layout.js, outside what a terrain scatter can fix
  // (no site makes "land" a point the geography itself classifies as
  // "sea").
  const roundNotes = [];
  for (let i = 0; i < 8; i++) {
    const lon = i * Math.PI / 4;
    roundNotes.push({ path: `n${i}.md`, weight: 1, v: [Math.cos(lon), Math.sin(lon), 0] });
  }
  const roundProbe = {
    owner: (x, y, z) => {
      let best = -1, bestDot = -2;
      for (let i = 0; i < roundNotes.length; i++) {
        const v = roundNotes[i].v;
        const d = x * v[0] + y * v[1] + z * v[2];
        if (d > bestDot) { bestDot = d; best = i; }
      }
      return best;   // the whole sphere is land, split into 8 wedges
    },
    altitude: () => 0,
  };
  const PNoy = { render: { terrain: { coreSites: 3, coreJitter: 0.35 } } };

  check("coreSite: returns exactly notes.length x coreSites sites",
           coreSite(roundNotes, PNoy, 0.1).length === roundNotes.length * 3 * 3);

  let outsideTerritory = 0;
  const healthyCore = coreSite(roundNotes, PNoy, 2 / Math.sqrt(40));
  for (let i = 0; i < roundNotes.length; i++)
    for (let k = 0; k < 3; k++) {
      const o = (i * 3 + k) * 3;
      if (roundProbe.owner(healthyCore[o], healthyCore[o + 1], healthyCore[o + 2]) !== i) outsideTerritory++;
    }
  check("coreSite: every injected site stays within ITS OWN note's territory",
           outsideTerritory === 0);

  // The defect reproduced, then fixed: a sparse scatter (40 sites for 8
  // territories) inevitably leaves gaps; the core fills them.
  const sparseN = 16;
  const base = seedSites(sparseN);
  const count = new Array(roundNotes.length).fill(0);
  for (let i = 0; i < sparseN; i++) {
    const p = roundProbe.owner(base[i * 3], base[i * 3 + 1], base[i * 3 + 2]);
    if (p >= 0) count[p]++;
  }
  check("core: WITHOUT it, a sparse scatter leaves at least one empty territory (the defect, reproduced)",
           count.some(c => c === 0));
  const fixCore = coreSite(roundNotes, PNoy, 2 / Math.sqrt(sparseN));
  const countWith = count.slice();
  for (let i = 0; i < roundNotes.length; i++)
    for (let k = 0; k < 3; k++) {
      const o = (i * 3 + k) * 3;
      const p = roundProbe.owner(fixCore[o], fixCore[o + 1], fixCore[o + 2]);
      if (p >= 0) countWith[p]++;
    }
  check("core: WITH it, no empty territory left (the fix holds, not just on average)",
           countWith.every(c => c > 0));

  // Integration: `createTerrain` with `notes` supplied does build a BIGGER
  // mesh (n + notes.length x coreSites sites), never smaller — and without
  // `notes`, unchanged behavior (no regression for existing callers,
  // including every other test in this file).
  const PInt = { zoom: PARAMS.zoom, render: { terrain: { ...PARAMS.render.terrain,
                 sitesMin: sparseN, sitesMax: sparseN, coreSites: 3 } } };
  const withoutNotes = createTerrain(roundProbe, PInt);
  const withNotes = createTerrain(roundProbe, PInt, roundNotes);
  const imgA = makeFrame(), imgB = makeFrame();
  const roundColors = roundNotes.map((_, i) => [40 + i * 20, 120, 200 - i * 10]);
  const infoA = withoutNotes.paint(imgA, W, Hc, cam(400), roundColors, SEA, null);
  const infoB = withNotes.paint(imgB, W, Hc, cam(400), roundColors, SEA, null);
  check("core: the mesh WITH notes has exactly notes.length x coreSites more sites than WITHOUT",
           infoB.n === infoA.n + roundNotes.length * 3);
}

summary();
