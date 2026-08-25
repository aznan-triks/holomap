# Holomap

An Obsidian plugin that renders your vault as a living holographic planet: territories sized by note weight, cities, a transport network between domains, and a player layer that follows the note you currently have open.

![status](https://img.shields.io/badge/status-personal%20project-orange)

## What it does

- **Territories** — every note becomes land on a sphere; area scales with a computed weight (links, status, quest flag) and density (written volume).
- **Continents / countries / regions / cities** — notes are classified from your vault's own taxonomy, not a fixed schema.
- **Cities** — clusters of notes render as skylines; building count follows density.
- **Transport network** — animated routes connect neighboring continents.
- **Player layer** — a pulsing marker on the note you have open, plus a heading toward your current "quest" note, walked along the link graph.
- **Deterministic** — the layout is seeded from vault content (a hash), not `Math.random()`: the same vault always produces the same map, so it can serve as a stable mental landmark.
- **Auto-generated settings tab** — every tunable in `src/config.js` shows up in Obsidian's settings automatically, typed and bounded from its own default value.

## ⚠️ Requirements — this is not a drop-in plugin

Holomap reads its taxonomy and folder layout from a file named `_shared/para-conventions.md` at the root of your vault, with two headings:

- `## Chemins` — folder paths for Projects, Areas, Resources, Archives, and the inbox note, each as a backtick-quoted path (e.g. `- Areas: \`02. Domaines/\``).
- `## Taxonomie des tags` — tag lists per axis (`domaine`, `projet/univers`, `outil/format`, `personne`), each as backtick-quoted tags.

It also expects specific frontmatter fields on your notes (`area_liee`, `projet_lie`, `status`, `quete`, `type`, `liaison`, `date_creation`) — see `src/collect.js` for the exact shape. This plugin was built for one specific PARA-method vault; adapting it to a different structure means editing `collect.js`.

The headings, field names, and folder examples above are quoted in French on purpose: they're the literal strings the code parses from that vault's `para-conventions.md` and frontmatter, not translatable prose. The plugin's own UI (view name, ribbon tooltip, commands, error messages) is in English.

## Install (manual — not on the community plugin store)

1. `npm install`
2. `npm run build` — compiles `main.js` and lists the files to copy.
3. Copy `main.js`, `manifest.json`, and `styles.css` into `<your vault>/.obsidian/plugins/holomap/`.
4. Enable "Holomap" in Obsidian's Community Plugins settings.

There is no auto-install step: the build script deliberately never guesses which vault to copy into (see `scripts/install-local.mjs`).

## Development

```bash
npm run dev     # esbuild in watch mode
npm run build   # production bundle
npm test        # runs every test/test-*.mjs suite (no external test framework)
```

Open the map from the ribbon icon ("Open the holographic map"), the command palette, or by embedding a ` ```holomap ``` ` code block in any note.

## Author

Created by [aznan-triks](https://github.com/aznan-triks).

## License

MIT — see [LICENSE](LICENSE). You're free to use, modify, and redistribute this, including commercially, as long as the copyright notice in [LICENSE](LICENSE) stays attached to any copy.
