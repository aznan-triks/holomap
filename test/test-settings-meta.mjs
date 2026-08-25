import { check, summary } from "./harness.mjs";
import { PARAMS } from "../src/config.js";
import { leaves } from "../src/settings-schema.js";
import {
  labelFor, descFor, boundsFor, fieldMatches, searchFilter, GROUP_LABELS,
} from "../src/settings-meta.js";

// GROUP_LABELS is English and covers the existing top-level groups
check("GROUP_LABELS: translates 'city'", GROUP_LABELS.city === "Cities");
check("GROUP_LABELS: translates 'weight'", typeof GROUP_LABELS.weight === "string" && GROUP_LABELS.weight !== "weight");

// labelFor: fallback to the technical name when no META entry
check("labelFor: falls back to technical name",
  labelFor(["totally", "unknown", "leaf"], "leaf") === "leaf");
// labelFor: META entry wins (weight.perLink is seeded in META)
check("labelFor: META entry takes priority",
  labelFor(["weight", "perLink"], "perLink") === "Weight per link");

// descFor: empty string when unknown
check("descFor: empty when unknown", descFor(["totally", "unknown"]) === "");

// boundsFor: auto by default, META override wins per-key
const auto = boundsFor(["buildings", "max"], "number", 26);
check("boundsFor: auto by default (integer x3)", auto.max === 78 && auto.step === 1);
// grid.seaIrregularity is seeded in META with a max override
const over = boundsFor(["grid", "seaIrregularity"], "number", 3);
check("boundsFor: META overrides the max", over.max === 8 && over.min === 0);

// fieldMatches: matches technical path token
const perLink = [...leaves(PARAMS)].find(f => f.path.join(".") === "weight.perLink");
check("fieldMatches: finds by technical name", fieldMatches(perLink, "perlink") === true);
check("fieldMatches: does not match an absent token", fieldMatches(perLink, "zoomzoom") === false);

// searchFilter: empty search → null (default view)
check("searchFilter: empty search → null", searchFilter(PARAMS, "   ") === null);

// searchFilter: a matching group is listed, a non-matching one is not
const r1 = searchFilter(PARAMS, "perlink");
check("searchFilter: matching field is listed", r1.visibleFields.has("weight.perLink"));
check("searchFilter: matching group is listed (expanded)", r1.visibleGroups.has("weight"));
check("searchFilter: non-matching group absent (hidden)", !r1.visibleGroups.has("density"));

// searchFilter: nested match marks ALL ancestor groups (render + render.terrain)
const r2 = searchFilter(PARAMS, "facet");
check("searchFilter: deep ancestor listed (render.terrain)", r2.visibleGroups.has("render.terrain"));
check("searchFilter: root ancestor listed (render)", r2.visibleGroups.has("render"));

summary();
