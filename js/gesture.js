// Turns smoothed pose landmarks into a single game input: FLAP.
//
// Gesture: raise both hands up towards / above your shoulders.
//
// Everything is measured in "torso units" – the distance from the shoulder
// line to the hip line – so it doesn't matter how far from the camera you
// stand or how tall you are.
//
//   lift = (shoulderY - wristY) / torsoLength      (averaged over both hands)
//     ≈ -1.0  hands hanging by your sides
//     ≈  0.0  hands level with your shoulders
//     ≈ +0.7  hands straight up above your head
//
// State machine with hysteresis so one raise = exactly one flap:
//
//   ARMED  --(lift crosses RISE)-->  FLAP! --> FIRED
//   FIRED  --(lift drops below RESET)-->  ARMED
//
// The gap between RISE and RESET is the "wiggle room": once you've flapped,
// small wobbles near the threshold do nothing; you have to actually bring your
// hands back down a bit before the next flap can fire.

import { LM } from "./landmarks.js";

const CALIBRATION_MS = 1500;   // how long we watch the player's neutral pose
const MIN_FLAP_GAP_MS = 180;   // hard cooldown between flaps
const RISE_ABOVE_NEUTRAL = 0.6;  // hands must come up ~0.6 torso lengths from rest (≈ chest height)…
const RISE_CAP = 0.15;           // …but never more than "slightly above shoulders"
const RISE_FLOOR_ABOVE_NEUTRAL = 0.3;  // and never less than this, so fidgeting can't flap
const HYSTERESIS = 0.3;          // drop this far below RISE to re-arm (a small dip is enough)

function avg(a, b) { return (a + b) / 2; }

export class FlapDetector {
  constructor() {
    this.reset();
  }

  reset() {
    this.state = "ARMED";
    this.lift = null;             // latest combined hand lift (torso units)
    this.neutral = null;          // calibrated resting lift
    this.rise = 0;                // trigger threshold
    this.resetLevel = -0.5;       // re-arm threshold
    this.calibrated = false;
    this._calSamples = [];
    this._calStart = null;
    this._lastFlapAt = -Infinity;
  }

  /** Throw away calibration and re-learn the neutral pose. */
  recalibrate() {
    const lift = this.lift;
    this.reset();
    this.lift = lift;
  }

  get calibrationProgress() {
    if (this.calibrated) return 1;
    if (this._calStart === null) return 0;
    return Math.min(1, (performance.now() - this._calStart) / CALIBRATION_MS);
  }

  /**
   * @param {Array<{x:number,y:number,visibility:number}>|null} lm smoothed landmarks
   * @param {number} now performance.now()
   * @returns {{flap:boolean}}
   */
  update(lm, now) {
    if (!lm) return { flap: false };

    const lift = this._computeLift(lm);
    if (lift === null) return { flap: false };
    this.lift = lift;

    if (!this.calibrated) {
      this._calibrate(lift, now);
      return { flap: false };
    }

    let flap = false;
    if (this.state === "ARMED") {
      if (lift >= this.rise && now - this._lastFlapAt >= MIN_FLAP_GAP_MS) {
        flap = true;
        this.state = "FIRED";
        this._lastFlapAt = now;
      }
    } else if (this.state === "FIRED") {
      if (lift <= this.resetLevel) this.state = "ARMED";
    }
    return { flap };
  }

  _computeLift(lm) {
    const ls = lm[LM.L_SHOULDER], rs = lm[LM.R_SHOULDER];
    const lh = lm[LM.L_HIP], rh = lm[LM.R_HIP];
    if (!ls || !rs || !lh || !rh) return null;

    const shoulderY = avg(ls.y, rs.y);
    const hipY = avg(lh.y, rh.y);
    // Fallback if the hips are out of frame: shoulder width ≈ 0.6 torso.
    let torso = Math.abs(hipY - shoulderY);
    const hipsVisible = lh.visibility > 0.4 && rh.visibility > 0.4;
    if (!hipsVisible || torso < 0.04) {
      torso = Math.hypot(ls.x - rs.x, ls.y - rs.y) / 0.6;
    }
    if (torso < 0.02) return null;

    const hands = [];
    for (const [w, e] of [[LM.L_WRIST, LM.L_ELBOW], [LM.R_WRIST, LM.R_ELBOW]]) {
      const wrist = lm[w], elbow = lm[e];
      // Use the wrist if we can see it; otherwise fall back to the elbow
      // (people often raise their hands out of the top of the frame).
      if (wrist && wrist.visibility > 0.3) hands.push(wrist.y);
      else if (elbow && elbow.visibility > 0.3) hands.push(elbow.y);
    }
    if (hands.length === 0) return null;

    const handY = hands.reduce((a, b) => a + b, 0) / hands.length;
    return (shoulderY - handY) / torso;
  }

  _calibrate(lift, now) {
    if (this._calStart === null) this._calStart = now;
    this._calSamples.push(lift);
    if (now - this._calStart < CALIBRATION_MS) return;

    // Median is robust to the player waving around during calibration.
    const sorted = [...this._calSamples].sort((a, b) => a - b);
    const neutral = sorted[Math.floor(sorted.length / 2)];
    this.neutral = neutral;

    // RISE: a generous distance above rest, but capped so that "hands roughly
    // at shoulder height" always counts, even if you rest with hands high.
    this.rise = Math.max(
      neutral + RISE_FLOOR_ABOVE_NEUTRAL,
      Math.min(RISE_CAP, neutral + RISE_ABOVE_NEUTRAL)
    );
    this.resetLevel = this.rise - HYSTERESIS;
    this.calibrated = true;
    this.state = lift >= this.rise ? "FIRED" : "ARMED";
  }
}
