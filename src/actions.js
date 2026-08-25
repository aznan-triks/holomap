// actions.js — DORMANT. Written, tested, but NOT LOADED by the map.
//
// Read this before touching it: this module has been off `view.js`'s module
// list since 07/27, at the user's explicit request — "remove the menu on the
// right, I never asked for that, I want the planet." The right-click menu,
// the diff modal and the Unknown Territory panel therefore show up nowhere.
// Nothing in the vault can be written to by the map.
//
// The file stays here because it corresponds to task 11 of the plan and is
// covered by `test-actions.mjs`: reconnecting it means adding "actions.js"
// back to MODULES_REQUIS and restoring the two calls removed from `view.js`.
// Don't put it back "just in case": a loaded module is a module that can
// break the mount, and that's exactly what happened the day it was written.
//
// --- What it does, if ever reconnected: -------------------------------
//
// The ONLY module allowed to write to the vault.
//
// Everything else in the map is read-only. Here we write, so three
// safeguards, in this order, none negotiable:
//
//   1. NO write on a left click. Writing requires a RIGHT click, a menu
//      choice, then a confirmation. A navigation gesture must never be able
//      to modify a note by accident.
//   2. The DIFF is shown before writing. You see exactly what will change,
//      key by key, before/after.
//   3. ADDITIONS ONLY. Never delete a key, never overwrite a value already
//      set, never touch a line of the note's body. This is the vault rule
//      (INSTRUCTIONS §4: never delete user content) applied to the one place
//      that could break it.
//
// Corollary of (3), and it's intentional: attaching a domain to a note that
// already has an `area_liee` does NOTHING, and says so. The map doesn't
// rewrite what the user has set — if they want to change it, they change it
// in the note.

// What the frontmatter would become, without writing anything.
//
// Returns `{ before, after, change }`. `change` false means "nothing to do",
// not "it failed": that's the normal case of a value already present.
function computeDiff(current, addition) {
  const before = JSON.parse(JSON.stringify(current || {}));
  const after = JSON.parse(JSON.stringify(current || {}));
  const keys = [];
  let change = false;

  for (const [key, value] of Object.entries(addition || {})) {
    // LISTS get enriched (union), everything else only lands on empty.
    // `tags` and `personnes` are lists by convention (para-conventions.md);
    // `liaison` became one on 07/25. We don't hardcode the list of
    // list-keys: whatever arrives as an array is a list.
    if (Array.isArray(value)) {
      const existing = Array.isArray(after[key]) ? after[key]
                      : after[key] ? [after[key]] : [];
      const newValues = value.filter(t => !existing.includes(t));
      if (newValues.length) {
        after[key] = [...existing, ...newValues];
        change = true; keys.push(key);
      }
    } else if (after[key] === undefined || after[key] === null || after[key] === "") {
      after[key] = value;
      change = true; keys.push(key);
    }
  }
  return { before, after, change, keys };
}

// Writes — and only the keys the diff actually changed.
//
// ⚠️ Rewriting the whole `after` into the frontmatter, as the first version
// did, touches keys we didn't change: writing normalizes them (order,
// quoting, folded lists) and the user's `git diff` fills up with lines they
// didn't ask for. We only write what changes.
async function apply(app, path, addition) {
  const file = app.vault.getAbstractFileByPath(path);
  if (!file) return false;
  let ok = false;
  await app.fileManager.processFrontMatter(file, fm => {
    const { after, change, keys } = computeDiff(fm, addition);
    if (!change) return;
    for (const key of keys) fm[key] = after[key];
    ok = true;
  });
  return ok;
}

