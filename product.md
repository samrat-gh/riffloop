# RiffLoop

## Product Overview

**RiffLoop** is a browser-based guitar looper that allows musicians to record a musical phrase, loop it continuously, and layer additional guitar parts on top of it.

The goal is to provide the core experience of a **physical guitar looper pedal** directly in the browser, using a microphone or audio interface connected to the user's computer.

RiffLoop is primarily designed for guitar practice, improvisation, songwriting, and experimenting with layered guitar parts.

---

## Core Concept

The fundamental workflow is:

**Record → Loop → Overdub → Repeat**

For example:

1. The guitarist records a 10-second chord progression.
2. RiffLoop automatically repeats that recording.
3. The guitarist plays a melody over it and records the melody as an overdub.
4. The guitarist adds another small guitar part.
5. All layers continue playing together as one repeating musical loop.

The first recording establishes the **master loop length**. Every subsequent layer must remain synchronized with that loop.

---

## Target User

RiffLoop is primarily for:

* Guitar players
* Musicians practicing alone
* Songwriters
* Guitarists experimenting with riffs and melodies
* Beginners learning looping and layering
* Musicians who want a simple alternative to a physical looper pedal

The product should feel useful while holding a guitar, meaning the interface must be simple enough to operate without constantly looking at the screen.

---

## Product Philosophy

### Simple

The user should understand the application immediately.

The primary interaction should be obvious:

> **Record something → let it loop → add something else.**

Do not overwhelm the user with professional audio-production features.

### Musical

RiffLoop should feel like a musical instrument rather than an audio-editing application.

The interface should communicate rhythm, timing, looping, and musical layers.

### Low Latency

Audio responsiveness is extremely important.

The system should prioritize reliable timing and low-latency audio playback over unnecessary visual effects or complex UI.

### Focused

RiffLoop is not intended to become a full DAW.

It should remain focused on the looping experience.

---

# Core Features

## 1. Microphone / Audio Input

RiffLoop must be able to record from either of two kinds of input. Both are fully supported in the MVP:

* **Microphone:** the computer's built-in microphone or a USB microphone, placed in front of an acoustic guitar or an amp. This needs no extra gear, so it is the easiest way to start.
* **Audio interface:** a guitar plugged directly into an audio interface. This is the cleaner option, with lower latency and no bleed.

The application should request microphone permission when required and clearly communicate the current input state.

The user can choose which input device to use. It defaults to the system's default input, and the last choice is remembered on the device. Switching input is only possible when not recording or overdubbing. If the selected device disconnects, the user is told and can pick another. The loop keeps playing. A recording or overdub in progress ends as if the user had stopped it.

A small input level meter shows the incoming signal at all times, so the user can see that the input is working and whether it is too quiet or clipping. It is not a mixer. There are no gain controls in the MVP; level is set on the microphone or interface.

Guitar input must not be altered by browser voice processing (echo cancellation, noise suppression, auto gain). These are designed for speech and damage guitar tone and sustain.

Headphones are recommended. When using a microphone with speakers, loop playback leaks back into the microphone and gets recorded into overdubs, so layers pile up copies of the earlier audio. The user chooses **Listening on: Headphones / Speakers** (remembered on the device). In Speakers mode, after each overdub RiffLoop removes the loop that leaked from the speakers into the take. It knows exactly what it played, so it can subtract it without touching the guitar. Browser echo cancellation is not used: it is built for voice calls and ducks and chops a guitar while the loop plays. Headphones mode keeps takes exactly as recorded and is the default.

---

## 2. Initial Recording

The user can press **Record** to begin recording their first guitar phrase.

The first recording becomes the **Master Loop**.

**Count-in:** pressing Record does not start recording right away. A countdown runs first, giving the guitarist time to get their hands back on the guitar:

* The countdown length is 5 seconds by default. The user can choose 5, 10, or a custom number of whole seconds (0–30, where 0 means start immediately).
* The choice is shown next to the Record button, can only be changed in Idle, and is remembered on the device.
* The countdown is shown large on screen, and a short, quiet tick sounds each second, so it can be followed without looking. Recording starts right after the last tick.
* Pressing Record again during the countdown cancels it and returns to Idle.
* The same count-in applies to overdubs. The loop stops during it so the ticks are clearly heard, then restarts from the top exactly when recording begins. With a count-in of 0, recording starts at once over the playing loop. Pressing Overdub again during the count-in cancels it: no layer is added and the loop resumes from the top.
* While recording or overdubbing, the elapsed time is shown.

This also keeps the sound of the key press or click out of the recording.

When the user finishes the phrase, they stop the recording.

A very short recording (under about half a second, usually an accidental double press) is discarded, and RiffLoop returns to idle.

The application should then immediately begin looping the recorded phrase.

Example:

