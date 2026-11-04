import assert from "node:assert/strict";
import { test } from "node:test";
import {
  easeToward,
  FRAME_SLACK,
  frameDelta,
  frameDue,
  MAX_DT,
  motionMode,
  nextDeadline,
  parseMotionPref,
  targetFps,
} from "../src/lib/motion.ts";

test("a stored preference is only off when it says exactly off", () => {
  for (const raw of [null, undefined, "", "on", "ON", "OFF", "true", "0", "garbage"]) {
    assert.equal(parseMotionPref(raw), "on", String(raw));
  }
  assert.equal(parseMotionPref("off"), "off");
});

// [motionOn, reducedMotion, canHover] -> ambient, reactive, fades, edgeFade, ambientFps, reactiveFps
const table = [
  [
    true,
    false,
    true,
    {
      ambient: true,
      reactive: true,
      fades: true,
      edgeFade: true,
      ambientFps: 30,
      reactiveFps: 60,
    },
  ],
  [
    true,
    true,
    true,
    {
      ambient: true,
      reactive: false,
      fades: false,
      edgeFade: false,
      ambientFps: 30,
      reactiveFps: 30,
    },
  ],
  [
    true,
    false,
    false,
    {
      ambient: true,
      reactive: false,
      fades: true,
      edgeFade: true,
      ambientFps: 30,
      reactiveFps: 30,
    },
  ],
  [
    true,
    true,
    false,
    {
      ambient: true,
      reactive: false,
      fades: false,
      edgeFade: false,
      ambientFps: 30,
      reactiveFps: 30,
    },
  ],
  [
    false,
    false,
    true,
    {
      ambient: false,
      reactive: false,
      fades: false,
      edgeFade: true,
      ambientFps: 30,
      reactiveFps: 30,
    },
  ],
  [
    false,
    true,
    true,
    {
      ambient: false,
      reactive: false,
      fades: false,
      edgeFade: false,
      ambientFps: 30,
      reactiveFps: 30,
    },
  ],
  [
    false,
    false,
    false,
    {
      ambient: false,
      reactive: false,
      fades: false,
      edgeFade: true,
      ambientFps: 30,
      reactiveFps: 30,
    },
  ],
  [
    false,
    true,
    false,
    {
      ambient: false,
      reactive: false,
      fades: false,
      edgeFade: false,
      ambientFps: 30,
      reactiveFps: 30,
    },
  ],
];

for (const [motionOn, reducedMotion, canHover, expected] of table) {
  test(`mode: motion ${motionOn ? "on" : "off"}, reduced ${reducedMotion}, can hover ${canHover}`, () => {
    assert.deepEqual(motionMode({ motionOn, reducedMotion, canHover }), expected);
  });
}

test("reduced motion never gets cursor reaction or fades, but keeps the symbols moving", () => {
  for (const canHover of [true, false]) {
    const mode = motionMode({ motionOn: true, reducedMotion: true, canHover });
    assert.equal(mode.ambient, true);
    assert.equal(mode.reactive, false);
    assert.equal(mode.fades, false);
  }
});

test("fades are off exactly when motion is off or reduced, which is when the page gets .no-fx", () => {
  for (const motionOn of [true, false]) {
    for (const reducedMotion of [true, false]) {
      for (const canHover of [true, false]) {
        const { fades } = motionMode({ motionOn, reducedMotion, canHover });
        assert.equal(fades, motionOn && !reducedMotion);
      }
    }
  }
});

test("the ambient drift is capped at 30 fps in every mode, on every device", () => {
  for (const motionOn of [true, false]) {
    for (const reducedMotion of [true, false]) {
      for (const canHover of [true, false]) {
        assert.equal(motionMode({ motionOn, reducedMotion, canHover }).ambientFps, 30);
      }
    }
  }
});

test("60 fps is only available where the cursor can react, and only while it is reacting", () => {
  for (const motionOn of [true, false]) {
    for (const reducedMotion of [true, false]) {
      for (const canHover of [true, false]) {
        const mode = motionMode({ motionOn, reducedMotion, canHover });
        const canReact = motionOn && canHover && !reducedMotion;
        assert.equal(mode.reactiveFps, canReact ? 60 : 30);
        assert.equal(targetFps(mode, false), 30, "idle drift is 30 fps");
        assert.equal(targetFps(mode, true), canReact ? 60 : 30);
      }
    }
  }
});

test("desktop with motion allowed runs at 30 fps until the cursor reacts, then 60", () => {
  const mode = motionMode({ motionOn: true, reducedMotion: false, canHover: true });
  assert.equal(targetFps(mode, false), 30);
  assert.equal(targetFps(mode, true), 60);
});

test("the hero's outer columns fade in unless reduced motion is on, whatever the toggle says", () => {
  for (const motionOn of [true, false]) {
    for (const reducedMotion of [true, false]) {
      for (const canHover of [true, false]) {
        const { edgeFade } = motionMode({ motionOn, reducedMotion, canHover });
        assert.equal(edgeFade, !reducedMotion);
      }
    }
  }
});

// ---- the frame limiter ---------------------------------------------------------

/**
 * Replays a display refreshing at `hz` the way hero.ts uses the limiter: each frame,
 * draw if it is due, then move the deadline on. `fpsAt(seconds)` gives the cap then.
 */
