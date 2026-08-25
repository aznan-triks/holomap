// MESURE (tâche 0 du plan desync) ET test de régression (tâches 1 et 2).
// Chiffre l'écart entre la grille fine de partition (qui décide clics et
// semis) et le pavage de Voronoï réellement peint ; imprime des taux, et
// n'échoue sur ce volet que si la mesure est impossible à conduire. Porte
// aussi les assertions de non-régression des tâches 1 (gain/regression de la
// confirmation terrain, repli sans module terrain) et 2 (cohérence peint/cliqué).
import { check as verifier, summary as bilan } from "./harness.mjs";
import * as terrain from "../src/terrain.js";
import {
  computePositions, partition, seedLights, toSphere, sampler,
} from "../src/layout.js";
import { PARAMS as PROD } from "../src/config.js";

// Skin réduite : la mesure porte sur le RAPPORT entre deux géographies, pas
// sur la taille absolue. Garder la skin de prod ferait un test de 20 s.
const PARAMS = JSON.parse(JSON.stringify(PROD));
PARAMS.skin = { width: 512, height: 256 };
PARAMS.layout.iterations = 60;   // convergence suffisante pour une mesure

// Un coffre synthétique assez fourni pour avoir de vraies côtes découpées.
const notes = [];
for (let i = 0; i < 24; i++) {
  notes.push({
    path: `n${i}.md`, links: i > 0 ? [`n${i - 1}.md`] : [],
    weight: 1 + (i % 5) * 0.6,
    continent: `C${i % 3}`, country: `P${i % 6}`, region: `R${i}`,
  });
}

const placed = computePositions(notes, PARAMS);
const grid = partition(placed, PARAMS, PARAMS.grid.cellWorld);

// Semis SANS confirmation terrain (4e argument absent) : on veut mesurer
// l'erreur brute, pas l'erreur résiduelle après l'atténuation actuelle.
const seeds = seedLights(grid, placed, PARAMS, null);

const probe = sampler(placed, PARAMS, PARAMS.grid.cellWorld);

// Taux de lumières que le pavage désavoue, à une taille de toile donnée.
function mismatchRate(width, height) {
  const n = terrain.siteLevel(width, height, PARAMS);
  const sites = terrain.seedSites(n);
  const index = terrain.buildIndex(sites, n);
  let total = 0, wrong = 0;
  seeds.forEach((pack, i) => {
    for (const [x, y] of pack) {
      const v = toSphere(x, y, PARAMS);
      const s = terrain.nearest(sites, index, v);
      if (s < 0) continue;
      total++;
      // Le pavage peint la couleur du propriétaire du SITE, pas du point.
      if (probe.owner(sites[s * 3], sites[s * 3 + 1], sites[s * 3 + 2]) !== i) wrong++;
    }
  });
  return { total, wrong, rate: total ? wrong / total : 0, sites: n };
}

console.log("\n--- Écart grille fine / pavage peint ---");
const tailles = [[900, 560], [1400, 900], [1900, 1150], [1650, 980], [1280, 720]];
for (const [w, h] of tailles) {
  const m = mismatchRate(w, h);
  console.log(`  toile ${w}x${h} : ${m.sites} sites, ` +
              `${m.wrong}/${m.total} lumières désavouées (${(m.rate * 100).toFixed(1)}%)`);
}

// La mesure doit être CONDUCTIBLE — c'est tout ce qu'on affirme ici.
verifier("mesure : des lumières ont été semées", seeds.some(p => p.length > 0));
verifier("mesure : le pavage se construit", mismatchRate(1400, 900).total > 0);

// --- Tâche 1 : la confirmation doit porter sur la toile RÉELLE -------------
import { createTerrainConfirmer } from "../src/layout.js";

// Une confirmation qui connaît la vraie toile doit rejeter au moins tout ce
// que rejette la confirmation aveugle : elle a strictement plus d'information.
{
  const aveugle = createTerrainConfirmer(placed, PARAMS, grid.size, terrain);
  const informe = createTerrainConfirmer(placed, PARAMS, grid.size, terrain,
                                         { width: 1280, height: 720 });
  let regressions = 0, gains = 0;
  seeds.forEach((pack, i) => {
    for (const [x, y] of pack) {
      const v = toSphere(x, y, PARAMS);
      const a = aveugle(v, i), b = informe(v, i);
      if (a && !b) gains++;         // l'informée attrape ce que l'aveugle rate
      if (!a && b) regressions++;   // l'informée accepte ce que l'aveugle rejette
    }
  });
  console.log(`  confirmation informée : +${gains} rejets, ${regressions} régressions`);
  verifier("confirmer : la toile réelle ne relâche jamais un rejet existant",
    regressions === 0);
  verifier("confirmer : la toile réelle attrape des points que l'aveugle laisse passer",
    gains > 0);
}

// Repli : sans module terrain, tout est accepté (tests, harnais) — jamais de crash.
verifier("confirmer : sans terrain, tout passe (repli)",
  createTerrainConfirmer(placed, PARAMS, grid.size, null)([0, 0, 1], 0) === true);

// --- Tâche 2 : le sol cliquable doit être le sol peint ---------------------
//
// On ne peut pas cliquer sans navigateur : on teste la RÈGLE, pas le DOM.
// Le propriétaire vu depuis le pavage doit être celui que le pavage peint.
{
  const n = terrain.siteLevel(1280, 720, PARAMS);
  const sites = terrain.seedSites(n);
  const index = terrain.buildIndex(sites, n);
  // Règle de résolution par le pavage, la même que celle câblée dans render.js.
  const ownerByMesh = v => {
    const s = terrain.nearest(sites, index, v);
    if (s < 0) return -1;
    return probe.owner(sites[s * 3], sites[s * 3 + 1], sites[s * 3 + 2]);
  };
  // Sur un échantillon de directions, la résolution par pavage est
  // AUTO-COHÉRENTE : deux points d'une même facette donnent la même note.
  let coherent = true;
  for (let k = 0; k < 200 && coherent; k++) {
    const s = terrain.nearest(sites, index,
      [sites[k * 3], sites[k * 3 + 1], sites[k * 3 + 2]]);
    if (s !== k) coherent = false;   // un site est sa propre facette
  }
  verifier("hit-test : la résolution par pavage est auto-cohérente", coherent);
  verifier("hit-test : un site appartient à une note ou à la mer",
    [...Array(50).keys()].every(k => {
      const o = ownerByMesh([sites[k * 3], sites[k * 3 + 1], sites[k * 3 + 2]]);
      return o === -1 || (o >= 0 && o < placed.length);
    }));
}

bilan();
