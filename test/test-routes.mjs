import { check, summary } from "./harness.mjs";
import { adjacents, computeTransports, cadence, VISIBLE, BOAT_THRESHOLD,
        PLANE_SHARE, PLANE_FLOOR, STREET_THRESHOLD,
        arcPoints, frontOfGlobe, zoomSpeed,
        terminal, visibleTerminals, terminalAppear, drawTerminals,
        drawLinks, animate, STYLE, territoryRadii } from "../src/routes.js";

// Direction on the sphere from a latitude/longitude in degrees: transport
// rules are measured in angular gap, so test notes need to be placed
// somewhere precise.
const dir = (lat, lon) => {
  const a = lat * Math.PI / 180, o = lon * Math.PI / 180;
  return [Math.cos(a) * Math.cos(o), Math.cos(a) * Math.sin(o), Math.sin(a)];
};

// Same composite-key separator as classify.js and routes.js (ASCII 31).
// Built by code rather than written as an escape sequence: writing the NUL
// character escape has corrupted this file several times.
const SEP = String.fromCharCode(31);

// Rule REWORKED: a boat CROSSES the sea, it doesn't need touching landmasses
// (the old rule was inherited from the flat map, which had no ocean).
// What decides now: same continent or touching continents -> train;
// separated by sea and close -> boat; too far -> plane.
const notes = [
  { path: "a.md", continent: "C1", country: "P1", city: "V1", v: dir(0, 0),
    links: ["b.md", "c.md", "d.md", "e.md", "f.md"] },
  // C2 touches C1: we travel by road, even though it's a different continent.
  { path: "b.md", continent: "C2", country: "P2", city: "V2", v: dir(0, 10), links: ["a.md"] },
  // C3 is separated by sea, but within crossing range (30 degrees of arc).
  { path: "c.md", continent: "C3", country: "P3", city: "V3", v: dir(0, 30), links: ["a.md"] },
  // Same continent, but 8 degrees apart: well beyond the street threshold, so
  // a real rail journey.
  { path: "d.md", continent: "C1", country: "P1", city: "V4", v: dir(0, 8), links: ["a.md"] },
  // Nearly overlapping `a` (0.7 degree): it's a street, the arc would be
  // invisible. What disqualifies it is the DISTANCE, plus the city label --
  // hence a different city here, so the check can't pass by accident.
  { path: "e.md", continent: "C1", country: "P1", city: "V6", v: dir(0.5, 0.5), links: ["a.md"] },
  // C4 is on the other side of the world: long-haul.
  { path: "f.md", continent: "C4", country: "P4", city: "V5", v: dir(0, 150), links: ["a.md"] },
];
const adj = new Set(["C1" + SEP + "C2"]);
const t = computeTransports(notes, adj);
const type = (x, y) => (t.find(r => (r.a === x && r.b === y) || (r.a === y && r.b === x)) || {}).type;

check("touching continents -> train (the road works)",
         type("a.md", "b.md") === "train");
check("sea to cross, but close -> boat", type("a.md", "c.md") === "bateau");
check("other side of the world -> plane", type("a.md", "f.md") === "avion");
check("cities on the same continent -> train", type("a.md", "d.md") === "train");
check("nearly overlapping notes -> no transport (street)", type("a.md", "e.md") === undefined);
check("no duplicates", t.length === 4);
// The threshold must remain a CROSSING, not a trip around the world: beyond
// it, the arc would cover a sixth of the planet and read as a flight.
check("crossing threshold on the order of magnitude of a sea",
         BOAT_THRESHOLD > 0.3 && BOAT_THRESHOLD < 1.2);

// Unknown position (caller who didn't run placement): no distance to guess,
// so we fall back to long-haul rather than inventing a boat.
check("without a position, we don't guess a crossing",
         computeTransports([
           { path: "s1.md", continent: "C1", country: "P1", city: "V1", links: ["s2.md"] },
           { path: "s2.md", continent: "C9", country: "P9", city: "V9", links: ["s1.md"] },
         ], adj).map(r => r.type)[0] === "avion");

// A network that fades when you zoom reads as a bug (reported from Obsidian:
// "zooming in makes the planes disappear").
check("all vehicles stay visible at all zoom levels",
         ["world", "continent", "country"].every(level =>
           ["avion", "bateau", "train"].every(t => VISIBLE[level].includes(t))));

// A dangling link (target absent from the model) produces no route.
check("link to a missing note -> ignored",
         computeTransports([{ path: "x.md", continent: "C1", country: "P1", city: "V1",
                               links: ["ghost.md"] }], adj).length === 0);

// Two hamlets (city = null) in the same country are linked by a train:
// without the `city === null` case, null === null would make them look like
// the same city.
check("two hamlets on the same continent -> train",
         computeTransports([
           { path: "h1.md", continent: "C1", country: "P1", city: null, links: ["h2.md"] },
           { path: "h2.md", continent: "C1", country: "P1", city: null, links: ["h1.md"] },
         ], adj).map(r => r.type)[0] === "train");

