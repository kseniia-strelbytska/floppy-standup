// Flappy Bird, drawn from scratch with the original game's colour palette.
// Physics is in px/second so it's frame-rate independent, and is tuned to be
// playable with whole-body input (slower fall, bigger gaps, wider spacing).

// ---- tuning -------------------------------------------------------------
const H = 512;                 // logical height; width follows the window
const GRAVITY = 500;           // px/s² (gentle: body input is slower than a thumb)
const FLAP_VY = -340;          // px/s upward impulse (~115 px of lift per flap)
const MAX_FALL = 380;          // px/s terminal velocity
const PIPE_SPEED = 90;         // px/s
const PIPE_GAP = 180;          // px between top and bottom pipe
const PIPE_SPACING = 240;      // px between consecutive pipes
const PIPE_W = 52;
const PIPE_CAP_H = 26;
const GROUND_H = 112;
const BIRD_W = 34, BIRD_H = 24;
const HIT_MARGIN = 4;          // shrink hitbox so near misses are forgiven
const RESTART_DELAY_MS = 900;  // ignore flaps right after dying
const FLAP_PEAK = (FLAP_VY * FLAP_VY) / (2 * GRAVITY); // px gained per flap
export { FLAP_PEAK, PIPE_GAP, PIPE_W, BIRD_H, GROUND_H, H };

// ---- palette (original Flappy Bird "day" theme) -------------------------
const C = {
  sky: "#4ec0ca",
  cityLight: "#d0f0e8",
  cityBush: "#9fe54f",
  ground: "#ded895",
  grass: "#73bf2e",
  grassLight: "#9ce659",
  ink: "#533e2d",
  pipe: "#73bf2e",
  pipeLight: "#9ce659",
  pipeDark: "#558022",
  bird: "#f7d51d",
  birdWing: "#f0b429",
  birdCheek: "#faf2c8",
  beak: "#f1592a",
  eye: "#ffffff",
  pupil: "#000000",
  panel: "#ded895",
  panelDark: "#c9b37e",
  title: "#e86101",
  text: "#533e2d",
  white: "#ffffff",
};

