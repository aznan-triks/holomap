// Generic, shape-driven schema: no hand-written list of the ~100 leaves in
// PARAMS. Anything added to config.js's PARAMS shape later shows up in the
// settings tab automatically, typed from its own default value.

function typeOf(value) {
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "number") return "number";
  if (Array.isArray(value) && value.every(v => typeof v === "number")) return "numberArray";
  return "unknown";
}

// Recursively walks a PARAMS-like object and yields a flat list of leaves
// { path: ["render","terrain","facet"], key, type, defaultValue }.
// Intermediate groups (non-leaf objects) are not leaves: settings.js decides
// how to display them (section, subheading).
function *leaves(obj, path = []) {
  for (const key of Object.keys(obj)) {
    const value = obj[key];
    const type = typeOf(value);
    if (type === "unknown" && value && typeof value === "object" && !Array.isArray(value)) {
      yield* leaves(value, [...path, key]);
    } else if (type !== "unknown") {
      yield { path: [...path, key], key, type, defaultValue: value };
    }
    // A leaf of unknown type (e.g. a mixed array) is skipped rather than
    // crashing the render — it stays editable only via data.json.
  }
}

// Is this a group (an object to walk) rather than a leaf? Used by settings.js
// to decide what to open as a sub-section.
function isGroup(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    && typeOf(value) === "unknown";
}

function read(obj, path) {
  let cur = obj;
  for (const p of path) { if (cur == null) return undefined; cur = cur[p]; }
  return cur;
}

function write(obj, path, value) {
  let cur = obj;
  for (let i = 0; i < path.length - 1; i++) {
    if (typeof cur[path[i]] !== "object" || cur[path[i]] === null) cur[path[i]] = {};
    cur = cur[path[i]];
  }
  cur[path[path.length - 1]] = value;
}

function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

// Merges `overrides` on top of `defaults`, leaf by leaf (never a whole-group
// replacement): a partial override (a single leaf changed in a big group)
// never makes its neighbors disappear.
function merge(defaults, overrides) {
  const result = clone(defaults);
  for (const leaf of leaves(defaults)) {
    const v = read(overrides || {}, leaf.path);
    if (v !== undefined) write(result, leaf.path, v);
  }
  return result;
}

// Slider bounds derived from the SOLE shape of the default value, so that any
// new numeric setting in config.js gets a sensible slider without dedicated
// metadata. settings-meta.js can override when the computed bounds are absurd.
// Deliberate order: the "duration in ms" detection (by NAME) comes before the
// integer rule, otherwise `transitionMs: 400` (an integer) would get a step of
// 1 instead of 10. The "small magnitude" rule (0 < default < 0.1) comes before
// the broad 0..1 rule: a step of 0.01 is too coarse for values like
// weightToArea (0.012), which must stay precisely dominant over smaller
// neighbors (seaRadius).
function autoBounds(type, defaultValue, path) {
  const name = path[path.length - 1] || "";
  const isDuration = /ms$/i.test(name) || /duration|period/i.test(name);
  if (isDuration)                                return { min: 0, max: Math.max(defaultValue * 3, 1), step: 10 };
  if (defaultValue > 0 && defaultValue < 0.1)     return { min: 0, max: 1, step: defaultValue / 100 };
  if (defaultValue >= 0 && defaultValue <= 1)     return { min: 0, max: 1, step: 0.01 };
  if (Number.isInteger(defaultValue))             return { min: 0, max: defaultValue * 3, step: 1 };
  return { min: 0, max: defaultValue * 3, step: defaultValue / 100 };
}

export { leaves, isGroup, read, write, clone, merge, typeOf, autoBounds };