// --- Interface: plain DOM, never the Obsidian API ---------------------------
//
// ⚠️ The first version built its menu and modal with `Menu` and `Modal`,
// pulled from `window.require("obsidian")`. That doesn't work here, and the
// error was blunt when the map opened:
//
//   vault map — error: Cannot find module 'obsidian'
//
// The "obsidian" module isn't a real Node module: Obsidian only supplies it
// to PLUGINS, via its own loader. A dataviewjs block is evaluated outside
// that loader, so `require` there is Electron's, which doesn't know that
// name. Worse, the exception was thrown during mount: the animation loop
// never started and the map stayed **frozen** on its first frame — a symptom
// with no apparent link to its cause.
//
// Everything is therefore built in plain DOM. More lines, but no dependency
// on an API this context doesn't have, and the look follows the theme via
// Obsidian's CSS variables (see view.css).

// Small helper: an element, its classes, its text. Obsidian's `createEl`
// only exists on elements it builds itself, not on these.
function el(parent, tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  if (parent) parent.appendChild(e);
  return e;
}

// The confirmation modal. `onConfirm` is only called if the user clicks
// "Write" — never on open.
//
// Returns the root element (or `null` outside a browser), which lets tests
// verify safeguard #1: no modal, no write.
function openModal(app, title, diff, onConfirm) {
  if (typeof document === "undefined") return null;
  const backdrop = el(document.body, "div", "carte-atlas-modale-fond");
  const box = el(backdrop, "div", "carte-atlas-modale");
  const close = () => { backdrop.remove(); document.removeEventListener("keydown", onKeydown); };
  const onKeydown = e => { if (e.key === "Escape") close(); };
  document.addEventListener("keydown", onKeydown);
  // Click outside = cancel. Never the reverse: we don't confirm by accident.
  backdrop.addEventListener("mousedown", e => { if (e.target === backdrop) close(); });

  el(box, "h3", null, title);
  if (!diff.change) {
    // Normal case, not an error: explain why nothing happens.
    el(box, "p", null, "No change: the value is already set. "
                       + "The map never overwrites what exists.");
    const onlyBar = el(box, "div", "carte-atlas-barre");
    el(onlyBar, "button", null, "Close").onclick = close;
    return backdrop;
  }
  const table = el(box, "table", "carte-atlas-diff");
  const header = el(table, "tr");
  el(header, "th", null, "key");
  el(header, "th", null, "before");
  el(header, "th", null, "after");
  for (const key of new Set([...Object.keys(diff.before), ...Object.keys(diff.after)])) {
    const a = JSON.stringify(diff.before[key] === undefined ? null : diff.before[key]);
    const b = JSON.stringify(diff.after[key] === undefined ? null : diff.after[key]);
    if (a === b) continue;
    const tr = el(table, "tr");
    el(tr, "td", null, key);
    el(tr, "td", null, a);
    el(tr, "td", null, b);
  }
  const bar = el(box, "div", "carte-atlas-barre");
  el(bar, "button", null, "Cancel").onclick = close;
  const confirmBtn = el(bar, "button", "mod-cta", "Write");
  confirmBtn.onclick = async () => {
    // Button disarms before waiting: an impatient double-click would write
    // twice.
    confirmBtn.disabled = true;
    try { await onConfirm(); } finally { close(); }
  };
  return backdrop;
}

// The context menu, in DOM. `groups` = [{ title, items: [{ text, action }] }].
// A group with no items shows greyed out instead of being hidden: "no tag on
// this axis" is information, a missing menu is a mystery.
function openMenu(x, y, groups) {
  if (typeof document === "undefined") return null;
  const menu = el(document.body, "div", "carte-atlas-menu");
  const close = () => {
    menu.remove();
    document.removeEventListener("mousedown", outsideClick, true);
    document.removeEventListener("keydown", onKeydown);
  };
  const outsideClick = e => { if (!menu.contains(e.target)) close(); };
  const onKeydown = e => { if (e.key === "Escape") close(); };
  // In the CAPTURE phase: otherwise the click that closes the menu first
  // reaches the map underneath and triggers an unwanted dive.
  document.addEventListener("mousedown", outsideClick, true);
  document.addEventListener("keydown", onKeydown);

  for (const group of groups) {
    if (group.title) el(menu, "div", "carte-atlas-menu-titre", group.title);
    if (group.empty) { el(menu, "div", "carte-atlas-menu-vide", group.empty); continue; }
    for (const item of group.items) {
      const b = el(menu, "div", "carte-atlas-menu-item", item.text);
      b.onclick = () => { close(); item.action(); };
    }
  }
  // Positioned AFTER filling: size is only known once the content is there,
  // and without this a long menu overflows off the bottom of the window
  // unnoticed.
  menu.style.left = "0px"; menu.style.top = "0px";
  const b = menu.getBoundingClientRect();
  menu.style.left = Math.max(4, Math.min(x, window.innerWidth - b.width - 4)) + "px";
  menu.style.top = Math.max(4, Math.min(y, window.innerHeight - b.height - 4)) + "px";
  return menu;
}

