// Display metadata table, SEPARATE from the shape engine (settings-schema).
// Everything falls back automatically: a field missing from META shows up
// under its technical name with computed bounds; nothing breaks if config.js
// gains a setting with no entry here. No dependency on `obsidian` → testable
// under Node.
import { leaves, autoBounds } from "./settings-schema.js";

// English titles for top-level groups and the render/live sub-groups. A group
// with no entry shows up under its technical name.
const GROUP_LABELS = {
  weight: "Note weight", density: "Density (written volume)", country: "Countries",
  city: "Cities", buildings: "Buildings", layout: "Placement (force solver)",
  grid: "Grid / territory carving", zoom: "Zoom and camera",
  wake: "Wake (player layer)", alert: "Alerts", canvas: "Canvas size",
  text: "Text size", skin: "Planet skin", render: "Rendering",
  live: "Live layer (micro-interactions)",
  globe: "Globe", gesture: "During a gesture (zoom/drag)", opacity: "Opacities",
  gridlines: "Grid lines", relief: "Relief", smoothing: "Border smoothing",
  terrain: "Terrain (Voronoi tiling)", pulse: "City pulse",
  trail: "Vehicle trail", flicker: "Grid flicker",
  parallax: "Parallax", reticle: "Reticle", scan: "Opening scan",
  hover: "Hover", cascade: "Border cascade", cards: "Network view (cards)",
  particles: "Particles", growth: "Building growth", vehicle: "Vehicle speed",
};

// Lucide icons (Obsidian's setIcon API) shown before each group title. A
// group with no entry gets a neutral icon (see settings.js). Ids = Lucide names.
const GROUP_ICONS = {
  weight: "scale", density: "file-text", country: "flag", city: "building-2",
  buildings: "building", layout: "git-fork", grid: "grid-3x3", zoom: "search",
  wake: "footprints", alert: "alert-triangle", canvas: "frame", text: "type",
  skin: "globe", render: "sparkles", live: "activity", globe: "globe",
  gesture: "hand", opacity: "layers", gridlines: "grid", relief: "mountain",
  smoothing: "spline", terrain: "hexagon", pulse: "heart-pulse", trail: "route",
  flicker: "zap", parallax: "move", reticle: "crosshair", scan: "scan-line",
  hover: "mouse-pointer", cascade: "chevrons-down", cards: "layout-grid",
  particles: "sparkle", growth: "trending-up", vehicle: "car",
};

// Sparse META, indexed by path.join("."). Writing priority: the most visible
// groups first (city, render, live, zoom). Reuses the substance of config.js's
// own comments. Extensible group by group without ever blocking the render.
const META = {
  "weight.base":        { label: "Base weight", desc: "Baseline weight every note carries." },
  "weight.perLink":     { label: "Weight per link", desc: "Extra weight added per outgoing link." },
  "weight.active":      { label: "Active multiplier", desc: "Weight multiplier for active notes." },
  "weight.done":        { label: "Done multiplier", desc: "Weight multiplier for completed notes." },
  "weight.archived":    { label: "Archived multiplier", desc: "Weight multiplier for archived notes." },
  "weight.quest":       { label: "Quest multiplier", desc: "Weight multiplier for quest notes." },

  "density.header":     { label: "Frontmatter bytes", desc: "Frontmatter bytes deducted before comparing written volume." },
  "density.floor":      { label: "Density floor", desc: "Smallest density ratio (bounds the hamlet end)." },
  "density.ceiling":    { label: "Density ceiling", desc: "Largest density ratio (bounds the metropolis end)." },

  "city.minNotes":      { label: "Minimum notes", desc: "Fewest notes a cluster needs to become a city." },
  "buildings.base":     { label: "Base buildings", desc: "Buildings every city gets regardless of density." },
  "buildings.perDensity": { label: "Buildings per density", desc: "Extra buildings per unit of density." },
  "buildings.max":      { label: "Max buildings", desc: "Cap beyond which towers overlap into a blob." },

  "grid.weightToArea":  { label: "Weight → area", desc: "Converts note weight into claimed area on the sphere. Must dominate sea radius." },
  "grid.seaRadius":     { label: "Sea radius", desc: "Fixed share of the threshold beyond which a cell is sea." },
  "grid.seaIrregularity": { label: "Coast irregularity", desc: "How jagged the coastlines ripple. Frozen by the user — leave as is.", max: 8 },
  "grid.core":          { label: "Core cells", desc: "Guaranteed territory radius so a light note is never fully swallowed." },

  "zoom.min":           { label: "Min zoom", desc: "Furthest the camera can pull back." },
  "zoom.max":           { label: "Max zoom", desc: "Closest the camera can push in." },
  "zoom.transitionMs":  { label: "Transition (ms)", desc: "Duration of a zoom transition." },

  "render.terrain.facet": { label: "Facet size", desc: "Voronoi facet size for the terrain tiling." },
  "render.terrain.active": { label: "Terrain enabled", desc: "Draw the Voronoi terrain layer." },

  "live.pulse.period":  { label: "Pulse period (ms)", desc: "How often cities pulse." },
  "live.pulse.amplitude": { label: "Pulse amplitude", desc: "Strength of the city pulse." },
};

function keyOf(path) { return path.join("."); }

function labelFor(path, fallback) {
  const m = META[keyOf(path)];
  return (m && m.label) || fallback;
}

function descFor(path) {
  const m = META[keyOf(path)];
  return (m && m.desc) || "";
}

function boundsFor(path, type, defaultValue) {
  const auto = autoBounds(type, defaultValue, path);
  const m = META[keyOf(path)] || {};
  const override = {};
  if (m.min !== undefined) override.min = m.min;
  if (m.max !== undefined) override.max = m.max;
  if (m.step !== undefined) override.step = m.step;
  return { ...auto, ...override };
}

// Is this text (already lowercased) present in this leaf's English label, its
// technical path, or its description?
function fieldMatches(leaf, lowerText) {
  const label = labelFor(leaf.path, leaf.key).toLowerCase();
  const technical = keyOf(leaf.path).toLowerCase();
  const desc = descFor(leaf.path).toLowerCase();
  return label.includes(lowerText)
      || technical.includes(lowerText)
      || desc.includes(lowerText);
}

// null = empty search (the caller restores the default view). Otherwise: the
// set of visible leaves + the set of ALL their ancestor groups (so nested
// sub-groups open too).
function searchFilter(defaults, text) {
  const t = (text || "").trim().toLowerCase();
  if (!t) return null;
  const visibleFields = new Set();
  const visibleGroups = new Set();
  for (const leaf of leaves(defaults)) {
    if (fieldMatches(leaf, t)) {
      visibleFields.add(keyOf(leaf.path));
      for (let i = 1; i < leaf.path.length; i++) {
        visibleGroups.add(leaf.path.slice(0, i).join("."));
      }
    }
  }
  return { visibleFields, visibleGroups };
}

export {
  GROUP_LABELS, GROUP_ICONS, META,
  labelFor, descFor, boundsFor, fieldMatches, searchFilter,
};
