/**
 * The lazy footer arcade. It is a separate file that the page script requests only after a real
 * visitor has the footer in reach (see lazy.ts), so it is never part of the first load. It must
 * not pull in any other module: the build check lets this file say export but never import, so
 * everything it needs arrives through the env argument.
 */

import type { ArcadeEnv } from "./lazy.ts";

export function initArcade(env: ArcadeEnv): void {
  // Plumbing only for now: mark the footer so tests and the console can see the chunk ran.
  env.footer.dataset.arcade = "ready";
}
