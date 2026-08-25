function weighNotes(notes, PARAMS) {
  const p = PARAMS.weight;
  for (const n of notes) {
    const linkCount = (n.links || []).length;
    let weight = (p.base + p.perLink * linkCount);
    if (n.status === "actif") weight *= p.active;
    else if (n.status === "terminé") weight *= p.done;
    if (n.inArchive) weight *= p.archived;
    if (n.quete === true) weight *= p.quest;
    n.weight = weight;
  }
  densify(notes, PARAMS);
  return notes;
}

// DENSITY of a note: how much is written in it, scaled to the vault.
//
// User decision (26/07): buildings must encode both density, understood as
// content volume, AND weight. The two never merge into a single number —
// they carry different meanings and rendering keeps them separate: density
// decides the city's FOOTPRINT (stem count, ground coverage), weight decides
// its HEIGHT and glow. So a long but dormant note becomes a sprawling, low
// city; a short but central note, a single spike. Both read at a glance and
// don't hide one another.
//
// The scale is RELATIVE to the vault, never a byte threshold: that's the only
// way to get the same reading on a 58-note vault and a 500-note vault. The
// reference is the MEDIAN (not the mean: a couple of river-length notes would
// drag the mean high enough to flatten everything else to the floor).
// Logarithmic scale, because note sizes span two orders of magnitude: linear
// would put 90% of cities at the floor and a single one at the ceiling.
//
// `header` removes the frontmatter's fixed cost: without this subtraction, an
// empty note weighs half of a real note and every city looks the same.
function densify(notes, PARAMS) {
  const d = (PARAMS && PARAMS.density) || {};
  const header  = d.header  !== undefined ? d.header  : 220;
  const floor   = d.floor   !== undefined ? d.floor   : 0.25;
  const ceiling = d.ceiling !== undefined ? d.ceiling : 3;

  const usableSize = n => Math.max(0, (n.size || 0) - header);
  const sizes = notes.map(usableSize).filter(t => t > 0).sort((a, b) => a - b);
  // No sizes collected (test fixture, module called standalone): neutral density.
  // A uniform map is better than a map that encodes noise.
  if (!sizes.length) {
    for (const n of notes) n.density = 1;
    return notes;
  }
  const median = sizes[Math.floor(sizes.length / 2)];
  for (const n of notes) {
    const raw = Math.log2(1 + usableSize(n) / median);   // median -> 1
    n.density = Math.max(floor, Math.min(ceiling, raw));
  }
  return notes;
}

function aggregate(notes) {
  const sum = (key) => {
    const m = new Map();
    for (const n of notes) m.set(n[key], (m.get(n[key]) || 0) + n.weight);
    return m;
  };
  return { regions: sum("region"), countries: sum("country"), continents: sum("continent") };
}

export { weighNotes, aggregate, densify };
