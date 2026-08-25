import { check, summary } from "./harness.mjs";
import { readTaxonomy, readPaths, normalizeRef } from "../src/collect.js";

const conv = `
## Chemins

- Projects : \`01. Notes/\`
- Areas : \`02. Domaines/\`

## Taxonomie des tags

Quatre axes :

- **domaine** (le sujet — recommandé) : \`etudes\`, \`dev\`, \`contenu\`
- **projet/univers** : \`world-of-trois\`, \`daily-taguel\`
- **outil/format** : \`obsidian\`, \`llm-hub\`
- **personne** (toute personne nommée) : \`baba\`, \`juno\`
`;

const t = readTaxonomy(conv);
check("domaine axis", t.domaine.join(",") === "etudes,dev,contenu");
check("projet axis", t.projet.join(",") === "world-of-trois,daily-taguel");
check("outil axis", t.outil.join(",") === "obsidian,llm-hub");
check("personne axis", t.personne.join(",") === "baba,juno");

const c = readPaths(conv);
check("projects path", c.projets === "01. Notes/");
check("areas path", c.domaines === "02. Domaines/");

// The real para-conventions.md is 100% CRLF while the template above is LF
// only: without these two cases, falling back to split("\n") would pass silently.
const convCRLF = conv.replace(/\n/g, "\r\n");
check("taxonomy CRLF", JSON.stringify(readTaxonomy(convCRLF)) === JSON.stringify(t));
check("paths CRLF",    JSON.stringify(readPaths(convCRLF))   === JSON.stringify(c));

// normalizeRef: pure, so testable outside Obsidian.
check("plain text ref", normalizeRef("Santé") === "Santé");
check("wikilink ref", normalizeRef("[[Santé]]") === "Santé");
check("path + alias ref",
  normalizeRef("[[02. Domaines/Dev et IA.md|Dev]]") === "Dev et IA");
// Spaces AROUND the brackets: must trim before stripping, otherwise "]]" is
// no longer at the end of the string and the value comes out still bracketed.
check("wikilink ref surrounded by spaces", normalizeRef("  [[Santé]] ") === "Santé");
check("Dataview object ref", normalizeRef({ path: "02. Domaines/Santé.md" }) === "Santé");
check("null ref", normalizeRef(null) === null);
summary();
