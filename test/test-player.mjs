import { check, summary } from "./harness.mjs";
import { capitals, shortestPath, wake, drawPlayer } from "../src/player.js";
import * as routes from "../src/routes.js";

const DAY = 86400000, T = 1_700_000_000_000;
const notes = [
  { path: "a.md", links: ["b.md"], quete: false, mtime: T - 1 * DAY },
  { path: "b.md", links: ["a.md", "c.md"], quete: false, mtime: T - 3 * DAY },
  { path: "c.md", links: ["b.md"], quete: true, mtime: T - 30 * DAY },
  { path: "z.md", links: [], quete: false, mtime: T - 2 * DAY },
];

check("one capital", capitals(notes).length === 1 && capitals(notes)[0].path === "c.md");
check("shortest path", shortestPath(notes, "a.md", "c.md").join(">") === "a.md>b.md>c.md");
check("off network → null", shortestPath(notes, "z.md", "c.md") === null);
check("start = end", shortestPath(notes, "c.md", "c.md").length === 1);
check("missing note → null", shortestPath(notes, "fantome.md", "c.md") === null);

const s = wake(notes, { wake: { days: 7 } }, T);
check("wake = last 7 days", s.length === 3);
check("wake chronological", s[0].path === "b.md" && s[2].path === "a.md");
check("wake without setting → defaults to 7 days", wake(notes, {}, T).length === 3);
// ⚠️ The trail is BOUNDED. A day of imports or a skill run touches dozens of
// notes at once; without a cap, the wake stops being a trajectory and
// becomes a net thrown over the planet (seen in a capture, when every note
// in the test set had no mtime).
{
  const crowd = Array.from({ length: 200 }, (_, i) =>
    ({ path: "f" + i + ".md", links: [], quete: false, mtime: T - i * 1000 }));
  const s = wake(crowd, { wake: { days: 7, max: 30 } }, T);
  check("wake: capped", s.length === 30);
  check("wake: the most RECENT ones are kept",
           s[s.length - 1].path === "f0.md");
}

check("multiple capitals detected", capitals(
  notes.map(n => ({ ...n, quete: n.path !== "z.md" }))
).length === 3);

// ⚠️ The shortest path must REALLY be the shortest: a depth-first traversal
// would return a valid but longer path, and the displayed hop count would
// lie. Diamond: a→b→d and a→c→d, plus a detour a→e→f→d.
{
  const diamond = [
    { path: "a.md", links: ["b.md", "e.md"] },
    { path: "b.md", links: ["a.md", "d.md"] },
    { path: "d.md", links: ["b.md"] },
    { path: "e.md", links: ["a.md", "f.md"] },
    { path: "f.md", links: ["e.md", "d.md"] },
  ];
  diamond[2].links.push("f.md");
  check("shortest path, not the first one found",
           shortestPath(diamond, "a.md", "d.md").length === 3);
}

