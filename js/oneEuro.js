// One Euro filter (Casiez et al. 2012).
// Low jitter when the signal is still, low lag when it moves fast —
// exactly the trade-off we want for pose landmarks.

class LowPass {
  constructor() { this.y = null; }
  filter(x, alpha) {
    this.y = this.y === null ? x : alpha * x + (1 - alpha) * this.y;
    return this.y;
  }
}

export class OneEuro {
  /**
   * @param {number} minCutoff lower = smoother at rest (Hz)
   * @param {number} beta      higher = less lag when moving fast
   * @param {number} dCutoff   cutoff for the derivative estimate (Hz)
   */
  constructor(minCutoff = 1.5, beta = 0.05, dCutoff = 1.0) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
    this.x = new LowPass();
    this.dx = new LowPass();
    this.lastT = null;
    this.lastX = null;
  }

  static alpha(cutoff, dt) {
    const tau = 1 / (2 * Math.PI * cutoff);
    return 1 / (1 + tau / dt);
  }

  filter(x, t) {
    if (this.lastT === null) {
      this.lastT = t;
      this.lastX = x;
      this.dx.filter(0, 1);
      return this.x.filter(x, 1);
    }
    const dt = Math.max(1e-3, (t - this.lastT) / 1000);
    this.lastT = t;
    const dxRaw = (x - this.lastX) / dt;
    this.lastX = x;
    const dxHat = this.dx.filter(dxRaw, OneEuro.alpha(this.dCutoff, dt));
    const cutoff = this.minCutoff + this.beta * Math.abs(dxHat);
    return this.x.filter(x, OneEuro.alpha(cutoff, dt));
  }

  reset() {
    this.x = new LowPass();
    this.dx = new LowPass();
    this.lastT = null;
    this.lastX = null;
  }
}
