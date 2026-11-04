/**
 * Pure decisions and maths for the interactive effects. No DOM, no clock, so all
 * of it can be tested. The DOM glue lives in src/scripts/.
 */

export const MOTION_KEY = "motion";
export type MotionPref = "on" | "off";

/** Anything but a stored "off" means on, so a missing, blocked or corrupt value is safe. */
export function parseMotionPref(raw: string | null | undefined): MotionPref {
  return raw === "off" ? "off" : "on";
}

export interface MotionEnv {
  /** The footer toggle. */
  motionOn: boolean;
  /** prefers-reduced-motion: reduce. */
  reducedMotion: boolean;
  /** (hover: hover): the primary input can hover, the same test the tile glow uses. */
  canHover: boolean;
}

export interface MotionMode {
  /** The hero symbols keep changing by themselves. Off means the static frame. */
  ambient: boolean;
  /** The hero symbols react to the cursor. */
  reactive: boolean;
  /** Transitions may fade. When false the page gets .no-fx and every state switches instantly. */
  fades: boolean;
  /** The hero's outer columns fade in when the canvas first appears. Under reduced motion they are there at once. */
  edgeFade: boolean;
  /** Frame-rate ceiling for the ambient drift, on every device. */
  ambientFps: number;
  /** Ceiling while the cursor is reacting in the hero: 60 where reaction is allowed, else the same as ambient. */
  reactiveFps: number;
}

/** The ceiling right now: 60 only while the cursor is reacting in the hero. */
export function targetFps(mode: MotionMode, reacting: boolean): number {
  return reacting ? mode.reactiveFps : mode.ambientFps;
}

export function motionMode({ motionOn, reducedMotion, canHover }: MotionEnv): MotionMode {
  const reactive = motionOn && canHover && !reducedMotion;
  return {
    ambient: motionOn,
    reactive,
    fades: motionOn && !reducedMotion,
    edgeFade: !reducedMotion,
    ambientFps: 30,
    reactiveFps: reactive ? 60 : 30,
  };
}

/** The longest step the animation will take, so a returning tab does not jump. */
export const MAX_DT = 0.1;

/** Seconds since the last frame, clamped to [0, MAX_DT]. */
export function frameDelta(now: number, last: number): number {
  return Math.max(0, Math.min(MAX_DT, (now - last) / 1000));
}

/**
 * Exponential smoothing that gives the same result however the time is sliced:
 * one step of 1/30 s lands where two steps of 1/60 s do. `seconds` is the time
 * constant (about 63% of the way there after that long).
 */
export function easeToward(current: number, target: number, seconds: number, dt: number): number {
  if (seconds <= 0) return target;
  return target + (current - target) * Math.exp(-dt / seconds);
}

/** A frame timestamp can land this many ms before its deadline and still count as on time. */
export const FRAME_SLACK = 1;

/** Whether a frame at `now` (ms) is due, given the running deadline. */
export function frameDue(now: number, deadline: number): boolean {
  return now >= deadline - FRAME_SLACK;
}

/**
 * The deadline for the next frame after drawing at `now`. It advances from the
 * previous deadline, not from `now`, so a display that cannot hit the rate exactly
 * (75 Hz asked for 30 fps) alternates between close frames and still averages the
 * target instead of always overshooting to the next refresh. If a stall left it
 * behind, it restarts from `now` rather than drawing a burst to catch up.
 */
export function nextDeadline(deadline: number, now: number, fps: number): number {
  const interval = 1000 / fps;
  const next = deadline + interval;
  return next <= now ? now + interval : next;
}
