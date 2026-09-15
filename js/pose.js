// Camera + MediaPipe Pose Landmarker + smoothing + person counting.
//
// Pipeline per frame:
//   webcam frame -> PoseLandmarker (up to MAX_POSES people)
//               -> count people (with hysteresis so glitches don't flicker)
//               -> One-Euro smoothing of the single tracked player's landmarks
//               -> draw skeleton on the small camera canvas

import {
  PoseLandmarker,
  FilesetResolver,
  DrawingUtils,
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14";
import { OneEuro } from "./oneEuro.js";
import { LM } from "./landmarks.js";

const WASM_URL =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm";
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task";

const MAX_POSES = 4;

export { LM };

// A pose has to be reasonably confident on the torso to count as a person.
// Prevents a chair / poster / partial arm in the corner counting as "someone".
function isRealPerson(landmarks) {
  const core = [LM.NOSE, LM.L_SHOULDER, LM.R_SHOULDER, LM.L_HIP, LM.R_HIP];
  let ok = 0;
  for (const i of core) {
    const p = landmarks[i];
    if (p && (p.visibility ?? 1) > 0.5) ok++;
  }
  return ok >= 3;
}

export class PoseTracker {
  /**
   * @param {HTMLVideoElement} video
   * @param {HTMLCanvasElement} skeletonCanvas
   */
  constructor(video, skeletonCanvas) {
    this.video = video;
    this.canvas = skeletonCanvas;
    this.ctx = skeletonCanvas.getContext("2d");
    this.landmarker = null;
    this.drawing = new DrawingUtils(this.ctx);

    // Person-count hysteresis. Counts are in *frames* (~30/s).
    this.rawCount = 0;
    this.stableCount = 0;         // what the game should believe
    this._candidate = 0;
    this._candidateFrames = 0;
    this.FRAMES_TO_PAUSE = 4;     // ~130 ms of "2+ people" before pausing
    this.FRAMES_TO_RESUME = 12;   // ~400 ms of "exactly 1" before resuming
    this.FRAMES_TO_LOSE = 20;     // ~650 ms of "nobody" before we call it lost

    // Smoothed landmarks for the single tracked player: array of {x,y,visibility}
    this.smoothed = null;
    this.aspect = 4 / 3;           // frame width / height, for distance maths
    this.filters = null;           // [ [fx, fy] x 33 ]
    this.lastVideoTime = -1;
    this.fps = 0;
    this._fpsAcc = 0;
    this._fpsCount = 0;
    this._fpsT = performance.now();
  }

  async init() {
    const vision = await FilesetResolver.forVisionTasks(WASM_URL);
    this.landmarker = await PoseLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: MODEL_URL, delegate: "GPU" },
      runningMode: "VIDEO",
      numPoses: MAX_POSES,
      minPoseDetectionConfidence: 0.5,
      minPosePresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });
  }

  async startCamera() {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: "user" },
      audio: false,
    });
    this.video.srcObject = stream;
    await new Promise((res) => {
      this.video.onloadedmetadata = () => res();
    });
    await this.video.play();
    this.canvas.width = this.video.videoWidth;
    this.canvas.height = this.video.videoHeight;
    this.aspect = this.video.videoWidth / this.video.videoHeight;
  }

  _ensureFilters() {
    if (this.filters) return;
    this.filters = [];
    for (let i = 0; i < 33; i++) {
      // Slightly more smoothing on the position than the default: landmarks
      // twitch a bit even when you stand still. beta keeps fast arm raises snappy.
      this.filters.push([new OneEuro(1.2, 0.08), new OneEuro(1.2, 0.08)]);
    }
  }

  _resetFilters() {
    if (!this.filters) return;
    for (const [fx, fy] of this.filters) { fx.reset(); fy.reset(); }
  }

  /**
   * Run detection if a new video frame is available.
   * @returns {boolean} true if a new frame was processed
   */
  update(now) {
    if (!this.landmarker || this.video.readyState < 2) return false;
    if (this.video.currentTime === this.lastVideoTime) return false;
    this.lastVideoTime = this.video.currentTime;

    const result = this.landmarker.detectForVideo(this.video, now);
    const people = (result.landmarks || []).filter(isRealPerson);
    this.rawCount = people.length;
    this._updateStableCount(this.rawCount);

    // Track the biggest person (closest to camera) when there's exactly one
    // stable person – if there are briefly 2 raw detections, keep tracking the
    // largest so a passer-by doesn't hijack the controls.
    let player = null;
    if (people.length > 0) {
      player = people.reduce((best, lm) => {
        const size = (l) => {
          const a = l[LM.L_SHOULDER], b = l[LM.R_SHOULDER];
          return Math.hypot(a.x - b.x, a.y - b.y);
        };
        return size(lm) > size(best) ? lm : best;
      }, people[0]);
    }

    if (player) {
      this._ensureFilters();
      this.smoothed = player.map((p, i) => ({
        x: this.filters[i][0].filter(p.x, now),
        y: this.filters[i][1].filter(p.y, now),
        visibility: p.visibility ?? 1,
      }));
    } else {
      this.smoothed = null;
      this._resetFilters();
    }

    this._draw(people, player);
    this._tickFps(now);
    return true;
  }

  _updateStableCount(raw) {
    // Bucket into 0 / 1 / 2+ – we only care about those three states.
    const bucket = raw >= 2 ? 2 : raw;
    if (bucket === this.stableCount) {
      this._candidate = bucket;
      this._candidateFrames = 0;
      return;
    }
    if (bucket !== this._candidate) {
      this._candidate = bucket;
      this._candidateFrames = 0;
    }
    this._candidateFrames++;

    let needed;
    if (bucket === 2) needed = this.FRAMES_TO_PAUSE;       // pause quickly
    else if (bucket === 1) needed = this.FRAMES_TO_RESUME; // resume a bit slower
    else needed = this.FRAMES_TO_LOSE;                     // "nobody" slowest

    if (this._candidateFrames >= needed) {
      this.stableCount = bucket;
      this._candidateFrames = 0;
    }
  }

  _draw(people, player) {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    for (const lm of people) {
      const isPlayer = lm === player && this.stableCount === 1;
      const color = isPlayer ? "#73bf2e" : "#ff4d4d";
      const pts = isPlayer && this.smoothed ? this.smoothed : lm;
      this.drawing.drawConnectors(pts, PoseLandmarker.POSE_CONNECTIONS, {
        color,
        lineWidth: 6, // the panel is small, so draw thick
      });
      this.drawing.drawLandmarks(pts, {
        color: "#fff",
        fillColor: color,
        lineWidth: 2,
        radius: 5,
      });
    }
  }

  _tickFps(now) {
    this._fpsCount++;
    if (now - this._fpsT >= 1000) {
      this.fps = this._fpsCount;
      this._fpsCount = 0;
      this._fpsT = now;
    }
  }
}
