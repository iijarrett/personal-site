# Personal site (JD)

Static, hardened, edge-hosted personal portfolio for jarrettd.com. The plan (stack, hardening, phases) is kept outside this repo in the "Portfolio Site Roadmap" sheet; if you need it, ask the owner for the file. The look-and-feel prototype is a separate project, `personal-prototype`, in the same parent folder.

## Hard rules

- Static output only. No server code, database, login, admin panel, forms or analytics.
- No third-party requests at runtime: self-host fonts, no CDNs, no embeds, no trackers, no cookies.
- The Content Security Policy stays strict: no inline scripts or styles, no `eval`, `script-src 'self'`. If a change needs a CSP exception, stop and ask.
- Inline `style` attributes in markup are forbidden (they need `style-src 'unsafe-inline'`). Setting a property through the CSSOM from an external script, such as `el.style.setProperty("--x", "1")`, is allowed: the CSP does not restrict it.
- No new dependency without asking. Pin exact versions, commit the lockfile, install with `npm ci --ignore-scripts`.
- Never commit secrets, tokens, real IP addresses, personal file paths or graded USD coursework. Never read or print `.env*` files.
- No write-ups of active Hack The Box machines.
- Budget: home page HTML under 14 KB, total first load under 100 KB, Lighthouse 100.
- Accessibility: everything reachable by keyboard, visible focus, honour `prefers-reduced-motion`, and the page works with JavaScript off (the ASCII hero ships as a static frame first).

## Design

Tokyo Night. Dark background `#16161e` / `#1a1b26`, one accent purple `#bb9af7`. Light mode uses Tokyo Night Day with accent `#9854f1`. IBM Plex Sans for text, JetBrains Mono for labels and code, both self-hosted.
Original code only. openclaw.ai is inspiration; do not copy its code, mascot or layout.

## Workflow

- One branch per task. `main` is protected and changes go in through a pull request.
- Every change is reviewed before it merges, and only one person edits a branch at a time.
- Small commits with clear messages.
- Run the checks (build, lint, tests, header check) before saying a task is done.
- Commit only after `npm run verify` exits 0. Chain commit after verify with `&&`.
- Run npm run verify bare, never piped or tailed, so its exit code is real.

## Commands

Needs Node `>=22.23.4` and Python 3 (standard library only). Run everything from the repo root.

| Command                   | What it does                                                                                    |
| ------------------------- | ----------------------------------------------------------------------------------------------- |
| `npm ci --ignore-scripts` | Install from the lockfile. Never plain `npm install`, and ask before adding a dependency.       |
| `npm run dev`             | Dev server at `http://localhost:4321`.                                                          |
| `npm run check`           | `astro check`: types for `.astro` files and the content schemas.                                |
| `npm run lint`            | `biome ci .`: lint and format check, fails on any diff.                                         |
| `npm run format`          | `biome format --write .`: apply the formatting.                                                 |
| `npm test`                | `node --test tests/`: unit tests, including `scripts/check_dist.py` against fixture builds.     |
| `npm run build`           | Static build into `dist/`.                                                                      |
| `npm run check:dist`      | `python scripts/check_dist.py`: rules and budgets on `dist/` (see below).                       |
| `npm run preview`         | Serve `dist/` locally. It ignores `_headers`.                                                   |
| `npm run verify`          | `check`, `lint`, `test`, `build`, `check:dist` in order. Run this before saying a task is done. |

Notes:

- Run local binaries as `npx --no-install <tool>`, never bare `npx`, so nothing is fetched from the network.
- Set `ASTRO_TELEMETRY_DISABLED=1` in your shell so Astro sends no telemetry.
- `check:dist` fails on inline script or style, `style=` and `on*=` attributes, forms and embeds, `data:` URLs, any `.js` that mentions `eval`, `Function` (the bare word, so aliases and `Function?.(` trip too), `fetch`, `XMLHttpRequest`, `WebSocket`, `sendBeacon`, `document.cookie` (also `document["cookie"]`), `createElement("script")`, `innerHTML`/`outerHTML`/`insertAdjacentHTML`, `document.write`, an absolute `http(s)://` URL or a protocol-relative `//host` URL (no allowlist), or contains the word `import` (except `import.meta`) or the word `export` (see below), off-site or missing resources, a home page over 14 KB (decimal), a first load over 100 KB (it follows CSS `@import`/`url()` chains, counting each file once), all JS over 10,000 bytes or all CSS over 12,000 bytes (built, uncompressed, totals), and a sitemap that lists the 404 page, lists an unbuilt page or omits a built one. The word "placeholder" in a page only warns for now; make it a failure before launch.
- The JS checks in `check:dist` are a tripwire, not a sandbox. They are regular expressions over the built text, with no parser, so obfuscated or computed-member tricks (string concatenation, `window["fe"+"tch"]`) are out of scope. The CSP is the real enforcement. If a build trips a pattern, change the code, not the list.
- Until the game phase, built JS is single-file, with no imports and no exports. The one exception is `public/theme-init.js`: a tiny classic script in the head that adds the `js` class to `<html>` and applies a saved light theme, both before first paint, because the CSP forbids the inline script that would normally do it. The `js` class is what lets the CSS hide the header on scroll, so without JavaScript the header is always visible. It is a second file, but it is self-contained, follows every rule below and counts toward the JS total. It is copied unhashed, so the Phase 5 headers must make it revalidate. Both rules are about the word, not the syntax: any whole-word `import` in built JS fails, except `import.meta`, and any whole-word `export` fails, with no exception. They do not try to read binding names or tell a static import from a dynamic `import(` or a re-export, so Unicode names (`import π from "./m.js"`), `export * from "./m.js"`, `export default`, comments, line breaks and odd spacing cannot slip past. They also cannot tell a statement from a string, comment, object key or property, so anything that merely says either word fails too (`const help = 'Use import "./x.js";'`, `// export the data`, `{ import: 1 }`, `o.export`); reword it. Words that only contain the letters (`important`, `reimport`, `imports`, `exports`, `reexport`, `_export`) pass. There is no separate re-export rule: a re-export has to say `export`. So each script is one self-contained file, the first load has no JS module graph to follow, and the checker does not follow one. Revisit with a real tokenizer when the game needs modules or lazy loading, and decide the lazy-load approach then.
- Tests are plain `.mjs` on purpose: `@types/node` is not installed, so they are not type-checked.
- The header check for the deployed site is not here yet (Phase 5).
