# RiffLoop Development Guide

## 1. Product Reference

`product.md` is the source of truth for what RiffLoop should do.

This document is the source of truth for **how RiffLoop should be developed**.

Do not expand the product beyond the requirements in `product.md` unless explicitly requested.

---

## 2. Tech Stack

Use:

* Next.js 16+
* React
* TypeScript
* App Router
* Tailwind CSS
* Web Audio API
* AudioWorklet for input capture
* MediaDevices API for audio input
* ESLint
* pnpm

RiffLoop should be primarily client-side.

Do not introduce a backend, database, authentication, or external API for the MVP.

Since there is no backend, the app can be built as a static export (`output: 'export'`). Audio code runs only in the browser: guard or lazy-load anything that touches `window`, `AudioContext`, or `navigator.mediaDevices` so server rendering does not break.

Target browsers: current desktop Chrome, Edge, Firefox, and Safari. Mobile is best-effort for the MVP.

---

## 3. Core Engineering Principle

RiffLoop is an **interactive real-time audio application**, not a normal web application.

Priorities:

1. Reliable audio timing
2. Low latency
3. Clean loop transitions
4. Simple user experience
5. Maintainable code
6. Visual polish

Audio correctness is more important than UI complexity.

---

## 4. Audio Architecture

Keep the audio engine separate from React UI.

Conceptually:

```text
Audio Input
    ↓
MediaStream
    ↓
AudioContext
    ↓
Audio Engine
    ↓
Loop / Layer Playback
    ↓
Output
```

The audio engine should own:

* AudioContext
* Input stream
* Recording
* AudioBuffers
* Master loop
* Overdub layers
* Playback scheduling
* Volume
* Audio nodes

React should primarily control and display application state.

---

## 5. Timing

The **Web Audio clock** must be the source of truth for audio timing.

Do NOT use:

```text
setInterval()
setTimeout()
React rendering
```

to synchronize actual audio playback.

UI updates (progress indicator, elapsed time) should use `requestAnimationFrame` and read `AudioContext.currentTime`, so the display follows the audio clock instead of keeping its own.

The master loop determines the canonical loop duration.

All overdubs must synchronize to the master loop.

Recommended playback approach: give every layer a buffer of exactly the master length, and play each through an `AudioBufferSourceNode` with `loop = true`, all started at the same scheduled `AudioContext` time. This is gapless and cannot drift, because the audio thread handles the repeating. Do not re-trigger each pass from JavaScript.

Capture input with an AudioWorklet, which receives samples on the audio thread, stamped with the audio clock, and posts them to the main thread. Do not use `MediaRecorder` for loop audio, because its timing is coarse and it produces compressed chunks, not samples.

Put the worklet processor as a plain JavaScript file in `public/worklets/` and load it with `audioContext.audioWorklet.addModule("/worklets/<name>.js")`. This avoids bundler-specific worklet handling and works with static export.

Record mono. Audio interfaces often expose two inputs, and the guitar may be on either one, so average all input channels into one instead of taking only channel 0.

Create all buffers at `audioContext.sampleRate`.

### Latency compensation (implemented)

Build the core MVP first without compensation: record, loop, overdub, undo, clear. Once it works end to end, add compensation as the last MVP step. Until then, write overdubs through a single function, so the rotation described below can be added in one place later.

What the guitarist hears is delayed by output latency, and what gets recorded is delayed by input latency:

```text
t            loop sample scheduled on the audio clock
t + out      sound reaches the guitarist        (output latency)
t + out      guitarist plays along
t + out + in note arrives in the audio engine   (input latency)
```

Without correction, every overdub is shifted late by the round-trip latency `L = out + in`, relative to the master. If the guitarist follows the previous overdub rather than the master, the error builds up from layer to layer. Flams become audible at around 10 ms.

The master loop needs no compensation. Nothing plays while it is recorded, so input latency shifts its start and end equally, and the length stays correct.

Typical round trip:

```text
Audio interface, small buffer   ~10–20 ms
Built-in mic + speakers         ~20–50 ms
Bluetooth headphones            ~150–300 ms  (warn the user; unusable for overdubbing)
```

**Estimating `L`:**

