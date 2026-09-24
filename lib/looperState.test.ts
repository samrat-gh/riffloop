import { describe, expect, it } from "vitest";
import { transition } from "./looperState";

const ctx = { countIn: 5, overdubs: 0 };

describe("transition", () => {
  it("runs the main flow", () => {
    expect(transition("idle", "record", ctx)).toBe("countdown");
    expect(transition("countdown", "countdownDone", ctx)).toBe("recording");
    expect(transition("recording", "record", ctx)).toBe("playing");
    expect(transition("playing", "overdub", ctx)).toBe("overdubbing");
    expect(transition("overdubbing", "overdub", ctx)).toBe("playing");
    expect(transition("playing", "clear", ctx)).toBe("idle");
  });

  it("skips the countdown when count-in is 0", () => {
    expect(transition("idle", "record", { ...ctx, countIn: 0 })).toBe("recording");
  });

  it("cancels the countdown", () => {
    expect(transition("countdown", "record", ctx)).toBe("idle");
  });

  it("discards too-short recordings", () => {
    expect(transition("recording", "tooShort", ctx)).toBe("idle");
  });

  it("pauses, stops and resumes", () => {
    expect(transition("playing", "pause", ctx)).toBe("paused");
    expect(transition("paused", "stop", ctx)).toBe("stopped");
    expect(transition("stopped", "play", ctx)).toBe("playing");
    expect(transition("paused", "play", ctx)).toBe("playing");
  });

  it("allows undo only with overdubs and not while overdubbing", () => {
    expect(transition("playing", "undo", ctx)).toBeNull();
    expect(transition("playing", "undo", { ...ctx, overdubs: 1 })).toBe("playing");
    expect(transition("paused", "undo", { ...ctx, overdubs: 1 })).toBe("paused");
    expect(transition("overdubbing", "undo", { ...ctx, overdubs: 1 })).toBeNull();
  });

  it("rejects invalid actions", () => {
    expect(transition("idle", "overdub", ctx)).toBeNull();
    expect(transition("idle", "clear", ctx)).toBeNull();
    expect(transition("playing", "record", ctx)).toBeNull();
    expect(transition("overdubbing", "clear", ctx)).toBeNull();
    expect(transition("overdubbing", "pause", ctx)).toBeNull();
  });

  it("keeps the loop when the input is lost", () => {
    expect(transition("recording", "inputLost", ctx)).toBe("playing");
    expect(transition("overdubbing", "inputLost", ctx)).toBe("playing");
    expect(transition("countdown", "inputLost", ctx)).toBe("idle");
    expect(transition("playing", "inputLost", ctx)).toBeNull();
  });

  it("imports into a new or existing loop, never during a take", () => {
    expect(transition("idle", "import", ctx)).toBe("stopped");
    expect(transition("playing", "import", ctx)).toBe("playing");
    expect(transition("paused", "import", ctx)).toBe("paused");
    expect(transition("recording", "import", ctx)).toBeNull();
    expect(transition("overdubbing", "import", ctx)).toBeNull();
    expect(transition("countdown", "import", ctx)).toBeNull();
  });

  it("enters and leaves the error state", () => {
    expect(transition("playing", "fail", ctx)).toBe("error");
    expect(transition("error", "play", ctx)).toBeNull();
    expect(transition("error", "recover", ctx)).toBe("idle");
  });
});
