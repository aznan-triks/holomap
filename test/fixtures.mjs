export const areas = [
  { name: "Dev et IA", path: "02. Domaines/Dev et IA.md" },
  { name: "Contenu et création", path: "02. Domaines/Contenu et création.md" },
  { name: "Relations", path: "02. Domaines/Relations.md" },
];

// Taxonomy axes as parsed from para-conventions.md
export const taxonomy = {
  domaine: ["dev", "ia", "contenu", "relations", "etudes", "meta"],
  projet: ["world-of-trois", "daily-taguel"],
  outil: ["obsidian", "llm-hub", "dnd", "foundry-vtt", "shorts", "notebooklm"],
  personne: ["backflip", "juno"],
};

// The World of Trois case: 4 notes that must form ONE country, not four.
export const notes = [
  { path: "wot1.md", name: "Créer jeu D&D multijoueur", tags: ["dnd", "world-of-trois", "foundry-vtt", "notebooklm"], area: null, linkedProject: "[[wot2]]", status: "actif", quete: false, inArchive: false, type: "idée", link: [], links: ["wot2.md"] },
  { path: "wot2.md", name: "Créer jeu de cartes", tags: ["dnd", "world-of-trois", "backflip"], area: "Contenu et création", linkedProject: null, status: "actif", quete: false, inArchive: false, type: "idée", link: [], links: ["wot1.md"] },
  { path: "wot3.md", name: "Idée Shorts", tags: ["contenu", "world-of-trois", "shorts", "notebooklm"], area: null, linkedProject: "[[wot4]]", status: "à trier", quete: false, inArchive: false, type: "idée", link: [], links: [] },
  { path: "wot4.md", name: "Scénario Boucle Trois 99", tags: ["world-of-trois"], area: "Contenu et création", linkedProject: null, status: "actif", quete: false, inArchive: false, type: "idée", link: [], links: [] },
  { path: "dev1.md", name: "LLM Hub", tags: ["dev", "obsidian", "llm-hub"], area: "Dev et IA", linkedProject: null, status: "actif", quete: true, inArchive: false, type: "projet", link: ["https://exemple"], links: ["dev2.md"] },
  { path: "dev2.md", name: "Skills", tags: ["dev", "obsidian"], area: null, linkedProject: "[[dev1]]", status: "terminé", quete: false, inArchive: true, type: "note", link: [], links: ["dev1.md"] },
  { path: "orph.md", name: "Orpheline", tags: [], area: null, linkedProject: null, status: "à trier", quete: false, inArchive: false, type: "note", link: [], links: [] },
];
