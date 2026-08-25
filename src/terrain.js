// terrain.js — the planet's ground, as unique Voronoi polygons.
//
// WHAT THIS REPLACES, AND WHY (07/27, second rewrite)
//
// The first version (07/26-27) meshed the ground as a REGULAR grid of quads
// cut into two RIGHT triangles, all identical in shape, laid down with no
// relation whatsoever to the geography it carried. Two structural flaws, and
// no amount of tuning could fix them:
//   — it isn't an ADAPTIVE triangulation — a low-poly 3D model has facets of
//     varied shapes and sizes, not a uniform grid;
//   — the COASTLINE was computed elsewhere (partition-grid contours, a
//     separate notion) from the mesh — so it could never FOLLOW the shape of
//     the facets.
//
// Here, the ground is a SPHERICAL VORONOI tiling: a scatter of sites on the
// sphere, each site owning a cell — a single CONVEX polygon of irregular
// shape and size, like a real low-poly mesh. Three direct consequences of
// this topology change:
//   — the coast is now a CELL EDGE: where a land cell touches a sea cell. It
//     follows the tiling by construction, no longer a foreign notion bolted
//     on top;
//   — each cell is lit on ITS OWN NORMAL (computed on its real vertices, not
//     approximated from a corner): the relief sculpts itself, no forced tint
//     hashing needed to fake facets;
//   — cell geometry DEPENDS ONLY ON THE ZOOM LEVEL (site count), never on the
//     camera: so it's computed ONCE per level then cached, and per-frame work
//     reduces to projecting and filling — cheaper than rebuilding a mesh on
//     every redraw.
//
// WHAT DOESN'T CHANGE
//
// The SEA is still painted as an analytic sphere (no cell worth paying for a
// flat tint), lighting stays fixed to the CAMERA, and rasterization is still
// hand-written with a depth buffer — these three choices are independent of
// facet shape and remain correct as-is.
//
// WHAT THE APPROXIMATION COSTS, IN ALL HONESTY
//
// A cell is built by clipping a polygon in the TANGENT plane at the site
// (gnomonic projection), against the bisectors of its nearest neighbors —
// the standard method for approximating a spherical Voronoi diagram without a
// dedicated algorithm. It's exact in the limit of an infinitely small cell;
// for a finite-size cell, two neighbors can compute a slightly different
// shared boundary (each seen from its own tangent plane).
//
// Measured rather than assumed negligible (`test-terrain.mjs`): outside the
// polar cap (beyond 70° latitude — see below why that zone is special), a
// cell's vertex and its nearest neighbor's stay within 1.3 px of each other
// at the app's maximum screen radius (3000 px), with half of all cases under
// 0.15 px. Invisible in practice — no ridge or crack at the seam.
//
// THE POLAR CAP (beyond 70°) IS A KNOWN, UNCORRECTED EXCEPTION: the same gap
// reaches several hundred pixels there (up to 948 px measured). Cause
// identified, not guessed: the (latitude, longitude) spatial-index bucketing
// collapses near a pole, where all longitudes converge — a bucket can have
// real Voronoi neighbors that its longitude bucket, far off in value, never
// reports. Harmless here and deliberately left uncorrected: that zone is
// ALL sea (no land beyond 55° latitude, see layout.js), so it's never
// painted as a polygon (sea stays the analytic sphere); and the camera can't
// get close to it anyway (`zoom.latitudeMax`, ±75°). A real fix (dedicated
// polar bucket) can wait for an actual need.

