// Taxonomy and paths are read from para-conventions.md, never hardcoded:
// a value that changes there must not require touching this file.
function readTaxonomy(text) {
  const axes = { domaine: [], projet: [], outil: [], personne: [] };
  const target = { "domaine": "domaine", "projet/univers": "projet",
                  "outil/format": "outil", "personne": "personne" };
  const block = text.split("## Taxonomie des tags")[1] || "";
  // split(/\r?\n/) and not split("\n"): para-conventions.md is CRLF, and a
  // leftover "\r" at end of line makes the `$` anchor below fail to match
  // (JS's dot doesn't match \r), which silently emptied the axes.
  for (const line of block.split(/\r?\n/)) {
    const m = line.match(/^-\s+\*\*([^*]+)\*\*[^:]*:\s*(.+)$/);
    if (!m) continue;
    const axis = target[m[1].trim()];
    if (!axis) continue;
    axes[axis] = [...m[2].matchAll(/`([^`]+)`/g)].map(x => x[1]);
  }
  return axes;
}

function readPaths(text) {
  const block = text.split("## Chemins")[1] || "";
  // Labels come from the .md file: they can contain regex-active characters
  // (parentheses in "Modèles (templates)", accents, dots...).
  const escape = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const find = label => {
    const m = block.match(new RegExp("^-\\s+" + escape(label) + "[^:]*:\\s*`([^`]+)`", "m"));
    return m ? m[1] : null;
  };
  return {
    projets: find("Projects"), domaines: find("Areas"),
    ressources: find("Resources"), archives: find("Archives"),
    inbox: find("Inbox source"),
  };
}

function normalizeRef(ref) {
  if (!ref) return null;
  // Trim BEFORE stripping brackets: "[[Santé]] " has a space AFTER "]]",
  // so the `$` anchor in /\]\]$/ won't match unless we trim first.
  const raw = String(ref.path || ref).trim()
    .replace(/^\[\[/, "").replace(/\]\]$/, "").split("|")[0];
  const m = raw.split("/");
  return m[m.length - 1].replace(/\.md$/, "").trim();
}

// Reads a frontmatter field regardless of its shape (text wikilink, {path}
// object, array): normalizeRef already knows how to strip a wikilink, we
// just need to feed it the raw Obsidian cache value rather than Dataview's.
function collect(app, chemins) {
  // This message is shown as-is to the user: it must stay readable.
  if (!chemins.domaines) throw new Error("chemin Areas introuvable dans para-conventions.md");

  const racines = [chemins.projets, chemins.domaines, chemins.ressources, chemins.archives]
    .filter(Boolean).map(c => c.replace(/\/$/, ""));

  // `chemins.inbox` points to a FILE ("00. Inbox/Notes rapides.md"); the folder
  // is derived from its first segment. Nothing hardcoded here either.
  const inboxFolder = chemins.inbox ? chemins.inbox.split("/")[0] + "/" : null;
  const inInbox = f => inboxFolder !== null && f.path.startsWith(inboxFolder);

  // Scope deliberately restricted to the PARA folders + inbox. Out of scope
  // on purpose: root notes (Home.md, SESSIONS.md, "Carte du vault.md" — which
  // must never collect itself), and the Journal/, Templates/ and Knowledge/
  // folders.
  const fichiers = app.vault.getMarkdownFiles().filter(f =>
    racines.some(r => f.path.startsWith(r + "/")) || inInbox(f)
  );

  const domaines = [];
  const notes = [];
  const inDomaines = f => f.path.startsWith(chemins.domaines.replace(/\/$/, "") + "/");
  const resolvedLinks = app.metadataCache.resolvedLinks || {};

  for (const f of fichiers) {
    // Folder readme: never a vault note, regardless of the folder
    // (02. Domaines/Readme.md just like 00. Inbox/Readme.md).
    if (f.basename === "Readme") continue;
    if (inDomaines(f)) {
      domaines.push({ name: f.basename, path: f.path });
      continue;
    }
    const cache = app.metadataCache.getFileCache(f) || {};
    const fm = cache.frontmatter || {};
    const tags = new Set();
    for (const t of (fm.tags || [])) tags.add(String(t).replace(/^#/, ""));
    for (const t of (cache.tags || [])) tags.add(t.tag.replace(/^#/, ""));

    notes.push({
      path: f.path,
      name: f.basename,
      tags: Array.from(tags),
      area: normalizeRef(fm.area_liee),
      linkedProject: normalizeRef(fm.projet_lie),
      status: fm.status ? String(fm.status) : null,
      quete: fm.quete === true,
      type: fm.type ? String(fm.type) : null,
      link: Array.from(fm.liaison || []).map(String),
      createdDate: fm.date_creation ? String(fm.date_creation) : null,
      mtime: f.stat ? f.stat.mtime : 0,
      // Size WRITTEN in the note, in bytes (already tracked by the vault, no
      // file is re-read). This is the "density" half of the city — weight
      // (links, status, quest) gives it height, this gives it footprint.
      size: f.stat && typeof f.stat.size === "number" ? f.stat.size : 0,
      inArchive: chemins.archives ? f.path.startsWith(chemins.archives.replace(/\/$/, "") + "/") : false,
      inInbox: inInbox(f),
      // resolvedLinks[path] is an object { targetPath: linkCount } — unresolved
      // links (missing target) don't appear here, unlike p.file.outlinks on
      // the Dataview side: filtered identically further below anyway (only
      // links to a collected note survive).
      links: Object.keys(resolvedLinks[f.path] || {}),
    });
  }

  // Symmetrization: a link A→B counts as an undirected edge A—B.
  const index = new Map(notes.map(n => [n.path, n]));
  for (const n of notes) {
    n.links = n.links.filter(l => index.has(l));
    for (const l of n.links) {
      const other = index.get(l);
      if (!other.links.includes(n.path)) other.links.push(n.path);
    }
  }
  return { notes, domaines };
}

export { readTaxonomy, readPaths, normalizeRef, collect };