// The continent key is sorted: the same pair encountered "backwards" (the
// alphabetically second continent first) must give the same verdict -- here,
// "they touch, so the road works".
check("sorted continent key regardless of link direction",
         computeTransports([
           { path: "z.md", continent: "C2", country: "P2", city: "V2", v: dir(0, 5), links: ["y.md"] },
           { path: "y.md", continent: "C1", country: "P1", city: "V1", v: dir(0, 0), links: ["z.md"] },
         ], adj).map(r => r.type)[0] === "train");

// --- adjacents(): two continents are neighbors if they share a border, i.e.
// if a cell of one touches orthogonally a cell of the other. Pure function,
// testable under node with a synthetic grid.
// PARAMS is no longer read (the old rule measured a distance between coasts
// along the edge of the canvas -- an artefact, since this vault has no sea).
// The signature keeps a 3rd, ignored argument to stay compatible with view.js.
const twoNotes = [{ continent: "A" }, { continent: "B" }];
const threeNotes = [{ continent: "A" }, { continent: "B" }, { continent: "C" }];
const row = cells => ({ width: cells.length, height: 1, cellSize: 5, cells });
const square = (width, cells) => ({ width, height: cells.length / width, cellSize: 5, cells });

const M = -1;
// A and B touch (gx1|gx2) -> shared border.
check("touching continents -> adjacent",
         adjacents(row([0, 0, 1, 1]), twoNotes).has("A" + SEP + "B"));

// A and B separated by sea -> no shared border.
check("continents separated by sea -> not adjacent",
         !adjacents(row([0, 0, M, 1, 1]), twoNotes).has("A" + SEP + "B"));

// Three continents: A/B touch, C is isolated by sea.
const three = adjacents(row([0, 0, 1, 1, M, 2, 2]), threeNotes);
check("only the pair sharing a border is kept",
         three.size === 1 && three.has("A" + SEP + "B")
         && !three.has("A" + SEP + "C") && !three.has("B" + SEP + "C"));

// Purely diagonal contact: A at (0,0), B at (1,1), sea in the other two
// cells. Adjacency is orthogonal, so NO shared border.
check("diagonal-only contact -> not adjacent",
         !adjacents(square(2, [0, M, M, 1]), twoNotes).has("A" + SEP + "B"));

// THE FIXED BUG (see task 9 report): a continent entirely enclosed within
// another, with no sea around it, touches its neighbor along its whole
// perimeter. The old coastline-based rule declared it not adjacent; by
// shared border it is correctly a neighbor. This is the real "Contenu et
// création" case.
const enclave = { width: 9, height: 9, cellSize: 5, cells: new Int32Array(81) };
for (let gy = 3; gy <= 5; gy++) for (let gx = 3; gx <= 5; gx++) enclave.cells[gy * 9 + gx] = 1;
const adjEnclave = adjacents(enclave, twoNotes);
check("landlocked continent with no sea -> adjacent to its neighbor",
         adjEnclave.size === 1 && adjEnclave.has("A" + SEP + "B"));

// animate() isn't covered here: it requires a 2D canvas context and returns
// nothing. The controller checks it visually in Obsidian (Step 6).

// --- Per-link cadence --------------------------------------------------------
// User feedback: "I don't want everything moving at the same rhythm/speed".
// These checks hold the desynchronization in place.
const links = [];
for (let i = 0; i < 40; i++)
  links.push(cadence({ a: "n" + i + ".md", b: "n" + (i * 7 % 40) + ".md", type: "avion" }));

check("cadence: deterministic for the same link",
  cadence({ a: "x.md", b: "y.md", type: "avion" }).start
  === cadence({ a: "x.md", b: "y.md", type: "avion" }).start);
check("cadence: two links don't start from the same point",
  cadence({ a: "x.md", b: "y.md", type: "avion" }).start
  !== cadence({ a: "x.md", b: "z.md", type: "avion" }).start);
check("cadence: two links don't have the same pace",
  cadence({ a: "x.md", b: "y.md", type: "avion" }).factor
  !== cadence({ a: "x.md", b: "z.md", type: "avion" }).factor);
// The start must cover the whole route, otherwise vehicles stay clustered on
// one stretch of the line instead of spread across it.
check("cadence: starts spread across the whole route",
  Math.min(...links.map(c => c.start)) < 0.15
  && Math.max(...links.map(c => c.start)) > 0.85);
check("cadence: start always in [0,1[",
  links.every(c => c.start >= 0 && c.start < 1));
// Pace bounds: too slow = frozen vehicle, too fast = flickering line.
check("cadence: pace between 0.55 and 1.45 times the type's speed",
  links.every(c => c.factor >= 0.55 && c.factor <= 1.45));
check("cadence: paces are really spread out",
  Math.max(...links.map(c => c.factor)) - Math.min(...links.map(c => c.factor)) > 0.5);
// The type is part of the identity: two links between the same notes but of
// different types shouldn't overlap exactly.
check("cadence: the type counts in the identity",
  cadence({ a: "x.md", b: "y.md", type: "avion" }).start
  !== cadence({ a: "x.md", b: "y.md", type: "train" }).start);

