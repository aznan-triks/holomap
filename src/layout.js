// Composite-key separator. Built IN CODE, never written literally: a raw null
// character in a source file makes search tools treat it as binary and skip
// it silently (bitten by this 5 times).
const SEP = String.fromCharCode(31);

// Seeded PRNG: same vault, same map every time it's opened.
// Without determinism the map can't serve as a mental landmark.
function hash(txt) {
  let h = 2166136261;
  for (let i = 0; i < txt.length; i++) { h ^= txt.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function random(seed) {
  let e = seed >>> 0;
  return () => { e = (Math.imul(e, 1664525) + 1013904223) >>> 0; return e / 4294967296; };
}

// --- The sphere and its skin ------------------------------------------------
//
// The geography is SPHERICAL: each note is a direction on the globe. But the
// partition grid stays indexed by rows/columns, each cell covering a tile of
// latitude/longitude. That rectangle is the planet's "skin": it's what the
// renderer paints, before wrapping it onto the globe.
//
// Happy consequence: all the contour code (stitching cell edges, smoothing
// steps, per-territory fills, land/sea cutting) works in skin coordinates and
// never needs to know the world is round.
//
// Convention: x spans longitude from -PI to PI, y spans latitude from +PI/2
// (top) to -PI/2 (bottom). The skin wraps on itself in x — so there is no
// edge anymore, and the whole margin apparatus of the old flat map disappears
// with it.
function toSphere(x, y, PARAMS) {
  const lon = (x / PARAMS.skin.width - 0.5) * 2 * Math.PI;
  const lat = (0.5 - y / PARAMS.skin.height) * Math.PI;
  const cl = Math.cos(lat);
  return [cl * Math.cos(lon), cl * Math.sin(lon), Math.sin(lat)];
}
function fromSphere(v, PARAMS) {
  const lat = Math.asin(Math.max(-1, Math.min(1, v[2])));
  const lon = Math.atan2(v[1], v[0]);
  return [(lon / (2 * Math.PI) + 0.5) * PARAMS.skin.width,
          (0.5 - lat / Math.PI) * PARAMS.skin.height];
}
// Brings any direction back onto the unit sphere.
function normalize(v) {
  const n = Math.hypot(v[0], v[1], v[2]);
  return n < 1e-12 ? [0, 0, 1] : [v[0] / n, v[1] / n, v[2] / n];
}
// Brings a direction back into the habitable band: beyond the latitude limit,
// fold it onto the band's edge while keeping its longitude.
//
// Confining domain anchors alone is NOT enough — lesson from a failed
// attempt: the relaxation that regularizes territories then moves each note
// to its own centroid, and those centroids drift toward the poles since
// nothing else claims those latitudes. The fold-back must therefore apply on
// every note move, not just the initial draw.
//
// `band` is the SINE of the maximum latitude (1 = no limit).
function inBand(v, band) {
  if (!band || band >= 1 || Math.abs(v[2]) <= band) return v;
  const z = v[2] > 0 ? band : -band;
  const flat = Math.hypot(v[0], v[1]);
  // Right on a pole: no longitude to preserve, pick one.
  if (flat < 1e-12) return [Math.sqrt(1 - z * z), 0, z];
  const k = Math.sqrt(Math.max(0, 1 - z * z)) / flat;
  return [v[0] * k, v[1] * k, z];
}

// Squared CHORDAL distance: the straight chord through the globe, not the
// surface arc.
//
// Chosen over geodesic distance for a substantive reason, not convenience: it
// is monotone with the angle (so it gives exactly the same partition), but it
// keeps the property that matters — the locus of points equidistant in score
// between two notes is a PLANE, whose intersection with the sphere is a
// CIRCLE. The border is therefore known exactly, and snapping to the exact
// border (the fix that removed the staircase on interior borders) applies
// without changing principle.
function distance2(a, b) {
  const dx = a[0] - b[0], dy = a[1] - b[1], dz = a[2] - b[2];
  return dx * dx + dy * dy + dz * dz;
}

// Interpolated value-noise fractal. Shared base for coastline and relief.
//
// Interpolated value noise, not a per-cell draw: an independent draw per cell
// would give speckle, not a shape. Each octave is a lattice of a given step
// whose values are interpolated; summing them gives a broad swell plus finer
// detail on top.
//
// Deterministic (same vault, same map), and no string built inside the loop:
// it runs over a hundred thousand times.
//
// `octaves`: list of [lattice step in px, weight]. The step also acts as a
// selector in the hash, so two octaves with different steps draw independent
// values.
function fractalNoise(octaves) {
  const total = octaves.reduce((s, o) => s + o[1], 0);
  const value = (i, j, sel) => {
    let h = Math.imul(i, 374761393) ^ Math.imul(j, 668265263) ^ Math.imul(sel, 2246822519);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296 * 2 - 1;
  };
  const smoothstep = t => t * t * (3 - 2 * t);   // zero slope at nodes: no corner
  return (x, y) => {
    let s = 0;
    for (const [step, weight] of octaves) {
      const i = Math.floor(x / step), j = Math.floor(y / step);
      const tx = smoothstep(x / step - i), ty = smoothstep(y / step - j);
      const a = value(i, j, step), b = value(i + 1, j, step);
      const c = value(i, j + 1, step), d = value(i + 1, j + 1, step);
      s += weight * ((a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty);
    }
    return s / total;
  };
}

// Same noise, but evaluated in THREE DIMENSIONS on the sphere.
//
// Essential, not a matter of elegance: noise computed in latitude/longitude
// would seam badly at the antimeridian (a visible seam right through the
// middle of a continent) and would squash at the poles, where the skin's
// columns converge. Evaluated on the direction, it ignores the skin and has
// neither seam nor pole.
//
// `octaves`: list of [step, weight], the step expressed as a chord on the
// unit sphere — a step of 0.2 gives roughly ten ripples pole to pole.
// Interpolated over the eight corners of the cube, smoothed as in two
// dimensions: an independent draw per cell would give speckle, not a shape.
function fractalNoise3d(octaves) {
  const total = octaves.reduce((s, o) => s + o[1], 0);
  const value = (i, j, k, sel) => {
    let h = Math.imul(i, 374761393) ^ Math.imul(j, 668265263)
          ^ Math.imul(k, 2246822519) ^ Math.imul(sel, 3266489917);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296 * 2 - 1;
  };
  const smoothstep = t => t * t * (3 - 2 * t);
  return (x, y, z) => {
    let s = 0;
    for (const [step, weight] of octaves) {
      // The step also acts as a hash selector: two octaves with different
      // steps draw independent values. Scaled to an integer since a
      // fractional step can't be used as a seed.
      const sel = Math.round(step * 10000);
      const i = Math.floor(x / step), j = Math.floor(y / step), k = Math.floor(z / step);
      const tx = smoothstep(x / step - i), ty = smoothstep(y / step - j), tz = smoothstep(z / step - k);
      let acc = 0;
      for (let dk = 0; dk <= 1; dk++) {
        const wz = dk ? tz : 1 - tz;
        for (let dj = 0; dj <= 1; dj++) {
          const wy = dj ? ty : 1 - ty;
          for (let di = 0; di <= 1; di++) {
            const wx = di ? tx : 1 - tx;
            acc += wx * wy * wz * value(i + di, j + dj, k + dk, sel);
          }
        }
      }
      s += weight * acc;
    }
    return s / total;
  };
}

// Coastline noise. Without it a note claims land out to a CONSTANT radius
// around itself: the world's edges are then perfect circular arcs, and the
// map looks like a string of bubbles. So the sea threshold is made to ripple
// in space, at two scales.
//
// Steps are on the order of a territory's RADIUS, not the world's. Noise
// that ripples over 97 px while a territory spans 45 shifts it as a block
// instead of carving it: the coast stays a circular arc, just displaced.
// That's what kept the "string of bubbles" look despite a strong amplitude.
// Steps are expressed as a chord on the unit sphere, and stay on the order of
// a territory's RADIUS (about 0.2 with current settings).
//
// UNFROZEN on 07/26 with the user's approval ("unfreeze the coastline
// shape"). Two octaves don't make a coastline: they make one big swell and
// one small one, so a soft outline. Real coastlines are fractal — bays,
// headlands, coves, at every scale down to fine detail. So we go finer, with
// a half ratio between successive scales, like real terrain.
//
// The floor is not a taste call but the GRID RESOLUTION: a cell is 2 px of
// skin, about 0.012 of chord. An octave finer than two or three cells
// wouldn't be drawn, it would be randomly sampled — edge speckle, not detail.
// 0.04 and 0.018 are therefore the last two useful steps.
//
// It's the SEA THRESHOLD being enriched, not the traced line after the fact:
// moving the coastline once computed would desync it from the partition
// grid, and lights, buildings and clicks would end up in the water.
const COAST_OCTAVES = [[0.22, 1], [0.088, 0.5], [0.04, 0.28], [0.018, 0.14]];

// Terrain relief. Steps are deliberately DIFFERENT from the coast's (and not
// multiples of them): two fields sharing steps would look alike, and
// mountains would start hugging bays — relief would add no new visual
// information. One octave finer than the coast, since shading lives on small
// detail.
// No FINER than the coast's steps, and especially not multiples of them.
// Measured on captures: at too coarse a step, relief makes dark blotches
// bigger than a territory, read as holes rather than mountains.
const RELIEF_OCTAVES = [[0.137, 1], [0.059, 0.5], [0.026, 0.25]];

// Same octaves, extended two notches for the faceted TERRAIN mesh.
//
// The list above stops at 0.026 chord because the precomputed shading lives
// on a 1024 px image: finer wouldn't be drawn there, only randomly sampled.
// The mesh, however, queries the field at the exact direction, at whatever
// fineness the zoom demands — the image's limit no longer applies to it.
// Without these two extra octaves, terrain is smooth and empty at country
// level: broad soft swells, no detail, exactly what had just been gained in
// coastline sharpness.
//
// RELIEF_OCTAVES itself is left untouched: it serves the other render path,
// whose look is validated.
const FINE_RELIEF_OCTAVES = RELIEF_OCTAVES.concat([[0.011, 0.12], [0.0045, 0.06]]);

// The parameter is no longer read; kept in the signature since partition's
// call passes it and tests supply it.
function coastNoise(PARAMS) { return fractalNoise3d(COAST_OCTAVES); }
function reliefNoise() { return fractalNoise3d(RELIEF_OCTAVES); }
function fineReliefNoise() { return fractalNoise3d(FINE_RELIEF_OCTAVES); }

// Terrain shading, computed ONCE at mount time.
//
// A height is derived from fractal noise, then that height is lit by a
// grazing light: a slope facing the light brightens, a slope in shadow
// darkens. That's what gives the valleys and ridges of the concept-art
// reference, where our terrain used to be a flat wash.
//
// `scale` = how many map pixels per shading pixel. 2 (half resolution) is
// plenty: shading is a soft texture, and computing the noise over the whole
// canvas at full pixel density would cost four times more for an invisible
// gain.
//
// Returns SIGNED `shade` in [-1, 1]: negative = slope in shadow, positive =
// lit slope. The renderer turns it into a black/white overlay — two tints,
// one array.
function reliefField(PARAMS, scale) {
  const step = scale || 2;
  const width = Math.ceil(PARAMS.skin.width / step);
  const height = Math.ceil(PARAMS.skin.height / step);
  const noise = reliefNoise();
  const h = new Float32Array(width * height);
  // Height is read from the DIRECTION, not the cell: that's what avoids a
  // seam at the antimeridian and a squashed pattern at the poles.
  for (let j = 0; j < height; j++)
    for (let i = 0; i < width; i++) {
      const v = toSphere(i * step, j * step, PARAMS);
      h[j * width + i] = noise(v[0], v[1], v[2]);
    }

  // Grazing light from the northwest, matching the reference renders.
  const lx = -0.7071, ly = -0.7071;
  const shade = new Float32Array(width * height);
  const bounded = (v, m) => Math.max(0, Math.min(m, v));
  // In longitude the image wraps on itself: the column right of the last one
  // is the first. Clamping to the edge, as on the flat map, would invent a
  // cliff in the middle of a continent here.
  const wrap = i => ((i % width) + width) % width;
  let peak = 0;
  for (let j = 0; j < height; j++)
    for (let i = 0; i < width; i++) {
      // Centered difference. In latitude we clamp to the edge (poles don't
      // fold onto each other), in longitude we wrap.
      const dzdx = h[j * width + wrap(i + 1)] - h[j * width + wrap(i - 1)];
      const dzdy = h[bounded(j + 1, height - 1) * width + i] - h[bounded(j - 1, height - 1) * width + i];
      const v = -(dzdx * lx + dzdy * ly);
      shade[j * width + i] = v;
      if (Math.abs(v) > peak) peak = Math.abs(v);
    }
  // Normalized by the strongest slope encountered: shading contrast then
  // depends on neither the sampling step nor the chosen octaves, only on the
  // terrain's shape.
  if (peak > 0) for (let k = 0; k < shade.length; k++) shade[k] /= peak;
  return { width, height, scale: step, heights: h, shade };
}

// How far the sea threshold can stray from its nominal value, in the unit
// used by the partition score (squared chords on the unit sphere).
//
// The amplitude is measured against a territory's WEIGHT share, not the base
// radius. It used to be seaIrregularity × seaRadius², which coupled two
// unrelated things: whenever the base radius was reduced to make area
// proportional to content, irregularity collapsed with it and coastlines
// went back to circular arcs — the "string of bubbles" already rejected
// once. Tied to weight, the carving keeps the same strength regardless of
// territory size.
function coastAmplitude(PARAMS) {
  return (PARAMS.grid.seaIrregularity || 0) * PARAMS.grid.weightToArea;
}

// Reach of a territory, as a chord on the unit sphere: how far a note can
// claim land around itself. It's partition's sea rule read backwards — a
// cell stays land as long as its squared distance, minus weight converted to
// area, doesn't exceed the sea threshold (coast noise included, so the most
// favorable case).
//
// No longer used to bound anything: the sphere has no edge, so no land can
// be cut by a frame. Kept because it expresses a useful quantity — a
// territory's expected size — that checks use to calibrate settings.
function territoryReach(note, PARAMS) {
  return Math.sqrt(PARAMS.grid.seaRadius + coastAmplitude(PARAMS)
                   + (note.weight || 1) * PARAMS.grid.weightToArea);
}

// --- Geography, SAMPLABLE AT ANY POINT -------------------------------------
//
// Until now geography only existed as a GRID: a 2 px skin cell, filled once
// at mount time, then painted and scaled up. That's what causes the sharp
// steps at country level — the skin is scaled up tenfold there, so a 2 px
// cell becomes a 38 px block on screen. No image smoothing fixes that: the
// fine-detail information was never computed, it was sampled too coarsely
// once and for all.
//
// The three functions below pull the FORMULAS out of the fill loop, so we
// can ask "what exactly is in this direction?" at any fineness — down to the
// screen pixel if needed, so as fine as the zoom demands.
//
// These are the single source: `partition` calls them to fill its cells,
// exactly as the terrain mesh calls them for its facets. Duplicating the
// formula on both sides would produce two geographies that silently
// diverge — a coastline painted where a click finds no land. A check forbids
// them from drifting apart.

// Ownership score: a POWER diagram (squared distance minus weight), not a
// Voronoi one — it's the weight that gives a heavy note a larger territory.
// Returns the index of the best-placed note and drops its score into
// `SCORE[0]`.
//
// The score is returned through a shared buffer rather than an array: this
// function is called half a million times per relaxation pass, and
// allocating a pair on every call would cost more than the whole computation.
const SCORE = new Float64Array(1);
function ownerAt(vx, vy, vz, notes, kWeight) {
  let best = -1, score = Infinity;
  for (let i = 0; i < notes.length; i++) {
    const v = notes[i].v;
    const dx = vx - v[0], dy = vy - v[1], dz = vz - v[2];
    const s = dx * dx + dy * dy + dz * dz - (notes[i].weight || 1) * kWeight;
    if (s < score) { score = s; best = i; }
  }
  SCORE[0] = score;
  return best;
}

// Polar extinction: share of the sea threshold still active at this
// latitude. 1 within the habitable band, 0 beyond it, fading over the last
// few degrees.
function polarShare(PARAMS, latDeg) {
  const latMax = PARAMS.grid.landLatitude || 0;
  if (!latMax) return 1;
  const fade = PARAMS.grid.latitudeFade || 1;
  const d = Math.abs(latDeg) - (latMax - fade);
  if (d <= 0) return 1;
  if (d >= fade) return 0;
  return 1 - d / fade;
}

// A threshold brought down to ZERO is NOT enough to forbid land, and that's
// what measurement showed: land still rose to 66° with extinction supposedly
// total at 58°. The score is `distance² − weight`, so it's NEGATIVE
// everywhere within reach of a heavy note — and a negative score still comes
// under a zero threshold. To truly extinguish, the threshold must drop below
// the lowest reachable score: that's this floor.
function thresholdFloor(notes, PARAMS) {
  let maxWeight = 1;
  for (const n of notes) maxWeight = Math.max(maxWeight, n.weight || 1);
  return maxWeight * PARAMS.grid.weightToArea
       + PARAMS.grid.seaRadius + coastAmplitude(PARAMS);
}

// Sea threshold in a direction: the nominal value, carved by coast noise,
// then extinguished toward the poles. A direction is land when its ownership
// score doesn't exceed this threshold.
function thresholdAt(vx, vy, vz, noise, amplitude, PARAMS, floor) {
  const raw = PARAMS.grid.seaRadius + (amplitude ? amplitude * noise(vx, vy, vz) : 0);
  const latDeg = Math.asin(Math.max(-1, Math.min(1, vz))) * 180 / Math.PI;
  const p = polarShare(PARAMS, latDeg);
  return p === 1 ? raw : raw * p - (1 - p) * floor;
}

// Geography probe: "in this direction, which note owns the ground, and what
// is its altitude?". Replays `partition`'s rule exactly, guaranteed core
// included, without a grid and without a fineness limit.
//
// The core is tested in SKIN COORDINATES, not angle: on the grid side it's a
// disk of cells, so a disk of skin pixels — a spherical disk wouldn't have
// the same shape near the poles, and the two geographies would drift apart
// exactly where it's least visible.
function sampler(notes, PARAMS, size) {
  const noise = coastNoise(PARAMS);
  const relief = fineReliefNoise();
  const amplitude = coastAmplitude(PARAMS);
  const floor = thresholdFloor(notes, PARAMS);
  const kWeight = PARAMS.grid.weightToArea;
  const cell = size || PARAMS.grid.cellWorld || 2;
  const coreRadius = (PARAMS.grid.core || 0) * cell;   // in skin pixels
  const coreRadius2 = coreRadius * coreRadius;
  const width = PARAMS.skin.width;
  const anchors = notes.map(n => fromSphere(n.v, PARAMS));

  return {
    // Index of the owning note, or -1 for sea.
    owner(vx, vy, vz) {
      const s = thresholdAt(vx, vy, vz, noise, amplitude, PARAMS, floor);
      const i = ownerAt(vx, vy, vz, notes, kWeight);
      if (SCORE[0] <= s) return i;
      // Outside the territory: the guaranteed core still writes
      // unconditionally — except under TOTAL extinction (p <= 0), otherwise
      // a note placed high in latitude would replant land beyond the limit.
      // `s < 0` was the wrong test: `s` mixes latitude with the vault's MAX
      // weight (`thresholdFloor`), so a light note in the fade zone was also
      // losing its own core, at its own anchor — see the twin note in
      // `partition`.
      if (coreRadius2 <= 0) return -1;
      const latDeg = Math.asin(Math.max(-1, Math.min(1, vz))) * 180 / Math.PI;
      if (polarShare(PARAMS, latDeg) <= 0) return -1;
      const p = fromSphere([vx, vy, vz], PARAMS);
      for (let k = 0; k < anchors.length; k++) {
        let dx = Math.abs(p[0] - anchors[k][0]);
        if (dx > width / 2) dx = width - dx;                    // the skin wraps in x
        const dy = p[1] - anchors[k][1];
        if (dx * dx + dy * dy <= coreRadius2) return k;
      }
      return -1;
    },
    // Raw terrain altitude, in [-1, 1]. Same field as the precomputed shading
    // (`reliefField`), but read at the exact direction instead of re-read
    // from a half-resolution image.
    altitude(vx, vy, vz) { return relief(vx, vy, vz); }
  };
}

// Placement of notes ON THE SPHERE.
//
// Same three forces as before — repulsion between notes, attraction along
// links, cohesion toward the domain anchor — but applied to directions, and
// followed by a reprojection onto the globe after each step.
//
// There's no clamping left at all: the sphere is closed, a note can't leave
// the world. The whole margin apparatus of the flat map disappears here, and
// with it the "land cut clean at zoom-out" defect it used to contain — there
// is no longer an edge for it to happen at.
//
// Each note gets its direction `n.v`, and its skin position `n.x`/`n.y` (see
// toSphere) so the rest of the program keeps working in rectangular
// coordinates.
function computePositions(notes, PARAMS) {
  const layout = PARAMS.layout;
  const index = new Map(notes.map((n, i) => [n.path, i]));

  // Habitable band: land stays between two latitudes, the poles are ocean.
  //
  // Reported from Obsidian: "some continents are at the poles". It's the
  // worst spot on the map — the skin is squashed there (a territory
  // stretches into a ribbon), the camera loses its north reference, and
  // nothing is readable anymore. The value is the SINE of the maximum
  // latitude: 0.82 ≈ 55 degrees.
  const band = layout.latitudeBand || 1;
  for (const n of notes) {
    // Starting direction drawn from the note's path, so stable from one
    // opening to the next. The draw goes through latitude in arcsine,
    // otherwise points cluster at the poles instead of covering the globe.
    const r = random(hash(n.path));
    const lat = Math.asin((2 * r() - 1) * band), lon = (2 * r() - 1) * Math.PI;
    const cl = Math.cos(lat);
    n.v = [cl * Math.cos(lon), cl * Math.sin(lon), Math.sin(lat)];
  }

  // Domain anchors spread REGULARLY over the globe, via a Fibonacci spiral,
  // not drawn at random: at random, two domains often land side by side and
  // their continents merge into one block, while a third ends up alone on
  // the other side. The overall rotation still derives from the domain
  // name — the map stays stable.
  const names = [];
  for (const n of notes) if (!names.includes(n.continent)) names.push(n.continent);
  const anchors = new Map();
  names.forEach((name, k) => {
    const offset = random(hash(name))() * 2 * Math.PI;
    // The spiral stays regular, but confined to the habitable band: without
    // this factor, with seven domains, the first two land almost on the
    // poles — and a continent at the pole is unreadable.
    const z = (1 - 2 * (k + 0.5) / names.length) * band;
    const rho = Math.sqrt(Math.max(0, 1 - z * z));
    const th = k * 2.399963229728653 + offset;   // golden angle
    anchors.set(name, [rho * Math.cos(th), rho * Math.sin(th), z]);
  });

  const f = notes.map(() => [0, 0, 0]);
  for (let it = 0; it < layout.iterations; it++) {
    for (let i = 0; i < notes.length; i++) { f[i][0] = 0; f[i][1] = 0; f[i][2] = 0; }
    for (let i = 0; i < notes.length; i++) {
      const a = notes[i].v;
      for (let j = i + 1; j < notes.length; j++) {
        const b = notes[j].v;
        let dx = a[0] - b[0], dy = a[1] - b[1], dz = a[2] - b[2];
        let d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < 1e-6) { d2 = 1e-6; dx = 1e-3; dy = 1e-3; dz = 0; }
        const g = layout.repulsion / d2, d = Math.sqrt(d2);
        f[i][0] += dx / d * g; f[i][1] += dy / d * g; f[i][2] += dz / d * g;
        f[j][0] -= dx / d * g; f[j][1] -= dy / d * g; f[j][2] -= dz / d * g;
      }
    }
    for (let i = 0; i < notes.length; i++) {
      const a = notes[i];
      for (const l of a.links || []) {
        const j = index.get(l); if (j === undefined) continue;
        const b = notes[j].v;
        f[i][0] += (b[0] - a.v[0]) * layout.attraction;
        f[i][1] += (b[1] - a.v[1]) * layout.attraction;
        f[i][2] += (b[2] - a.v[2]) * layout.attraction;
      }
      const anchor = anchors.get(a.continent);
      f[i][0] += (anchor[0] - a.v[0]) * layout.cohesion;
      f[i][1] += (anchor[1] - a.v[1]) * layout.cohesion;
      f[i][2] += (anchor[2] - a.v[2]) * layout.cohesion;
    }
    for (let i = 0; i < notes.length; i++) {
      const a = notes[i];
      a.v = inBand(normalize([a.v[0] + f[i][0] * layout.step,
                              a.v[1] + f[i][1] * layout.step,
                              a.v[2] + f[i][2] * layout.step]), band);
    }
  }
  for (const n of notes) { const p = fromSphere(n.v, PARAMS); n.x = p[0]; n.y = p[1]; }
  return notes;
}

// Approximated weighted Voronoi: a power diagram (distance² − weight), laid
// ON THE SPHERE. That's what makes area proportional to weight.
//
// Distance is chordal (see distance2): same partition as a surface distance,
// but the border between two notes stays the exact intersection of a plane
// with the globe, a true curve — that's what snapToBisectors goes after to
// remove the staircase on interior borders.
//
// The grid is CYCLIC in longitude: the last column touches the first. So
// there's no more edge, no more margin, and no land can be sliced by a
// frame.
//
// DOCUMENTED SIDE EFFECT (contractual for callers, even though it doesn't
// show up in the return value): Lloyd relaxation moves each note to its
// territory's centroid, i.e. partition() writes note.v as well as note.x /
// note.y in addition to returning { width, height, size, cells, areas }.
// Rendering and hit-testing rely on these recentered positions: do not
// remove.
function partition(notes, PARAMS, size) {
  const band = (PARAMS.layout && PARAMS.layout.latitudeBand) || 1;
  const width = Math.ceil(PARAMS.skin.width / size);
  const height = Math.ceil(PARAMS.skin.height / size);
  const cells = new Int32Array(width * height);

  // Direction and REAL AREA of each cell, computed once.
  //
  // The area is essential: on the skin all cells are equal, but on the globe
  // a cell near a pole is much smaller than one at the equator. Counting
  // cells instead of their area would give polar notes an outsized weight —
  // and would silently ruin the "area is earned" invariant, exactly as it
  // was lost once already.
  const dirs = new Float64Array(width * height * 3);
  const areas = new Float64Array(width * height);
  for (let gy = 0; gy < height; gy++) {
    const py = gy * size + size / 2;
    const lat = (0.5 - py / PARAMS.skin.height) * Math.PI;
    const cl = Math.cos(lat), sl = Math.sin(lat);
    for (let gx = 0; gx < width; gx++) {
      const px = gx * size + size / 2;
      const lon = (px / PARAMS.skin.width - 0.5) * 2 * Math.PI;
      const k = gy * width + gx;
      dirs[k * 3] = cl * Math.cos(lon); dirs[k * 3 + 1] = cl * Math.sin(lon); dirs[k * 3 + 2] = sl;
      areas[k] = Math.max(1e-9, cl);
    }
  }

  // Sea threshold PER CELL: nominal value, carved by coast noise, then
  // extinguished toward the poles. Computed once for all — it depends only
  // on position, not on the notes, whereas fill() is replayed on every
  // relaxation pass.
  //
  // The user report behind polar extinction: "some continents go to the
  // poles". Yet the ANCHORS were properly confined to ±55° by
  // `layout.latitudeBand` — but a territory extends some fifteen degrees
  // around its anchor, and land actually reached 68.6°. Confining the notes
  // doesn't confine the land: measurement showed that, not reasoning. So we
  // extinguish the sea threshold ITSELF over the last few degrees, rather
  // than cutting land at a fixed latitude: a straight edge would read as a
  // rendering bug, while a fading threshold lets coast noise draw an
  // irregular polar shoreline.
  //
  // The formula itself lives in `thresholdAt`: the same one the terrain mesh
  // queries per facet. Two copies would silently diverge.
  const noise = coastNoise(PARAMS);
  const amplitude = coastAmplitude(PARAMS);
  const floor = thresholdFloor(notes, PARAMS);
  const thresholds = new Float64Array(width * height);
  // TOTAL extinction per cell (p <= 0, beyond `landLatitude`) — distinct from
  // a plain negative threshold. `thresholds[k]` mixes two things: latitude
  // AND the vault's MAX weight (see `thresholdFloor`), so a light note can
  // have an already-negative threshold in the fade zone, well before real
  // extinction. Using `thresholds[k] < 0` to block the core also
  // extinguished light notes at their OWN anchor — the guaranteed core is
  // supposed to protect them from exactly that.
  const extinguished = new Uint8Array(width * height);
  for (let k = 0; k < width * height; k++) {
    thresholds[k] = thresholdAt(dirs[k * 3], dirs[k * 3 + 1], dirs[k * 3 + 2],
                        noise, amplitude, PARAMS, floor);
    const latDeg = Math.asin(Math.max(-1, Math.min(1, dirs[k * 3 + 2]))) * 180 / Math.PI;
    extinguished[k] = polarShare(PARAMS, latDeg) <= 0 ? 1 : 0;
  }

  const kWeight = PARAMS.grid.weightToArea;
  const fill = () => {
    for (let k = 0; k < width * height; k++) {
      const i = ownerAt(dirs[k * 3], dirs[k * 3 + 1], dirs[k * 3 + 2], notes, kWeight);
      cells[k] = SCORE[0] > thresholds[k] ? -1 : i;
    }
    cores();
  };

  // Guaranteed core: a few cells around each note always belong to it, even
  // if the partition would give them to a neighbor or the sea.
  //
  // This is not decoration, it fixes a fundamental flaw of the power
  // diagram: a light note stuck next to a heavy one can lose ALL of its
  // territory. It then becomes invisible on the map and unreachable by
  // click — a vault note simply gone. The problem used to be worked around
  // by keeping land scarce (territories had nothing to contest), at the cost
  // of a planet of isolated islands, reported by the user from Obsidian.
  //
  // The core lifts that trade-off: much more land can now be handed out
  // without losing anyone. It only costs a few cells per note, so it doesn't
  // distort the area/weight proportionality (checked separately).
  const coreRadius = PARAMS.grid.core || 0;
  function cores() {
    if (coreRadius <= 0) return;
    for (let i = 0; i < notes.length; i++) {
      const p = fromSphere(notes[i].v, PARAMS);
      const cx = Math.floor(p[0] / size), cy = Math.floor(p[1] / size);
      for (let dy = -coreRadius; dy <= coreRadius; dy++) {
        const gy = cy + dy;
        if (gy < 0 || gy >= height) continue;          // beyond a pole
        for (let dx = -coreRadius; dx <= coreRadius; dx++) {
          if (dx * dx + dy * dy > coreRadius * coreRadius) continue;   // a disk, not a square
          const gx = (((cx + dx) % width) + width) % width;       // wrap in longitude
          // The core writes unconditionally: it must therefore also respect
          // polar extinction — otherwise a note placed high in latitude
          // would replant land beyond the limit. `extinguished`, not
          // `thresholds[...] < 0` — see the note above about this exact trap.
          if (extinguished[gy * width + gx]) continue;
          cells[gy * width + gx] = i;
        }
      }
    }
  }

  fill();
  // Lloyd relaxation: regularizes shapes without making them geometric.
  for (let pass = 0; pass < PARAMS.grid.lloyd; pass++) {
    const sx = new Float64Array(notes.length), sy = new Float64Array(notes.length);
    const sz = new Float64Array(notes.length), count = new Int32Array(notes.length);
    for (let k = 0; k < width * height; k++) {
      const i = cells[k];
      if (i < 0) continue;
      // Direction average WEIGHTED BY AREA, then brought back onto the
      // globe: that's the center in the sphere's sense. A plain average of
      // the skin's rows/columns would pull notes toward the poles.
      const a = areas[k];
      sx[i] += dirs[k * 3] * a; sy[i] += dirs[k * 3 + 1] * a; sz[i] += dirs[k * 3 + 2] * a;
      count[i]++;
    }
    // A territory's center is always somewhere in the world (the sphere is
    // closed), but it can fall outside the habitable band: territories
    // overflow toward the poles, for lack of competitors at those
    // latitudes, and their center follows. So we fold it back, otherwise
    // notes migrate toward the poles pass after pass — which confining the
    // anchors alone wasn't enough to prevent.
    for (let i = 0; i < notes.length; i++)
      if (count[i] > 0 && (sx[i] || sy[i] || sz[i])) {
        notes[i].v = inBand(normalize([sx[i], sy[i], sz[i]]), band);
        const p = fromSphere(notes[i].v, PARAMS);
        notes[i].x = p[0]; notes[i].y = p[1];
      }
    fill();
  }
  return { width, height, size, cells, areas };
}

function extractBorders(grid, notes, level) {
  const key = i => {
    if (i < 0) return SEP + "sea";
    const n = notes[i];
    if (level === "continent") return n.continent;
    if (level === "country") return n.continent + SEP + n.country;
    return n.continent + SEP + n.country + SEP + n.region;
  };
  const { width, height, size, cells } = grid;
  const segments = [];
  for (let gy = 0; gy < height; gy++)
    for (let gx = 0; gx < width; gx++) {
      const here = key(cells[gy * width + gx]);
      // The column right of the last one is the first: the world is round
      // in longitude. Without this wrap, a territory straddling the
      // antimeridian would be cut in two by a border that doesn't exist.
      if (key(cells[gy * width + (gx + 1) % width]) !== here)
        segments.push({ x1: (gx + 1) * size, y1: gy * size, x2: (gx + 1) * size, y2: (gy + 1) * size });
      // In latitude, however, nothing wraps: the poles are true ends of the
      // world, not a seam.
      if (gy + 1 < height && key(cells[(gy + 1) * width + gx]) !== here)
        segments.push({ x1: gx * size, y1: (gy + 1) * size, x2: (gx + 1) * size, y2: (gy + 1) * size });
    }
  return segments;
}

// --- From staircase steps to coastlines ------------------------------------
//
// extractBorders returns isolated bits of cell edge, all grid-aligned. Drawn
// as-is, they look like a staircase: the defect visible as soon as you zoom
// in. Two steps fix it, both computed ONCE at mount time (never in the
// animation loop):
//   1. chainBorders stitches the pieces into continuous polylines;
//   2. smoothLine rounds the steps by corner-cutting (Chaikin).
// The partition grid itself doesn't move: hit-testing and territories stay
// exactly what they were, only the drawn line changes.

// The single land/sea outline, with no interior border at all: it's the
// continent's silhouette, used to clip the land fill (see render.land).
// A separate function rather than a level of extractBorders: here only the
// SIGN of the cell matters, no territory key to build.
//
// On the sphere, the skin's rim is no longer a shoreline: left and right the
// world wraps on itself, and top and bottom are the poles, which are points
// of the world, not its edge. So no artificial coastline is fabricated
// around the rim anymore — that was a crutch of the flat map, where
// territories overflowed a frame.
//
// The poles remain a special case: if land touches the first or last row,
// the contour must still close. So it closes on the polar row, otherwise the
// silhouette would be an open ribbon and fill nothing (defect already hit
// once: 512 cells recognized out of 11,926).
function extractCoast(grid) {
  const { width, height, size, cells } = grid;
  const land = (gx, gy) => {
    if (gy < 0 || gy >= height) return false;            // beyond a pole: nothing
    const x = ((gx % width) + width) % width;        // wrap in longitude
    return cells[gy * width + x] >= 0;
  };
  const segments = [];
  // Vertical edges: every column, the last wrapping onto the first.
  for (let gy = 0; gy < height; gy++)
    for (let gx = 0; gx < width; gx++)
      if (land(gx, gy) !== land(gx + 1, gy))
        segments.push({ x1: (gx + 1) * size, y1: gy * size, x2: (gx + 1) * size, y2: (gy + 1) * size });
  // Horizontal edges, from gy = -1 (above the north pole) to height - 1.
  for (let gy = -1; gy < height; gy++)
    for (let gx = 0; gx < width; gx++)
      if (land(gx, gy) !== land(gx, gy + 1))
        segments.push({ x1: gx * size, y1: (gy + 1) * size, x2: (gx + 1) * size, y2: (gy + 1) * size });
  return segments;
}

// Stitches segments into polylines. A closed loop comes back to its start
// (first point === last). Chaining STOPS at any vertex where anything other
// than two segments meet (an endpoint, or a T/X junction between three
// territories): there, no continuation is "the" right one, and picking one
// at random would make the line jump from one territory to another.
function chainBorders(segments) {
  const key = (x, y) => x + "|" + y;
  const adj = new Map();   // vertex -> [{ v: neighbor vertex, id: segment }]
  const pts = new Map();   // vertex -> [x, y]
  const add = (a, b, id) => {
    if (!adj.has(a)) adj.set(a, []);
    adj.get(a).push({ v: b, id });
  };
  segments.forEach((s, id) => {
    const a = key(s.x1, s.y1), b = key(s.x2, s.y2);
    pts.set(a, [s.x1, s.y1]); pts.set(b, [s.x2, s.y2]);
    add(a, b, id); add(b, a, id);
  });

  const visited = new Uint8Array(segments.length);
  const lines = [];
  // "Open" vertices (degree != 2) first: an open line must be walked from
  // its endpoint, otherwise it would come out cut in two. Closed loops,
  // where every vertex has degree 2, are collected afterward.
  const vertices = [...adj.keys()];
  const starts = vertices.filter(k => adj.get(k).length !== 2).concat(vertices);
  for (const start of starts) {
    for (const first of adj.get(start)) {
      if (visited[first.id]) continue;
      const line = [pts.get(start)];
      let edge = first;
      while (edge && !visited[edge.id]) {
        visited[edge.id] = 1;
        line.push(pts.get(edge.v));
        const next = adj.get(edge.v);
        edge = next.length === 2 ? next.find(a => !visited[a.id]) : null;
      }
      lines.push(line);
    }
  }
  return lines;
}

// Corner-cutting (Chaikin): each segment is replaced by its quarter and
// three-quarter points, which planes off right angles without ever leaving
// the original line's envelope — the coast stays glued to its territory. A
// closed line is smoothed as a loop (no frozen angle at the seam); an open
// line keeps both endpoints, otherwise neighboring lines would come apart at
// the joints.
function smoothLine(line, passes) {
  if (line.length < 3 || passes <= 0) return line;
  const closed = line[0][0] === line[line.length - 1][0]
             && line[0][1] === line[line.length - 1][1];
  let pts = closed ? line.slice(0, -1) : line.slice();
  for (let k = 0; k < passes; k++) {
    if (pts.length < 3) break;
    const n = pts.length, out = [];
    if (!closed) out.push(pts[0]);
    for (let i = 0; i < (closed ? n : n - 1); i++) {
      const a = pts[i], b = pts[(i + 1) % n];
      out.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25]);
      out.push([a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
    }
    if (!closed) out.push(pts[n - 1]);
    pts = out;
  }
  return closed ? pts.concat([pts[0]]) : pts;
}

// Glues open lines that share an endpoint back together, end to end, until
// closed loops are obtained. Needed for the coastline: wherever two land
// cells touch only at a corner, four coastline pieces meet at the same
// vertex and chaining stops there (no continuation is obvious). The stroke
// tolerates that, but a FILL needs closed contours, otherwise the land
// silhouette falls apart into pieces.
// The pairing at these four-branch vertices is arbitrary — it doesn't
// matter: every way of pairing them gives the same area.
function closeLoops(lines) {
  const closed = l => l[0][0] === l[l.length - 1][0] && l[0][1] === l[l.length - 1][1];
  const closedList = lines.filter(closed);
  const open = lines.filter(l => !closed(l));
  while (open.length) {
    let current = open.shift();
    for (let progress = true; progress && !closed(current);) {
      progress = false;
      const end = current[current.length - 1];
      for (let i = 0; i < open.length; i++) {
        const o = open[i], a = o[0], b = o[o.length - 1];
        if (a[0] === end[0] && a[1] === end[1]) current = current.concat(o.slice(1));
        else if (b[0] === end[0] && b[1] === end[1]) current = current.concat(o.slice(0, -1).reverse());
        else continue;
        open.splice(i, 1); progress = true; break;
      }
    }
    // Safety net: a line that never closes (a coastline cut by the canvas
    // edge) is closed by force, otherwise it would fill nothing.
    closedList.push(closed(current) ? current : current.concat([current[0]]));
  }
  return closedList;
}

// --- The step itself, not just its angle -----------------------------------
//
// Corner-cutting smooths a step's angle, never the step itself: measured on
// the real map, a vertex's offset from the ten-cell chord is 1.04 px at 2
// passes, 1.03 at 4, 1.02 at 8 — it stops moving. That's why adding passes
// never fixed the staircase on interior borders, only doubled the cost. The
// step is real geometry: the border between two territories is rasterized
// on a 2 px cell, and at country level the map is scaled up roughly tenfold.
//
// But that border is known EXACTLY: the partition is a power diagram, so the
// border between two notes is the line |p−a|² − w_a = |p−b|² − w_b. Each
// vertex is snapped to it with one Newton step — exact on the first try,
// since the gradient of the difference is constant.
//
// Two families of vertices are left untouched:
//  - those bordering the sea: there, the border isn't a bisector but the
//    rippled sea threshold, whose irregularity is exactly the point;
//  - those whose projection would move more than one cell, a sign that the
//    two notes picked aren't the ones actually bordering this vertex (a
//    triple point, a territory split in two).
//
// `key` identifies the traced level: the two notes picked must be on either
// side of THAT border. Otherwise, on a country border, two notes of the same
// country could be picked and the vertex would be pulled onto an internal
// border we don't draw.
// On the sphere, the exact border between two notes is the intersection of a
// PLANE with the globe, a circle. Same reasoning as flat, one level up: the
// vertex is snapped onto that plane with a Newton step (exact on the first
// try, the gradient being constant), then put back on the globe and
// translated back to skin coordinates.
function snapToBisectors(lines, grid, notes, PARAMS, key) {
  const { width, height, size, cells } = grid;
  const k = PARAMS.grid.weightToArea;
  const cellAt = (gx, gy) => {
    if (gy < 0 || gy >= height) return -1;
    const x = ((gx % width) + width) % width;     // wrap in longitude
    return cells[gy * width + x];
  };
  const score = (n, p) => distance2(p, n.v) - (n.weight || 1) * k;
  const project = point => {
    const [x, y] = point;
    const gx = Math.round(x / size), gy = Math.round(y / size);
    // The four cells touching the vertex. If even one is sea, the vertex
    // belongs to the coastline: leave it alone.
    const candidates = [];
    for (let dy = -1; dy <= 0; dy++)
      for (let dx = -1; dx <= 0; dx++) {
        const i = cellAt(gx + dx, gy + dy);
        if (i < 0) return point;
        if (!candidates.includes(i)) candidates.push(i);
      }
    const p = toSphere(x, y, PARAMS);
    let a = -1, sa = Infinity;
    for (const i of candidates) {
      const s = score(notes[i], p);
      if (s < sa) { a = i; sa = s; }
    }
    let b = -1, sb = Infinity;
    for (const i of candidates) {
      if (key(i) === key(a)) continue;
      const s = score(notes[i], p);
      if (s < sb) { b = i; sb = s; }
    }
    if (b < 0) return point;
    // Gradient of the score difference: twice the vector from one note to
    // the other, through the globe.
    const u = [notes[b].v[0] - notes[a].v[0],
               notes[b].v[1] - notes[a].v[1],
               notes[b].v[2] - notes[a].v[2]];
    const d2 = u[0] * u[0] + u[1] * u[1] + u[2] * u[2];
    if (d2 < 1e-12) return point;
    const t = (sa - sb) / (2 * d2);
    const q = normalize([p[0] - t * u[0], p[1] - t * u[1], p[2] - t * u[2]]);
    // Safety guard, same intent as before: a vertex that would need to move
    // more than one cell isn't bordered by the two notes picked (a triple
    // point, a territory split in two).
    //
    // But it's measured ON THE SPHERE, not on the skin. On the skin, a
    // modest move near a pole stretches into a huge jump in longitude — the
    // guard used to reject almost everything there, and the staircase on
    // interior borders survived (measured: roughness only dropped by a
    // factor of 1.4 instead of 3).
    const sphereStep = Math.PI * size / PARAMS.skin.height;   // side of a cell, in radians
    if (distance2(p, q) > sphereStep * sphereStep) return point;
    const r = fromSphere(q, PARAMS);
    // Translating back to the skin accounts for the wrap in longitude,
    // otherwise a vertex near the antimeridian would appear to jump from one
    // end of the world to the other.
    let dx = r[0] - x;
    const wrap = PARAMS.skin.width;
    if (dx > wrap / 2) dx -= wrap;
    if (dx < -wrap / 2) dx += wrap;
    return [x + dx, r[1]];
  };
  return lines.map(l => l.map(project));
}

// Closed, smoothed contour of EACH note's territory, ready to fill.
//
// The coastline settles the outer silhouette, but internally the ground was
// still painted cell by cell: borders between two neighboring territories
// kept their staircase. Here each note gets its own outline, smoothed like
// the coast, and the ground is painted as flat fills rather than squares.
//
// A single grid sweep serves everyone: an edge between two different cells
// belongs to the TWO territories it separates, so it's filed into both
// buckets. Sweeping per note would cost the number of notes times the whole
// grid.
function extractTerritoryContours(grid, notes, passes, PARAMS) {
  const { width, height, size, cells } = grid;
  const bundles = notes.map(() => []);
  const cellAt = (gx, gy) => {
    if (gy < 0 || gy >= height) return -1;
    const x = ((gx % width) + width) % width;     // wrap in longitude
    return cells[gy * width + x];
  };
  const store = (i, seg) => { if (i >= 0) bundles[i].push(seg); };
  // Longitude wraps: every column is swept, the last touching the first.
  // There's no more canvas rim to count as a border — that was a crutch of
  // the flat map.
  for (let gy = 0; gy < height; gy++)
    for (let gx = 0; gx < width; gx++) {
      const a = cellAt(gx, gy), b = cellAt(gx + 1, gy);
      if (a === b) continue;
      const s = { x1: (gx + 1) * size, y1: gy * size, x2: (gx + 1) * size, y2: (gy + 1) * size };
      store(a, s); store(b, s);
    }
  for (let gy = -1; gy < height; gy++)
    for (let gx = 0; gx < width; gx++) {
      const a = cellAt(gx, gy), b = cellAt(gx, gy + 1);
      if (a === b) continue;
      const s = { x1: gx * size, y1: (gy + 1) * size, x2: (gx + 1) * size, y2: (gy + 1) * size };
      store(a, s); store(b, s);
    }
  // A territory's outline is its note's bisector against each of its
  // neighbors: the level is therefore the note itself.
  return bundles.map(segs => {
    let lines = closeLoops(chainBorders(segs));
    if (PARAMS) lines = snapToBisectors(lines, grid, notes, PARAMS, i => i);
    return lines.map(l => smoothLine(l, passes));
  });
}

// Contours ready to draw for a level: segments -> polylines -> snap to exact
// bisector -> smoothing.
// The "coast" level only keeps the land/sea border (extractCoast).
function extractContours(grid, notes, level, passes, PARAMS) {
  const coast = level === "coast";
  const segments = coast ? extractCoast(grid)
                        : extractBorders(grid, notes, level);
  let lines = chainBorders(segments);
  if (coast) lines = closeLoops(lines);
  // The coastline isn't a bisector but the rippled sea threshold: nothing to
  // snap there (the snap would refuse itself, vertex by vertex).
  if (PARAMS && !coast) {
    const key = level === "continent" ? i => notes[i].continent
              : level === "country" ? i => notes[i].continent + SEP + notes[i].country
              : i => notes[i].continent + SEP + notes[i].country + SEP + notes[i].region;
    lines = snapToBisectors(lines, grid, notes, PARAMS, key);
  }
  return lines.map(l => smoothLine(l, passes));
}

// --- Confirmation against the terrain mesh ---------------------------------
//
// User report (07/28): ports/airports off the coast, THEN city lights off
// land — the same underlying defect, in two spots. Any position placed by
// THIS file (`layout.js`) is decided on the FINE partition grid (2 px); what
// actually shows on screen, once terrain is active, is the Voronoi mesh from
// `terrain.js` — ~17x coarser (facets aim for ~34 px), and built AFTER the
// fact, at a canvas size unknown here (`seedTerminals`/`seedLights` run at
// model load, before any canvas exists). A point valid on the fine grid —
// truly, measured — can therefore land, once seen from the real mesh, in the
// sea or in a neighbor's territory: not a rule error, but two different
// geographies stacked on top of each other, already hit elsewhere in this
// module (hover, contours).
//
// The fix: confirm a candidate against a SAMPLE of the mesh that `terrain.js`
// will actually build. `terrain` is the loaded module (injected by
// `buildModel`/`render.mount`, both already have it); without it (tests,
// harness), we fall back to the old rule — never a crash.
//
// A SINGLE reference size is NOT enough, and this isn't a guess: measured by
// confirming against 1400x900 then re-checking against a DIFFERENT size
// (1650x980, as plausible as any — the user's real canvas is unknown here).
// Same result before and after doubling the setback margin (33% of ports
// mismatched in both cases): the site sample is rebuilt WITH NO RELATION to
// the previous one as soon as `n` changes (already documented in
// `terrain.js`, § `siteLevel`) — confirming against one reference guarantees
// nothing for another. The fix: confirm against SEVERAL representative sizes
// and require agreement from ALL of them — a point far from the coast at any
// of these resolutions is likely to be so at the user's own, unknown, one
// too.
const REF_TERRAIN_SIZES = [[900, 560], [1400, 900], [1900, 1150]];
function createTerrainConfirmer(notes, PARAMS, size, terrain, meshHint) {
  if (!terrain) return () => true;
  const refSampler = sampler(notes, PARAMS, size);
  // The REAL canvas first when the caller knows it: the three reference sizes
  // are only a safety net for post-mount resizing. Confirming against one
  // resolution guarantees nothing for another (the tiling is rebuilt with no
  // relation to the previous one as soon as `n` changes, cf. terrain.js §
  // siteLevel) — hence accumulating checks rather than replacing them.
  const tailles = meshHint
    ? [[meshHint.width, meshHint.height], ...REF_TERRAIN_SIZES]
    : REF_TERRAIN_SIZES.slice();
  const refs = tailles.map(([l, h]) => {
    const n = terrain.siteLevel(l, h, PARAMS);
    const sites = terrain.seedSites(n);
    return { sites, index: terrain.buildIndex(sites, n) };
  });
  return (v, i) => {
    for (const { sites, index } of refs) {
      const s = terrain.nearest(sites, index, v);
      // Cautious fallback: a site not found doesn't count as a mismatch
      // (degenerate case, not observed in practice).
      if (s < 0) continue;
      if (refSampler.owner(sites[s * 3], sites[s * 3 + 1], sites[s * 3 + 2]) !== i) return false;
    }
    return true;
  };
}

// --- City lights ------------------------------------------------------------
//
// One light point per note gave about sixty fireflies scattered over the
// whole planet: the reference instead shows a DENSE texture of small tight
// golden dots — that texture is what reads a territory as inhabited, and it
// was the biggest remaining gap from the reference look.
//
// The sample lives HERE and not in the renderer, for two reasons: it's
// computed once at mount time (the renderer only draws points from then on),
// and the invariant that matters is checked outside the browser — a light
// must fall INSIDE its note's territory, otherwise a city glows on the sea
// or in a neighbor's yard.
//
// Rejection sampling against the partition grid: it's the only rule that
// can't lie, since it's exactly the one used for the cut. An analytic sample
// (a disk around the note) would overflow as soon as a territory isn't
// round — and none of them are.
//
// Returns, per note, a list of [x, y, warm, glow]: `warm` (0 or 1) picks
// between window-gold and cold-halogen white, `glow` sets the brightness.
// Both are drawn from the note's path, so stable from one opening to the
// next: a city should keep its grain, it's a mental landmark.
function seedLights(grid, notes, PARAMS, terrain, meshHint) {
  const W = PARAMS.skin.width, H = PARAMS.skin.height;
  // See "Confirmation against the terrain mesh" above: without it, a light
  // valid on the fine grid could land off land once seen from the mesh
  // actually painted (user report, 07/28).
  const confirm = createTerrainConfirmer(notes, PARAMS, grid.size, terrain, meshHint);
  return notes.map((n, i) => {
    const r = random(hash("lights" + SEP + n.path));
    // Number of lights: density follows content, like area. A heavy note is
    // a big city, a light one a hamlet.
    const count = Math.max(14, Math.min(130, Math.round(16 + (n.weight || 1) * 22)));
    // Search radius: the territory's reach, translated from a chord on the
    // sphere into skin pixels. In longitude the skin stretches toward the
    // poles, so the search must widen there — otherwise a polar note's
    // cities bunch into a vertical bar.
    const chord = territoryReach(n, PARAMS);
    const angle = 2 * Math.asin(Math.max(-1, Math.min(1, chord / 2)));
    const ry = angle * H / Math.PI;
    const lat = (0.5 - n.y / H) * Math.PI;
    const rx = ry / Math.max(0.15, Math.cos(lat));
    const points = [];
    // Rejection is bounded: on a heavily carved territory, missing is
    // normal. Better a slightly less dense city than a mount that hangs.
    for (let attempt = 0; attempt < count * 8 && points.length < count; attempt++) {
      // Square-root draw = uniform disk; the lower exponent pulls toward the
      // center, giving a downtown plus outskirts rather than an even sprinkle.
      const d = Math.pow(r(), 0.62), th = r() * 2 * Math.PI;
      let x = n.x + Math.cos(th) * d * rx;
      const y = n.y + Math.sin(th) * d * ry;
      if (y < 0 || y >= H) continue;              // beyond a pole: no world there
      x = ((x % W) + W) % W;                       // longitude wraps
      if (cellUnder(grid, x, y) !== i) continue;
      if (!confirm(toSphere(x, y, PARAMS), i)) continue;
      // Gold dominates heavily, cold white only punctuates: at equal shares,
      // the city drifted toward blue-gray and the warmth stopped reading.
      points.push([x, y, r() < 0.8 ? 1 : 0, 0.45 + r() * 0.55]);
    }
    // Safety net: a tiny territory may accept nothing. The note must stay
    // visible — a note with no light is a note you can't find.
    if (!points.length) points.push([n.x, n.y, 1, 1]);
    return points;
  });
}

// --- Stations, ports and airports ------------------------------------------
//
// Two Obsidian reports that are really one: boats used to leave from the
// note's CENTER — the middle of the land, crossing their own continent
// before touching water — and all three transport types left from the same
// point, so nothing told a port apart from an airport or a station when a
// single territory had all three.
//
// One terminal per type and per note, seeded ONCE at mount time:
//   — station : at the heart of the city, i.e. the note itself;
//   — port    : on a COASTAL cell of the territory (the one facing the
//               destination is picked when the arc is drawn, hence a list
//               rather than a single point);
//   — airport : inland, away from the city.
//
// Read from the partition GRID, never an analytic formula: it's the only
// rule that can't lie about what's land, sea, or whose — same reasoning, and
// the same trap avoided, as seedLights (a disk around the note overflows as
// soon as the territory isn't round, and none are).
//
// DOCUMENTED SIDE EFFECT (contractual, like partition): writes `note.terminals`
// in addition to returning the array. routes.js reads terminals from the
// note, not having the grid on hand; without the seeding having run it falls
// back to the note's position, i.e. the old behavior.
// `meshHint` currently has NO live caller: seedTerminals runs inside mount.js's
// buildModel(), before render.mount() ever creates a canvas, so nothing can
// supply it yet (see the diagnosis doc's "Correction du 2026-08-24" section).
const MAX_PORTS = 6;
function seedTerminals(grid, notes, PARAMS, terrain, meshHint) {
  const { width, height, size, cells } = grid;
  const sea = (gx, gy) => {
    if (gy < 0 || gy >= height) return true;              // beyond a pole
    const x = ((gx % width) + width) % width;         // longitude wraps
    return cells[gy * width + x] < 0;
  };
  // Owner of a cell, -1 for sea — same wrap as `sea`, but gives the INDEX
  // and not just "land or not".
  const owner = (gx, gy) => {
    if (gy < 0 || gy >= height) return -1;
    const x = ((gx % width) + width) % width;
    return cells[gy * width + x];
  };

  // Each note's tangent frame: it's what picks the direction to push the
  // airport toward. An offset computed on the skin would be wrong near the
  // poles, where the same cell width covers far less real terrain.
  const coasts = notes.map(() => []);
  // "Pure" subset of `coasts` (see `pureTerritory`): preferred for ports,
  // falling back to `coasts` if a territory has no pure coast.
  const pureCoasts = notes.map(() => []);
  const heading = notes.map(n => {
    const east = normalize([-n.v[1], n.v[0], 0]);
    const north = [n.v[1] * east[2] - n.v[2] * east[1],
                  n.v[2] * east[0] - n.v[0] * east[2],
                  n.v[0] * east[1] - n.v[1] * east[0]];
    const th = random(hash("airport" + SEP + n.path))() * 2 * Math.PI;
    const c = Math.cos(th), s = Math.sin(th);
    return [east[0] * c + north[0] * s, east[1] * c + north[1] * s, east[2] * c + north[2] * s];
  });
  const airport = notes.map(() => null);
  const airportScore = notes.map(() => -Infinity);
  // Fallback: the best candidate WITHOUT the setback, for territories too
  // small to hold anything at a distance from the sea.
  const airportEdge = notes.map(() => null);
  const edgeScore = notes.map(() => -Infinity);
  // Station fallback: unlike ports/airports/lights, the station was never
  // confirmed against the terrain mesh at all — it was written straight from
  // `n.v` (see "Confirmation against the terrain mesh" above). Same defect
  // class, so same treatment: track, across every owned cell, the one
  // CLOSEST to the note's own anchor that DOES confirm, to fall back to if
  // the raw anchor itself doesn't.
  const stationCandidate = notes.map(() => null);
  const stationScore = notes.map(() => -Infinity);

  // User report: "some planes land too close to the edge". Correct, and it
  // was the rule itself: the airport was the innermost cell furthest along
  // the drawn direction, so by construction the last one before the sea — an
  // airport glued to the cliff. We now require it to stay `setback` cells
  // away from any water: a runway needs land around it, and that's what
  // sets it apart from a port to the eye.
  //
  // The test costs (2r+1)^2 reads, but it only runs on a cell that would
  // improve the score — a few dozen times per territory, not 131,000 times.
  const setback = (PARAMS.grid && PARAMS.grid.airportSetback) || 4;
  // User report (07/28): "ports, airports and stations off the coast",
  // still true after the polar-anchor fix — a DIFFERENT cause, measured
  // before writing anything (probed on the 58-note dataset, real terrain
  // mesh with 1884 sites): `farFromWater` only ever looked at the SEA, never
  // at NEIGHBORS. On a fully packed map, most cells "far from water" are
  // mainly far from the sea and stuck against another note — the fine grid
  // (2 px) doesn't care, but the much coarser terrain mesh then often files
  // the cell on the neighbor's side. Measured: 20 airports out of 58 (34%)
  // fell outside their own note once seen from the mesh, and 0 because of
  // the sea — the sea was never the problem. `pureTerritory` closes that
  // gap: no OTHER note tolerated within the radius (the sea itself stays
  // tolerated — `sea()` excludes it separately for the airport, and that's
  // intentional for a port).
  function pureTerritory(gx, gy, i, radius) {
    for (let dy = -radius; dy <= radius; dy++)
      for (let dx = -radius; dx <= radius; dx++) {
        const own = owner(gx + dx, gy + dy);
        if (own >= 0 && own !== i) return false;
      }
    return true;
  }
  function farFromWater(gx, gy, i) {
    for (let dy = -setback; dy <= setback; dy++)
      for (let dx = -setback; dx <= setback; dx++)
        if (sea(gx + dx, gy + dy)) return false;
    return pureTerritory(gx, gy, i, setback);
  }
  // Port setback, more modest than the airport's: a port stays on the coast
  // by definition (it must border water), it only needs a layer of PURE
  // territory behind it, not full isolation.
  const portSetback = (PARAMS.grid && PARAMS.grid.portSetback) || 2;

  // See "Confirmation against the terrain mesh" earlier in this file — same
  // underlying defect as the lights, measured separately here.
  const confirmedByTerrain = createTerrainConfirmer(notes, PARAMS, size, terrain, meshHint);

  // User report (07/28, second pass): `pureTerritory` above barely changed
  // anything for PORTS — measured, not assumed: ~54% still mismatched
  // against the real mesh, and 90% of that remainder because of the SEA, not
  // a neighbor (`pureTerritory` only guards against neighbors, never the
  // sea — and a port is BY DEFINITION glued to the sea, so `pureTerritory`
  // alone can't fix that). A fine coastal cell is, by construction, equally
  // close to land and water as seen from the coarser mesh: about HALF of
  // fine coastal cells, measured against the reference mesh itself (not
  // another draw), never confirm no matter how much lateral setback is
  // added.
  //
  // The fix that works: if the raw coastal cell doesn't confirm, nudge it
  // toward the territory's CENTER in small steps until it does — a port
  // pulled back a few pixels on a coastline dozens of pixels long still
  // reads as "on the coast", and gains real anchoring on the actual mesh.
  // Not beyond `NUDGE_MAX_SHARE` of the way to the center: beyond that, a
  // "port" planted in the middle of the territory wouldn't look like a port
  // anymore, so it's better to fall back to the documented raw `coasts`.
  const NUDGE_MAX_SHARE = 0.6, NUDGE_STEPS = 8;
  function towardCenter(v, center, i) {
    for (let k = 1; k <= NUDGE_STEPS; k++) {
      const t = (NUDGE_MAX_SHARE * k) / NUDGE_STEPS;
      const nv = normalize([v[0] + (center[0] - v[0]) * t,
                             v[1] + (center[1] - v[1]) * t,
                             v[2] + (center[2] - v[2]) * t]);
      if (confirmedByTerrain(nv, i)) return nv;
    }
    return null;
  }

  for (let gy = 0; gy < height; gy++)
    for (let gx = 0; gx < width; gx++) {
      const i = cells[gy * width + gx];
      if (i < 0) continue;
      const v = toSphere((gx + 0.5) * size, (gy + 0.5) * size, PARAMS);
      const sDot = v[0] * notes[i].v[0] + v[1] * notes[i].v[1] + v[2] * notes[i].v[2];
      if (sDot > stationScore[i] && confirmedByTerrain(v, i)) { stationScore[i] = sDot; stationCandidate[i] = v; }
      if (sea(gx + 1, gy) || sea(gx - 1, gy) || sea(gx, gy + 1) || sea(gx, gy - 1)) {
        coasts[i].push(v);
        if (pureTerritory(gx, gy, i, portSetback)) {
          if (confirmedByTerrain(v, i)) pureCoasts[i].push(v);
          else { const nv = towardCenter(v, notes[i].v, i); if (nv) pureCoasts[i].push(nv); }
        }
        continue;                       // a coastal cell never hosts a runway
      }
      // The airport is the innermost cell furthest along the drawn
      // direction AMONG those still at a distance from water: away from the
      // city, but well inland — and deterministic, so at the same spot from
      // one opening to the next (a moving airport isn't a landmark anymore).
      const s = v[0] * heading[i][0] + v[1] * heading[i][1] + v[2] * heading[i][2];
      if (s > edgeScore[i]) { edgeScore[i] = s; airportEdge[i] = v; }
      if (s > airportScore[i] && farFromWater(gx, gy, i) && confirmedByTerrain(v, i)) { airportScore[i] = s; airport[i] = v; }
    }

  return notes.map((n, i) => {
    // A few ports SPREAD APART from each other rather than the first ones
    // found: taken in grid order they'd all cluster on the same stretch of
    // coast (the grid reads row by row) and a territory would have only one
    // seafront, whatever its actual shape.
    //
    // Pure coast first (see `pureTerritory`): fall back to the raw coast if
    // the territory has none (too small, or squeezed between two
    // neighbors).
    const raw = pureCoasts[i].length ? pureCoasts[i] : coasts[i];
    const ports = [];
    if (raw.length) {
      ports.push(raw[0]);
      while (ports.length < Math.min(MAX_PORTS, raw.length)) {
        let farthest = null, best = -1;
        for (const c of raw) {
          let d = Infinity;
          for (const p of ports) d = Math.min(d, distance2(c, p));
          if (d > best) { best = d; farthest = c; }
        }
        if (!farthest || best <= 0) break;
        ports.push(farthest);
      }
    }
    // Safety nets: a tiny territory may have no inland cell at all (all
    // coast) and an enclave no coastal cell. Either way we fall back to the
    // city rather than returning `null` — a transport with no terminal would
    // simply not be drawn.
    // Cascading fallback: full inland, else any inland cell, else the city —
    // a transport with no terminal would no longer be drawn at all.
    // Station: the raw anchor `n.v` first — it's the point already meant to
    // sit at the territory's heart — but only if the terrain mesh agrees
    // (see "Confirmation against the terrain mesh" above); otherwise the
    // closest confirmed cell found during the scan, same cascading spirit as
    // airport/ports just below.
    const rawStation = [n.v[0], n.v[1], n.v[2]];
    const station = confirmedByTerrain(n.v, i) ? rawStation : (stationCandidate[i] || rawStation);
    const result = { station,
                airport: airport[i] || airportEdge[i] || [n.v[0], n.v[1], n.v[2]],
                ports };
    n.terminals = result;
    return result;
  });
}

// The grid also serves as hit-testing: a direct read, no geometric test.
// Longitude wraps, so a click just past the antimeridian correctly picks the
// facing cell rather than empty space.
function cellUnder(grid, x, y) {
  const gy = Math.floor(y / grid.size);
  if (gy < 0 || gy >= grid.height) return -1;
  const gx = ((Math.floor(x / grid.size) % grid.width) + grid.width) % grid.width;
  return grid.cells[gy * grid.width + gx];
}

export { hash, random, fractalNoise, fractalNoise3d, coastNoise, reliefNoise,
         reliefField, fineReliefNoise, toSphere, fromSphere, normalize, distance2,
         coastAmplitude, territoryReach, inBand,
         ownerAt, polarShare, thresholdFloor, thresholdAt, sampler,
         computePositions, partition, extractBorders,
         extractCoast, chainBorders, closeLoops, smoothLine,
         snapToBisectors,
         extractContours, extractTerritoryContours, seedLights,
         seedTerminals, MAX_PORTS, cellUnder, createTerrainConfirmer };
