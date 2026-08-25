// player.js — the PLAYER layer: where I am, where I'm going, where I've been.
//
// The first nine modules describe the vault; this one describes the user
// inside it. Two things drawn, and nothing else:
//
//   — the CURSOR: the note currently open in Obsidian, marked by a pulsing ring;
//   — the HEADING: the shortest path, ALONG THE LINK GRAPH, to the current
//     quest (the "capital").
//
// Note: the WAKE (notes touched in recent days, linked by a trail) is
// COMPUTED but no longer drawn as of 07/27 — see comment [1] in
// `drawPlayer`.
//
// Note: the heading follows the graph, never a straight line. A direct line
// between the open note and the quest would be a lie: it would say "two steps
// away" when four intermediate notes must be crossed. HOP count is the only
// distance that means anything in a second brain — that's what's shown.
//
// Note: written for the sphere, not the flat map of the original plan.
// Everything drawn here goes through 3D points and great-circle arcs
// (routes.arcPoints), like the transport links: a segment drawn directly
// between two SCREEN points would cut through the globe and come out the
// other side — the bug fixed 07/25 on the transport arcs, not to be
// reintroduced here.

// The capital(s): notes carrying `quete: true`.
//
// Convention allows only one, but the function returns however many exist:
// rendering is what warns, calculation doesn't censor. A vault with two
// quests needs fixing, and seeing it is the only way to know.
function capitals(notes) {
  return notes.filter(n => n.quete === true);
}

// Breadth-first search over the link graph. Returns the path (list of note
// paths, start included) or `null` if the two notes don't communicate.
function shortestPath(notes, startPath, endPath) {
  const index = new Map(notes.map(n => [n.path, n]));
  if (!index.has(startPath) || !index.has(endPath)) return null;
  if (startPath === endPath) return [startPath];
  const parent = new Map([[startPath, null]]);
  const queue = [startPath];
  // Head cursor rather than `shift()`: on a vault with thousands of notes,
  // `shift()` re-copies the queue on every iteration.
  for (let head = 0; head < queue.length; head++) {
    const current = queue[head];
    for (const next of index.get(current).links || []) {
      if (parent.has(next) || !index.has(next)) continue;
      parent.set(next, current);
      if (next === endPath) {
        const path = [];
        for (let c = next; c !== null; c = parent.get(c)) path.unshift(c);
        return path;
      }
      queue.push(next);
    }
  }
  return null;
}

// Notes touched within the last `PARAMS.wake.days`, oldest to newest: the
// ORDER carries the information, the trail reads as a work trajectory.
//
// Note: `now` is a DATE (milliseconds since 1970), not the animation clock.
// Confusing the two — as the first version did — gives a deeply negative
// cutoff, so a wake that keeps EVERY note in the vault: seen on screen as a
// green web laid over the whole planet.
//
// `max` caps the number of notes kept, most recent winning. Not a taste
// setting: a day of imports or a skill run can touch a hundred notes at
// once, and the trail meant to show a trajectory would become a net thrown
// over the map.
function wake(notes, PARAMS, now) {
  const S = (PARAMS && PARAMS.wake) || {};
  const days = S.days || 7;
  const max = S.max || 30;
  const cutoff = now - days * 86400000;
  const kept = notes.filter(n => (n.mtime || 0) >= cutoff)
                    .sort((a, b) => (a.mtime || 0) - (b.mtime || 0));
  return kept.length > max ? kept.slice(kept.length - max) : kept;
}

// --- Rendering -----------------------------------------------------------

const CAPITAL = "#ffb86b";
const CURSOR  = "#ffffff";
const ALERT   = "#ff8b9e";
const ARC_POINTS = 24;      // a heading is only a few hops, no need for more

// Draws a great-circle arc between two notes, lifting the pen behind the
// globe. `mods.routes` supplies the geometry; without it (partial caller),
// draw nothing rather than a chord cutting through the planet.
function arcBetween(ctx, mods, proj, a, b, altitude) {
  if (!mods || !mods.routes || !a || !b || !a.v || !b.v) return;
  const points = mods.routes.arcPoints(a.v, b.v, altitude, ARC_POINTS).map(proj);
  let open = false;
  for (const p of points) {
    if (!mods.routes.frontOfGlobe(p)) { open = false; continue; }
    if (!open) { ctx.moveTo(p[0], p[1]); open = true; }
    else ctx.lineTo(p[0], p[1]);
  }
}

// Is a note visible, and where? Returns `null` if it's behind the globe.
function onScreen(mods, proj, n) {
  if (!n || !n.v) return null;
  const p = proj(n.v);
  if (mods && mods.routes && !mods.routes.frontOfGlobe(p)) return null;
  // Without routes.js, fall back to the component towards the eye, which is
  // enough for a point sitting on the ground (radius 1).
  if (p.length >= 3 && p[2] < 0) return null;
  return p;
}

