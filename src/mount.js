import { PARAMS as PARAMS_DEFAULT } from "./config.js";
import * as collect from "./collect.js";
import * as classify from "./classify.js";
import * as weigh from "./weigh.js";
import * as layout from "./layout.js";
import * as render from "./render.js";
import * as routes from "./routes.js";
import * as terrain from "./terrain.js";
import * as player from "./player.js";

const mods = { collect, classify, weigh, layout, render, routes, terrain, player };

// Reads para-conventions.md and builds the full model (notes, domains, cities,
// weights, partition grid, transport network). Same pipeline as the old
// view.js::buildModel, just fed by collect.js's Obsidian-native collect()
// instead of a Dataview query object. `params` defaults to the built-in tuning
// (config.js) so tests/tools that don't care about user settings keep working.
async function buildModel(app, params = PARAMS_DEFAULT) {
  const conv = await app.vault.adapter.read("_shared/para-conventions.md");
  const paths = mods.collect.readPaths(conv);
  const taxonomy = mods.collect.readTaxonomy(conv);
  const { notes, domaines } = mods.collect.collect(app, paths);

  mods.classify.classifyContinents(notes, domaines);
  mods.classify.classifyCountries(notes, taxonomy, params);
  mods.classify.classifyRegions(notes, taxonomy);
  const { cities } = mods.classify.classifyCities(notes, params);
  mods.weigh.weighNotes(notes, params);
  const weight = mods.weigh.aggregate(notes);
  mods.layout.computePositions(notes, params);
  const grid = mods.layout.partition(notes, params, params.grid.cellWorld);
  // Terminals, ports and airports: read on the grid, so AFTER the partition and
  // BEFORE transports, which draw their arcs terminal to terminal.
  mods.layout.seedTerminals(grid, notes, params, mods.terrain);
  const adjacency = mods.routes.adjacents(grid, notes, params);
  const transports = mods.routes.computeTransports(notes, adjacency, grid);

  return { mods, notes, domaines, cities, weight, grid, taxonomy, paths, transports };
}

// Mounts the map into `container` and returns a `detach()` to call when the
// host (ItemView.onClose / MarkdownRenderChild.onunload) tears down. Owns the
// rAF loop, the player-layer file-open listener, and their cleanup — nothing
// here is left for the caller to manage beyond calling detach() exactly once.
// `params`: settings frozen for the duration of the mount (phase 2: reload on
// next mount, no hot-apply — see the user decision).
async function mountMap(container, app, params = PARAMS_DEFAULT) {
  const model = await buildModel(app, params);
  const view = model.mods.render.mount(container, model, params, app);
  model.PARAMS = params;
  model.overlays = [(ctx, state, toScreen) =>
    model.mods.routes.animate(ctx, state, toScreen, model.transports, model.notes,
                               performance.now(), params)];

  // --- The PLAYER layer (player.js) ---
  let currentNote = null, fileRef = null;
  if (app && app.workspace) {
    const activeFile = app.workspace.getActiveFile();
    currentNote = activeFile ? activeFile.path : null;
    fileRef = app.workspace.on("file-open", f => {
      currentNote = f ? f.path : null;
    });
  }
  model.overlays.push((ctx, state, toScreen) =>
    model.mods.player.drawPlayer(ctx, state, toScreen, model, currentNote,
                                  performance.now(), Date.now()));

  let alive = true;
  let frame = requestAnimationFrame(function loop() {
    if (!alive) return;
    view.advance();
    view.present();
    frame = requestAnimationFrame(loop);
  });

  function detach() {
    if (!alive) return;
    alive = false;
    cancelAnimationFrame(frame);
    view.detach();
    if (fileRef && app && app.workspace) app.workspace.offref(fileRef);
  }

  return { detach };
}

export { buildModel, mountMap, PARAMS_DEFAULT };