```text
User plays:
| C | G | Am | F |

Record ends
       ↓

┌──────────────────────┐
│      MASTER LOOP     │
│       8 seconds      │
└──────────────────────┘
       ↓
   🔁 🔁 🔁 🔁
```

---

## 3. Continuous Loop Playback

Once the master loop has been created, it should continuously repeat.

The loop must:

* Restart accurately
* Maintain consistent timing
* Avoid noticeable gaps
* Avoid audible clicks where reasonably possible
* Avoid accumulating timing drift

The user should be able to clearly see where they currently are within the loop.

---

## 4. Overdub

While the master loop is playing, the user can record another guitar part.

For example:

```text
Layer 1
Chord progression
──────────────────── 🔁

Layer 2
Lead melody
──────────────────── 🔁

Layer 3
Small guitar fill
──────────────────── 🔁
```

All layers should remain synchronized to the master loop.

Overdubbing should feel immediate and natural.

Overdub behavior, like a physical looper pedal:

* An overdub can start anywhere in the loop, not only at the beginning.
* Every overdub layer has exactly the master loop length. Recording that passes the loop end wraps around to the loop start.
* An overdub records exactly one loop pass and then ends by itself. The guitarist never has to stop playing to press a button, and the new layer is heard from the very next pass. Pressing Overdub again ends it early.
* Each overdub creates one layer, which is what Undo removes. To add more, press Overdub again.
* There is no trimming or cutting of layers. That would turn RiffLoop into an audio editor (see Non-Goals). A layer that went wrong is removed with Undo and played again.
* Overdubs must line up with what the guitarist heard. Recording and playback latency must be compensated so the layer is not shifted late. This is the final MVP step, done once the core loop works (see `development.md`).

---

## 5. Multiple Layers

RiffLoop should support multiple overdub layers.

Each layer represents an additional musical recording.

Conceptually:

```text
Master Loop
    +
Overdub 1
    +
Overdub 2
    +
Overdub 3
    +
...
```

The user does not need to manually align the recordings.

RiffLoop handles synchronization automatically.

---

## 5a. Layer Volume

Each layer has its own volume slider (0–100%, default 100%), shown under the pedal once a loop exists. This is a simple balance control, not a mixer: no pan, EQ, or effects.

While an overdub records, the existing layers are automatically turned down (ducked), so the player hears the new part clearly and less of the loop leaks into a microphone. They return to full level at the loop point where the new layer joins.

---

## 5b. Enhance

A single Enhance switch (Off / On, remembered on the device) polishes the sound for players recording through a microphone:

* Turns down background noise (hiss, fan, room) between notes, and cuts low rumble and hum.
* Matches the level of every layer, so no layer is much louder than another.
* Adds light compression and a soft room reverb, so a laptop-mic guitar sounds fuller.

The original takes are always kept. Enhance can be switched off at any time to hear exactly what was recorded. There are no per-effect knobs; RiffLoop is not an effects unit.

---

## 5c. Import and Export

**Import:** audio files (anything the browser can decode, such as WAV, MP3 or M4A) can be added with an Import button or by dropping them anywhere on the page:

* With no loop yet, the first file becomes the loop and sets its length. The loop is then ready to play.
* Every other file becomes a new layer, fitted to the loop length (cut if longer, padded with silence if shorter). The user is told which files were fitted.
* Several files are imported in name order, so exported layers come back in their original order.
* Stereo files are mixed to mono, like recorded layers. Imported layers work like any other layer: volume, Undo, Enhance, export.
* Import is not possible during a count-in, recording, or overdub.

**Export:** the loop can be saved as audio files:

* **Export mix:** the whole loop as heard (layer volumes, Enhance, reverb), as a stereo WAV exactly one loop long, so it loops seamlessly in any player or DAW.
* **Layer download:** each layer on its own, as a mono WAV (a stem), at its volume and with Enhance if on. All stems have the loop's length, so they line up when stacked in an audio editor.

Files are 24-bit WAV, named with the date and time so exports don't overwrite each other.

---

## 6. Undo Overdub

The user should be able to remove the most recently recorded overdub.

Example:

```text
Master
  +
Overdub 1
  +
Overdub 2  ← Undo

Result:

Master
  +
Overdub 1
```

Undo should not affect the master loop or earlier layers.

---

## 7. Clear

The user can clear the entire session.

Clearing should remove:

* Master loop
* All overdubs
* Current playback state

After clearing, RiffLoop returns to its initial state and is ready for a new recording.

Because clearing is destructive and cannot be undone, it requires confirmation (for example, a second press or a press-and-hold).

---

## 8. Playback Controls

The user should have basic controls for:

* Play
* Pause
* Stop
* Record
* Overdub
* Undo
* Clear

Meaning:

