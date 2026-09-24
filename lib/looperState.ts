export type LooperState =
  | "idle"
  | "countdown"
  | "recording"
  | "playing"
  | "overdubbing"
  | "paused"
  | "stopped"
  | "error";

export type LooperAction =
  | "record" // idle: start (count-in or direct); countdown: cancel; recording: stop / create loop
  | "countdownDone"
  | "tooShort" // recording ended under the minimum length
  | "overdub" // playing: start; overdubbing: stop
  | "play"
  | "pause"
  | "stop"
  | "undo"
  | "import" // add audio files as layers (the first becomes the loop if none exists)
  | "clear"
  | "inputLost"
  | "fail"
  | "recover";

export interface TransitionContext {
  countIn: number;
  overdubs: number;
}

/** Returns the next state, or null when the action is not allowed in `state`. */
export function transition(
  state: LooperState,
  action: LooperAction,
  ctx: TransitionContext,
): LooperState | null {
  if (action === "fail") return "error";

  switch (state) {
    case "idle":
      if (action === "record") return ctx.countIn > 0 ? "countdown" : "recording";
      if (action === "import") return "stopped"; // loop is ready; Play starts it
      return null;
    case "countdown":
      if (action === "record" || action === "inputLost") return "idle";
      if (action === "countdownDone") return "recording";
      return null;
    case "recording":
      if (action === "record" || action === "inputLost") return "playing";
      if (action === "tooShort") return "idle";
      return null;
    case "playing":
      if (action === "overdub") return "overdubbing";
      if (action === "pause") return "paused";
      if (action === "stop") return "stopped";
      if (action === "undo") return ctx.overdubs > 0 ? "playing" : null;
      if (action === "import") return "playing";
      if (action === "clear") return "idle";
      return null;
    case "overdubbing":
      if (action === "overdub" || action === "inputLost") return "playing";
      return null;
    case "paused":
    case "stopped":
      if (action === "play") return "playing";
      if (action === "stop" && state === "paused") return "stopped";
      if (action === "undo") return ctx.overdubs > 0 ? state : null;
      if (action === "import") return state;
      if (action === "clear") return "idle";
      return null;
    case "error":
      return action === "recover" ? "idle" : null;
  }
}
