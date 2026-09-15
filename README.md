# floppy-standup

Flappy Bird you play with your body. A webcam + MediaPipe Pose watches you;
raise both hands above your shoulders to flap.

## Run

Browsers only allow camera access on `https://` or `localhost`, so serve the
folder rather than opening `index.html` directly:

```sh
python3 -m http.server 8000
# or: npx serve .
```

Then open <http://localhost:8000> in Chrome/Edge/Safari and allow the camera.
The pose model (~5 MB) and MediaPipe WASM are fetched from a CDN on first load.

## How it works

```
webcam frame → PoseLandmarker (up to 4 people) → count people (hysteresis)
             → One-Euro smoothing → hand-lift in torso units → flap state machine
             → FlappyGame.flap() → render game + skeleton
```

- `js/pose.js` – camera, MediaPipe, person counting, smoothing, skeleton drawing
- `js/gesture.js` – calibration + ARMED/FIRED flap detector with hysteresis
- `js/game.js` – the Flappy Bird game (canvas, original colour palette)
- `js/main.js` – wiring, overlays (TOO MANY PEOPLE / NO PLAYER / HOLD STILL)

Controls: raise both hands to flap; lower them to re-arm. `Space` flaps from the
keyboard, `C` re-runs the 1.5 s neutral-pose calibration.
