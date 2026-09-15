// Thumbs-up recogniser, built on MediaPipe's Gesture Recognizer.
// Runs on every Nth camera frame (it's a second model on top of pose) and
// reports an edge-triggered "toggle" once the gesture has been held for a bit.

import {
  GestureRecognizer,
  FilesetResolver,
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14";

const WASM_URL = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm";
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task";

const EVERY_N_FRAMES = 3;   // ~10 checks/s at 30 fps camera
const HOLD_MS = 700;        // hold the gesture this long to toggle
const MIN_SCORE = 0.6;

export class ThumbsUp {
  constructor(video) {
    this.video = video;
    this.recognizer = null;
    this.frame = 0;
    this.seenSince = null;    // when we first saw the gesture in the current hold
    this.consumed = false;    // toggle already fired for this hold
    this.active = false;      // gesture currently visible (for UI)
  }

  async init() {
    const vision = await FilesetResolver.forVisionTasks(WASM_URL);
    this.recognizer = await GestureRecognizer.createFromOptions(vision, {
      baseOptions: { modelAssetPath: MODEL_URL, delegate: "GPU" },
      runningMode: "VIDEO",
      numHands: 2,
    });
  }

  /**
   * Call once per processed camera frame.
   * @returns {boolean} true exactly once per held thumbs-up
   */
  update(now) {
    if (!this.recognizer) return false;
    if (++this.frame % EVERY_N_FRAMES !== 0) return false;

    const res = this.recognizer.recognizeForVideo(this.video, now);
    const up = (res.gestures || []).some((hand) =>
      hand.some((g) => g.categoryName === "Thumb_Up" && g.score >= MIN_SCORE)
    );
    this.active = up;

    if (!up) {
      this.seenSince = null;
      this.consumed = false;
      return false;
    }
    if (this.seenSince === null) this.seenSince = now;
    if (!this.consumed && now - this.seenSince >= HOLD_MS) {
      this.consumed = true;
      return true;
    }
    return false;
  }
}
