---

title: A Content Security Policy with no exceptions
summary: How this site runs on `default-src 'none'`, what that ruled out and how the build enforces it.
date: 2026-11-15
platform: Personal project
tags: [csp, headers, web]
---

A Content Security Policy tells the browser what a page may load and run. Most policies grow
exceptions until they protect very little. This site started with none and keeps it that way.

## The policy

- `default-src 'none'` denies everything that is not named below.
- `script-src`, `style-src`, `img-src`, `font-src` and `connect-src` are each `'self'`: the
  site's own origin and nothing else.
- `base-uri 'none'`, `form-action 'none'` and `frame-ancestors 'none'` stop base-tag tricks,
  form posts to other sites and framing.
- `upgrade-insecure-requests` and `require-trusted-types-for 'script'` upgrade plain links and
  force DOM-touching scripts through Trusted Types.

Everything is denied by default, and each type of resource is then allowed from the site's
own origin only.

## What it ruled out

- Inline scripts and styles. The theme setting that needs to run before the page paints lives
  in its own small file.
- Third-party fonts, analytics and embeds. The fonts are self-hosted and checked against
  checksums in the repository.
- `eval` and similar tricks, in my own code as well as in dependencies.

## Keeping it that way

A policy that can quietly weaken is not much of a control, so the build checks it. A script
scans the built pages and fails on an inline script or style, a `style` attribute, an event
handler, a form, an iframe, a resource that points off-site, or code that mentions `eval`,
`fetch` or `innerHTML`. A second script holds the response headers to the same policy, and
the release pipeline runs that check against the live site after every deploy.

## What I would do differently

- Write the checks before the pages. Adding them late meant fixing small violations that a
  failing test would have caught on the first day.
- Treat an exception as a design problem. Every time something seemed to need one, a simpler
  approach turned up.