// One pass of the player layer. Called as an overlay, so AFTER the terrain
// and the live layer: it sits on top of everything, which is intentional —
// it's the only layer that speaks about the user rather than the vault.
//
// Note: TWO clocks, and they are not the same:
//   — `clock`: the ANIMATION instant (performance.now()), driving the
//     cursor ring's pulse. Passed in by the caller rather than read here, so
//     the harness can snapshot a precise instant — same rule as the live
//     layer and the vehicles.
//   — `now`: today's DATE, deciding the wake window.
// Confusing them gives a wake that keeps the whole vault (see `wake`).
function drawPlayer(ctx, state, proj, model, currentPath, clock, now) {
  const notes = model.notes || [];
  const mods = model.mods || {};
  const index = new Map(notes.map(n => [n.path, n]));
  const caps = capitals(notes);
  const t = clock === undefined ? 0 : clock;
  const date = now === undefined ? Date.now() : now;

  // Note: [1] The WAKE IS NO LONGER DRAWN (07/27, user request: "the green
  // lines that aren't links are useless and clutter the view").
  //
  // It used to be the green trail connecting notes touched during the week.
  // It cut across the planet end to end in solid arcs, unrelated to the
  // geography it covered, and was the ONLY source of green on the map — the
  // three transports are orange, cream and cyan. The calculation (`wake`)
  // is kept along with its checks: it's correct, costs nothing while unused,
  // and is the only trace of "what I touched recently" should it come back
  // in another form (a badge on the note, say). Removing it here removes
  // the DRAWING, not the data.

  // [2] The CAPITALS: a beacon, visible at all three zoom levels. They don't
  // pulse — a fixed point, since a blinking marker reads as an alert.
  ctx.save();
  ctx.strokeStyle = CAPITAL; ctx.fillStyle = CAPITAL;
  ctx.shadowBlur = 14; ctx.shadowColor = CAPITAL;
  ctx.lineWidth = 1.4;
  for (const c of caps) {
    const p = onScreen(mods, proj, c);
    if (!p) continue;
    ctx.beginPath(); ctx.arc(p[0], p[1], 6, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(p[0], p[1], 2, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();

  // [3] The HEADING, drawn before the cursor so it passes underneath.
  const current = currentPath ? index.get(currentPath) : null;
  let path = null;
  if (current && caps.length) {
    path = shortestPath(notes, current.path, caps[0].path);
    ctx.save();
    ctx.lineWidth = 1.6;
    ctx.lineCap = "round";
    if (!path) {
      // Off-network: a red dashed as-the-crow-flies line, saying exactly
      // what it is — NO path exists, so nothing real to follow.
      ctx.strokeStyle = ALERT;
      ctx.globalAlpha = 0.6;
      ctx.setLineDash([2, 6]);
      ctx.beginPath();
      arcBetween(ctx, mods, proj, current, caps[0], 0.12);
      ctx.stroke();
    } else {
      ctx.strokeStyle = CURSOR;
      ctx.globalAlpha = 0.75;
      ctx.shadowBlur = 8; ctx.shadowColor = CURSOR;
      ctx.setLineDash([]);
      for (let i = 1; i < path.length; i++) {
        ctx.beginPath();
        arcBetween(ctx, mods, proj, index.get(path[i - 1]), index.get(path[i]), 0.05);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  // [4] The CURSOR: the note open in Obsidian. A breathing ring, the only
  // pulsing element of the layer — this is here and now.
  if (current) {
    const p = onScreen(mods, proj, current);
    if (p) {
      const pulse = 5 + 2.5 * Math.sin(t / 300);
      ctx.save();
      ctx.strokeStyle = CURSOR;
      ctx.lineWidth = 1.4;
      ctx.shadowBlur = 12; ctx.shadowColor = CURSOR;
      ctx.beginPath(); ctx.arc(p[0], p[1], pulse, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    }
  }

  // [5] The status line, top left. Three degenerate cases are stated
  // explicitly rather than left silent — a mute map reads as broken.
  ctx.save();
  // Same text scale as the rest of the map (set on `state` by
  // render.presenter). Falls back to 1 for test calls, which pass a reduced
  // `state` — but in real usage it's always there.
  const e = state.textScale || 1;
  ctx.font = `${(11 * e).toFixed(1)}px monospace`;
  ctx.textAlign = "left";
  ctx.shadowBlur = 6; ctx.shadowColor = "#000";
  const margin = 12 * e;
  let line = 20 * e;
  if (caps.length === 0) {
    ctx.fillStyle = ALERT;
    ctx.fillText("no quest — set quete: true on a project", margin, line);
    line += 16 * e;
  } else if (caps.length > 1) {
    ctx.fillStyle = CAPITAL;
    ctx.fillText("⚠ " + caps.length + " quests — convention allows only one", margin, line);
    line += 16 * e;
  }
  if (current && caps.length) {
    if (!path) {
      ctx.fillStyle = ALERT;
      ctx.fillText("off network: no link path to the quest", margin, line);
    } else {
      ctx.fillStyle = "#9fe8dd";
      const hops = path.length - 1;
      ctx.fillText("heading: " + hops + " hop" + (hops > 1 ? "s" : "")
                   + " → " + (caps[0].name || caps[0].path), margin, line);
    }
  }
  ctx.restore();
}

export { capitals, shortestPath, wake, drawPlayer };
