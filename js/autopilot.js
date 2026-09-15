// Plays the game by itself: flaps when the bird is about to drop out of the
// next gap, timed so the peak of the flap stays under the top pipe.

import { FLAP_PEAK, PIPE_GAP, PIPE_W, BIRD_H, GROUND_H, H } from "./game.js";

export function autopilotStep(game, now) {
  if (game.paused) return;
  if (game.state !== "PLAYING") { game.flap(now); return; }

  const b = game.bird;
  const by = b.y + BIRD_H / 2;
  const next = game.pipes.find((p) => p.x + PIPE_W + 6 > b.x);
  let gapTop, gapBot;
  if (next) {
    gapTop = next.top;
    gapBot = next.top + PIPE_GAP;
  } else {
    gapTop = H / 2 - 90;
    gapBot = H / 2 + 90;
  }
  // Flap late enough that the top of the arc clears the upper pipe with margin,
  // but never let the bird sink into the lower pipe or the ground.
  const floor = Math.min(gapBot - 30, H - GROUND_H - 40);
  const flapPoint = Math.max(floor, gapTop + FLAP_PEAK + 20);
  if (b.vy > 0 && by > Math.min(flapPoint, floor)) game.flap(now);
}