* Output: `AudioContext.outputLatency` where available (Chrome/Firefox, includes Bluetooth). Otherwise fall back to `baseLatency`, which covers only browser processing and underestimates.
* Input: browsers do not report this reliably (`track.getSettings().latency` is often 0 or wrong). Use a constant estimate (around 5–10 ms) defined in one place.
* First version: `L = outputLatency (or baseLatency) + INPUT_LATENCY_ESTIMATE`.

**Applying it (as implemented):** `writeOverdub` writes each captured block `L` frames earlier in the circular layer: `pos = frame - loopStartFrame - L`. The capture window itself is shifted `L` later, so a one-pass overdub still covers exactly one loop. This is equivalent to rotating the finished layer left by `L`, but needs no extra pass. `L = baseLatency + outputLatency + INPUT_LATENCY_SEC` (10 ms), computed when the overdub starts.

**Calibration (after MVP):** store `L` per input `deviceId` in `localStorage`, since each device has different latency. Options, best first:

1. Loopback click: play a click, record it back, detect the onset (a simple threshold works), and measure the delay. This measures the true round trip. It needs the mic to hear the speakers, or a cable from the interface output to its input.
2. Manual nudge: a ms slider the user adjusts until overdubbed clicks line up with the loop's clicks. Works with any setup.

Keep calibration off the main screen, so the interface stays minimal.

---

## 6. Master Loop

### Count-in

Schedule the count-in on the audio clock. When Record is pressed at time `t0`:

* Schedule one short tick per second, at `t0`, `t0 + 1`, … `t0 + N - 1`. A tick is an `OscillatorNode` through a `GainNode` with a quick envelope, which needs no audio files.
* Recording starts at `t0 + N`. The capture worklet discards any samples that arrive before that time.
* On cancel, stop the scheduled tick nodes.
* The on-screen countdown number is derived from `currentTime` in the `requestAnimationFrame` loop, like the other UI.
* Store the chosen count-in length in `localStorage`. Accept only whole seconds from 0 to 30.
* Overdubs use the same count-in. The loop sources stop, and new sources are scheduled to start at the count-in end with loop position 0, so the take starts at the top of the loop. The state is `overdubbing` from the moment Overdub is pressed, but samples before the count-in ends are ignored. Stopping during the count-in writes nothing, so no layer is added.

The first recording creates the master loop.

Example:

```text
User records 8 seconds
        ↓
Master loop = 8 seconds
        ↓
8s → 8s → 8s → 8s ...
```

Do not require the user to manually define the loop length.

The master loop must remain unchanged when overdubbing.

---

## 7. Overdub Architecture

Each overdub is an independent audio layer.

Conceptually:

```text
Master Loop
    +
Overdub 1
    +
Overdub 2
    +
Overdub 3
```

All layers use the master loop duration for synchronization.

Each overdub layer buffer is exactly the master loop length. Recorded samples are written at `(loop position) mod (loop length)`, so an overdub that starts mid-loop wraps around the loop end.

An overdub auto-ends after exactly one loop length of recording (`endFrame = startFrame + loop length`). About 150 ms before the end, the layer recorded so far is scheduled to start playing exactly at the end time, so the first notes of the layer are heard on the very next pass. The part still missing is the last 150 ms, which plays a whole loop later. By then, `stopOverdub` has swapped in the complete, faded layer. That swap is inaudible because the content is the same.

Each layer plays through its own `GainNode` (layer volume) into one output `GainNode`. Ducking during an overdub is scheduled on the output gain on the audio clock: down at the take start, back up at the loop point where the take ends. Cancelling or stopping early restores it immediately.

