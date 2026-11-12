/**
 * The one script the site ships. Loaded as a deferred module, so it never blocks
 * first paint. Every effect is decorative and degrades to the static page. The
 * card glow is plain CSS and needs none of this.
 */

import { initBar } from "./bar.ts";
import { initHero } from "./hero.ts";
import { initLazy } from "./lazy.ts";
import { initMotion, isMotionOn, setMotionOn, subscribe } from "./motion-state.ts";
import { initSettings } from "./settings.ts";

initMotion();
// Only the home page hides its header bar. The other pages are built with bar-on already on
// <html> (Base.astro), so the bar is showing and there is nothing for the bar script to decide.
if (!document.documentElement.classList.contains("bar-on")) initBar();
initSettings({ isOn: isMotionOn, set: setMotionOn });
initHero(subscribe);
initLazy(() => import("./arcade.ts"), { isOn: isMotionOn, subscribe });