// Deterministic integer noise, no lookup table: returns [0, 1) for a pair of
// indices. Used for site scatter (jitter) and per-cell shade — two frames of
// the same view must give the same result, or the ground shimmers.
function cellNoise(a, b) {
  let h = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

// Number of sites in the tiling — FIXED for the whole session, never
// recomputed on zoom (user feedback 07/28: "I don't want the number of cells
// to change on zoom"). Depends only on canvas size, never on `cam.R` — that
// alone also kills the "coastline shape changes" bug: before, zooming
// changed `n`, so it rebuilt the whole tiling from a scatter of points WITH
// NO RELATION to the previous one (measured: of 1024 sites at one level,
// only 6 survived at the next level up). One scatter for the whole session =
// one geography, never redrawn.
//
// Calibrated to be "medium/large", NOT at minimum zoom (fully zoomed out,
// the whole planet would fit in a handful of huge, illegible cells), but at
// the requested reference level: 5 wheel notches above max zoom-out
// (`zoom.min * zoom.factor^5`). Past that reference, zooming no longer
// changes the cell count — each cell simply grows on screen, as if
// approaching a real low-poly model.
function siteLevel(width, height, PARAMS) {
  const T = PARAMS.render.terrain, Z = PARAMS.zoom;
  const refZoom = Z.min * Math.pow(Z.factor, 5);
  const refRadius = Math.min(width, height) * 0.46 * refZoom;
  const angle = T.facet / Math.max(1, refRadius);
  const n = (4 * Math.PI) / (angle * angle);
  return Math.max(T.sitesMin || 64, Math.min(T.sitesMax || 200000, Math.round(n)));
}

// Half-angle of the actually visible world cone. Unchanged since the first
// version: depends only on canvas size, zoom, and relief amplitude — never
// on mesh topology.
//
// Two regimes, and conflating them is costly. AS LONG AS the horizon isn't
// on screen (zoomed in), the cone follows directly from canvas size. ONCE
// the horizon is on screen, we must go BEYOND 90°: a point past the horizon
// stays visible if it's tall enough, up to acos(1/(1+a)) further — exactly
// the limb silhouette.
// `canvasWidth`/`canvasHeight` (07/28): the STABLE panel size, never to be
// confused with `width`/`height` (the redraw ZONE, cropped to the visible
// disk — see `paint` in `render.js`, which grows AND shrinks it with zoom).
// `siteLevel` must always read the STABLE size: passing it the cropped zone
// brought back EXACTLY the bug this parameter fixes ("it still changes with
// zoom", user feedback 07/28) — site count recomputed on every zoom, just
// via a different path (cropped zone instead of `cam.R`). Optional and
// falling back to `width`/`height`: test calls, which always pass the same
// value for both, are unaffected.
function visibleHalfAngle(R, width, height, PARAMS, canvasWidth, canvasHeight) {
  const amp = Math.max(0, PARAMS.render.terrain.amplitude);
  const d = Math.hypot(width, height) / 2;
  const s = d / (Math.max(1, R) * (1 + amp));
  // One-cell margin: the cone is an exact bound, but a cell with just one
  // corner sticking out must still be kept. `sqrt(4π/n)` is a cell's angular
  // size (diameter of a disk of the same area) — one cell of margin, not
  // two: measured at double, it overshot by 0.1 rad near the equator, more
  // than a cell corner ever needs.
  const n = siteLevel(canvasWidth != null ? canvasWidth : width,
                       canvasHeight != null ? canvasHeight : height, PARAMS);
  const margin = Math.sqrt(4 * Math.PI / n);
  if (s >= 1) return Math.min(Math.PI, Math.PI / 2 + Math.acos(1 / (1 + amp)) + margin);
  return Math.asin(s) + margin;
}

function normalize3(x, y, z) {
  const n = Math.hypot(x, y, z) || 1;
  return [x / n, y / n, z / n];
}
function cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

// Scatter of sites on the sphere: a Fibonacci lattice (deterministic, roughly
// uniform, no random table), jittered to avoid an overly regular hexagonal
// tiling — a real bas-relief has facets of uneven size.
//
// The jitter stays moderate (a fraction of the average spacing): beyond
// that, sites can get close enough to produce degenerate cells (near-zero
// area) — rare, handled downstream by a simple rejection.
function seedSites(n) {
  const sites = new Float64Array(n * 3);
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  const jitter = Math.min(0.6, 1.6 / Math.sqrt(n));
  for (let i = 0; i < n; i++) {
    let y = n === 1 ? 0 : 1 - (i / (n - 1)) * 2;
    y = Math.max(-1, Math.min(1, y + (cellNoise(i, 11) - 0.5) * jitter));
    const theta = goldenAngle * i + (cellNoise(i, 22) - 0.5) * jitter * 3;
    const rp = Math.sqrt(Math.max(0, 1 - y * y));
    sites[i * 3] = rp * Math.cos(theta);
    sites[i * 3 + 1] = rp * Math.sin(theta);
    sites[i * 3 + 2] = y;
  }
  return sites;
}

// Coarse spatial index (latitude/longitude bucket → sites falling in it), to
// find a site's neighbors without comparing it to every other one —
// necessary past a few thousand sites (otherwise n² cost).
function buildIndex(sites, n) {
  const nBuck = Math.max(2, Math.round(Math.sqrt(n / 2)));
  const buckets = new Map();
  const key = (la, lo) => la * (nBuck + 2) + lo;
  const bucketOf = i => {
    const x = sites[i * 3], y = sites[i * 3 + 1], z = sites[i * 3 + 2];
    const lat = Math.asin(Math.max(-1, Math.min(1, z)));
    const lon = Math.atan2(y, x);
    const la = Math.max(0, Math.min(nBuck - 1, Math.floor((lat / Math.PI + 0.5) * nBuck)));
    let lo = Math.floor((lon / (2 * Math.PI) + 0.5) * nBuck) % nBuck;
    if (lo < 0) lo += nBuck;
    return [la, lo];
  };
  for (let i = 0; i < n; i++) {
    const [la, lo] = bucketOf(i);
    const k = key(la, lo);
    let arr = buckets.get(k);
    if (!arr) buckets.set(k, arr = []);
    arr.push(i);
  }
  return { buckets, nBuck, key, bucketOf };
}

// Grid bucket of an ARBITRARY direction — same formula as `bucketOf` in
// `buildIndex`, but for a point that isn't necessarily one of the scattered
// sites. Duplicating this formula elsewhere would silently desync it from
// the one used to BUILD the index — the same trap as two copies of the same
// geography, already hit once in this module.
// Both axes are now bounded/wrapped (`la` clamped, `lo` wrapped mod nBuck) so
// a site sitting exactly at a pole or the antimeridian never lands in a
// bucket `nearest()`'s search loop can't reach.
function bucketOfDirection(v, nBuck) {
  const lat = Math.asin(Math.max(-1, Math.min(1, v[2])));
  const lon = Math.atan2(v[1], v[0]);
  const la = Math.max(0, Math.min(nBuck - 1, Math.floor((lat / Math.PI + 0.5) * nBuck)));
  let lo = Math.floor((lon / (2 * Math.PI) + 0.5) * nBuck) % nBuck;
  if (lo < 0) lo += nBuck;
  return [la, lo];
}

// The scattered site nearest an ARBITRARY direction (not necessarily a
// site) — used by `layout.js` to confirm that a point placed on the fine
// grid (a terminal, a light) falls on the right side once seen from the real
// tiling, without paying for an exhaustive scan of the whole scatter.
//
// Same neighbor strategy as `candidateNeighbors` (5×5 buckets), but the
// search radius WIDENS as long as no candidate is found — a plain 5×5 can
// land on empty buckets near a pole or in a sparse scatter, and returning
// `-1` out of excess caution would break the caller more reliably than a
// slightly wider search.
function nearest(sites, index, v) {
  const [la0, lo0] = bucketOfDirection(v, index.nBuck);
  let best = -1, bestDist = Infinity;
  for (let R = 2; best < 0 && R <= index.nBuck; R += 3) {
    for (let dla = -R; dla <= R; dla++) {
      const la = la0 + dla;
      if (la < 0 || la >= index.nBuck) continue;
      for (let dlo = -R; dlo <= R; dlo++) {
        let lo = (lo0 + dlo) % index.nBuck;
        if (lo < 0) lo += index.nBuck;
        const arr = index.buckets.get(index.key(la, lo));
        if (!arr) continue;
        for (const j of arr) {
          const dx = sites[j * 3] - v[0], dy = sites[j * 3 + 1] - v[1], dz = sites[j * 3 + 2] - v[2];
          const d = dx * dx + dy * dy + dz * dz;
          if (d < bestDist) { bestDist = d; best = j; }
        }
      }
    }
  }
  return best;
}

// Candidate neighbors of `i`: sites from nearby buckets, over a bucket
// radius (5×5, ~50 candidates given the targeted tiling density).
// Measured, not guessed: 7×7 (98 candidates) passed the same membership
// test at 100% but cost 65% more to build (measured at country level,
// 524,000 sites: 446 ms → 271 ms first paint); 5×5 still holds 100%
// membership over 2000 random trials, at every density tier tested (512 to
// 8192 sites). A narrower radius (3×3) would more often miss real Voronoi
// neighbors (unclosed cell) — not tried further, 5×5 already holds up under
// measurement.
function candidateNeighbors(index, i) {
  const [la0, lo0] = index.bucketOf(i);
  const out = [];
  const R = 2;
  for (let dla = -R; dla <= R; dla++) {
    const la = la0 + dla;
    if (la < 0 || la >= index.nBuck) continue;
    for (let dlo = -R; dlo <= R; dlo++) {
      let lo = (lo0 + dlo) % index.nBuck;
      if (lo < 0) lo += index.nBuck;
      const arr = index.buckets.get(index.key(la, lo));
      if (arr) for (const j of arr) if (j !== i) out.push(j);
    }
  }
  return out;
}

// Gnomonic (tangent) projection of a unit direction as seen from `site` —
// coordinates in the tangent plane at `site`, local basis (right, up).
// Valid for a point in the same hemisphere as `site`; the neighbors we
// project here are close, so always in that case.
function toLocal(site, right, up, dir) {
  const d = dir[0] * site[0] + dir[1] * site[1] + dir[2] * site[2];
  const k = 1 / Math.max(1e-6, d);
  return [(dir[0] * right[0] + dir[1] * right[1] + dir[2] * right[2]) * k,
          (dir[0] * up[0] + dir[1] * up[1] + dir[2] * up[2]) * k];
}
// Inverse: a point in the tangent plane becomes a unit direction on the
// sphere again (that's the very definition of the gnomonic projection: the
// tangent-plane point, seen from the sphere's center).
function fromLocal(site, right, up, a, b) {
  return normalize3(site[0] + a * right[0] + b * up[0],
                     site[1] + a * right[1] + b * up[1],
                     site[2] + a * right[2] + b * up[2]);
}

// Clips a convex 2D polygon by the half-plane "closer to the origin (the
// site) than to `n`" — the bisector of 0 and `n`. Standard
// Sutherland-Hodgman: robust for any input polygon, including one already
// nearly clipped away by previous cuts.
function clipHalfPlane(poly, n) {
  if (poly.length === 0) return poly;
  const c = (n[0] * n[0] + n[1] * n[1]) / 2;
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const A = poly[i], B = poly[(i + 1) % poly.length];
    const dA = A[0] * n[0] + A[1] * n[1] - c, dB = B[0] * n[0] + B[1] * n[1] - c;
    const inA = dA <= 0, inB = dB <= 0;
    if (inA) out.push(A);
    if (inA !== inB) {
      const t = dA / (dA - dB);
      out.push([A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t]);
    }
  }
  return out;
}