**Enhance** (switchable, `lib/audio/enhance.ts`): every layer is stored twice, raw and enhanced. The enhanced copy goes through a chain: 80 Hz high-pass; gentle noise gate (opens 10 dB above the take's noise floor, capped at -40 dBFS; closes 6 dB lower after a 100 ms hold; fades down ~150 ms to -12 dB; digital silence is ignored when measuring the floor); level match; 2:1 RMS compressor (30 ms attack, 400 ms release) that only touches loud strums; level match again (-20 dBFS RMS, peaks ≤ -1 dBFS). A unit test fails if the level ever drops faster than 1.5 dB per 20 ms, which guards against pumping and chopping. It is done offline in plain JS with no lookahead, so timing never shifts. Each stage runs twice around the loop so filter and envelope state wrap across the loop point. A convolver room reverb (generated impulse) is sent from the output bus. Turning Enhance on or off swaps buffers at a scheduled instant, and the raw takes are never modified.

Summing many layers can clip. Leave headroom on the output mix instead of adding a compressor or limiter that changes the guitar sound.

Undo removes only the most recent overdub.

Clear removes the entire session.

Prefer keeping layers as separate `AudioBuffer` objects rather than permanently destructively mixing them during the MVP.

---

## 8. Loop Boundaries

Pay special attention to the beginning/end of the loop.

Avoid:

* Audible gaps
* Timing drift
* Abrupt discontinuities
* Clicks caused by waveform boundaries

Where fades belong:

* Master loop: the end and start of the recording rarely meet smoothly. Apply a very short fade (a few ms) at both ends of the master buffer.
* Overdub layers: audio that wraps across the loop boundary is continuous, so no fade is needed there. Apply the short fade at the punch-in and punch-out points instead, where the overdub starts and stops mid-loop.

Keep fades as short as possible; they exist only to remove clicks.

Do not unnecessarily modify the guitar's sound.

---

## 9. Audio Context

Use a single appropriate `AudioContext` for the session.

Handle browser autoplay restrictions correctly.

Initialize/resume audio in response to user interaction when required.

Request input with browser voice processing turned off:

```ts
navigator.mediaDevices.getUserMedia({
  audio: {
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
  },
});
```

Input selection:

* List inputs with `navigator.mediaDevices.enumerateDevices()` (filter `kind === "audioinput"`). Device labels are empty until permission is granted, so enumerate again after the first `getUserMedia` call.
* Open the chosen device with `deviceId: { exact: id }` alongside the constraints above.
* Save the chosen `deviceId` in `localStorage`. If it is missing next time, fall back to the default input.
* Listen for `devicechange` to refresh the list and to detect when the selected device disconnects.
* Switching devices stops the old stream's tracks and reconnects the new stream to the audio engine. The loop and its layers are not affected. Disable switching while recording or overdubbing.

Input level meter:

* Connect the input source to an `AnalyserNode`. It is a side branch only and is never connected to the output.
* Each `requestAnimationFrame`, read `getFloatTimeDomainData()` and show the peak level. Hold the peak briefly so short transients remain visible.
* Show a clip warning when the peak is at or near 1.0 (0 dBFS).
* The meter keeps working in every state, including idle, so the user can check the input before recording.

Never use browser echo cancellation, even for speakers: it is designed for voice calls, and while the loop plays it ducks and chops the guitar, which degraded every overdub layer. Instead, Speakers mode removes bleed offline after each overdub (`lib/audio/bleed.ts`):

1. Render exactly what the speakers played during the take with an `OfflineAudioContext`: every layer at its volume, ducked, plus the Enhance reverb, over two passes so the reverb wraps around the loop.
2. Compute exact circular cross- and auto-correlations between the take and that reference with one large FFT.
3. Find where the bleed arrives: the cross-correlation peak, searched from -5 ms to +43 ms around the latency-compensated position.
4. Fit a short 8 ms filter (the speaker→mic path) there by least squares, solved with Levinson recursion. Keeping it short matters, because the guitar leaks into the fit in proportion to √(taps / loop length).
5. Subtract the filtered reference from the recorded part of the take.

On test signals, this removes about 22 dB of bleed on a 4 s loop, with 99.6% of the guitar kept, and more on longer loops. It is linear, so it never gates or ducks the guitar.

Do not play the live input to the output (software monitoring) by default. It adds latency, and with a microphone it causes feedback. Microphone users hear the acoustic sound directly, and interface users normally monitor through the interface itself.

Both microphone and audio-interface input are MVP. They use the same code path. The only difference is the device selected. Test both.

Handle:

* Insecure context (`getUserMedia` requires HTTPS or `localhost`)
* Permission denied
* No input device
* Disconnected input
* Unsupported browser
* Audio initialization failure

with useful user-facing messages.

---

## 10. Application State

Keep application states explicit.

Typical states:

```text
idle
countdown
recording
playing
overdubbing
paused
stopped
error
```

Do not allow invalid operations.

Allowed transitions:

```text
idle        → countdown            (Record; skipped straight to recording when count-in is 0)
countdown   → recording            (countdown finishes)
countdown   → idle                 (Record again: cancel)
recording   → playing              (Stop / Create Loop)
playing     → overdubbing          (Overdub)
overdubbing → playing              (Stop Overdub)
playing     → paused               (Pause)
playing     → stopped              (Stop)
paused      → playing              (Play, resume from same position)
stopped     → playing              (Play, from loop start)
recording   → idle                 (Stop, but recording under ~0.5 s: discard)
playing / paused / stopped → idle  (Clear, after confirmation)
any         → error                (fatal: unsupported browser, permission denied, AudioContext failure)
error       → idle                 (user retries successfully)
```

An input disconnect is not a fatal error. The loop needs no input to keep playing. `recording` or `overdubbing` ends as if Stop were pressed, and the user is asked to choose another input. Everything else stays in its current state.

Undo is allowed in `playing`, `paused`, and `stopped` when at least one overdub exists. It does not change the state.

This means, for example:

* Cannot overdub before a master loop exists.
* Cannot undo when no overdub exists.
* Cannot undo while overdubbing. Stop the overdub first.
* Cannot create a second master loop without clearing the session.

Keep the transition logic as a small pure function so it can be unit tested without audio.

---

## 11. Code Organization

Keep responsibilities separated.

Suggested structure:

```text
app/
components/
lib/
  audio/
  hooks/
  types/
```

Audio processing belongs inside `lib/audio`.

UI components should not directly contain complex audio-processing logic.

Avoid giant components.

Avoid unnecessary abstractions.

Avoid `any`.

---

## 12. UI Guidelines

RiffLoop should feel like a **digital guitar looper pedal**.

Use:

* Dark interface
* Large controls
* Clear state indicators
* Loop progress visualization
* Minimal configuration
* Responsive layout

The musician should be able to understand the interface while holding a guitar.

Avoid making it look like a DAW.

---

## 13. Keyboard Controls

Keyboard shortcuts are part of the MVP:

```text
Space → Play/Pause
R     → Record / Cancel countdown / Stop recording
O     → Overdub / Stop overdub
Z     → Undo
C     → Clear (press twice to confirm)
```

Keyboard shortcuts must not interfere with text fields.

A key that is not valid in the current state does nothing (for example, Space while overdubbing).

Call `preventDefault()` for handled keys. Otherwise Space also activates whichever button has focus, which triggers two actions.

---

## 14. Dependencies

Prefer browser-native APIs.

Before adding a dependency, ask:

> Does this solve a real problem that should not reasonably be handled by the platform?

Keep the dependency footprint small.

---

## 15. Testing

Test the important behavior:

* Audio input
* Input device selection and switching
* Input level meter (responds to input, shows clipping)
* Count-in (5 / 10 / custom, cancel)
* Recording
* Master loop creation
* Loop playback
* Overdub
* Multiple overdubs
* Undo
* Clear
* Play/pause
* Permission errors
* Production build
* Type checking
* Linting

Unit test the pure logic with a lightweight runner such as Vitest:

* State transitions (including countdown cancel)
* Overdub wrap-around and summing into a layer buffer
* Latency offset calculation (when the final MVP step lands)

Real audio input and output cannot be meaningfully unit tested. Audio behavior must be manually tested with a real guitar, through both a microphone and an audio interface. Once latency compensation lands, also run an overdub timing check: record a steady rhythm, overdub the same rhythm, and listen for flamming.

---

## 16. MVP Boundary

Do NOT implement yet:

* Authentication
* Database
* Cloud storage
* Social features
* Collaboration
* AI
* Advanced effects
* Full DAW functionality
* MIDI
* BPM synchronization
* Backing-track management

Design the code so these can be added later without rewriting the core audio engine.

---

## 17. Development Workflow

When working on RiffLoop:

1. Read `product.md`.
2. Read this `development.md`.
3. Inspect the existing implementation.
4. Make the smallest sensible change.
5. Run type checking/lint/build.
6. Test the affected functionality.
7. Fix problems before moving on.
8. Avoid unrelated changes.

Do not rewrite working code without a reason.

Do not build placeholder functionality and call it complete.

---

## 18. Definition of Done

A feature is complete when:

* It works in the browser.
* It follows `product.md`.
* It follows this development guide.
* TypeScript passes.
* Lint passes.
* Production build passes.
* Audio behavior has been manually verified where applicable.
* No obvious regression has been introduced.

---

## Guiding Principle

> **RiffLoop should disappear behind the music.**

The musician should focus on playing, not operating software.

