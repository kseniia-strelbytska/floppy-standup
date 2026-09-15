// "Hands on head" gesture from pose landmarks: both wrists close to the head,
// held for a moment. Works at any distance because it uses the same body
// landmarks as the flap detector – no extra model, no fine hand detail needed.

import { LM } from "./landmarks.js";

const HOLD_MS = 500;        // how long both hands must stay on the head
const DROPOUT_MS = 150;     // tolerate brief tracking blips during the hold
const MAX_DIST = 0.45;      // wrist-to-nose distance, in torso units (touching ≈ 0.25–0.35)

export class HeadHold {
  constructor() {
    this.active = false;    // gesture currently seen (for UI)
    this.progress = 0;      // 0..1 of the hold
    this._since = null;     // when the current hold started
    this._lastSeen = -Infinity;
    this._consumed = false; // toggle already fired for this hold
  }

  /**
   * @param {Array|null} lm smoothed landmarks
   * @param {number} now
   * @returns {boolean} true exactly once per completed hold
   */
  update(lm, now) {
    const seen = lm ? this._handsOnHead(lm) : false;
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

  _handsOnHead(lm) {
    const nose = lm[LM.NOSE];
    const ls = lm[LM.L_SHOULDER], rs = lm[LM.R_SHOULDER];
    const lh = lm[LM.L_HIP], rh = lm[LM.R_HIP];
    const lw = lm[LM.L_WRIST], rw = lm[LM.R_WRIST];
    if (!nose || !ls || !rs || !lw || !rw) return false;
    if (nose.visibility < 0.5 || lw.visibility < 0.4 || rw.visibility < 0.4) return false;

    const shoulderY = (ls.y + rs.y) / 2;
    let torso = lh && rh && lh.visibility > 0.4 && rh.visibility > 0.4
      ? Math.abs((lh.y + rh.y) / 2 - shoulderY)
      : Math.hypot(ls.x - rs.x, ls.y - rs.y) / 0.6;
    if (torso < 0.02) return false;

    const d = (p) => Math.hypot(p.x - nose.x, p.y - nose.y) / torso;
    return d(lw) < MAX_DIST && d(rw) < MAX_DIST;
  }
}
