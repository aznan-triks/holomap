import { check, summary } from "./harness.mjs";
import { autoBounds } from "../src/settings-schema.js";

// Rule 1: ms-by-name beats the integer rule (step 10, not step 1)
const b1 = autoBounds("number", 400, ["zoom", "transitionMs"]);
check("autoBounds: name ending in -Ms → step of 10", b1.step === 10 && b1.min === 0 && b1.max === 1200);
const b2 = autoBounds("number", 3400, ["live", "pulse", "period"]);
check("autoBounds: name 'period' → duration rule", b2.step === 10 && b2.max === 10200);

// Rule 2: proportion / opacity (default within 0..1)
const b3 = autoBounds("number", 0.88, ["render", "opacity", "base"]);
check("autoBounds: proportion → 0..1 step 0.01",
  b3.min === 0 && b3.max === 1 && b3.step === 0.01);
const b4 = autoBounds("number", 0, ["parallax", "amplitude"]);
check("autoBounds: default 0 treated as a proportion 0..1", b4.max === 1 && b4.step === 0.01);

// Rule 3: integer (> 1)
const b5 = autoBounds("number", 26, ["buildings", "max"]);
check("autoBounds: integer → 0..(x3) step 1",
  b5.min === 0 && b5.max === 78 && b5.step === 1);

// Rule 4: decimal > 1
const b6 = autoBounds("number", 1.5, ["text", "max"]);
check("autoBounds: decimal >1 → 0..(x3) step default/100",
  b6.min === 0 && b6.max === 4.5 && Math.abs(b6.step - 0.015) < 1e-9);

// Rule 2b: small non-zero magnitude (< 0.1) gets a proportionally fine step,
// not the coarse 0.01 — fixes real config.js values like weightToArea (0.012)
// that must stay precisely dominant over seaRadius (0.0020).
const b7 = autoBounds("number", 0.012, ["grid", "weightToArea"]);
check("autoBounds: small magnitude (<0.1) → proportional step, not 0.01",
  b7.min === 0 && b7.max === 1 && Math.abs(b7.step - 0.00012) < 1e-9);
const b8 = autoBounds("number", 0.0005, ["layout", "repulsion"]);
check("autoBounds: tiny magnitude → proportionally tiny step",
  Math.abs(b8.step - 0.000005) < 1e-9);

// Rule 1 edge case: a zero-default duration must not produce a degenerate
// zero-width slider (min === max).
const b9 = autoBounds("number", 0, ["fade", "transitionMs"]);
check("autoBounds: zero-default duration → max floored to 1, no degenerate slider",
  b9.max === 1 && b9.min === 0 && b9.step === 10);

// Existing 0-default proportion case (glow/parallax.amplitude in config.js)
// must be UNCHANGED by the new small-magnitude rule (0 itself still falls
// through to the plain 0..1 rule, not the new one — 0 is not > 0).
const b10 = autoBounds("number", 0, ["render", "gesture", "glow"]);
check("autoBounds: default exactly 0 stays on the 0..1/0.01 rule (unchanged)",
  b10.max === 1 && b10.step === 0.01);

summary();
