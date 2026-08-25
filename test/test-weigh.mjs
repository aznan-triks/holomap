import { check, summary } from "./harness.mjs";
import { weighNotes, aggregate, densify } from "../src/weigh.js";
const P = { weight: { base: 1, perLink: 0.5, active: 1.3, done: 0.7, archived: 0.4, quest: 2.0 } };

const n = weighNotes([
  { path: "a.md", links: ["b.md", "c.md"], status: "actif", quete: false, inArchive: false, continent: "C1", country: "P1", region: "R1" },
  { path: "b.md", links: [], status: "terminé", quete: false, inArchive: true, continent: "C1", country: "P1", region: "R2" },
  { path: "c.md", links: [], status: "actif", quete: true, inArchive: false, continent: "C2", country: "P2", region: "R3" },
  { path: "d.md", links: [], status: "à trier", quete: false, inArchive: false, continent: "C1", country: "P3", region: "R4" },
  { path: "e.md", links: [], status: "à vérifier", quete: false, inArchive: false, continent: "C3", country: "P4", region: "R5" },
], P);

const p = c => n.find(x => x.path === c).weight;
check("two links + active", Math.abs(p("a.md") - (1 + 0.5 * 2) * 1.3) < 1e-9);
check("done + archived stack", Math.abs(p("b.md") - 1 * 0.7 * 0.4) < 1e-9);
check("quest doubles", Math.abs(p("c.md") - 1 * 1.3 * 2.0) < 1e-9);
check("status à trier has no multiplier", Math.abs(p("d.md") - (1 + 0.5 * 0)) < 1e-9);
check("status à vérifier has no multiplier", Math.abs(p("e.md") - (1 + 0.5 * 0)) < 1e-9);

const a = aggregate(n);
check("region weight", Math.abs(a.regions.get("R1") - p("a.md")) < 1e-9);
check("country weight = sum of regions", Math.abs(a.countries.get("P1") - (p("a.md") + p("b.md"))) < 1e-9);
check("continent weight = sum of countries", Math.abs(a.continents.get("C1") - ((1 + 0.5 * 2) * 1.3 + 1 * 0.7 * 0.4 + (1 + 0.5 * 0))) < 1e-9);

// --- DENSITY: how much a note has written in it, scaled to the vault -------
// User decision from 07/26: buildings encode the note's density.
// The following locks in the measure's two promises — it is RELATIVE to the
// vault (so it reads consistently regardless of writing style) and it does
// NOT replace weight (the two stay separate, see render.cityShape).
const PD = { density: { header: 200, floor: 0.25, ceiling: 3 } };
const v = t => ({ path: t + ".md", size: t });

{
  const notes = [1200, 2200, 4200, 8200, 16200].map(v);
  densify(notes, PD);
  const d = notes.map(n => n.density);
  check("density: the vault's median is 1", Math.abs(d[2] - 1) < 1e-9);
  check("density: increases with written volume",
    d.every((x, i, a) => i === 0 || x >= a[i - 1]));
  check("density: a note twice as long isn't worth twice as much",
    d[3] < 2 * d[2]);                       // logarithmic scale, not linear
}
{
  // The SAME distribution, written ten times longer: a vault of river-length
  // notes must read like a vault of short notes, otherwise the map encodes
  // the user's writing style instead of its content.
  const small = [1200, 2200, 4200, 8200, 16200].map(v);
  const large = [10200, 20200, 40200, 80200, 160200].map(v);
  densify(small, PD); densify(large, PD);
  check("density: relative to the vault, not a byte threshold",
    small.every((n, i) => Math.abs(n.density - large[i].density) < 0.02));
}
{
  const notes = [{ path: "vide.md", size: 150 },                // frontmatter only
                 v(1100), v(1200), v(1300),                     // the bulk of the vault
                 { path: "fleuve.md", size: 900000 }];
  densify(notes, PD);
  check("density: an empty note falls to the floor", notes[0].density === 0.25);
  check("density: a river-length note is capped",
    notes[notes.length - 1].density === 3);
}
{
  // Neutral fallback: called without sizes (module alone, old test fixture),
  // a uniform map is preferred over a map that encodes noise.
  const notes = [{ path: "a.md" }, { path: "b.md" }];
  densify(notes, PD);
  check("density: with no size collected, everyone is at 1",
    notes.every(n => n.density === 1));
}
{
  const notes = [{ path: "a.md", size: 2200, links: [], status: "actif", quete: false, inArchive: false }];
  weighNotes(notes, P);
  check("density: weighNotes sets it along the way", notes[0].density !== undefined);
}

summary();
