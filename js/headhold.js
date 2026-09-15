// "Hands on head" gesture from pose landmarks: both wrists close to the head,
// held for a moment. Works at any distance because it uses the same body
// landmarks as the flap detector – no extra model, no fine hand detail needed.

import { LM } from "./landmarks.js";

const HOLD_MS = 500;        // how long both hands must stay on the head
const DROPOUT_MS = 150;     // tolerate brief tracking blips during the hold
const MAX_DIST = 0.55;      // wrist-to-head distance, in torso units (touching ≈ 0.2–0.4)
const MIN_VIS = 0.2;        // wrists get low visibility scores when they're up by the head
const HEAD = [LM.NOSE, LM.L_EYE, LM.R_EYE, LM.L_EAR, LM.R_EAR];

export class HeadHold {
  constructor() {
    this.active = false;    // gesture currently seen (for UI)
    this.progress = 0;      // 0..1 of the hold
    this._since = null;     // when the current hold started
    this._lastSeen = -Infinity;
    this._consumed = false; // toggle already fired for this hold
    this.debug = "";        // last measured distances, for ?debug
  }

  /**
   * @param {Array|null} lm smoothed landmarks
   * @param {number} now
   * @returns {boolean} true exactly once per completed hold
   */
  update(lm, now, aspect = 4 / 3) {
    const seen = lm ? this._handsOnHead(lm, aspect) : false;
    if (seen) this._lastSeen = now;
    this.active = seen;

    // Release: hands away for longer than a blip → reset for the next toggle.
    if (now - this._lastSeen > DROPOUT_MS) {
      this._since = null;
      this._consumed = false;
      this.progress = 0;
      return false;
    }
    if (this._since === null) this._since = now;
    this.progress = Math.min(1, (now - this._since) / HOLD_MS);
    if (!this._consumed && this.progress >= 1) {
      this._consumed = true;
      return true;
    }
    return false;
  }

  _handsOnHead(lm, aspect) {
    const ls = lm[LM.L_SHOULDER], rs = lm[LM.R_SHOULDER];
    const lh = lm[LM.L_HIP], rh = lm[LM.R_HIP];
    const lw = lm[LM.L_WRIST], rw = lm[LM.R_WRIST];
    if (!ls || !rs || !lw || !rw) return false;
    if (lw.visibility < MIN_VIS || rw.visibility < MIN_VIS) { this.debug = "wrist not visible"; return false; }

    // Landmarks are normalised to the frame, so x needs the aspect ratio
    // applied before x and y distances can be compared.
    const dist = (a, b) => Math.hypot((a.x - b.x) * aspect, a.y - b.y);
    const shoulderY = (ls.y + rs.y) / 2;
    let torso = lh && rh && lh.visibility > 0.4 && rh.visibility > 0.4
      ? Math.abs((lh.y + rh.y) / 2 - shoulderY)
      : dist(ls, rs) / 0.6;
    if (torso < 0.02) return false;

    // Distance from each wrist to the *nearest* visible head landmark, so
    // hands on the sides or back of the head count as well as on top.
    const head = HEAD.map((i) => lm[i]).filter((p) => p && p.visibility > 0.3);
    if (head.length === 0) { this.debug = "head not visible"; return false; }
    const toHead = (w) => Math.min(...head.map((h) => dist(w, h))) / torso;
    const dl = toHead(lw), dr = toHead(rw);
    this.debug = `L ${dl.toFixed(2)} R ${dr.toFixed(2)} (< ${MAX_DIST})`;
    return dl < MAX_DIST && dr < MAX_DIST;
  }
}
