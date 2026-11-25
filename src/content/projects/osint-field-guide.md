---

title: OSINT Field Guide
summary: "A curated, ethics-first guide to OSINT tools: 87 entries, install lines for three operating systems, a command-line reader and an interactive pivot map."
kind: Build
status: in-progress
tags: [osint, python, ci/cd, ethics]
order: 3
---

OSINT Field Guide is a public, curated guide to open-source intelligence tools. It is written
ethics-first: each section starts from what you are allowed to do and why, and the tools come
after that. The repository is open, so the data, the checks and the history can all be read.

## What it is

- **A guide built from data.** Every tool is an entry in a YAML file, and the guide pages are
  generated from those files, so a fix is made once and shows up everywhere.
- **Install lines for three systems.** Each entry says how to install the tool on Windows,
  macOS and Linux.
- **A small command-line reader**, `osint-guide`, written in Python, for looking entries up
  from a terminal.
- **A weekly tool-health check** in CI, so a tool that has moved, been renamed or gone quiet
  shows up as a failing check instead of a broken link nobody notices.
- **A methodology page** that maps the guide to the Berkeley Protocol, the UN human rights
  standard for open-source investigations.

## Links

- [The repository on GitHub](https://github.com/iijarrett/osint-field-guide)
- [The methodology page](https://github.com/iijarrett/osint-field-guide/blob/main/docs/METHODOLOGY.md)

## Why a pivot map

Investigations move from one kind of thing to another: a username leads to an account, an
account to a photo, a photo to a place. The map below turns the guide into those hops. Choose
what you hold, see what you can reach and which tools get you there, and carry on from the
result. It is built from the same data as the guide, and the numbers on it are counted from
that data.

## How this page is built

The map's data is a copy of the guide's `docs/pivot-map.json`, kept in this site's repository
and read when the site is built. Nothing is fetched when you open the page, so the site's
Content Security Policy stays closed, and the whole map is real HTML first: with JavaScript
off you still get every pivot as a plain list. The script only switches what is shown and
keeps your trail.
