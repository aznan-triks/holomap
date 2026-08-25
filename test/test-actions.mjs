// ⚠️ These checks cover a DORMANT module: `actions.js` has not been loaded
// by the map since 07/27 (the right-click menu was removed on request).
// They are kept because they describe WRITE invariants for the vault —
// "additions only", "never overwrite", "no modal, no write" — that must
// still hold on the day the module is reconnected. A write module put back
// into service with no safety net is exactly the kind of thing that damages
// notes.
import { check, summary } from "./harness.mjs";
import { computeDiff, apply, openModal, unknownTerritory } from "../src/actions.js";

const d1 = computeDiff({ tags: ["dev"], status: "actif" }, { tags: ["obsidian"] });
check("tag added", d1.after.tags.join(",") === "dev,obsidian");
check("untouched keys preserved", d1.after.status === "actif");
check("change detected", d1.change === true);

const d2 = computeDiff({ tags: ["dev"] }, { tags: ["dev"] });
check("tag already present → no change", d2.change === false);

const d3 = computeDiff({ tags: ["dev"] }, { area_liee: "[[Dev et IA]]" });
check("missing key added", d3.after.area_liee === "[[Dev et IA]]");

const d4 = computeDiff({ tags: ["dev"], area_liee: "[[X]]" }, { area_liee: "[[Y]]" });
check("never overwrites an existing value",
         d4.change === false && d4.after.area_liee === "[[X]]");

// --- What the "additions only" rule must REALLY forbid -------------
//
// ⚠️ These cases are not variants of the previous one: they cover the three
// ways a write could destroy user content without anyone noticing
// (INSTRUCTIONS §4). Each is a possible regression.
{
  // 1. No key disappears, even one absent from the addition.
  const d = computeDiff({ tags: ["a"], status: "actif", personnes: ["Zak"] }, { tags: ["b"] });
  check("no key disappears",
           Object.keys(d.after).sort().join(",") === "personnes,status,tags");
  check("other lists are untouched", d.after.personnes.join(",") === "Zak");

  // 2. `before` is a snapshot, not a reference: mutating `after` must not
  //    propagate back into `before` (otherwise the modal shows "before" =
  //    "after" and displays an empty diff even though there is a real
  //    change).
  const source = { tags: ["a"] };
  const d2b = computeDiff(source, { tags: ["b"] });
  check("the diff does not mutate the source", source.tags.join(",") === "a");
  check("before and after are two distinct objects",
           d2b.before.tags.join(",") === "a" && d2b.after.tags.join(",") === "a,b");

  // 3. A list added on top of an existing SIMPLE value promotes it without
  //    losing it: this is the case of a `liaison: "url"` from before the
  //    07/25 switch to lists.
  const d3b = computeDiff({ liaison: "https://x" }, { liaison: ["https://y"] });
  check("simple value promoted to a list without loss",
           d3b.after.liaison.join(",") === "https://x,https://y");

  // 4. Nothing to add → nothing changes, and above all `keys` is empty
  //    (that's what `apply` writes; non-empty, it would rewrite untouched
  //    keys).
  const d4b = computeDiff({ tags: ["a"], status: "actif" }, {});
  check("empty addition → no key to write", d4b.change === false && d4b.keys.length === 0);
}

// --- Writing -------------------------------------------------------------
//
// Fake Obsidian: `processFrontMatter` hands over the object to mutate, like
// the real one. We check what matters, and what no diff test can see —
// WHICH keys are actually touched.
{
  const makeApp = (fm) => {
    const seen = { keys: [], fm };
    return {
      app: {
        vault: { getAbstractFileByPath: p => (p === "n.md" ? { path: p } : null) },
        fileManager: {
          processFrontMatter: async (f, fn) => {
            const proxy = new Proxy(fm, { set(o, k, v) { seen.keys.push(k); o[k] = v; return true; } });
            fn(proxy);
          },
        },
      }, seen,
    };
  };
  const a = makeApp({ tags: ["dev"], status: "actif", corpsIntact: 1 });
  await apply(a.app, "n.md", { tags: ["obsidian"] });
  check("write: only the changed key is rewritten", a.seen.keys.join(",") === "tags");
  check("write: the value is correct", a.seen.fm.tags.join(",") === "dev,obsidian");

  const b = makeApp({ area_liee: "[[X]]" });
  const written = await apply(b.app, "n.md", { area_liee: "[[Y]]" });
  check("write: nothing is written when nothing changes",
           written === false && b.seen.keys.length === 0);

  const c = makeApp({});
  check("write: file not found → false, no throw",
           (await apply(c.app, "absent.md", { tags: ["x"] })) === false);
}

// Without a DOM (node), the modal cannot open — and above all it must
// write NOTHING in the process. This is safeguard #1: no modal, no write.
{
  let called = false;
  const m = openModal(null, "t", { change: true, before: {}, after: {} },
                         () => { called = true; });
  check("no DOM: no modal, and no write triggered",
           m === null && called === false);
}

// ⚠️ THE bug of 07/27, locked down with a source check.
//
// The menu and the modal were built with Obsidian's `Menu` and `Modal`,
// obtained via `window.require("obsidian")`. This module only exists for
// PLUGINS: inside a dataviewjs block, `require` is Electron's and doesn't
// know that name. The exception was thrown at mount time, so the animation
// loop never started — "vault map — error: Cannot find module 'obsidian'",
// and a map FROZEN on its first frame.
//
// No behavioral test could catch it: under node there is neither `window`
// nor `require("obsidian")`, so the code obediently took its fallback
// branch and everything passed. It's the SOURCE that must be checked.
{
  const { readFileSync } = await import("node:fs");
  const source = readFileSync(new URL("../src/actions.js", import.meta.url), "utf8");
  // Comments are stripped before the check: the one telling the story of
  // the bug necessarily quotes the offending call, and leaving it counted
  // would make the check fail because of its own explanation.
  const code = source.split(/\r?\n/).filter(l => !/^\s*\/\//.test(l)).join("\n");
  check("actions.js never calls require(\"obsidian\")",
           !/require\s*\(\s*["']obsidian["']\s*\)/.test(code));
  check("actions.js builds its interface with standard DOM",
           source.includes("document.createElement"));
}

// Unknown Territory: the count of notes with no attachment.
{
  const model = { mods: { classify: { TERRA: "Terra Incognita" } },
                   notes: [{ continent: "Dev et IA" }, { continent: "Terra Incognita" },
                           { continent: "Terra Incognita" }] };
  const t = unknownTerritory(model);
  check("terra: counts notes with no attachment", t.lost.length === 2);
  check("terra: share of the vault", Math.abs(t.share - 2 / 3) < 1e-9);
  check("terra: empty vault → no share, no division by zero",
           unknownTerritory({ notes: [] }).share === 0);
}

summary();
