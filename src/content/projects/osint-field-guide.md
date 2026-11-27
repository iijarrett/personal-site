---

title: OSINT Field Guide
summary: "A curated, ethics-first guide to OSINT tools: 87 entries, install lines for three operating systems, a command-line reader, an interactive pivot map and a searchable tool list."
kind: Build
status: in-progress
tags: [osint, python, ci/cd, ethics]
order: 3
---

## How this page is built

The map and the tool list read copies of the guide's `docs/pivot-map.json` and
`docs/tools.json`, kept in this site's repository and read when the site is built. Nothing is
fetched when you open the page, so the site's Content Security Policy stays closed, and
everything is real HTML first: with JavaScript off you still get every pivot and every tool as
a plain list. The script only switches what is shown, keeps your trail and keeps the address
bar in step with it.