function replay(hz, fpsAt, seconds = 20, { jitter = 0, stall } = {}) {
  const period = 1000 / hz;
  const draws = [];
  let deadline = 0;
  for (let frame = 1; frame * period <= seconds * 1000; frame++) {
    let now = frame * period + Math.sin(frame * 12.9898) * jitter;
    if (stall && now > stall.at) now += stall.length;
    if (!frameDue(now, deadline)) continue;
    deadline = nextDeadline(deadline, now, fpsAt(now / 1000));
    draws.push(now);
  }
  return draws;
}
const rate = (draws, from, to) =>
  draws.filter((t) => t >= from * 1000 && t < to * 1000).length / (to - from);

for (const hz of [50, 60, 75, 90, 120, 144, 165]) {
  for (const cap of [30, 60]) {
    test(`on a ${hz} Hz display a ${cap} fps cap averages ${Math.min(cap, hz)} fps and never exceeds the cap`, () => {
      const draws = replay(hz, () => cap, 20);
      const average = draws.length / 20;
      assert.ok(Math.abs(average - Math.min(cap, hz)) < 0.6, `${average} fps`);
      assert.ok(average <= cap + 0.6);
    });
  }
}

test("the old reset-to-now limiter undershot where the refresh does not divide the rate", () => {
  // What hero.ts did before: drift from `now`, so every frame pays the whole refresh gap.
  const legacy = (hz, fps) => {
    let last = 0;
    let draws = 0;
    for (let now = 1000 / hz; now <= 10000; now += 1000 / hz) {
      if (now - last < 1000 / fps - 2) continue;
      last = now;
      draws++;
    }
    return draws / 10;
  };
  assert.ok(legacy(75, 30) < 26, "75 Hz at 30 fps");
  assert.ok(legacy(144, 60) < 50, "144 Hz at 60 fps");
  assert.ok(replay(75, () => 30, 10).length / 10 > 29.5);
  assert.ok(replay(144, () => 60, 10).length / 10 > 59.5);
});

test("timestamp jitter does not lose or double frames", () => {
  for (const [hz, cap] of [
    [60, 30],
    [144, 60],
    [75, 30],
  ]) {
    const average = replay(hz, () => cap, 20, { jitter: 1.5 }).length / 20;
    assert.ok(Math.abs(average - cap) < 1, `${hz} Hz, ${cap} fps: ${average}`);
  }
});

test("after a stall the limiter restarts instead of drawing a burst to catch up", () => {
  const draws = replay(60, () => 30, 12, { stall: { at: 4000, length: 5000 } });
  const afterStall = draws.filter((t) => t > 9000);
  for (let i = 1; i < afterStall.length; i++) {
    assert.ok(afterStall[i] - afterStall[i - 1] > 30, `burst at ${afterStall[i]}`);
  }
  assert.ok(Math.abs(rate(draws, 9.5, 12) - 30) < 1.5);
});

test("raising the cap mid-run (the cursor arrives) takes effect within a frame or two", () => {
  const draws = replay(120, (seconds) => (seconds < 4 ? 30 : 60), 8);
  assert.ok(Math.abs(rate(draws, 1, 4) - 30) < 1, "before");
  assert.ok(Math.abs(rate(draws, 4.5, 8) - 60) < 1.5, "after");
  const lowering = replay(120, (seconds) => (seconds < 4 ? 60 : 30), 8);
  assert.ok(Math.abs(rate(lowering, 4.5, 8) - 30) < 1.5, "back down");
});

test("nextDeadline moves on from the old deadline, and restarts from now when behind", () => {
  // On time: the next deadline is the old one plus an interval, not "now" plus one.
  assert.equal(nextDeadline(100, 101, 30), 100 + 1000 / 30);
  assert.equal(nextDeadline(0, 16, 30), 1000 / 30);
  // Behind (an interval or more late): restart from now rather than burst to catch up.
  assert.equal(nextDeadline(100, 130, 60), 130 + 1000 / 60);
  assert.equal(nextDeadline(100, 500, 30), 500 + 1000 / 30);
});

test("a frame is due once it is within FRAME_SLACK ms of its deadline", () => {
  assert.equal(frameDue(99, 100), true);
  assert.equal(frameDue(100 - FRAME_SLACK, 100), true);
  assert.equal(frameDue(100 - FRAME_SLACK - 0.01, 100), false);
  assert.equal(frameDue(250, 100), true);
});

test("frameDelta is in seconds and clamped to [0, MAX_DT]", () => {
  assert.ok(Math.abs(frameDelta(1016, 1000) - 0.016) < 1e-12);
  assert.equal(frameDelta(5000, 1000), MAX_DT);
  assert.equal(frameDelta(1000, 1000), 0);
  assert.equal(frameDelta(900, 1000), 0);
});

test("easing gives the same result however the time is sliced", () => {
  const run = (steps) => {
    let value = 0;
    for (let i = 0; i < steps; i++) value = easeToward(value, 1, 0.09, 1 / steps);
    return value;
  };
  const reference = run(60);
  for (const steps of [1, 10, 30, 144, 240]) {
    assert.ok(Math.abs(run(steps) - reference) < 1e-9, `${steps} steps`);
  }
});

test("easing converges without overshooting, and a zero time constant jumps", () => {
  let value = 0;
  let last = 0;
  for (let i = 0; i < 200; i++) {
    value = easeToward(value, 1, 0.1, 1 / 60);
    assert.ok(value >= last && value <= 1);
    last = value;
  }
  assert.ok(value > 0.999);
  assert.equal(easeToward(0.2, 0.7, 0, 0.016), 0.7);
  assert.equal(easeToward(0.5, 0.5, 0.1, 0.016), 0.5);
});
