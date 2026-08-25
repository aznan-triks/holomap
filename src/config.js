// Default tuning for the map. Extracted unchanged from the old view.js top-level
// PARAMS constant — chantier 2 turns this into the plugin's settings schema with a
// UI; for now it is still the single hardcoded source every module reads from.
const PARAMS = {
  weight:    { base: 1, perLink: 0.5, active: 1.3, done: 0.7, archived: 0.4, quest: 2.0 },
  // A note's density = written volume, scaled to the vault median (weigh.js).
  // `header` = frontmatter bytes deducted before comparing; `floor` and
  // `ceiling` bound the gap between hamlet and metropolis (beyond that, a
  // single note would eat the whole map).
  density:   { header: 220, floor: 0.25, ceiling: 3 },
  country:   { minNotes: 2 },
  city:      { minNotes: 2 },
  // City drawing (render.cityShape). A note's building count follows its
  // DENSITY: `base` buildings no matter what, plus `perDensity` per density
  // unit, capped at `max` (beyond that, towers overlap and the city turns
  // back into a blob).
  buildings: { base: 2, perDensity: 6, max: 26 },
  // step: force-solver integration step (fraction of velocity applied per
  // iteration). Bigger = faster but unstable convergence; smaller = slow but
  // steady.
  // The world is a SPHERE: notes are directions on the globe, forces are
  // applied in three dimensions then reprojected onto it. There is no margin
  // anymore — a sphere has no edge, so no land can be cut by a frame.
  // repulsion: expressed as squared chord distance on the unit sphere, so it
  // has no scale relationship with the old pixel-based value.
  // latitudeBand: sine of the maximum land latitude. 0.82 ~ 55 degrees, so
  // the poles stay ocean. Without this confinement a domain can land on a
  // pole — the least readable spot on the map (crushed skin, camera with no
  // north reference). Found by testing against the real vault from Obsidian.
  layout:    { iterations: 300, repulsion: 0.0005, attraction: 0.02, cohesion: 0.10, step: 0.55,
               latitudeBand: 0.82 },
  // weightToArea: converts a unitless weight into claimed area on the sphere
  // (in squared chord distance). It's the only setting that makes a note's
  // area proportional to its weight rather than its isolation — and it must
  // stay DOMINANT over seaRadius, otherwise every note claims the same
  // footprint regardless of content (a bug that stayed invisible for weeks).
  // seaRadius: fixed share of the threshold beyond which a cell is sea.
  // seaIrregularity: how much that threshold ripples across space (0 = coasts
  // as perfect circular arcs, a string of bubbles; higher = jagged coasts
  // with capes, bays and a few detached islets). Coast SHAPE is frozen by the
  // user — do not touch this setting.
  // core: radius, in cells, of the guaranteed territory for each note (see
  // layout.partition). Prevents a light note next to a heavy one from being
  // fully swallowed — and thus disappearing from the map and from clicks.
  grid:      { cellWorld: 2, cellCountry: 2, lloyd: 2, weightToArea: 0.012,
               seaRadius: 0.0020, seaIrregularity: 3, core: 3,
               airportSetback: 3,
               landLatitude: 64, latitudeFade: 14 },
  zoom:      { continentThreshold: 1.5, countryThreshold: 4, transitionMs: 400,
               min: 0.5, max: 12, factor: 1.15, margin: 0.5, latitudeMax: 75,
               grab: 0.9,
               maxTilt: 0.14, verticalCompression: 0.72 },
  // wake: recent work trail of the last few days (player.js).
  // `max` bounds the number of notes in the trail.
  wake:      { days: 7, max: 30 },
  alert:     { unknownLandShare: 0.3 },
  canvas:    { width: 900, height: 560, ratio: 0.62, screenShare: 0.8,
               minWidth: 420, minHeight: 300 },
  text:      { reference: 900, exponent: 0.5, min: 0.92, max: 1.5 },
  skin:      { width: 1024, height: 512 },
  render:    { globe: { step: 8, minDepth: 0.35 },
               gesture: { glow: 0, idle: 80 },
               opacity: { base: 0.88, terra: 0.08, archived: 0.11, active: 0.24, normal: 0.17 },
               gridlines: { targetScreen: 34, maxLines: 240, opacity: 0.14 },
               relief: { scale: 1, strength: 1.5, opacity: 0.45 },
               smoothing: { continent: 2, country: 2, region: 1 },
               terrain: { active: true, facet: 34,
                          sitesMin: 64, sitesMax: 20000,
                          coreSites: 3, coreJitter: 0.35,
                          amplitude: 0.035, base: 0.25,
                          light: [-0.40, 0.42, 0.81], ambient: 0.34, diffuse: 0.66,
                          reliefStrength: 26, reliefOpacity: 0.45, grazingLimit: 0.35,
                          facetShade: 24 } },
  // --- The LIVE LAYER: everything that moves without the camera moving -----
  live: {
    pulse:      { period: 3400, amplitude: 0.34, dispersion: 1 },
    trail:      { share: 0.05, segments: 8, opacity: 0.5 },
    flicker:    { period: 6800, amplitude: 0.5 },
    parallax:   { amplitude: 0 },
    reticle:    { radius: 14, opacity: 0.26 },
    scan:       { duration: 1500, width: 0.26, opacity: 0.5 },
    hover:      { rise: 130, halo: 34, haloTarget: 62, tick: 280, fade: 0.3 },
    cascade:    { duration: 800, band: 90 },
    cards:      { unfold: 300, line: 240, stagger: 55 },
    particles:  { count: 5, period: 2600, opacity: 0.95,
                  size: 2.6, start: 0.9, heightShare: 0.8, trail: 3 },
    growth:     { start: 0.8, end: 1.25 },
    vehicle:    { zoomExponent: 0.7, scaleUp: 0.35 },
  },
};

export { PARAMS };
