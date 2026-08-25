// Composite key separator (ASCII unit separator): never present in a
// continent, country, or tag name, so "a"+SEP+"b" can never collide.
const SEP = String.fromCharCode(31);

const TERRA = "Terra Incognita";

// Max number of hops allowed while walking up linkedProject before giving up (stage 2).
const MAX_LINKED_PROJECT_DEPTH = 3;

// "[[02. Domaines/Dev et IA]]" and "[[Dev et IA]]" refer to the same note.
function basename(ref) {
  if (!ref) return null;
  const raw = String(ref).replace(/^\[\[/, "").replace(/\]\]$/, "").split("|")[0];
  const parts = raw.split("/");
  return parts[parts.length - 1].replace(/\.md$/, "").trim();
}

function classifyContinents(notes, areas) {
  const byName = new Map(areas.map(d => [d.name, d]));

  // linkedProject is written as a wikilink (e.g. "[[Carte holographique du vault]]"), so
  // no folder is available: resolution can only go by basename. On collision (two notes
  // from different folders sharing the same basename), we deterministically keep the one
  // whose full path sorts first alphabetically.
  const basenameIndex = new Map();
  for (const n of [...notes].sort((a, b) => a.path.localeCompare(b.path))) {
    const b = basename(n.path);
    if (!basenameIndex.has(b)) basenameIndex.set(b, n);
  }

  // 1. area_liee
  for (const n of notes) {
    const target = basename(n.area);
    n.continent = target && byName.has(target) ? target : null;
  }

  // 2. transitive linkedProject, capped at MAX_LINKED_PROJECT_DEPTH hops, cycles cut short
  for (const n of notes) {
    if (n.continent) continue;
    const seen = new Set([n.path]);
    let current = n, depth = 0;
    while (current && current.linkedProject && depth < MAX_LINKED_PROJECT_DEPTH) {
      const next = basenameIndex.get(basename(current.linkedProject));
      if (!next || seen.has(next.path)) break;
      seen.add(next.path);
      if (next.continent) { n.continent = next.continent; break; }
      current = next; depth++;
    }
  }

  // 4. fallback
  for (const n of notes) if (!n.continent) n.continent = TERRA;
  return notes;
}

// Country = tag on the project/universe axis. Priority by AXIS, never by frequency:
// frequency would shatter one universe into as many countries as rare secondary tags.
// Known limitation: if a note carries several project/universe tags, the alphabetically
// first one wins — it can then land in a different country than notes that only share
// one of its other universes. Pinned by a test, not fixed (no note in the real vault
// carries two tags on this axis today).
function classifyCountries(notes, taxonomy, PARAMS) {
  const projectTags = new Set(taxonomy.projet || []);

  // Per-continent count to apply the minNotes threshold.
  const counts = new Map();
  for (const n of notes) {
    const cands = (n.tags || []).filter(t => projectTags.has(t)).sort();
    n._countryCandidate = cands.length ? cands[0] : null;
    if (n._countryCandidate) {
      const key = n.continent + SEP + n._countryCandidate;
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  }

  const threshold = PARAMS.country.minNotes;
  for (const n of notes) {
    const key = n.continent + SEP + n._countryCandidate;
    n.country = (n._countryCandidate && counts.get(key) >= threshold)
      ? n._countryCandidate
      : `Plaines de ${n.continent}`;
    delete n._countryCandidate;
  }
  return notes;
}

// Region = tool/format tag, else person. Here rarity IS a good signal:
// it isolates local specificity instead of drowning it. No minimum threshold.
function classifyRegions(notes, taxonomy) {
  const tools = new Set(taxonomy.outil || []);
  const people = new Set(taxonomy.personne || []);

  const freq = new Map();
  for (const n of notes)
    for (const t of n.tags || []) {
      const key = n.country + SEP + t;
      freq.set(key, (freq.get(key) || 0) + 1);
    }

  for (const n of notes) {
    const choose = set => (n.tags || [])
      .filter(t => set.has(t))
      .sort((a, b) => (freq.get(n.country + SEP + a) - freq.get(n.country + SEP + b))
                      || a.localeCompare(b))[0];
    n.region = choose(tools) || choose(people) || "Centre";
  }
  return notes;
}

// City = connected component of the link graph, bounded to the country,
// but free to span several regions: a real agglomeration overflows its
// administrative subdivisions.
function classifyCities(notes, PARAMS) {
  const index = new Map(notes.map(n => [n.path, n]));
  const seen = new Set();
  const cities = [];

  // "Connected component" is an undirected notion, but liens[] is written one-way
  // (A lists B without B listing A back). Following only outgoing links would make
  // the result depend on note iteration order: a note already "consumed" as an
  // isolated hamlet could never join a city discovered later that points to it.
  // So we symmetrize adjacency here before any traversal, rather than assume the
  // input data already is (Task 7/collect.js will symmetrize links at the source,
  // but this function must not silently depend on a promise kept by a module that
  // doesn't exist yet).
  const adjacency = new Map(notes.map(n => [n.path, new Set()]));
  for (const n of notes) {
    for (const l of n.links || []) {
      const target = index.get(l);
      if (!target) continue;
      adjacency.get(n.path).add(target.path);
      adjacency.get(target.path).add(n.path);
    }
  }

  const neighbors = n => [...adjacency.get(n.path)]
    .map(c => index.get(c))
    .filter(v => v && v.country === n.country && v.continent === n.continent);

  for (const start of notes) {
    if (seen.has(start.path)) continue;
    const stack = [start], group = [];
    seen.add(start.path);
    while (stack.length) {
      const n = stack.pop();
      group.push(n);
      for (const v of neighbors(n)) {
        if (seen.has(v.path)) continue;
        seen.add(v.path); stack.push(v);
      }
    }
    if (group.length >= PARAMS.city.minNotes) {
      const degree = n => neighbors(n).length;
      const leader = [...group].sort((a, b) => (degree(b) - degree(a)) || a.name.localeCompare(b.name))[0];
      cities.push({
        name: leader.name, country: leader.country, continent: leader.continent,
        members: group.map(n => n.path),
      });
      for (const n of group) n.city = leader.name;
    } else {
      for (const n of group) n.city = null; // hamlet
    }
  }
  return { notes, cities };
}

export { TERRA, MAX_LINKED_PROJECT_DEPTH, basename, classifyContinents, classifyCountries, classifyRegions, classifyCities };
