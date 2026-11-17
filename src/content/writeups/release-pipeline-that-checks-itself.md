---

title: A release pipeline that checks its own work
summary: Pinned actions, a software bill of materials, signed provenance and a live header check, all before a visitor sees a change.
date: 2026-11-14
platform: Personal project
tags: [ci/cd, supply chain, github actions]
---

Most of the risk in a small site sits in how it gets built and deployed, not in the site
itself. This pipeline treats each stage as something to verify.

## Before a change reaches main

- `main` accepts pull requests only, with squash merges, and two checks must pass: the full
  verification suite and the performance budgets.
- A script reads every workflow and fails on an action that is not pinned to a full commit
  hash, a workflow with write permissions at the top level, the `pull_request_target`
  trigger, or an `npm install` that could run scripts.
- Dependabot proposes updates to dependencies and to the actions themselves, and CodeQL and
  the OpenSSF Scorecard run on the repository.

## From merge to live

1. The release builds the site once and writes a CycloneDX software bill of materials.
2. The packed site is signed twice: build provenance for the archive, and an attestation
   that binds the bill of materials to it.
3. A second job downloads the archive and verifies both signatures against the release
   workflow before anything ships.
4. The deploy runs from a protected environment, so the Cloudflare token is not stored with
   the repository's other secrets.
5. A final step requests the live site and checks its headers, retrying while the new
   deploy settles.

## What I would do differently

- Pin actions from the first commit. Retrofitting the hashes was tedious, and a script that
  rejects a floating version makes the habit automatic.
- Keep each workflow's permissions empty at the top and grant them per job. It is a few
  extra lines and it limits what a compromised step can do.