// --- Links belong to the SPHERE, not the screen -----------------------------
//
// Bug fixed here: the arc was a Bezier curve drawn between the two on-screen
// projections, with no idea what was in front of or behind the sphere. Yet a
// note on the FAR SIDE still projects inside the disk: its line therefore
// crossed straight through the globe, and the curve's bulge pushed it
// outside the disk. It was the most visible bug on the globe.
//
// An arc is now a real path on the sphere (great circle), flown over at an
// altitude set by type, and every point knows whether it's visible.

const unit = v => { const n = Math.hypot(...v); return v.map(c => c / n); };
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const va = unit([1, 0.2, 0.1]), vb = unit([0.1, 1, -0.3]);
const arc = arcPoints(va, vb, 0.2, 24);

check("arc: starts at the first note and arrives at the second",
  Math.hypot(arc[0][0] - va[0], arc[0][1] - va[1], arc[0][2] - va[2]) < 1e-9
  && Math.hypot(arc[arc.length - 1][0] - vb[0], arc[arc.length - 1][1] - vb[1],
                arc[arc.length - 1][2] - vb[2]) < 1e-9);

check("arc: endpoints touch the ground (radius 1)",
  Math.abs(Math.hypot(...arc[0]) - 1) < 1e-9
  && Math.abs(Math.hypot(...arc[arc.length - 1]) - 1) < 1e-9);

// The midpoint peaks at exactly the requested altitude: that's what makes the
// line pass OVER the limb instead of through it.
check("arc: the midpoint flies over at the requested altitude",
  Math.abs(Math.hypot(...arc[12]) - 1.2) < 1e-6);

// A great circle is planar: all its points lie in the plane of the two
// notes. Without that the arc would veer off instead of following the
// shortest path.
{
  const n = unit([va[1] * vb[2] - va[2] * vb[1],
                   va[2] * vb[0] - va[0] * vb[2],
                   va[0] * vb[1] - va[1] * vb[0]]);
  check("arc: stays in the great circle's plane",
    arc.every(p => Math.abs(dot(p, n)) < 1e-9));
}

// Progress must be regular: a step that collapses mid-route would slow the
// vehicle down for no reason.
{
  const steps = [];
  for (let i = 1; i < arc.length; i++)
    steps.push(Math.hypot(arc[i][0] - arc[i - 1][0], arc[i][1] - arc[i - 1][1],
                        arc[i][2] - arc[i - 1][2]));
  check("arc: regular progression",
    Math.max(...steps) / Math.min(...steps) < 1.6);
}

// Two coincident notes (same direction): the great circle's axis is
// undefined. Must return a usable path rather than NaNs that would wipe the
// canvas.
check("arc: two coincident notes don't produce NaN",
  arcPoints(va, va, 0.2, 8).every(p => p.every(Number.isFinite)));

check("arc: requested number of points honored",
  arcPoints(va, vb, 0.1, 10).length === 11);

// frontOfGlobe: [screen x, screen y, component towards the eye, distance to
// the axis]. A point behind the sphere is hidden UNLESS it overflows the
// disk -- a high arc can pass behind the globe and remain visible past the
// limb.
check("visibility: in front of the sphere -> visible",
  frontOfGlobe([0, 0, 0.8, 0.3]));
check("visibility: behind the sphere and inside the disk -> hidden",
  !frontOfGlobe([0, 0, -0.8, 0.3]));
check("visibility: behind the sphere but outside the disk -> visible",
  frontOfGlobe([0, 0, -0.8, 1.4]));
// With no depth supplied (old caller), nothing is hidden: better an extra
// line than a whole layer silently vanishing.
check("visibility: no depth -> visible",
  frontOfGlobe([0, 0]));

// --- zoomSpeed: shipped with the micro-interactions, never checked ---------
//
// The bug it fixes: a vehicle moves at constant ANGULAR speed on the sphere,
// and the sphere's apparent radius grows with zoom -- so the closer you get,
// the faster it flies across the screen. That's the opposite of what's
// wanted: up close, you want to see a train running, not a streak passing.
check("speed: decreases when zooming in", zoomSpeed(8, 0.7) < zoomSpeed(1, 0.7));
check("speed: unchanged at zoom 1", Math.abs(zoomSpeed(1, 0.7) - 1) < 1e-12);
check("speed: exponent 0 = no compensation",
  zoomSpeed(1, 0) === 1 && zoomSpeed(12, 0) === 1);
// Exponent 1: on-screen speed becomes strictly constant, so the factor must
// be exactly the inverse of the zoom.
check("speed: exponent 1 = exact inverse of the zoom",
  Math.abs(zoomSpeed(4, 1) - 0.25) < 1e-12);
check("speed: default exponent = 0.7",
  Math.abs(zoomSpeed(4) - zoomSpeed(4, 0.7)) < 1e-12);
// Bounds: a zero or missing zoom must not produce division by zero nor a
// frozen vehicle -- they would vanish without an error.
check("speed: zero or missing zoom -> finite, positive value",
  [0, undefined, NaN].every(z => { const v = zoomSpeed(z, 0.7); return isFinite(v) && v > 0; }));

