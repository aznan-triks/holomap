import { check, summary } from "./harness.mjs";
import { notes, areas, taxonomy } from "./fixtures.mjs";
import { classifyContinents, classifyCountries, classifyRegions, classifyCities,
         TERRA, MAX_LINKED_PROJECT_DEPTH } from "../src/classify.js";
const n = classifyContinents(notes.map(x => ({ ...x })), areas);
const par = c => n.find(x => x.path === c).continent;

// linkedArea must win even when linkedProject, alone, would point to an OTHER area.
check("linkedArea wins even against a divergent linkedProject", classifyContinents(
  [
    { path: "precedence.md", tags: [], area: "Relations", linkedProject: "[[precedence-cible]]", links: [] },
    { path: "precedence-cible.md", tags: [], area: "Dev et IA", linkedProject: null, links: [] },
  ], areas
).find(x => x.path === "precedence.md").continent === "Relations");
check("linkedProject fallback (wot1 → wot2)", par("wot1.md") === "Contenu et création");
check("linkedProject fallback (dev2 → dev1)", par("dev2.md") === "Dev et IA");
check("no area and no linkedProject → Terra Incognita", par("orph.md") === "Terra Incognita");
check("linkedArea with normalized path", classifyContinents(
  [{ path: "z.md", tags: [], area: "02. Domaines/Dev et IA", linkedProject: null, links: [] }], areas
)[0].continent === "Dev et IA");

// Stage 2 — transitive linkedProject: regression test for the basename-index bug (Finding A).
// With the old index (key = full path), this resolution systematically failed
// because real notes live in nested PARA subfolders.
check("linkedProject resolves across nested folders", classifyContinents([
  { path: "01. Notes/WoT/Créer jeu de cartes World of Trois.md", tags: [], area: null, linkedProject: "[[Carte holographique du vault]]", links: [] },
  { path: "03. Ressources/Carte holographique/Carte holographique du vault.md", tags: [], area: "Dev et IA", linkedProject: null, links: [] },
], areas)[0].continent === "Dev et IA");

// A chain longer than MAX_LINKED_PROJECT_DEPTH must not resolve: the area
// is only reached after one hop too many.
{
  const length = MAX_LINKED_PROJECT_DEPTH + 2;
  const chain = [];
  for (let i = 0; i < length; i++) {
    chain.push({
      path: `chaine-${i}.md`,
      tags: [],
      area: i === length - 1 ? "Dev et IA" : null,
      linkedProject: i < length - 1 ? `[[chaine-${i + 1}]]` : null,
      links: [],
    });
  }
  check("chain longer than max depth → Terra Incognita",
    classifyContinents(chain, areas)[0].continent === TERRA);
}

// A cycle must terminate (no infinite loop) and must not resolve.
check("linkedProject cycle terminates without resolving", classifyContinents([
  { path: "cycle/x.md", tags: [], area: null, linkedProject: "[[y]]", links: [] },
  { path: "cycle/y.md", tags: [], area: null, linkedProject: "[[x]]", links: [] },
], areas)[0].continent === TERRA);

// --- Task 3: countries and regions ---
const P = { country: { minNotes: 2 } };
const m = classifyRegions(classifyCountries(classifyContinents(notes.map(x => ({ ...x })), areas), taxonomy, P), taxonomy);
const country = c => m.find(x => x.path === c).country;
const region = c => m.find(x => x.path === c).region;

// Non-regression: the "rarest tag" rule used to produce 4 countries here.
check("WoT = a single country", new Set(["wot1.md","wot2.md","wot3.md","wot4.md"].map(country)).size === 1);
check("WoT named world-of-trois", country("wot1.md") === "world-of-trois");
check("no project tag → Plaines", country("dev1.md") === "Plaines de Dev et IA");
check("region = tool tag", region("wot1.md") === "foundry-vtt");
// wot2 carries both a tool tag (dnd) and a person tag (backflip): the tool
// axis must win.
check("tool axis takes priority over person axis (wot2 has both)", region("wot2.md") === "dnd");
// On an ad-hoc note with no tool tag at all, the fallback to the person axis
// must work (choose(people) is actually reached).
check("person region fallback when no tool tag (ad-hoc note)",
  classifyRegions([{ path: "adhoc-personne.md", tags: ["juno"], country: "Test" }], taxonomy)[0].region === "juno"
);
check("no secondary tag → Centre", region("wot4.md") === "Centre");
check("project tag under threshold does not create a country", classifyCountries(
  [{ path: "s.md", tags: ["daily-taguel"], continent: "Dev et IA" }], taxonomy, P
)[0].country === "Plaines de Dev et IA");

