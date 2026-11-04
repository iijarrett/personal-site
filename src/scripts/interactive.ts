/**
 * The one script the site ships. Loaded as a deferred module, so it never blocks
 * first paint. Every effect is decorative and degrades to the static page. The
 * card glow is plain CSS and needs none of this.
 */

import { initHero } from "./hero.ts";
import { initMotion, isMotionOn, setMotionOn, subscribe } from "./motion-state.ts";
import { initSettings } from "./settings.ts";

initMotion();
initSettings({ isOn: isMotionOn, set: setMotionOn });
initHero(subscribe);