// --- Terminals: stations, ports, airports -----------------------------------
//
// Two pieces of real Obsidian feedback, handled together because they're
// really one: "boats should leave from the coast" and "separate airports,
// ports and stations when a single territory has several". As long as all
// three transport types leave from the CENTER of the note, no drawing can
// tell them apart, and a maritime arc crosses its own land before reaching
// the water.
//
// The seeding itself is checked in test-layout (it's the one reading the
// grid); here we check the terminal CHOICE, which is the transport rule.
{
  const east = dir(0, 90), west = dir(0, -90);
  const n = { path: "t.md", v: dir(0, 0), terminals: {
    station:  dir(0, 0),
    airport:  dir(6, 0),
    ports:    [east, west],
  } };

  check("terminal: the train leaves from the station", terminal(n, "train", east) === n.terminals.station);
  check("terminal: the plane leaves from the airport", terminal(n, "avion", east) === n.terminals.airport);
  // THE point of the user feedback: we don't board in the middle of the land.
  check("terminal: the boat leaves from a port, never from the city",
    n.terminals.ports.includes(terminal(n, "bateau", east)));
  // A territory with two coastlines: we board on the one facing the
  // crossing. Without this choice, a boat heading east would sail from the
  // west and go around its own continent.
  check("terminal: the chosen port faces the destination",
    terminal(n, "bateau", east) === east && terminal(n, "bateau", west) === west);
  // Compatibility: a caller that hasn't run the seeding (tests, old harness)
  // must get the old behavior back, not a vanished link.
  check("terminal: without seeding, falls back to the note's position",
    terminal({ path: "u.md", v: dir(0, 0) }, "bateau", east) === undefined
    || terminal({ path: "u.md", v: dir(0, 0) }, "bateau", east)[1] === 0);
  check("terminal: landlocked note (no port) -> the city, not nothing",
    terminal({ path: "e.md", v: dir(0, 0),
               terminals: { station: dir(0, 0), airport: dir(3, 0), ports: [] } },
             "bateau", east)[0] === 1);
}

// visibleTerminals: these are the terminals ACTUALLY used that get drawn,
// not "one port per note". A note with no crossing has no port, and a note
// that boards in two opposite directions shows two.
{
  // Each note has ITS OWN two docks, on either side of its city. A test
  // fixture where all notes share the same ports tests nothing: the "port
  // that faces" choice is then a tie, and deduplication wipes everything
  // out.
  const terminalsFor = (lon) => ({ station: dir(0, lon), airport: dir(5, lon),
                            ports: [dir(0, lon + 8), dir(0, lon - 8)] });
  const notes = [
    { path: "a.md", continent: "C1", country: "P1", city: "V1", v: dir(0, 0),
      links: ["b.md", "c.md"], terminals: terminalsFor(0) },
    // Two maritime crossings towards OPPOSITE directions from a.md.
    { path: "b.md", continent: "C2", country: "P2", city: "V2", v: dir(0, 35),
      links: ["a.md"], terminals: terminalsFor(35) },
    { path: "c.md", continent: "C3", country: "P3", city: "V3", v: dir(0, -35),
      links: ["a.md"], terminals: terminalsFor(-35) },
  ];
  const tr = computeTransports(notes, new Set());
  const state = { level: "country", zoom: 6 };
  const seen = visibleTerminals(state, tr, notes);

  check("visible terminals: all maritime here (no other link)",
    tr.every(r => r.type === "bateau") && seen.every(t => t.type === "bateau"));
  // Exactly "a single territory has several": a.md must show its two docks,
  // one per crossing.
  {
    const keys = new Set(seen.map(t => t.v.map(x => x.toFixed(3)).join(",")));
    check("visible terminals: a territory with two crossings shows two docks",
      keys.size === 4);
  }
  // Two links leaving from the same dock are painted only once: otherwise
  // its halo stacks and it glows brighter than the others for no reason.
  {
    const sameSide = notes.map(n => ({ ...n, terminals: { ...n.terminals, ports: [dir(0, 0)] } }));
    const seen2 = visibleTerminals(state, computeTransports(sameSide, new Set()), sameSide);
    check("visible terminals: a shared dock is counted only once",
      seen2.length === 1);
  }
  // A terminal with no visible link has no business on the map.
  check("visible terminals: no link -> no terminal",
    visibleTerminals(state, [], notes).length === 0);

  // End-to-end check on a fake context: a boat's LINE must start at the
  // port, not the city. It's the only way to verify that arc() (not
  // exported) does use the terminals.
  const trace = [], departures = [];
  const fakeCtx = {
    save(){}, restore(){}, beginPath(){}, stroke(){}, fill(){}, closePath(){},
    setLineDash(){}, arc(){}, rect(){}, translate(){}, rotate(){},
    moveTo(x, y){ departures.push([x, y]); trace.push([x, y]); },
    lineTo(x, y){ trace.push([x, y]); },
  };
  // Flat projection: x = longitude in radians. A point on the arc is thus
  // comparable to the expected terminal without unpacking a real camera.
  const proj = v => [Math.atan2(v[1], v[0]), Math.asin(Math.max(-1, Math.min(1, v[2]))), 1, 0];
  const rad = d => d * Math.PI / 180;
  drawLinks(fakeCtx, state, proj, tr.filter(r => r.a === "a.md" || r.b === "a.md"), notes);
  // Only `moveTo` calls matter: a `lineTo` can pass through anywhere, and
  // the arc between a.md's two docks does cross its own city -- the first
  // version of this check failed on an otherwise correct render.
  check("maritime link: each line STARTS at a dock",
    departures.length === 2
    && departures.every(([x]) => Math.abs(Math.abs(x) - rad(8)) < 1e-9));
  check("maritime link: no line starts at the center of the land",
    departures.every(([x]) => [0, rad(35), rad(-35)].every(c => Math.abs(x - c) > 1e-6)));

  // drawTerminals must draw something, and nothing at all at world level.
  const count = () => { trace.length = 0;
    drawTerminals(fakeCtx, state, proj, tr, notes, { zoom: { continentThreshold: 1.5 } });
    return trace.length; };
  check("terminals: drawn at country level", count() > 0);
  {
    trace.length = 0;
    drawTerminals(fakeCtx, { level: "world", zoom: 1 }, proj, tr, notes,
                 { zoom: { continentThreshold: 1.5 } });
    check("terminals: nothing drawn at world level", trace.length === 0);
  }
}