// --- The RENDERING -----------------------------------------------------------
//
// No canvas under node: we pass a spy context that records the orders it
// receives. It doesn't judge appearance (that's what captures are for) but
// it holds the invariants no capture would show: that the layer draws
// nothing outside the visible notes, and that it never draws a chord
// straight through the globe.
function spy() {
  const seen = { texts: [], strokes: 0, arcs: 0, moveTo: 0 };
  const noop = () => {};
  const ctx = new Proxy({
    save: noop, restore: noop, beginPath: noop, stroke: () => seen.strokes++,
    fill: noop, setLineDash: noop,
    moveTo: () => seen.moveTo++, lineTo: noop,
    arc: () => seen.arcs++,
    fillText: t => seen.texts.push(t),
  }, { get: (o, k) => (k in o ? o[k] : undefined), set: () => true });
  return { ctx, seen };
}
// Test projection: the camera looks along +x from infinity, so the visible
// face is x > 0 and the screen is the (y, z) plane. The 3rd returned term is
// the component TOWARDS THE EYE and the 4th the distance to the viewing
// axis, in radii — exactly what routes.frontOfGlobe reads.
const proj = v => [400 + 200 * v[1], 300 - 200 * v[2], v[0], Math.hypot(v[1], v[2])];
const dir = (lat, lon) => {
  const a = lat * Math.PI / 180, o = lon * Math.PI / 180;
  return [Math.cos(a) * Math.cos(o), Math.cos(a) * Math.sin(o), Math.sin(a)];
};
{
  const world = [
    { path: "a.md", name: "A", links: ["b.md"], quete: false, mtime: T, v: dir(0, 0) },
    { path: "b.md", name: "B", links: ["a.md", "c.md"], quete: false, mtime: T, v: dir(0, 20) },
    { path: "c.md", name: "C", links: ["b.md"], quete: true, mtime: T, v: dir(0, 40) },
  ];
  const model = { notes: world, mods: { routes }, PARAMS: { wake: { days: 7 } } };
  const e = spy();
  drawPlayer(e.ctx, { level: "world", zoom: 1 }, proj, model, "a.md", T, T);
  check("render: heading is announced in hops",
           e.seen.texts.some(t => /heading: 2 hops/.test(t)));
  check("render: the quest is named", e.seen.texts.some(t => /→ C$/.test(t)));
  check("render: something is drawn", e.seen.strokes > 0);

  // No quest: the layer SAYS so, it doesn't stay silent.
  const e2 = spy();
  drawPlayer(e2.ctx, { level: "world", zoom: 1 }, proj,
                 { ...model, notes: world.map(n => ({ ...n, quete: false })) }, "a.md", T, T);
  check("render: no quest → say so",
           e2.seen.texts.some(t => /no quest/.test(t)));

  // Two quests: a warning, not a silent choice.
  const e3 = spy();
  drawPlayer(e3.ctx, { level: "world", zoom: 1 }, proj,
                 { ...model, notes: world.map(n => ({ ...n, quete: n.path !== "b.md" })) },
                 "a.md", T, T);
  check("render: two quests → warn",
           e3.seen.texts.some(t => /2 quests/.test(t)));

  // Off network: stated, and never announced as a zero-hop heading.
  const isolated = [...world, { path: "z.md", name: "Z", links: [], quete: false,
                             mtime: T, v: dir(0, 90) }];
  const e4 = spy();
  drawPlayer(e4.ctx, { level: "world", zoom: 1 }, proj,
                 { ...model, notes: isolated }, "z.md", T, T);
  check("render: off network → say so",
           e4.seen.texts.some(t => /off network/.test(t))
           && !e4.seen.texts.some(t => /^heading:/.test(t)));

  // ⚠️ The invariant that matters: nothing is drawn for a note on the HIDDEN
  // FACE. Without this test, a quest ring would be painted on the visible
  // face at the position where the note "would be" — a marker in the wrong
  // place is worse than no marker at all.
  const behind = world.map(n => ({ ...n, v: dir(0, 180) }));
  const e5 = spy();
  drawPlayer(e5.ctx, { level: "world", zoom: 1 }, proj,
                 { ...model, notes: behind }, "a.md", T, T);
  check("render: nothing is painted for a note behind the globe",
           e5.seen.arcs === 0);

  // The cursor PULSES: two different instants don't give the same ring.
  // (we read the radius via a spy that keeps the arcs)
  const radii = [];
  const ctxR = { save(){}, restore(){}, beginPath(){}, stroke(){}, fill(){},
                 setLineDash(){}, moveTo(){}, lineTo(){}, fillText(){},
                 arc(x, y, r) { radii.push(r); } };
  drawPlayer(ctxR, { level: "world", zoom: 1 }, proj, model, "a.md", 0, T);
  const a0 = radii.slice();
  radii.length = 0;
  drawPlayer(ctxR, { level: "world", zoom: 1 }, proj, model, "a.md", 470, T);
  check("render: the cursor breathes",
           a0.length === radii.length && a0.some((r, i) => Math.abs(r - radii[i]) > 0.5));
}

summary();