// The Voronoi cell of site `i`: a polygon of unit directions on the sphere
// (convex order), or `null` if the clip degenerates (site nearly coincident
// with a neighbor — very rare, scatter jitter stays bounded).
function cellOfSite(sites, index, i, spacing) {
  const site = [sites[i * 3], sites[i * 3 + 1], sites[i * 3 + 2]];
  let ref = [0, 0, 1];
  if (Math.abs(site[2]) > 0.999) ref = [1, 0, 0];
  const right = normalize3(...cross(ref, site));
  const up = cross(site, right);
  const cands = candidateNeighbors(index, i);
  cands.sort((a, b) => {
    const da = (sites[a*3]-site[0])**2 + (sites[a*3+1]-site[1])**2 + (sites[a*3+2]-site[2])**2;
    const db = (sites[b*3]-site[0])**2 + (sites[b*3+1]-site[1])**2 + (sites[b*3+2]-site[2])**2;
    return da - db;
  });
  // Starting square, large enough to certainly contain the real cell: eight
  // times the average spacing between neighboring sites.
  const L = spacing * 8;
  let poly = [[-L, -L], [L, -L], [L, L], [-L, L]];
  for (const j of cands) {
    if (poly.length < 3) break;
    const nj = [sites[j * 3], sites[j * 3 + 1], sites[j * 3 + 2]];
    poly = clipHalfPlane(poly, toLocal(site, right, up, nj));
  }
  if (poly.length < 3) return null;
  return poly.map(([a, b]) => fromLocal(site, right, up, a, b));
}

// The full geometric mesh for a given site count: purely geometric, no
// dependency on geography — which is what lets it be cached for an entire
// session, as long as the zoom level (hence `n`) doesn't change.
// ⚠️ Return shape keeps the field name `cellules` (not `cells`) — read by
// property name from render.js and the test harness, neither translated in
// this pass; renaming it here would silently break them at runtime.
function buildMesh(n) {
  const sites = seedSites(n);
  const index = buildIndex(sites, n);
  const spacing = 2 / Math.sqrt(n);      // average area 4π/n → "radius" ~2/√n
  const cellules = new Array(n);
  for (let i = 0; i < n; i++) cellules[i] = cellOfSite(sites, index, i, spacing);
  return { n, sites, cellules };
}

// Guaranteed core of sites PER NOTE — same doctrine as `grid.core` on the
// partition side (layout.js): a territory too light to attract a site from
// the global scatter shouldn't disappear from the painted ground for that.
//
// User feedback (07/28, after moving to large cells): "cities are
// floating", "ports are floating", holes in the coastline. Measured before
// fixing (`diag-terrain-couverture.mjs`, 58-note test set, PRODUCTION
// settings): on a tiling of ~1884 sites, 3 territories out of 58 (5%) caught
// NO site at all — never painted as land, however exact their analytic
// outline — and 2 more caught only one (a silhouette reduced to a single
// cell). Structural cause, not a tuning issue: the scatter (jittered
// Fibonacci) is purely geometric, it knows nothing about notes; for equal
// AREA a small note has exactly the same odds as a large one of catching a
// site, and with 58 territories to cover for ~300 land sites, luck no
// longer suffices. Cities and stations themselves stay anchored at the
// note's EXACT position (`n.v`, via `layout.sampler`) — they don't move,
// it's the painted ground underneath that was dropping out.
//
// The core injects `coreSites` extra sites PER NOTE, jittered around its own
// direction (`n.v`) in the tangent plane — never far, a fraction of the base
// scatter's average spacing — so ALWAYS within its own territory (a note is
// never closer to a neighbor than to its own center). Deterministic
// (`cellNoise`), like the rest of the scatter.
function coreSite(notes, PARAMS, spacing) {
  const T = PARAMS.render.terrain;
  const K = Math.max(0, T.coreSites || 0);
  if (K === 0 || !notes || !notes.length) return new Float64Array(0);
  const jig = spacing * (T.coreJitter != null ? T.coreJitter : 0.35);
  const out = new Float64Array(notes.length * K * 3);
  let o = 0;
  for (let i = 0; i < notes.length; i++) {
    const v = notes[i] && notes[i].v;
    if (!v) continue;
    let ref = [0, 0, 1];
    if (Math.abs(v[2]) > 0.999) ref = [1, 0, 0];
    const right = normalize3(...cross(ref, v));
    const up = cross(v, right);
    for (let k = 0; k < K; k++) {
      const a = (cellNoise(i * 97 + k, 3) - 0.5) * 2 * jig;
      const b = (cellNoise(i * 97 + k, 5) - 0.5) * 2 * jig;
      const [x, y, z] = normalize3(v[0] + a * right[0] + b * up[0],
                                    v[1] + a * right[1] + b * up[1],
                                    v[2] + a * right[2] + b * up[2]);
      out[o++] = x; out[o++] = y; out[o++] = z;
    }
  }
  return o === out.length ? out : out.subarray(0, o);
}