// Frontmatter of a note as Obsidian knows it. Read from the metadata cache,
// never by re-reading the file: it's the same source that built the map.
function frontmatterOf(app, path) {
  const file = app.vault.getAbstractFileByPath(path);
  if (!file) return {};
  const cache = app.metadataCache.getFileCache(file);
  return (cache && cache.frontmatter) ? cache.frontmatter : {};
}

// Context menu on a note in the map.
//
// `toMap` and `cellUnder` are exactly the ones used by hover and click: the
// note targeted by the menu is therefore the one under the cursor, with no
// second computation that could diverge.
function installMenu(canvas, model, app, toMap) {
  if (!canvas || !canvas.addEventListener) return;

  canvas.addEventListener("contextmenu", e => {
    e.preventDefault();
    const [mx, my] = toMap(e.offsetX, e.offsetY);
    const i = model.mods.layout.celluleSous(model.grille, mx, my);
    if (i < 0) return;
    const note = model.notes[i];
    const name = note.nom || note.chemin;

    // One entry = one possible addition. `propose` does the full path:
    // read frontmatter, diff, modal, and write only on confirmation.
    const propose = (title, addition) => {
      const diff = computeDiff(frontmatterOf(app, note.chemin), addition);
      openModal(app, title, diff, () => apply(app, note.chemin, addition));
    };

    const groups = [{
      title: name,
      items: [{ text: "Open note",
                action: () => app.workspace.openLinkText(note.chemin, "", false) }],
    }];

    // ⚠️ Proposed tags come from the TAXONOMY read from the conventions,
    // never free text: the map must not become a parallel vocabulary
    // source. An empty axis says so instead of disappearing.
    for (const axis of ["projet", "outil", "personne"]) {
      const values = (model.taxonomie && model.taxonomie[axis]) || [];
      groups.push({
        title: "Tag — " + axis,
        empty: values.length ? null : "(no tag on this axis in the conventions)",
        items: values.map(tag => ({
          text: tag, action: () => propose("Tag « " + name + " »", { tags: [tag] }),
        })),
      });
    }

    const areas = model.domaines || [];
    groups.push({
      title: "Link to a domain",
      empty: areas.length ? null : "(no domain)",
      items: areas.map(d => {
        const areaName = d.nom || d;
        return { text: areaName,
                 action: () => propose("Attach « " + name + " »",
                                        { area_liee: "[[" + areaName + "]]" }) };
      }),
    });

    openMenu(e.clientX, e.clientY, groups);
  });
}

// Notes with no attachment: the catch-all "Terra Incognita".
//
// It's not a continent, it's an admission — a note that lands there has no
// `area_liee` and isn't linked to anything that has one. Counting and
// listing them is the only way to turn that pile into work to do.
function unknownTerritory(model) {
  const TERRA = model.mods && model.mods.classify ? model.mods.classify.TERRA : "Terra Incognita";
  const lost = (model.notes || []).filter(n => n.continent === TERRA);
  return { TERRA, lost, share: (model.notes || []).length
                                 ? lost.length / model.notes.length : 0 };
}

export { computeDiff, apply, openModal, openMenu, installMenu, frontmatterOf, unknownTerritory };
