# Portfolio site (JD)

Static, hardened, edge-hosted personal portfolio for jarrettd.com. The plan (stack, hardening, phases) is kept outside this repo in the "Portfolio Site Roadmap" sheet; if you need it, ask the owner for the file. The look-and-feel prototype is a separate project, `portfolio-prototype`, in the same parent folder.

## Hard rules

- Static output only. No server code, database, login, admin panel, forms or analytics.
- No third-party requests at runtime: self-host fonts, no CDNs, no embeds, no trackers, no cookies.
- The Content Security Policy stays strict: no inline scripts or styles, no `eval`, `script-src 'self'`. If a change needs a CSP exception, stop and ask.
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
- `check:dist` fails on inline script or style, `style=` and `on*=` attributes, forms and embeds, off-site or missing resources, a home page over 14 KB (decimal), a first load over 100 KB, and a sitemap that lists the 404 page, lists an unbuilt page or omits a built one. The word "placeholder" in a page only warns for now; make it a failure before launch.
- Tests are plain `.mjs` on purpose: `@types/node` is not installed, so they are not type-checked.
- The header check for the deployed site is not here yet (Phase 5).
