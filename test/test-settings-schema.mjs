import { check, summary } from "./harness.mjs";
import { leaves, isGroup, read, write, clone, merge, typeOf } from "../src/settings-schema.js";
import { PARAMS } from "../src/config.js";

check("typeOf: number", typeOf(1.5) === "number");
check("typeOf: boolean", typeOf(true) === "boolean");
check("typeOf: number array", typeOf([1, 2, 3]) === "numberArray");
check("typeOf: group object", typeOf({ a: 1 }) === "unknown");

check("isGroup: object", isGroup({ a: 1 }) === true);
check("isGroup: number", isGroup(5) === false);
check("isGroup: array", isGroup([1, 2]) === false);

const obj = { a: { b: 1, c: [1, 2] }, d: true };
check("read: deep path", read(obj, ["a", "b"]) === 1);
check("read: missing path → undefined", read(obj, ["x", "y"]) === undefined);

const obj2 = clone(obj);
write(obj2, ["a", "b"], 42);
check("write: mutates the copy without touching the original", obj2.a.b === 42 && obj.a.b === 1);
write(obj2, ["new", "path"], "v");
check("write: creates missing intermediate groups", obj2.new.path === "v");

// leaves() must find EVERY real numeric/boolean/array setting in PARAMS —
// that's the guarantee that "nothing is missed by the generic schema".
const allLeaves = [...leaves(PARAMS)];
check("leaves: finds a root-level setting (weight.base)",
  allLeaves.some(f => f.path.join(".") === "weight.base" && f.defaultValue === PARAMS.weight.base));
check("leaves: finds a deeply nested setting (render.terrain.facet)",
  allLeaves.some(f => f.path.join(".") === "render.terrain.facet"));
check("leaves: a nested boolean is typed correctly",
  allLeaves.find(f => f.path.join(".") === "render.terrain.active").type === "boolean");
check("leaves: a number array is typed correctly",
  allLeaves.find(f => f.path.join(".") === "render.terrain.light").type === "numberArray");
check("leaves: no leaf has an empty path", allLeaves.every(f => f.path.length > 0));

// merge: a partial override must NEVER make its neighbors disappear.
const merged = merge(PARAMS, { weight: { base: 99 } });
check("merge: the changed field is picked up", merged.weight.base === 99);
check("merge: neighbors in the same group survive", merged.weight.active === PARAMS.weight.active);
check("merge: an untouched group stays intact", merged.zoom.min === PARAMS.zoom.min);
check("merge: no overrides (null) → identical to defaults",
  JSON.stringify(merge(PARAMS, null)) === JSON.stringify(PARAMS));
check("merge: does not mutate the original defaults object", PARAMS.weight.base !== 99);

summary();