// Appear fade: terminals rise from the ground WITH the buildings, not all at
// once at a threshold crossing (a hard threshold reads as a flicker, a bug
// already fixed once for buildings).
{
  const P = { zoom: { continentThreshold: 1.5 } };
  check("appear: zero at world level", terminalAppear(1, P) === 0);
  check("appear: full well past the threshold", terminalAppear(4, P) === 1);
  check("appear: increasing in between",
    terminalAppear(1.3, P) < terminalAppear(1.6, P)
    && terminalAppear(1.6, P) < terminalAppear(2, P));
  check("appear: bounded to [0,1] even with no settings",
    [0, 1, 12, undefined].every(z => { const v = terminalAppear(z);
                                       return v >= 0 && v <= 1 && isFinite(v); }));
}

// --- The vehicle follows GEOGRAPHY, not the continent label -----------------
//
// Bug measured on the real vault (75 notes): 10 links, **100% trains**, zero
// boats, zero planes. Two causes, both in the rule:
//
//   1. "same continent -> train" read a CLASSIFICATION label, not geography.
//      53 of 75 notes have no `area_liee` and thus fall into "Terra
//      Incognita", which isn't a land but a catch-all scattered across the
//      whole planet: two of its notes at antipodes shared a "continent" and
//      were therefore linked by a train. Measured: one train of 93 degrees
//      of arc, another spending 58% of its route above the ocean.
//   2. The boat was UNREACHABLE by construction: it required two
//      non-neighboring continents AND less than 0.9 rad apart. But two
//      non-neighboring continents are, by definition, far apart -- minimum
//      gap measured 1.08 rad on the test fixture. The window was empty,
//      hence "0 boats" both here and in Obsidian.
//
// The rule now reads the route itself on the partition grid, the only thing
// that knows where the land is and where the sea is:
//   -- route that stays on dry land and isn't oversized -> train;
//   -- route that crosses water, but within crossing range -> boat;
//   -- the rest (too long, or mostly ocean) -> plane.
{
  // A test world: land everywhere EXCEPT a band of longitude, the sea. The
  // frame is the skin's own (width = trip around the world), derived from
  // the grid itself -- it knows its own extent, no need to pass it PARAMS.
  const worldWithSea = (lonMinDeg, lonMaxDeg) => {
    const width = 128, height = 64, cellSize = 8;
    const cells = new Int32Array(width * height).fill(0);
    for (let gy = 0; gy < height; gy++)
      for (let gx = 0; gx < width; gx++) {
        const lon = ((gx + 0.5) / width - 0.5) * 360;
        if (lon >= lonMinDeg && lon <= lonMaxDeg) cells[gy * width + gx] = -1;
      }
    return { width, height, cellSize, cells };
  };
  // Narrow sea between 10 and 20 degrees of longitude: everything else is
  // land.
  const g = worldWithSea(10, 20);
  const link = (v1, v2, cont1, cont2) => computeTransports([
    { path: "u.md", continent: cont1, country: "P1", city: "V1", v: v1, links: ["w.md"] },
    { path: "w.md", continent: cont2 || cont1, country: "P2", city: "V2", v: v2, links: ["u.md"] },
  ], new Set(), g).map(r => r.type)[0];

  check("geo: entirely overland route -> train",
           link(dir(0, -40), dir(0, -10), "C1") === "train");
  check("geo: a sea to cross, within range -> boat",
           link(dir(0, 5), dir(0, 25), "C1") === "bateau");
  // THE reported bug: same continent, but the ocean in between.
  check("geo: same continent with the ocean in between -> never a train",
           link(dir(0, 5), dir(0, 25), "C1") !== "train");
  check("geo: two continents joined by land -> train",
           link(dir(0, -40), dir(0, -10), "C1", "C2") === "train");
  check("geo: too long for a rail, even overland -> plane",
           link(dir(0, -170), dir(0, -40), "C1") === "avion");
  check("geo: crossing too long -> plane, not boat",
           link(dir(0, 5), dir(60, 160), "C1") === "avion");

  // The "Terra Incognita" catch-all must no longer produce a rail: exactly
  // the case measured on the real vault.
  check("geo: two Terra Incognita notes separated by sea -> not a train",
           link(dir(0, 5), dir(0, 25), "Terra Incognita") !== "train");

  // Without a grid (caller that hasn't partitioned yet), we don't guess a
  // geography: fall back to the old continent-based rule instead of
  // classifying at random. That's what keeps old tests and callers valid.
  check("without a grid: falls back to the continent-based rule",
           computeTransports([
             { path: "n1.md", continent: "C1", country: "P1", city: "V1", v: dir(0, 0), links: ["n2.md"] },
             { path: "n2.md", continent: "C1", country: "P1", city: "V2", v: dir(0, 3), links: ["n1.md"] },
           ], new Set()).map(r => r.type)[0] === "train");

  // A grid with no land at all must not produce an imaginary rail.
  const allSea = { width: 16, height: 8, cellSize: 8,
                    cells: new Int32Array(16 * 8).fill(-1) };
  check("geo: planet with no land -> no train",
           computeTransports([
             { path: "m1.md", continent: "C1", country: "P1", city: "V1", v: dir(0, 0), links: ["m2.md"] },
             { path: "m2.md", continent: "C1", country: "P1", city: "V2", v: dir(0, 8), links: ["m1.md"] },
           ], new Set(), allSea).map(r => r.type)[0] !== "train");

  // The same city always has no transport, grid or not: it's a street.
  check("geo: same city -> always no transport",
           computeTransports([
             { path: "v1.md", continent: "C1", country: "P1", city: "V1", v: dir(0, 0), links: ["v2.md"] },
             { path: "v2.md", continent: "C1", country: "P1", city: "V1", v: dir(0, 1), links: ["v1.md"] },
           ], new Set(), g).length === 0);

  // Symmetry: the verdict must not depend on which direction the link is
  // read in (it's the same arc, walked forwards or backwards).
  check("geo: same verdict in both directions",
           link(dir(0, 5), dir(0, 25), "C1") === link(dir(0, 25), dir(0, 5), "C1"));
}

