---

title: Segmented homelab network
summary: A small home network built around an OPNsense firewall, with an isolated security lab and tested backups.
kind: Build
status: complete
tags: [homelab, networking, hardening]
order: 2
---

A home lab for practising security work without putting the rest of the network at risk. The
design came first and every change is recorded with the reason for it.

## Hardware

- A Lenovo ThinkCentre M70q mini PC running Debian and Docker, in a 10-inch DeskPi rack.
- A UPS for clean shutdowns, a JetKVM for out-of-band access and a USB drive enclosure for
  storage.
- Raspberry Pis for network services and for a monitoring sensor.

## Network

- **OPNsense** is the firewall and router, with a managed switch enforcing the segments.
- Separate segments for trusted devices, servers, an isolated cyber lab, smart-home devices
  and management.
- The cyber lab has no route to the trusted or server segments. It reaches the internet only
  when a task needs it.

## Hardening

- Default-deny firewall rules, opened one port at a time.
- SSH with keys only, and reached through a WireGuard VPN instead of an open port.
- Encrypted, automated backups, with a restore tested to prove they work.

## What I learned

- Start fully locked down and open things deliberately. Closing a wide-open network later
  rarely happens.
- A backup does not count until a restore has worked.
