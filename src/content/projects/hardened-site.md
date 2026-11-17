---

title: This site, hardened end to end
summary: The controls behind this static site, and the checks that fail the build when one regresses.
kind: Case study
status: in-progress
tags: [headers, ci/cd, supply chain]
order: 1
---

This site is a set of static files with a strict Content Security Policy, a protected
repository and a release pipeline that checks its own work. The repository is public, so
every control below can be read and re-run.

## Goals

- Static output only, with no third-party requests at runtime.
- Every claim on the page backed by a check that can be re-run.
- A change that weakens a control fails the build instead of reaching visitors.

## What ships

- **Content Security Policy** with `default-src 'none'` and `'self'` for scripts, styles,
  images, fonts and connections. No inline code, no eval, and Trusted Types required.
- **Response headers**: HSTS for two years with subdomains, `nosniff`, `X-Frame-Options: DENY`,
  `Referrer-Policy: no-referrer`, a locked-down Permissions Policy, and same-origin
  Cross-Origin-Opener and Cross-Origin-Resource policies.
- **Self-hosted fonts** with their checksums in the repository, and no analytics or embeds.
- **Email authentication** for the domain: SPF, DKIM and DMARC at `p=reject`, with receive-only
  email routing for `hello@` and `security@`, and a `security.txt` file for reports.

## The pipeline

- `main` accepts changes only by pull request, with squash merges and the `Verify` and
  `Lighthouse budgets` checks required.
- Four scripts hold the build to the rules: one for the built pages, one for the headers, one
  for the workflows and one for performance budgets. CodeQL, Dependabot and the OpenSSF
  Scorecard run alongside them.
- Every GitHub Action is pinned to a full commit hash, workflows start with no permissions,
  and `npm ci --ignore-scripts` keeps install scripts from running.
- A release builds the site once, writes a software bill of materials, signs build provenance
  for both, verifies those signatures, deploys from a protected environment and then checks
  the headers on the live site.

## Still to do

- Submit the domain to the HSTS preload list once the site is stable.
- Add a public status page and Cloudflare firewall rules.
- Publish a PGP key and link it from `security.txt`.