export class FlappyGame {
  /** @param {HTMLCanvasElement} canvas */
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.best = Number(localStorage.getItem("floppy-best") || 0);
    this.paused = false;
    this.resize();
    this.reset();
  }

  resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.floor(window.innerWidth * dpr);
    this.canvas.height = Math.floor(window.innerHeight * dpr);
    this.scale = this.canvas.height / H;
    this.W = this.canvas.width / this.scale; // logical width
    this.ctx.setTransform(this.scale, 0, 0, this.scale, 0, 0);
    this.ctx.imageSmoothingEnabled = false;
  }

  reset() {
    this.state = "READY";          // READY | PLAYING | DEAD | GAMEOVER
    this.score = 0;
    this.bird = { x: this.W * 0.35, y: H / 2 - 40, vy: 0, rot: 0 };
    this.pipes = [];
    this.groundX = 0;
    this.t = 0;                    // seconds elapsed (for animations)
    this.diedAt = 0;
    this.wingFrame = 0;
    this.flash = 0;
  }

  /** The player's single input. Returns true if it did something. */
  flap(now = performance.now()) {
    if (this.paused) return false;
    switch (this.state) {
      case "READY":
        this.state = "PLAYING";
        this._spawnPipe(this.W + 60);
        this.bird.vy = FLAP_VY;
        return true;
      case "PLAYING":
        this.bird.vy = FLAP_VY;
        return true;
      case "GAMEOVER":
        if (now - this.diedAt >= RESTART_DELAY_MS) {
          this.reset();
          return true;
        }
        return false;
      default:
        return false;
    }
  }

  update(dt, now = performance.now()) {
    if (this.paused) return;
    dt = Math.min(dt, 0.05); // never let a hitch teleport the bird
    this.t += dt;
    this.wingFrame = Math.floor(this.t * 10) % 3;

    const b = this.bird;
    const groundY = H - GROUND_H;

    if (this.state === "READY") {
      b.y = H / 2 - 40 + Math.sin(this.t * 4) * 6;
      b.rot = 0;
      this._scrollGround(dt);
      return;
    }

    if (this.state === "PLAYING" || this.state === "DEAD") {
      b.vy = Math.min(MAX_FALL, b.vy + GRAVITY * dt);
      b.y += b.vy * dt;
      // Nose up briefly after a flap, then tip down as we fall.
      const target = b.vy < 0 ? -0.45 : Math.min(1.4, (b.vy / MAX_FALL) * 1.6);
      b.rot += (target - b.rot) * Math.min(1, dt * (b.vy < 0 ? 18 : 6));
      if (b.y < -BIRD_H) { b.y = -BIRD_H; b.vy = 0; }
    }

    if (this.state === "PLAYING") {
      this._scrollGround(dt);
      for (const p of this.pipes) {
        p.x -= PIPE_SPEED * dt;
        if (!p.passed && p.x + PIPE_W < b.x) {
          p.passed = true;
          this.score++;
        }
      }
      if (this.pipes.length && this.pipes[0].x + PIPE_W < -10) this.pipes.shift();
      const last = this.pipes[this.pipes.length - 1];
      if (!last || last.x < this.W - PIPE_SPACING) {
        this._spawnPipe(last ? last.x + PIPE_SPACING : this.W + 60);
      }
      if (this._collides()) this._die(now);
    }

    if (this.state === "DEAD" || this.state === "PLAYING") {
      if (b.y + BIRD_H >= groundY) {
        b.y = groundY - BIRD_H;
        b.vy = 0;
        if (this.state === "PLAYING") this._die(now);
        this.state = "GAMEOVER";
      }
    }
    if (this.flash > 0) this.flash -= dt * 4;
  }

  _scrollGround(dt) {
    this.groundX = (this.groundX - PIPE_SPEED * dt) % 24;
  }

  _spawnPipe(x) {
    const minTop = 60;
    const maxTop = H - GROUND_H - PIPE_GAP - 60;
    const top = minTop + Math.random() * (maxTop - minTop);
    this.pipes.push({ x, top, passed: false });
  }

  _collides() {
    const b = this.bird;
    const bx1 = b.x + HIT_MARGIN, bx2 = b.x + BIRD_W - HIT_MARGIN;
    const by1 = b.y + HIT_MARGIN, by2 = b.y + BIRD_H - HIT_MARGIN;
    for (const p of this.pipes) {
      const px1 = p.x - 2, px2 = p.x + PIPE_W + 2; // caps stick out by 2px
      if (bx2 < px1 || bx1 > px2) continue;
      if (by1 < p.top || by2 > p.top + PIPE_GAP) return true;
    }
    return false;
  }

  _die(now) {
    if (this.state !== "PLAYING") return;
    this.state = "DEAD";
    this.diedAt = now;
    this.flash = 1;
    if (this.score > this.best) {
      this.best = this.score;
      localStorage.setItem("floppy-best", String(this.best));
    }
  }

  // ---- rendering ----------------------------------------------------------

  draw() {
    const ctx = this.ctx;
    const W = this.W;
    const groundY = H - GROUND_H;

    // sky
    ctx.fillStyle = C.sky;
    ctx.fillRect(0, 0, W, H);

    // distant city + bushes (static, like the original)
    this._drawSkyline(groundY);

    // pipes
    for (const p of this.pipes) this._drawPipe(p, groundY);

    // ground
    ctx.fillStyle = C.ground;
    ctx.fillRect(0, groundY, W, GROUND_H);
    ctx.fillStyle = C.ink;
    ctx.fillRect(0, groundY, W, 2);
    ctx.fillStyle = C.grass;
    ctx.fillRect(0, groundY + 2, W, 12);
    ctx.fillStyle = C.grassLight;
    for (let x = this.groundX - 24; x < W + 24; x += 24) {
      ctx.beginPath();
      ctx.moveTo(x, groundY + 14);
      ctx.lineTo(x + 12, groundY + 2);
      ctx.lineTo(x + 24, groundY + 14);
      ctx.closePath();
      ctx.fill();
    }
    ctx.fillStyle = C.ink;
    ctx.fillRect(0, groundY + 14, W, 2);

    // bird
    this._drawBird();

    // score / panels
    if (this.state === "READY") this._drawReady();
    else if (this.state === "PLAYING" || this.state === "DEAD") this._drawScore(this.score, W / 2, 60, 40);
    else if (this.state === "GAMEOVER") this._drawGameOver();

    if (this.flash > 0) {
      ctx.fillStyle = `rgba(255,255,255,${Math.min(1, this.flash)})`;
      ctx.fillRect(0, 0, W, H);
    }
  }

  _drawSkyline(groundY) {
    const ctx = this.ctx;
    const W = this.W;
    // clouds band
    ctx.fillStyle = C.cityLight;
    ctx.fillRect(0, groundY - 50, W, 50);
    for (let x = -20; x < W + 40; x += 64) {
      ctx.beginPath();
      ctx.arc(x + 20, groundY - 50, 22, Math.PI, 0);
      ctx.arc(x + 48, groundY - 50, 16, Math.PI, 0);
      ctx.fill();
    }
    // bushes
    ctx.fillStyle = C.cityBush;
    ctx.fillRect(0, groundY - 22, W, 22);
    for (let x = -10; x < W + 40; x += 50) {
      ctx.beginPath();
      ctx.arc(x + 15, groundY - 22, 18, Math.PI, 0);
      ctx.arc(x + 38, groundY - 22, 12, Math.PI, 0);
      ctx.fill();
    }
  }

  _drawPipe(p, groundY) {
    const ctx = this.ctx;
    const x = p.x;
    const body = (y, h) => {
      ctx.fillStyle = C.pipe;
      ctx.fillRect(x, y, PIPE_W, h);
      ctx.fillStyle = C.pipeLight;
      ctx.fillRect(x + 6, y, 10, h);
      ctx.fillStyle = C.pipeDark;
      ctx.fillRect(x + PIPE_W - 10, y, 6, h);
      ctx.strokeStyle = C.ink;
      ctx.lineWidth = 2;
      ctx.strokeRect(x + 1, y, PIPE_W - 2, h);
    };
    const cap = (y) => {
      ctx.fillStyle = C.pipe;
      ctx.fillRect(x - 2, y, PIPE_W + 4, PIPE_CAP_H);
      ctx.fillStyle = C.pipeLight;
      ctx.fillRect(x + 4, y + 2, 10, PIPE_CAP_H - 4);
      ctx.fillStyle = C.pipeDark;
      ctx.fillRect(x + PIPE_W - 8, y + 2, 6, PIPE_CAP_H - 4);
      ctx.strokeStyle = C.ink;
      ctx.lineWidth = 2;
      ctx.strokeRect(x - 1, y + 1, PIPE_W + 2, PIPE_CAP_H - 2);
    };
    // top pipe
    body(-4, p.top - PIPE_CAP_H + 4);
    cap(p.top - PIPE_CAP_H);
    // bottom pipe
    const by = p.top + PIPE_GAP;
    body(by + PIPE_CAP_H, groundY - by - PIPE_CAP_H);
    cap(by);
  }

  _drawBird() {
    const ctx = this.ctx;
    const b = this.bird;
    ctx.save();
    ctx.translate(b.x + BIRD_W / 2, b.y + BIRD_H / 2);
    ctx.rotate(b.rot);
    ctx.translate(-BIRD_W / 2, -BIRD_H / 2);

    // body
    ctx.fillStyle = C.bird;
    ctx.strokeStyle = C.ink;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(BIRD_W / 2, BIRD_H / 2, BIRD_W / 2 - 1, BIRD_H / 2 - 1, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // cheek
    ctx.fillStyle = C.birdCheek;
    ctx.beginPath();
    ctx.ellipse(21, 15, 7, 5, 0, 0, Math.PI * 2);
    ctx.fill();

    // wing (3-frame flap)
    const wingY = [4, 8, 12][this.state === "GAMEOVER" ? 1 : this.wingFrame];
    ctx.fillStyle = C.birdWing;
    ctx.beginPath();
    ctx.ellipse(11, wingY + 4, 8, 4.5, -0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // eye
    ctx.fillStyle = C.eye;
    ctx.beginPath();
    ctx.ellipse(23, 8, 5, 5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = C.pupil;
    ctx.beginPath();
    ctx.arc(25, 8, 2, 0, Math.PI * 2);
    ctx.fill();

    // beak
    ctx.fillStyle = C.beak;
    ctx.beginPath();
    ctx.moveTo(26, 12);
    ctx.lineTo(37, 15);
    ctx.lineTo(26, 19);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  _text(str, x, y, size, color = C.white, align = "center") {
    const ctx = this.ctx;
    ctx.font = `bold ${size}px "Courier New", monospace`;
    ctx.textAlign = align;
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    ctx.lineWidth = Math.max(2, size / 8);
    ctx.strokeStyle = C.ink;
    ctx.strokeText(str, x, y);
    ctx.fillStyle = color;
    ctx.fillText(str, x, y);
  }

  _drawScore(n, x, y, size) {
    this._text(String(n), x, y, size);
  }

  _drawReady() {
    const W = this.W;
    this._text("GET READY", W / 2, 110, 36, C.title);
    this._text("Raise both hands", W / 2, 160, 18);
    this._text("to flap", W / 2, 184, 18);
    // little up-arrow above the bird
    const b = this.bird;
    this._text("^", b.x + BIRD_W / 2, b.y - 26 + Math.sin(this.t * 6) * 3, 26);
  }

  _drawGameOver() {
    const ctx = this.ctx;
    const W = this.W;
    this._text("GAME OVER", W / 2, 120, 40, C.title);

    const pw = 226, ph = 116;
    const px = W / 2 - pw / 2, py = 170;
    ctx.fillStyle = C.panelDark;
    ctx.fillRect(px + 3, py + 3, pw, ph);
    ctx.fillStyle = C.panel;
    ctx.fillRect(px, py, pw, ph);
    ctx.strokeStyle = C.ink;
    ctx.lineWidth = 3;
    ctx.strokeRect(px, py, pw, ph);

    this._text("SCORE", px + pw - 20, py + 24, 14, C.title, "right");
    this._text(String(this.score), px + pw - 20, py + 48, 26, C.white, "right");
    this._text("BEST", px + pw - 20, py + 76, 14, C.title, "right");
    this._text(String(this.best), px + pw - 20, py + 100, 26, C.white, "right");

    const medal = this.score >= 30 ? "#e5c14c" : this.score >= 20 ? "#c0c0c0" : this.score >= 10 ? "#cd7f32" : null;
    if (medal) {
      ctx.fillStyle = medal;
      ctx.beginPath();
      ctx.arc(px + 50, py + ph / 2, 26, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }

    const canRestart = performance.now() - this.diedAt >= RESTART_DELAY_MS;
    if (canRestart && Math.floor(this.t * 2) % 2 === 0) {
      this._text("Raise hands to restart", W / 2, py + ph + 36, 18);
    }
  }
}