// --- The STREET is measured, no longer read off a label ---------------------
//
// User feedback from 07/27 ("there's no more planes", "the pathfinding logic
// needs revisiting"), diagnosed on the REAL vault before touching any code:
// 19 links, 14 of them dismissed as "streets" for the sole reason that both
// notes carried the same `city` label. Three quarters of the network
// vanished -- with no relation to geography, since the dismissed arcs (9 to
// 29 degrees) overlapped the ones that were kept (18 to 50). A "city" is a
// CLASSIFICATION group: one of them on this vault spans 35 degrees of arc, a
// fifth of a hemisphere.
//
// First fix (morning of 07/27): the street becomes a measurement -- do the
// two territories touch? That removed the module's last label, but NOT the
// underlying bug, and the plan from the evening of 07/27 showed it: the same
// Lloyd relaxation that pulls linked notes together also makes the gap
// shorter than the sum of the territories (26% of the sphere for 58 notes),
// so the geometric test still threw out most of the network as soon as a
// note was added. A criterion that depends on territory size can't decide
// "is there a journey": it measures the partition, not the route.
//
// Rule in place: a FIXED threshold (STREET_THRESHOLD, ~3 degrees). Below it,
// the two notes are drawn in the same spot and the arc would be invisible;
// above it, every link is a journey. Nothing else enters into it -- neither
// the label, nor the grid.
{
  // The threshold must stay on the order of a SCREEN PIXEL, not geography:
  // beyond a handful of degrees, it would start discarding real journeys
  // again.
  check("street: fixed threshold on the order of a few degrees",
           STREET_THRESHOLD > 0.005 && STREET_THRESHOLD < 0.12);

  const simplePair = (v1, v2, city1, city2, g) => computeTransports([
    { path: "r1.md", continent: "C1", country: "P1", city: city1, v: v1, links: ["r2.md"] },
    { path: "r2.md", continent: "C1", country: "P1", city: city2, v: v2, links: ["r1.md"] },
  ], new Set(), g);

  // Two notes of the SAME city, 60 degrees apart: they do travel.
  check("street: same city but far-apart notes -> there is a transport",
           simplePair(dir(0, 0), dir(0, 60), "V1", "V1").length === 1);
  // Converse: DIFFERENT cities, but notes stacked on top of each other.
  check("street: overlapping notes -> no transport, even with different cities",
           simplePair(dir(0, 0), dir(0, 1), "V1", "V2").length === 0);
  // The current rule's bite is here: it's DISTANCE that decides, and the
  // verdict flips on either side of the threshold, with the labels held
  // constant.
  const degrees = (d) => dir(0, d);
  const under = STREET_THRESHOLD * 180 / Math.PI * 0.5, over = STREET_THRESHOLD * 180 / Math.PI * 2;
  check("street: the verdict flips on either side of the threshold",
           simplePair(degrees(0), degrees(under), "V1", "V1").length === 0 &&
           simplePair(degrees(0), degrees(over), "V1", "V1").length === 1);
}

