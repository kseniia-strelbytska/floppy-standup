// Glue: camera → pose → gesture → game, all on one requestAnimationFrame loop.

import { PoseTracker } from "./pose.js";
import { FlapDetector } from "./gesture.js";
import { FlappyGame } from "./game.js";
import { HeadHold } from "./headhold.js";
import { autopilotStep } from "./autopilot.js";

const $ = (id) => document.getElementById(id);
const video = $("video");
const skeleton = $("skeleton");
const overlay = $("overlay");
const overlayTitle = $("overlay-title");
const overlaySub = $("overlay-sub");
const camStatus = $("cam-status");
const gaugeFill = $("gauge-fill");
const gaugeMark = $("gauge-mark");
const titleA = $("title-a");

const game = new FlappyGame($("game"));
const tracker = new PoseTracker(video, skeleton);
const detector = new FlapDetector();
const headHold = new HeadHold();
let autopilot = false;

// ?nocam → skip the camera entirely and play with Space (handy for tuning physics).
const NO_CAM = new URLSearchParams(location.search).has("nocam");
const DEBUG = new URLSearchParams(location.search).has("debug");
window.floppy = { game, tracker, detector, setAutopilot: (v) => { autopilot = v; } };

let ready = false;          // model + camera up
let fatal = null;           // error message if we can't run at all
let lostAt = null;          // when the player disappeared (for auto-recalibration)
let prevStable = -1;
const RECAL_AFTER_LOST_MS = 2500;

window.addEventListener("resize", () => game.resize());

// Keyboard fallback so the game is testable without a camera.
window.addEventListener("keydown", (e) => {
  if (e.code === "Space") { e.preventDefault(); game.flap(); }
  if (e.key === "c" || e.key === "C") detector.recalibrate();
  if (e.key === "a" || e.key === "A" || e.key === "p" || e.key === "P") autopilot = !autopilot;
});
$("game").addEventListener("pointerdown", () => game.flap());

function showOverlay(title, sub, warn = false) {
  overlay.classList.remove("hidden");
  overlayTitle.textContent = title;
  overlayTitle.classList.toggle("warn", warn);
  overlaySub.textContent = sub;
}
function hideOverlay() { overlay.classList.add("hidden"); }

function setCamStatus(text, cls = "") {
  camStatus.textContent = text;
  camStatus.className = "cam-status " + cls;
}

function updateGauge() {
  if (!detector.calibrated || detector.lift === null) {
    gaugeFill.style.height = `${detector.calibrationProgress * 100}%`;
    gaugeFill.className = "gauge-fill";
    gaugeMark.style.bottom = "100%";
    return;
  }
  const lo = Math.min(detector.neutral, detector.resetLevel) - 0.2;
  const hi = detector.rise + 0.35;
  const norm = (v) => Math.max(0, Math.min(1, (v - lo) / (hi - lo)));
  gaugeFill.style.height = `${norm(detector.lift) * 100}%`;
  gaugeFill.className = "gauge-fill" + (detector.state === "ARMED" ? " armed" : "");
  gaugeMark.style.bottom = `${norm(detector.rise) * 100}%`;
}

let lastT = performance.now();
function loop(now) {
  const dt = (now - lastT) / 1000;
  lastT = now;

  let pauseReason = null;

  if (NO_CAM) {
    pauseReason = null;
  } else if (fatal) {
    pauseReason = ["CAMERA UNAVAILABLE", fatal, true];
  } else if (!ready) {
    pauseReason = ["LOADING", "Starting camera and loading the pose model…"];
  } else {
    // 1. Pose
    const newFrame = tracker.update(now);
    const stable = tracker.stableCount;
    if (newFrame && headHold.update(stable === 1 ? tracker.smoothed : null, now, tracker.aspect)) {
      autopilot = !autopilot;
    }

    // Re-learn the neutral pose if a (possibly new) player steps in after a gap.
    if (stable !== 1 && prevStable === 1) lostAt = now;
    if (stable === 1 && prevStable !== 1 && lostAt !== null && now - lostAt > RECAL_AFTER_LOST_MS) {
      detector.recalibrate();
    }
    prevStable = stable;

    // 2. Gesture (only while exactly one person is stably tracked)
    if (stable === 1) {
      const { flap } = detector.update(tracker.smoothed, now, tracker.aspect);
      if (!detector.calibrated) {
        pauseReason = ["HOLD STILL", "Calibrating… stand naturally with your hands down"];
      } else if (flap && !autopilot) {
        // On autopilot the detector still runs (so the gauge keeps moving and
        // the hold-to-toggle still works) but arm flaps control nothing.
        game.flap(now);
      }
    } else if (stable >= 2) {
      pauseReason = ["TOO MANY PEOPLE", "Game paused until only one player is in view", true];
    } else {
      pauseReason = ["NO PLAYER", "Step in front of the camera"];
    }

    // camera panel status line
    const n = tracker.rawCount;
    const label = stable >= 2 ? `${n} people – paused` : stable === 1 ? "1 player" : "no player";
    const dbg = DEBUG
      ? ` · lift ${detector.lift?.toFixed(2) ?? "–"} · head ${headHold.debug} ${Math.round(headHold.progress * 100)}%${autopilot ? " · AUTO" : ""}`
      : "";
    setCamStatus(
      `${label} · ${tracker.fps} fps · ${detector.calibrated ? detector.state : "calibrating"}${dbg}`,
      stable >= 2 ? "bad" : stable === 1 ? "good" : ""
    );
    updateGauge();
  }

  // 3. Game
  game.paused = pauseReason !== null;
  if (pauseReason) showOverlay(...pauseReason); else hideOverlay();
  titleA.classList.toggle("auto", autopilot);
  if (autopilot) autopilotStep(game, now);
  game.update(dt, now);
  game.draw();

  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

(async () => {
  if (NO_CAM) { setCamStatus("camera disabled (?nocam)"); return; }
  try {
    setCamStatus("Loading pose model…");
    await tracker.init();
    setCamStatus("Starting camera…");
    await tracker.startCamera();
    ready = true;
  } catch (err) {
    console.error(err);
    fatal = err?.message || String(err);
    setCamStatus("Camera / model failed – see console", "bad");
  }
})();