// The ground for a given mesh: the geography probe, plus caches (one per
// zoom level encountered). Created once at mount time, reused on every
// redraw.
//
// `notes` (07/28, optional): used ONLY to place the guaranteed per-note core
// (see `coreSite`) — without it, the scatter stays purely geometric, as
// before (no regression for callers with no notes on hand, including every
// test in this file). Captured once here, at mount time, never re-read
// afterward: same doctrine as the classification read by `edges()` ("a
// reclassification would go through `invalidate`").
function createTerrain(probe, PARAMS, notes) {
  // A mesh is eager ONLY for its sites (positions) and spatial index — both
  // cheap even at 16,000 sites (a few ms, measured). Each site's CELL (the
  // clipped polygon, ownership, relief) is LAZY: built on first camera
  // sighting, then kept.
  //
  // The first version of this module built the ENTIRE tiling — all 16,000
  // cells of the whole planet — on the very first redraw of a zoom level,
  // including ones never seen (the far side of the globe). Measured before
  // fixing: 360 ms freeze on first paint of the world level, vs 5 ms once
  // cached. Per-site laziness is exactly the strategy of the old vertex
  // cache (never recomputed except on demand) — applied here to cells
  // instead of quad corners.
  let edgesBuilt = 0;          // number of cells whose edges have been computed
  let meshes = new Map();      // n → { n, sites, index }                (positions + index, eager)
  let states = new Map();      // n → { cells, owner, radius, shade }    (lazy, per site)
  let depth = null;            // depth buffer, reallocated with the canvas

  function getMesh(n) {
    let m = meshes.get(n);
    if (!m) {
      let sites = seedSites(n);
      // Guaranteed core (see `coreSite`): applied ONCE here, when the mesh
      // is built — never recomputed on redraw, like the rest of this cache.
      // `total` (≠ `n`, the cache key) is the mesh's real site count once
      // the core is added.
      const core = coreSite(notes, PARAMS, 2 / Math.sqrt(n));
      const K = core.length / 3;
      let total = n;
      if (K > 0) {
        const combined = new Float64Array((n + K) * 3);
        combined.set(sites, 0);
        combined.set(core, n * 3);
        sites = combined;
        total = n + K;
      }
      m = { n: total, sites, index: buildIndex(sites, total) };
      meshes.set(n, m);
      // owner initialized to -2: "not built yet", distinct from -1 (sea,
      // built and known as such) — this is what lets a cell be recomputed
      // only once, never twice. `radii[i]`: one radius per polygon VERTEX
      // (see below why a single per-cell height isn't enough), not per
      // cell.
      // `lightOwner`: owner known WITHOUT the cell being built (see
      // `ownerOf`). Kept separate from `owner`, whose value ≠ -2 is the
      // sentinel "cell fully built" — conflating the two froze the map on
      // the very first gesture.
      // `cellEdges`: a cell's boundary edges, computed once (they don't
      // depend on the camera — see `ensureCellEdges`).
      states.set(n, { cells: new Array(total), radii: new Array(total),
                       centerRadius: new Float64Array(total),
                       centroidDir: new Array(total), centroidRadius: new Array(total),
                       owner: new Int32Array(total).fill(-2),
                       lightOwner: new Int32Array(total).fill(-2),
                       cellEdges: new Array(total),
                       shade: new Float64Array(total) });
    }
    return m;
  }

  // Builds site `i`'s cell if not already built.
  //
  // OWNERSHIP FIRST, POLYGON SECOND — and not the other way around. A probe
  // query is a handful of operations; clipping a polygon (neighbor search +
  // Sutherland-Hodgman against each) costs dozens. Since the sea covers
  // ~70% of the sphere (see layout.js) and never needs its polygon — it
  // stays painted via the analytic sphere. Clipping first and checking
  // ownership after (the natural order if you don't measure) means paying
  // for clipping on nearly every visible site at the WORLD level only to
  // throw it away immediately. Measured: this simple reordering brought
  // first paint of the world level from 230 to 45 ms (16,000 sites, ~2,300
  // of them land).
  //
  // THE RADIUS IS SAMPLED AT EVERY VERTEX, not once at the center — and this
  // isn't an optional refinement. A single height per cell only pushes all
  // its vertices out from the center uniformly: that doesn't tilt the
  // polygon (scaling rotates nothing), so lighting — which measures exactly
  // the gap between the polygon's normal and a smooth sphere's — sees
  // NOTHING of the assigned height, whatever the real terrain slope. Found
  // while writing the checks: relief that clearly rises across the screen
  // rendered two IDENTICAL colors. With a per-vertex radius, a cell
  // straddling a slope actually tilts — with a double benefit: two
  // neighboring cells, probing at nearly the same spot (their vertices
  // nearly coincide, see "seam" in the checks), also get the SAME height
  // there, tightening the seam further.
  function ensureCell(m, e, i, spacing) {
    if (e.owner[i] !== -2) return;
    const x = m.sites[i * 3], y = m.sites[i * 3 + 1], z = m.sites[i * 3 + 2];
    const p = probe.owner(x, y, z);
    if (p < 0) { e.owner[i] = -1; return; }   // sea: no polygon to build
    const poly = cellOfSite(m.sites, m.index, i, spacing);
    if (!poly) { e.owner[i] = -1; return; }   // degenerate (very rare): treated as sea
    e.cells[i] = poly;
    e.owner[i] = p;
    const T = PARAMS.render.terrain;
    const radii = new Array(poly.length);
    for (let k = 0; k < poly.length; k++) {
      const v = poly[k];
      const a = Math.max(0, Math.min(1, (probe.altitude(v[0], v[1], v[2]) + 1) / 2));
      radii[k] = 1 + T.amplitude * (T.base + (1 - T.base) * a);
    }
    e.radii[i] = radii;
    // Radius at the CENTER (the site itself, not a vertex): the APEX vertex
    // of every fan triangle (see `paint` — the fan now starts from the
    // site, not a polygon corner).
    const aCenter = Math.max(0, Math.min(1, (probe.altitude(x, y, z) + 1) / 2));
    e.centerRadius[i] = 1 + T.amplitude * (T.base + (1 - T.base) * aCenter);

    // CENTROID point of each fan triangle (site, v_k, v_k+1), one per EDGE —
    // user feedback 07/28: "triple the triangle count". Each fan triangle is
    // split into 3 by adding this point and connecting it to the 3 corners
    // (see `paint`): it's the only 1→3 split that keeps triangles of
    // comparable size — cutting a single edge would give 1→2, not 1→3.
    // Sampled as a full vertex in its own right (its OWN direction, its OWN
    // altitude), not interpolated from the 3 neighboring vertices: an
    // interpolated centroid would give a flat triangle by construction (an
    // average tilts nothing — same trap as the single per-cell height,
    // above), invisible like the three triangles of the first version. The
    // tiling and boundaries don't shift a pixel: this split is purely
    // internal to an ALREADY-built cell, never seen by `edges()`.
    const centroidDir = new Array(poly.length);
    const centroidRadius = new Array(poly.length);
    for (let k = 0; k < poly.length; k++) {
      const v0 = poly[k], v1 = poly[(k + 1) % poly.length];
      const [cx, cy, cz] = normalize3(x + v0[0] + v1[0], y + v0[1] + v1[1], z + v0[2] + v1[2]);
      centroidDir[k] = [cx, cy, cz];
      const ac = Math.max(0, Math.min(1, (probe.altitude(cx, cy, cz) + 1) / 2));
      centroidRadius[k] = 1 + T.amplitude * (T.base + (1 - T.base) * ac);
    }
    e.centroidDir[i] = centroidDir;
    e.centroidRadius[i] = centroidRadius;

    // Small deterministic shade per cell, in LEVELS (not percentage: see the
    // "not triangular everywhere" note from the first version, same trap,
    // fixed the same way here from the start).
    e.shade[i] = (cellNoise(i, 7) - 0.5) * 2 * (T.facetShade || 0);
  }

  // Flat-triangle rasterization with depth test — carried over unchanged
  // from the first version: facet topology changes, not how they're
  // painted. Each cell (a k-sided polygon) is fan-split from its first
  // vertex into (k-2) triangles, all the SAME color: the split isn't
  // visible, a cell still reads as one flat surface regardless of its side
  // count.
  function triangle(px, W, x0, y0, z0, x1, y1, z1, x2, y2, z2, r, g, b, zx0, zy0, zx1, zy1) {
    let area = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
    if (area === 0) return;
    if (area < 0) {
      let t;
      t = x1; x1 = x2; x2 = t; t = y1; y1 = y2; y2 = t; t = z1; z1 = z2; z2 = t;
      area = -area;
    }
    let bx0 = Math.max(zx0, Math.floor(Math.min(x0, x1, x2)));
    let bx1 = Math.min(zx1 - 1, Math.ceil(Math.max(x0, x1, x2)));
    let by0 = Math.max(zy0, Math.floor(Math.min(y0, y1, y2)));
    let by1 = Math.min(zy1 - 1, Math.ceil(Math.max(y0, y1, y2)));
    if (bx1 < bx0 || by1 < by0) return;
    const inv = 1 / area;
    const dzdx = ((z1 - z0) * (y2 - y0) - (z2 - z0) * (y1 - y0)) * inv;
    const dzdy = ((z2 - z0) * (x1 - x0) - (z1 - z0) * (x2 - x0)) * inv;
    for (let y = by0; y <= by1; y++) {
      const py = y + 0.5;
      let w0 = (x2 - x1) * (py - y1) - (bx0 + 0.5 - x1) * (y2 - y1);
      let w1 = (x0 - x2) * (py - y2) - (bx0 + 0.5 - x2) * (y0 - y2);
      let w2 = (x1 - x0) * (py - y0) - (bx0 + 0.5 - x0) * (y1 - y0);
      const i0 = -(y2 - y1), i1 = -(y0 - y2), i2 = -(y1 - y0);
      let z = z0 + (bx0 + 0.5 - x0) * dzdx + (py - y0) * dzdy;
      let k = y * W + bx0;
      for (let x = bx0; x <= bx1; x++, k++, w0 += i0, w1 += i1, w2 += i2, z += dzdx) {
        if (w0 < 0 || w1 < 0 || w2 < 0) continue;
        if (z <= depth[k]) continue;
        depth[k] = z;
        const o = k * 4;
        px[o] = r; px[o + 1] = g; px[o + 2] = b; px[o + 3] = 255;
      }
    }
  }

  // The SEA, painted without a single cell — unchanged since the first
  // version: the ocean is flat and uniform, paying for it in polygons would
  // buy nothing (see header).
  let seaRGBA = null, seaDepth = null, seaSpans = null, seaKey = "";
  function prepareSea(W, Hc, cam, sea, bias) {
    const key = cam.R + ":" + cam.cx + ":" + cam.cy + ":" + W + "x" + Hc
              + ":" + sea[0] + "," + sea[1] + "," + sea[2] + ":" + bias;
    if (key === seaKey && seaRGBA) return;
    if (!seaRGBA || seaRGBA.length !== W * Hc * 4) {
      seaRGBA = new Uint8ClampedArray(W * Hc * 4);
      seaDepth = new Float32Array(W * Hc);
      seaSpans = new Int32Array(Hc * 2);
    }
    const T = PARAMS.render.terrain;
    const [lx, ly, lz] = T.light;
    const amb = T.ambient, dif = T.diffuse;
    const R = cam.R, cx = cam.cx, cy = cam.cy;
    const [mr, mg, mb] = sea;
    const iR = 1 / Math.max(1, R);
    for (let y = 0; y < Hc; y++) {
      const b = -(y + 0.5 - cy) * iR;
      const b2 = b * b;
      if (b2 >= 1) { seaSpans[y * 2] = 0; seaSpans[y * 2 + 1] = 0; continue; }
      const half = Math.sqrt(1 - b2) * R;
      const x0 = Math.max(0, Math.ceil(cx - half - 0.5));
      const x1 = Math.min(W, Math.floor(cx + half + 0.5));
      seaSpans[y * 2] = x0; seaSpans[y * 2 + 1] = Math.max(x0, x1);
      let k = y * W + x0;
      for (let x = x0; x < x1; x++, k++) {
        const a = (x + 0.5 - cx) * iR;
        const r2 = a * a + b2;
        const p = r2 >= 1 ? 0 : Math.sqrt(1 - r2);
        const lit = amb + dif * Math.max(0, a * lx + b * ly + p * lz);
        seaDepth[k] = p - bias;
        const o = k * 4;
        seaRGBA[o] = mr * lit; seaRGBA[o + 1] = mg * lit;
        seaRGBA[o + 2] = mb * lit; seaRGBA[o + 3] = 255;
      }
    }
    seaKey = key;
  }
  function layDownSea(data, W, zx0, zy0, zx1, zy1) {
    for (let y = zy0; y < zy1; y++) {
      const x0 = Math.max(zx0, seaSpans[y * 2]), x1 = Math.min(zx1, seaSpans[y * 2 + 1]);
      if (x1 <= x0) continue;
      const k0 = y * W + x0, k1 = y * W + x1;
      data.set(seaRGBA.subarray(k0 * 4, k1 * 4), k0 * 4);
      depth.set(seaDepth.subarray(k0, k1), k0);
    }
  }

  // Lighting AND color of ONE fan TRIANGLE, on ITS TRUE NORMAL (cross
  // product of its 2 edges from the apex).
  //
  // REWRITTEN (07/28) TO LIGHT EACH FAN TRIANGLE SEPARATELY, NOT ONCE FOR
  // THE WHOLE CELL ANY MORE. Newell's formula over ALL polygon vertices gave
  // ONE averaged normal: the (k-2) fan triangles then got exactly the same
  // color, indistinguishable from each other — the cell read as ONE flat
  // surface, never as facets. Verified visually (capture at country level,
  // zoom 6): large flat polygons, no facets. Each triangle now has ITS OWN
  // normal (cross product of its 2 edges from the apex), hence ITS OWN
  // color — this is what makes the ground REALLY triangulated, with facets
  // that vary within a single cell.
  function shadeTriangle(A, B, C, siteDir, c, cellShade, T, cam) {
    const abx = B[0] - A[0], aby = B[1] - A[1], abz = B[2] - A[2];
    const acx = C[0] - A[0], acy = C[1] - A[1], acz = C[2] - A[2];
    let nx = aby * acz - abz * acy, ny = abz * acx - abx * acz, nz = abx * acy - aby * acx;
    if (nx * siteDir[0] + ny * siteDir[1] + nz * siteDir[2] < 0) { nx = -nx; ny = -ny; nz = -nz; }
    const nn = Math.hypot(nx, ny, nz) || 1;
    nx /= nn; ny /= nn; nz /= nn;
    const [dx, dy, dz] = cam.right, [hx, hy, hz] = cam.up, [ax, ay, az] = cam.forward;
    const [lx, ly, lz] = T.light;
    const amb = T.ambient, dif = T.diffuse;
    const cd = nx * dx + ny * dy + nz * dz;
    const ch = nx * hx + ny * hy + nz * hz;
    const ca = nx * ax + ny * ay + nz * az;
    // Radial reference at the cell CENTER (the site direction): slope is
    // measured relative to it, as before.
    const rd = siteDir[0] * dx + siteDir[1] * dy + siteDir[2] * dz;
    const rh = siteDir[0] * hx + siteDir[1] * hy + siteDir[2] * hz;
    const ra = siteDir[0] * ax + siteDir[1] * ay + siteDir[2] * az;
    const litSphere = amb + dif * Math.max(0, rd * lx + rh * ly + ra * lz);
    let slope = (cd * lx + ch * ly + ca * lz) - (rd * lx + rh * ly + ra * lz);
    const grazingLimit = T.grazingLimit || 0.35;
    const grazing = Math.max(0, Math.min(1, ra / grazingLimit));
    slope *= grazing;
    let r8 = c[0] * litSphere, g8 = c[1] * litSphere, b8 = c[2] * litSphere;
    const soften = x => x / (1 + x);
    const p = slope * T.reliefStrength;
    if (p > 0) {
      const a = soften(p * 0.5) * T.reliefOpacity;
      r8 += (170 - r8) * a; g8 += (225 - g8) * a; b8 += (245 - b8) * a;
    } else if (p < 0) {
      const a = soften(-p) * T.reliefOpacity;
      r8 -= r8 * a; g8 -= g8 * a; b8 += (8 - b8) * a;
    }
    const d = cellShade;
    return [r8 + d * 0.8, g8 + d, b8 + d * 1.15];
  }

  // Paints the ground onto `img`. `W, Hc` are the size of the received
  // IMAGE — in production, `render.js` crops it to the visible disk (the
  // saving documented above), so `W, Hc` GROWS AND SHRINKS with zoom.
  // `canvasWidth`/`canvasHeight` (07/28, optional, falling back to `W, Hc`
  // if omitted — test calls unaffected) are the panel's STABLE size: THAT is
  // what must calibrate `siteLevel`, never the cropped zone, or the site
  // count recomputes on every zoom regardless (user feedback 07/28, see the
  // header of `visibleHalfAngle`).
  function paint(img, W, Hc, cam, colors, sea, zone, canvasWidth, canvasHeight) {
    const T = PARAMS.render.terrain;
    const TL = canvasWidth != null ? canvasWidth : W;
    const TH = canvasHeight != null ? canvasHeight : Hc;
    const data = img.data;
    if (!depth || depth.length !== W * Hc) depth = new Float32Array(W * Hc);
    const zx0 = Math.max(0, zone ? zone.x0 : 0), zx1 = Math.min(W, zone ? zone.x1 : W);
    const zy0 = Math.max(0, zone ? zone.y0 : 0), zy1 = Math.min(Hc, zone ? zone.y1 : Hc);
    for (let y = zy0; y < zy1; y++) depth.fill(-Infinity, y * W + zx0, y * W + zx1);

    const n = siteLevel(TL, TH, PARAMS);
    const m = getMesh(n);
    const e = states.get(n);
    const spacing = 2 / Math.sqrt(n);

    // Sea bias, same spirit as the first version: a cell is FLAT (all its
    // vertices at its own radius, but the surface between them dips
    // slightly under that sphere), so the sea is pulled back a hair
    // proportional to a cell's angular size, so low coastline is never
    // eaten by the water.
    const arc = Math.sqrt(4 * Math.PI / n);
    prepareSea(W, Hc, cam, sea, arc * arc / 8);
    layDownSea(data, W, zx0, zy0, zx1, zy1);

    const theta = visibleHalfAngle(cam.R, W, Hc, PARAMS, TL, TH);
    const cosTheta = Math.cos(Math.min(Math.PI, theta));
    const [ax, ay, az] = cam.forward;
    let cellsPainted = 0, visible = 0, triangles = 0;

    for (let i = 0; i < m.n; i++) {
      const sx = m.sites[i * 3], sy = m.sites[i * 3 + 1], sz = m.sites[i * 3 + 2];
      // Culling by simple dot product, BEFORE any construction: this is
      // what makes laziness possible — the vast majority of sites (the far
      // side of the globe) is never clipped, never queried.
      if (sx * ax + sy * ay + sz * az < cosTheta) continue;
      ensureCell(m, e, i, spacing);
      if (e.owner[i] < 0) continue;   // sea, or degenerate cell (very rare)
      visible++;
      const poly = e.cells[i];
      const radii = e.radii[i];
      const owner = e.owner[i];
      const c = colors[owner] || sea;

      // 3D vertices (direction × ITS OWN radius) then screen projection,
      // once per cell vertex — the core of not sharing work: a shared
      // vertex would only be recomputed once even if actually shared, but
      // two neighboring cells each have their own vertices (the gap between
      // the two independent constructions is measured in the tests).
      const verts3D = new Array(poly.length);
      const sx2 = new Array(poly.length), sy2 = new Array(poly.length), sz2 = new Array(poly.length);
      for (let k = 0; k < poly.length; k++) {
        const [vx, vy, vz] = poly[k];
        const r = radii[k];
        const px = vx * r, py = vy * r, pz = vz * r;
        verts3D[k] = [px, py, pz];
        sx2[k] = cam.cx + cam.R * (px * cam.right[0] + py * cam.right[1] + pz * cam.right[2]);
        sy2[k] = cam.cy - cam.R * (px * cam.up[0] + py * cam.up[1] + pz * cam.up[2]);
        sz2[k] = px * ax + py * ay + pz * az;
      }
      const siteDir = [sx, sy, sz];

      // Fan apex: the SITE itself, at ITS OWN radius — not a polygon corner
      // (see the header of `shadeTriangle` for why).
      const rc = e.centerRadius[i];
      const cxp = sx * rc, cyp = sy * rc, czp = sz * rc;
      const ccx2 = cam.cx + cam.R * (cxp * cam.right[0] + cyp * cam.right[1] + czp * cam.right[2]);
      const ccy2 = cam.cy - cam.R * (cxp * cam.up[0] + cyp * cam.up[1] + czp * cam.up[2]);
      const ccz2 = cxp * ax + cyp * ay + czp * az;
      const apex3D = [cxp, cyp, czp];

      // Fan from the SITE: `poly.length` base triangles (one per edge), each
      // immediately SPLIT INTO 3 around its centroid (user feedback 07/28:
      // "triple the triangle count") — so `poly.length * 3` triangles total,
      // each with ITS OWN color (see `shadeTriangle`).
      const centroidDir = e.centroidDir[i], centroidRadius = e.centroidRadius[i];
      for (let k = 0; k < poly.length; k++) {
        const k1 = (k + 1) % poly.length;
        const [cdx, cdy, cdz] = centroidDir[k];
        const rC = centroidRadius[k];
        const mx = cdx * rC, my = cdy * rC, mz = cdz * rC;
        const mid3D = [mx, my, mz];
        const mx2 = cam.cx + cam.R * (mx * cam.right[0] + my * cam.right[1] + mz * cam.right[2]);
        const my2 = cam.cy - cam.R * (mx * cam.up[0] + my * cam.up[1] + mz * cam.up[2]);
        const mz2 = mx * ax + my * ay + mz * az;

        let cc = shadeTriangle(apex3D, verts3D[k], mid3D, siteDir, c, e.shade[i], T, cam);
        triangle(data, W, ccx2, ccy2, ccz2, sx2[k], sy2[k], sz2[k],
                 mx2, my2, mz2, cc[0], cc[1], cc[2], zx0, zy0, zx1, zy1);
        cc = shadeTriangle(verts3D[k], verts3D[k1], mid3D, siteDir, c, e.shade[i], T, cam);
        triangle(data, W, sx2[k], sy2[k], sz2[k], sx2[k1], sy2[k1], sz2[k1],
                 mx2, my2, mz2, cc[0], cc[1], cc[2], zx0, zy0, zx1, zy1);
        cc = shadeTriangle(verts3D[k1], apex3D, mid3D, siteDir, c, e.shade[i], T, cam);
        triangle(data, W, sx2[k1], sy2[k1], sz2[k1], ccx2, ccy2, ccz2,
                 mx2, my2, mz2, cc[0], cc[1], cc[2], zx0, zy0, zx1, zy1);
        triangles += 3;
      }
      cellsPainted++;
    }
    // Counter exposed to lock in the requested tripling (07/28): every edge
    // of a visible cell produces exactly 3 triangles (see the centroid note
    // above) — same doctrine as `edgesBuilt`, a count rather than an
    // eyeballed guess.
    //
    // `m.n`, not the local `n` (07/28, guaranteed core): `n` is the density
    // calibration (`siteLevel`, the cache key), `m.n` the mesh's TRUE site
    // count once the per-note core is added (see `coreSite`). The two only
    // coincide when no notes are given to `createTerrain` — the gap is
    // exactly what the core test locks in (`infoB.n === infoA.n +
    // notes.length × coreSites`).
    // ⚠️ Field names `cellules`/`visibles` (not `cells`/`visible`) kept as-is —
    // read by property name from the test harness, untranslated in this pass.
    return { n: m.n, cellules: cellsPainted, visibles: visible, triangles };
  }

  // Identifies a site's owner WITHOUT building its polygon — the strict
  // minimum needed to know whether a neighbor belongs to the same family as
  // an already-built cell. Cost: one probe query, versus a neighbor search
  // plus full clipping for `ensureCell`.
  //
  // IT WRITES TO ITS OWN ARRAY, NEVER TO `e.owner` — this is the fix for a
  // bug that FROZE the map in real Obsidian (07/27 night). `e.owner[i] !==
  // -2` is `ensureCell`'s SENTINEL: it means "cell fully built", polygon and
  // radii included. Setting an owner there without building the cell made
  // `ensureCell` exit early on the very next redraw, and `paint` then read
  // `poly.length` on a never-built polygon — exception, dead animation loop,
  // map frozen on its last frame.
  //
  // No test could catch it: the first paint passes (edges are computed
  // AFTER painting), the failure only shows on the next redraw, i.e. the
  // user's first gesture.
  //
  // `e.owner` remains the source of truth once set; this array is only a
  // fallback cache for cells never built.
  function ownerOf(m, e, i) {
    if (e.owner[i] !== -2) return e.owner[i];        // built cell: authoritative
    if (e.lightOwner[i] !== -2) return e.lightOwner[i];
    const x = m.sites[i * 3], y = m.sites[i * 3 + 1], z = m.sites[i * 3 + 2];
    const p = probe.owner(x, y, z);
    e.lightOwner[i] = p < 0 ? -1 : p;
    return e.lightOwner[i];
  }

  // Mesh boundaries: edges between cells of different owners, classified by
  // TYPE (coast, continent, country, region). These are the TILING'S OWN
  // EDGES — not independent polylines bolted on top. They follow the ground
  // by CONSTRUCTION, which is the whole point of this computation (see the
  // 07/27 evening diagnosis in implementation_plan.md).
  //
  // Each segment is a pair of 3D points at relief altitude: ready to project
  // onto screen through the same frame as the terrain, with no offset.
  //
  // Each edge's neighbor is found via the site nearest the edge's midpoint —
  // exactly the definition of a Voronoi diagram. No need to build the
  // neighbor's polygon, just to know its owner (`ensureOwner`), which avoids
  // paying for Sutherland-Hodgman on far-side cells.
  //
  // Deduplication: for land-land boundaries, the segment is only emitted if
  // i < j (each edge would otherwise be seen by both adjacent cells). For
  // coasts (land-sea), the sea cell is never iterated, so no duplicate to
  // handle.
  // A CELL's edges, computed once then kept.
  //
  // THIS IS THE EXPENSIVE PART, and it DOESN'T DEPEND ON THE CAMERA: edges,
  // neighbors and owners are only a function of the mesh and the geography.
  // The first version recomputed everything every frame — measured on the
  // harness: per-frame cost while panning 61.9 → 135.4 ms, i.e. double, on a
  // map where "it lags" is already the recurring complaint. Cached per cell
  // (same doctrine as `e.cells`), per-frame work reduces to copying
  // already-filled arrays.
  //
  // Each edge's neighbor is the site nearest its MIDPOINT — exactly the
  // definition of a Voronoi diagram. No need for the neighbor's polygon,
  // just its owner (`ownerOf`), which avoids clipping far-side cells.
  //
  // `own` = the territory's outline (any edge whose neighbor has a
  // different owner, sea included): each cell only pushes its OWN edges,
  // the one across pushes its own. Edges BY TYPE, though, are deduplicated
  // (i < j), or every boundary would be drawn twice.
  //
  // The cache assumes note classification (continent / country / region)
  // doesn't change during a session — true: it's computed at mount time. A
  // reclassification would go through `invalidate`.
  function ensureCellEdges(m, e, i, notes) {
    const already = e.cellEdges[i];
    if (already !== undefined) return already;
    // Counter exposed: it's THE measure of whether the cache holds. A timer
    // wouldn't say so reliably (it varies machine to machine); here, moving
    // the camera over an already-seen area must cost ZERO edge computation.
    edgesBuilt++;
    const poly = e.cells[i], radii = e.radii[i];
    const pI = e.owner[i];
    const noteI = notes[pI];
    if (!poly || !noteI) return (e.cellEdges[i] = null);

    const SEP = String.fromCharCode(31);
    const out = { coast: [], continent: [], country: [], region: [], own: [] };
    // Candidate neighbors are the SAME for every edge of a cell — pulling
    // them out of the inner loop saves one spatial search per edge
    // (measured: 115 → 75 ms at world zoom, before caching).
    const cands = candidateNeighbors(m.index, i);
    for (let k = 0; k < poly.length; k++) {
      const k1 = (k + 1) % poly.length;
      const v0 = poly[k], v1 = poly[k1];
      const mx = v0[0] + v1[0], my = v0[1] + v1[1], mz = v0[2] + v1[2];
      const mn = Math.hypot(mx, my, mz) || 1;
      const mdx = mx / mn, mdy = my / mn, mdz = mz / mn;

      let bestJ = -1, bestDist = Infinity;
      for (const j of cands) {
        const dx = m.sites[j * 3] - mdx, dy = m.sites[j * 3 + 1] - mdy,
              dz = m.sites[j * 3 + 2] - mdz;
        const d = dx * dx + dy * dy + dz * dz;
        if (d < bestDist) { bestDist = d; bestJ = j; }
      }
      if (bestJ < 0) continue;

      // Neighbor's owner — lightweight, no polygon built, and never touches
      // the build sentinel (see `ownerOf`).
      const pJ = ownerOf(m, e, bestJ);

      const r0 = radii[k], r1 = radii[k1];
      const p0x = v0[0] * r0, p0y = v0[1] * r0, p0z = v0[2] * r0;
      const p1x = v1[0] * r1, p1y = v1[1] * r1, p1z = v1[2] * r1;

      if (pJ !== pI) out.own.push(p0x, p0y, p0z, p1x, p1y, p1z);

      let type = null;
      if (pJ < 0) {
        type = "coast";
      } else {
        if (i >= bestJ) continue;              // land-land dedup
        const noteJ = notes[pJ];
        if (!noteJ) continue;
        if (noteI.continent !== noteJ.continent) type = "continent";
        else if ((noteI.continent + SEP + noteI.country) !==
                 (noteJ.continent + SEP + noteJ.country)) type = "country";
        else if (noteI.region !== noteJ.region) type = "region";
      }
      if (!type) continue;
      out[type].push(p0x, p0y, p0z, p1x, p1y, p1z);
    }
    return (e.cellEdges[i] = out);
  }

  // Owner (note index, or -1 for sea) of the site NEAREST a given direction,
  // resolved against the mesh for the SAME (W,H) `paint`/`edges` would use —
  // so hit-testing always reads the geometry that's actually on screen, never
  // a mesh built fresh at an unrelated resolution. Reuses `ownerOf` (see its
  // header) so an unbuilt cell resolves via the cheap probe query, without
  // tripping the "-2 = not yet built" sentinel that a naive read of `e.owner`
  // would misinterpret as sea.
  function paintedOwnerAt(v, W, H) {
    const n = siteLevel(W, H, PARAMS);
    const m = getMesh(n);
    const e = states.get(n);
    const s = nearest(m.sites, m.index, v);
    if (s < 0) return -1;
    return ownerOf(m, e, s);
  }

  let edgesKey = "", edgesCache = null;
  function edges(W, H, cam, notes) {
    const T = PARAMS.render.terrain;
    const n = siteLevel(W, H, PARAMS);
    const key = n + ":" + cam.forward.join(",") + ":" + cam.R + ":" + W + "x" + H;
    if (key === edgesKey && edgesCache) return edgesCache;

    const m = getMesh(n);
    const e = states.get(n);
    if (!e) { edgesCache = null; edgesKey = key; return null; }
    const spacing = 2 / Math.sqrt(n);
    const theta = visibleHalfAngle(cam.R, W, H, PARAMS);
    const cosTheta = Math.cos(Math.min(Math.PI, theta));
    const [ax, ay, az] = cam.forward;

    // `byNote`: each territory's OWN outline, collected in the same pass.
    // This is what hover highlighting reads.
    //
    // Without it, hover highlighted `contours.territoires` — polylines
    // pulled from the partition grid, so a DIFFERENT geography than the
    // ground, and laid on the unit sphere while the tiling sits at relief
    // altitude. Hence the user feedback "hover didn't highlight in the same
    // places" — two drawings of two different worlds superimposed.
    //
    // A land-land edge is pushed on BOTH sides (unlike edges by type,
    // deduplicated): it's the outline of each of the two neighbors.
    const segs = { coast: [], continent: [], country: [], region: [], byNote: new Map() };
    const pushNote = (idx, tab) => {
      let t = segs.byNote.get(idx);
      if (!t) segs.byNote.set(idx, t = []);
      for (let q = 0; q < tab.length; q++) t.push(tab[q]);
    };

    for (let i = 0; i < m.n; i++) {
      const sx = m.sites[i * 3], sy = m.sites[i * 3 + 1], sz = m.sites[i * 3 + 2];
      if (sx * ax + sy * ay + sz * az < cosTheta) continue;
      if (e.owner[i] < 0) continue;       // sea, or not yet built
      if (!e.cells[i]) continue;
      const bc = ensureCellEdges(m, e, i, notes);
      if (!bc) continue;
      // Gathering: plain copies, no geometry computed here.
      if (bc.coast.length) segs.coast.push(...bc.coast);
      if (bc.continent.length) segs.continent.push(...bc.continent);
      if (bc.country.length) segs.country.push(...bc.country);
      if (bc.region.length) segs.region.push(...bc.region);
      if (bc.own.length) pushNote(e.owner[i], bc.own);
    }
    edgesCache = segs;
    edgesKey = key;
    return segs;
  }

  function invalidate() { meshes = new Map(); states = new Map(); edgesCache = null; edgesKey = ""; }

  // The last result of `edges`, WITHOUT ever triggering computation. This is
  // what the live layer (hover) reads: it's painted every frame, so it must
  // never be able to trigger a recompute — only the terrain layer computes.
  function lastEdges() { return edgesCache; }

  return { paint, edges, lastEdges, invalidate, paintedOwnerAt,
           counters: () => ({ edgesBuilt }),
           currentLevel: () => [...meshes.keys()] };
}

export { cellNoise, siteLevel, visibleHalfAngle, seedSites, buildIndex,
         candidateNeighbors, nearest, toLocal, fromLocal, clipHalfPlane, cellOfSite,
         buildMesh, coreSite, createTerrain };