// --- The street does NOT depend on the partition ----------------------------
//
// This is exactly the regression the fixed threshold is there to prevent:
// with the old `gap <= ra + rb` test, growing the territories was enough to
// make a journey vanish without moving a single degree. This check FAILS if
// we go back to a criterion that reads the grid.
{
  // A grid that carries its own AREAS: that's what a territory's radius is
  // derived from. Area of an equirectangular cell is proportional to
  // cos(latitude).
  const gridWithAreas = (cellRadius) => {
    const width = 128, height = 64, cellSize = 8;
    const cells = new Int32Array(width * height).fill(-1);
    const areas = new Float64Array(width * height);
    for (let gy = 0; gy < height; gy++) {
      const lat = (0.5 - (gy + 0.5) / height) * Math.PI;
      for (let gx = 0; gx < width; gx++) areas[gy * width + gx] = Math.cos(lat);
    }
    // Two round territories, one at 0 degrees and the other at 60 degrees of
    // longitude.
    const centers = [[0, 0], [0, 60]];
    for (let gy = 0; gy < height; gy++)
      for (let gx = 0; gx < width; gx++) {
        const lon = ((gx + 0.5) / width - 0.5) * 360;
        const lat = (0.5 - (gy + 0.5) / height) * 180;
        centers.forEach(([clat, clon], i) => {
          if (Math.hypot(lat - clat, lon - clon) <= cellRadius)
            cells[gy * width + gx] = i;
        });
      }
    return { width, height, cellSize, cells, areas };
  };
  const pair = (v1, v2, city1, city2, g) => computeTransports([
    { path: "r1.md", continent: "C1", country: "P1", city: city1, v: v1, links: ["r2.md"] },
    { path: "r2.md", continent: "C1", country: "P1", city: city2, v: v2, links: ["r1.md"] },
  ], new Set(), g);

  // Same pair of notes, 60 degrees apart, seen through two opposite
  // partitions: narrow territories (3 degrees radius) then territories so
  // wide they overlap (40 degrees). The old rule changed its verdict; the
  // new one can't, since it only looks at the arc.
  const narrow = gridWithAreas(3), wide = gridWithAreas(40);
  check("street: narrow territories -> transport",
           pair(dir(0, 0), dir(0, 60), "V1", "V1", narrow).length === 1);
  check("street: overlapping territories -> transport all the same",
           pair(dir(0, 0), dir(0, 60), "V1", "V2", wide).length === 1);
  check("street: the verdict doesn't depend on the partition",
           pair(dir(0, 0), dir(0, 60), "V1", "V1", narrow).length ===
           pair(dir(0, 0), dir(0, 60), "V1", "V1", wide).length);
}

// --- The plane: a threshold RELATIVE to the vault ---------------------------
//
// "There's no more planes", measured: zero planes on the real vault, and not
// by accident -- its longest link is 50 degrees of arc when the threshold
// demanded 60. The threshold was therefore unreachable by construction,
// exactly like the boat before 07/26.
//
// The cause is structural: the placer ATTRACTS linked notes towards each
// other, so what creates a link is precisely what shortens it. Measured on
// the vault: between two arbitrary notes the median gap is 48 degrees,
// between two LINKED notes it ranges 9 to 50. No absolute threshold can
// decide there.
//
// Hence a relative threshold (the PLANE_SHARE quantile of the real links),
// bounded by a floor and a ceiling so it stays geography.
{
  // A fully overland planet: the terrain therefore never says "boat" and the
  // only remaining criterion is LENGTH, which is what's tested here.
  // (No `areas`: the street falls back to the label, and `city: null` is
  // never one -- so all links are kept.)
  const allLand = { width: 128, height: 64, cellSize: 8,
                         cells: new Int32Array(128 * 64).fill(0) };
  const chain = (gapsDeg) => {
    const notes = [{ path: "c0.md", continent: "C1", country: "P", city: null,
                     v: dir(0, 0), links: [] }];
    gapsDeg.forEach((d, i) => {
      notes[0].links.push("c" + (i + 1) + ".md");
      notes.push({ path: "c" + (i + 1) + ".md", continent: "C1", country: "P", city: null,
                   v: dir(0, d), links: ["c0.md"] });
    });
    return computeTransports(notes, new Set(), allLand).map(r => r.type);
  };
  // A vault where ALL links are short has no plane: the floor forbids it,
  // even if one of them is the longest of the batch.
  check("plane: a vault with only short links has none",
           chain([5, 8, 10, 12, 15, 18, 20]).every(t => t !== "avion"));
  // A spread-out vault has some, and only on its longest links.
  // All links stay UNDER the absolute ceiling (BOAT_THRESHOLD, 60 degrees):
  // otherwise the ceiling alone would produce planes and this check would no
  // longer say anything about the relative threshold, which is what it's
  // meant to hold. Verified with bite by raising PLANE_SHARE to 1 -> "a
  // spread-out vault has some" then FAILS.
  const spread = chain([10, 15, 20, 30, 40, 50, 55]);
  check("plane: a spread-out vault has some", spread.includes("avion"));
  check("plane: reserved to the longest quarter",
           spread.filter(t => t === "avion").length <= Math.ceil(spread.length * 0.4));
  // Guard rail: the absolute ceiling stays sovereign. A link that goes
  // around the world is a flight even in a vault where everything else is
  // longer than it could possibly be -- impossible, so we check the
  // reverse: in a vault that's entirely long-haul, everything is a plane.
  check("plane: beyond the ceiling, everything is a flight",
           chain([120, 130, 140, 150]).every(t => t === "avion"));
  check("plane: floor and ceiling in the right order",
           PLANE_FLOOR > 0 && PLANE_FLOOR < BOAT_THRESHOLD
           && PLANE_SHARE > 0.5 && PLANE_SHARE < 1);
}