// Known limitation, pinned (not ideal): if a note carries two project/universe tags,
// the alphabetically first one is kept, even if another of its universe tags is the
// one its "true" siblings share. This test does not validate this behavior as
// desirable — it forces anyone changing the selection rule to do so deliberately.
check("known limitation: two universe tags → alphabetically first wins", classifyCountries(
  [
    { path: "multi1.md", tags: ["world-of-trois", "daily-taguel"], continent: "X" },
    { path: "multi2.md", tags: ["daily-taguel"], continent: "X" },
  ], taxonomy, P
).find(x => x.path === "multi1.md").country === "daily-taguel");

// --- Task 4: cities and hamlets ---
const V = { city: { minNotes: 2 } };
const res = classifyCities(m, V);
const cityOf = c => res.notes.find(x => x.path === c).city;

check("cluster of 2 notes = a city", cityOf("wot1.md") !== null && cityOf("wot1.md") === cityOf("wot2.md"));
check("isolated note = hamlet", cityOf("wot4.md") === null);
check("city named after the most connected note", ["Créer jeu D&D multijoueur", "Créer jeu de cartes"].includes(cityOf("wot1.md")));
check("city spanning two regions", (() => {
  const v = res.cities.find(v => v.members.includes("wot1.md"));
  const regions = new Set(v.members.map(c => res.notes.find(n => n.path === c).region));
  return regions.size === 2;
})());

// Finding 1 (fix pass): "connected component" is an undirected notion. Two notes
// linked by a single outgoing link (Q has no link, P points to Q) must form a
// city regardless of the order they appear in the array — before the fix,
// the order [Q, P] left both as hamlets while [P, Q] merged them.
check("connected component independent of order: directed links", (() => {
  const orderA = classifyCities(
    [
      { path: "ordreQ.md", name: "Ordre Q", tags: [], continent: "C", country: "P", links: [] },
      { path: "ordreP.md", name: "Ordre P", tags: [], continent: "C", country: "P", links: ["ordreQ.md"] },
    ], V
  );
  const orderB = classifyCities(
    [
      { path: "ordreP.md", name: "Ordre P", tags: [], continent: "C", country: "P", links: ["ordreQ.md"] },
      { path: "ordreQ.md", name: "Ordre Q", tags: [], continent: "C", country: "P", links: [] },
    ], V
  );
  const cityA = orderA.notes.find(n => n.path === "ordreQ.md").city;
  const cityB = orderB.notes.find(n => n.path === "ordreQ.md").city;
  return cityA !== null && cityA === cityB
    && orderA.notes.find(n => n.path === "ordreP.md").city === cityA;
})());

// Finding 2 (fix pass): in the real fixtures, no linked pair crosses a country
// boundary — the previous assertion passed even without the `country` filter in
// neighbors(). We force the crossing with an ad-hoc pair that is linked but in
// two different countries: it must NOT form a city (each stays an isolated hamlet).
{
  const borderPair = [
    { path: "frontA.md", name: "Frontière A", tags: [], continent: "C", country: "Pays A", links: ["frontB.md"] },
    { path: "frontB.md", name: "Frontière B", tags: [], continent: "C", country: "Pays B", links: ["frontA.md"] },
  ];
  const rf = classifyCities(borderPair.map(x => ({ ...x })), V);
  check("city does not cross a country boundary (linked pair, different countries)",
    rf.cities.length === 0
    && rf.notes.find(n => n.path === "frontA.md").city === null
    && rf.notes.find(n => n.path === "frontB.md").city === null);
}

// Finding 3 (fix pass): the previous test tolerated two possible names (degree tie
// on the WoT fixtures), which a naive leader = group[0] would also have satisfied.
// Here a central node has a strictly higher degree (2 links vs 1): the city name
// must be forced, not merely plausible.
{
  const degreeChain = [
    { path: "d1.md", name: "Feuille Un", tags: [], continent: "C", country: "P", links: ["d2.md"] },
    { path: "d2.md", name: "Centre", tags: [], continent: "C", country: "P", links: ["d1.md", "d3.md"] },
    { path: "d3.md", name: "Feuille Deux", tags: [], continent: "C", country: "P", links: ["d2.md"] },
  ];
  const rd = classifyCities(degreeChain.map(x => ({ ...x })), V);
  check("city named after the highest-degree node (no tie)",
    rd.notes.find(n => n.path === "d1.md").city === "Centre");
}

summary();
