/**
 * The rule for loading the lazy chunk, with no DOM in it. The chunk is requested once, and
 * only when both are true: the footer is near the viewport and the visitor has really done
 * something (pressed, touched, wheeled or typed). A page that is only opened, or loaded by a
 * tool, never asks for it.
 */

export type Gate = {
  /** Tell the gate whether the footer is near the viewport right now. */
  setNear: (on: boolean) => void;
  /** Tell the gate a real visitor acted. */
  setActed: () => void;
};

export function createGate(open: () => void): Gate {
  let isNear = false;
  let hasActed = false;
  let done = false;
  const check = (): void => {
    if (isNear && hasActed && !done) {
      done = true;
      open();
    }
  };
  return {
    setNear(on) {
      isNear = on;
      check();
    },
    setActed() {
      hasActed = true;
      check();
    },
  };
}