// --- The train must be VISIBLE -----------------------------------------------
//
// Observed on a capture (train repainted magenta to spot it): its track was
// just a row of one-pixel dots, invisible at normal zoom -- even though it's
// the most common vehicle in the real vault, 6 links out of 10. It combined
// the sparsest dash pattern, the thinnest line and the lowest opacity, on
// the one color that's also the background's and the graticule's.
//
// These three checks don't judge taste: they forbid the train from
// becoming, on these three settings at once, the poor relation of the other
// two.
{
  const others = [STYLE.avion, STYLE.bateau];
  check("train: line no thinner than the other vehicles",
           others.every(s => STYLE.train.epaisseur >= s.epaisseur));
  check("train: no dimmer than the other vehicles",
           others.every(s => STYLE.train.alpha >= s.alpha));
  // A mostly-empty dash pattern reads as noise, not as a track.
  check("train: mostly-solid dashes",
           STYLE.train.tirets[0] > STYLE.train.tirets[1]);
  // Altitude, however, must STAY the lowest: that's what sets a rail apart
  // from a flight at a glance. Fixing it "too" would have erased the
  // meaning.
  check("train: always hugs the ground",
           others.every(s => STYLE.train.altitude < s.altitude));
}

// --- User feedback (07/28): "on zoom, the vehicles restart" -----------------
//
// `animate` had never been called twice at different zooms in any test --
// exactly why the bug survived. Fixture built by hand: two notes far enough
// apart for a real plane trip, an ABSOLUTE clock advanced far (600,000 ms,
// ten minutes of session -- that scale is what makes the bug visible), a
// single frame's gap (16 ms, one scroll-wheel notch mid-gesture).
{
  const dir2 = (lat, lon) => { const a = lat * Math.PI / 180, o = lon * Math.PI / 180;
    return [Math.cos(a) * Math.cos(o), Math.cos(a) * Math.sin(o), Math.sin(a)]; };
  const animNotes = [{ path: "va.md", v: dir2(0, 0) }, { path: "vb.md", v: dir2(0, 90) }];
  const animTransports = [{ a: "va.md", b: "vb.md", type: "avion" }];
  // Fake projection: a 3D point becomes a screen point at a fixed scale,
  // always in front of the sphere (comp = 1, outside the disk) -- only the
  // CONTINUITY of the trajectory matters here, not the real projection.
  const proj = p => [p[0] * 500, p[1] * 500, 1, 2];
  // Fake context: swallows any method call and does nothing, except
  // `translate`, whose coordinates are captured -- that's where `animate`
  // places the vehicle before drawing it.
  function fakeCtx(captures) {
    return new Proxy({}, {
      get(target, prop) {
        if (prop === "translate") return (x, y) => captures.push([x, y]);
        return prop in target ? target[prop] : () => {};
      },
      set(target, prop, val) { target[prop] = val; return true; },
    });
  }
  const animState = { zoom: 1, level: "world", network: 0 };
  const c1 = [];
  animate(fakeCtx(c1), animState, proj, animTransports, animNotes, 600000, undefined);
  // A hard scroll-wheel notch (zoom x6) right at the start of the next frame
  // (16 ms later, a real animation interval): the position must barely move,
  // only by what 16 ms of flight represents.
  animState.zoom = 6;
  const c2 = [];
  animate(fakeCtx(c2), animState, proj, animTransports, animNotes, 600016, undefined);
  const jump = c1.length && c2.length
    ? Math.hypot(c2[0][0] - c1[0][0], c2[0][1] - c1[0][1]) : Infinity;
  // Loosely bounded (50 px on a x500-scale projection): 16 ms of flight only
  // moves the vehicle a fraction of a pixel. A zoom jump without the fix
  // lands anywhere on the route -- measured at several hundred pixels on
  // this same fixture before the fix.
  check("vehicles: a mid-flight zoom doesn't jump the vehicle elsewhere on its route",
    jump < 50);
}

summary();