* **Play** starts the loop, or resumes it after Pause.
* **Pause** halts playback and keeps the current loop position.
* **Stop** halts playback and returns to the loop start. The session is kept.

Controls should have clear visual states.

For example:

```text
IDLE
Record | Count-in: 5s ▾

COUNTDOWN
3… | Cancel

RECORDING
Stop / Create Loop

PLAYING
Overdub | Pause | Stop | Undo* | Clear

OVERDUBBING
Stop Overdub

PAUSED / STOPPED
Play | Undo* | Clear

* only when at least one overdub exists
```

The interface should avoid showing irrelevant controls when they cannot be used.

---

# Loop State Model

RiffLoop should conceptually operate through clear states.

### Idle

No loop exists.

```text
[ Record ]
```

### Countdown

Record was pressed and the count-in is running.

```text
3
Recording starts in…
```

### Recording

The first loop is being recorded.

```text
● Recording
00:07
```

### Playing

A master loop exists and is looping.

```text
▶ Playing
Loop: 00:08
```

### Overdubbing

A new layer is being recorded while the existing loop continues playing.

```text
● Overdubbing
Layer 2
```

### Paused

The loop is temporarily paused. Play resumes from the same position.

### Stopped

Playback has been stopped and the position is reset to the loop start. The loop and all layers still exist.

---

# Loop Visualization

The application should provide a visual representation of the current loop.

A simple circular or horizontal progress indicator can show:

```text
|────────────●────────|
0s                     8s
```

The indicator should continuously move from the beginning to the end of the loop and restart.

The visualization should help the musician understand timing without distracting from the actual music.

---

# User Interface

RiffLoop should have a **minimal, dark, musician-focused interface**.

It should resemble a modern digital looper pedal rather than an audio production dashboard.

### Important UI principles

* Large primary controls
* Clear recording/playing state
* Input level meter
* Minimal text
* High visual contrast
* Easy to operate while playing guitar
* Responsive layout
* Keyboard shortcuts for the main controls (see `development.md`)
* Avoid unnecessary panels and configuration

The primary interaction should fit naturally into one screen.

---

# Audio Architecture

RiffLoop is an interactive audio application, not simply an audio recorder.

The implementation should prioritize the **Web Audio API** and appropriate browser audio primitives for accurate playback scheduling and low latency.

Audio is captured and played back entirely through the Web Audio API, so that recording and playback share the same clock. `MediaRecorder` is not used for loop audio.

The architecture should separate:

### Audio Engine

Responsible for:

* Audio input
* Recording
* Loop creation
* Playback
* Overdubbing
* Synchronization
* Volume
* Audio scheduling

### Application State

Responsible for:

* Current application mode
* Loop existence
* Layer information
* Playback state
* Recording state

### UI

Responsible for:

* Controls
* Visual feedback
* Loop progress
* Status indicators
* User interaction

The audio engine should not be tightly coupled to React UI state.

---

# Technology Direction

Preferred stack:

* **Next.js**
* **TypeScript**
* **Tailwind CSS**
* **Web Audio API**
* React

Additional libraries may be introduced when they solve a real technical problem, particularly around audio processing, but unnecessary dependencies should be avoided.

RiffLoop should run primarily in the browser without requiring a backend for its core looping functionality.

---

# Future Features

These are intentionally **not part of the initial MVP**, but the architecture should avoid making them unnecessarily difficult later.

Potential future capabilities include:

* Metronome
* BPM detection
* Tempo control
* Quantization
* Tap tempo
* Save/load sessions
* Multiple independent loop tracks
* Redo
* MIDI foot-controller support
* Input/output volume controls
* Basic effects (beyond Enhance)
* Guitar tuner

Future features should not complicate the core looping experience.

---

# Non-Goals

RiffLoop is **not** intended to be:

* A full DAW
* A multitrack music production suite
* A professional audio editor
* A complex mixing console
* A social music platform
* A music streaming application

If a feature does not directly improve the experience of **recording, looping, and layering musical ideas**, it should be questioned before being added.

---

# MVP Definition

The MVP is successful when a guitarist can:

1. Open RiffLoop.
2. Select their input: a microphone, or a guitar through an audio interface.
3. Press **Record**.
4. Play a guitar phrase.
5. Finish the phrase.
6. Have RiffLoop automatically repeat it.
7. Press **Overdub**.
8. Play another guitar part.
9. Hear both parts looping together.
10. Undo the latest overdub.
11. Clear the session.
12. Start again.

Final MVP step, once the above works: overdubs line up in time with the loop (latency compensation).

The experience should feel close to using a **simple physical looper pedal**, while remaining accessible through a web browser.

---

# Guiding Principle

> **RiffLoop should disappear behind the music.**

The musician should spend their attention on playing guitar, not operating software.

Every design and technical decision should be evaluated against this principle.

