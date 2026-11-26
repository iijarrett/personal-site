# Release check: personal-site

jarrettd.com, Astro static site on Cloudflare Workers. Tracks: Every project + Website.

Kept per release. Copy of the run record from the Pre-Launch Review sheet. A tick needs dated evidence; "Not run" is an honest answer.

## Latest run

- Version / commit: not recorded
- Date: 2026-11-26 (template created)
- Call: **not yet decided**

## Every-project gates

| # | Gate | Result | Evidence / note |
|---|------|--------|-----------------|
| 1 | Tests pass from a clean checkout | Pass | Pass. CI Verify and Lighthouse budgets green on PRs 36 to 38 (2026-11-26). |
| 2 | Dependencies audited | Not run |  |
| 3 | Secrets scan is clean | Not run |  |
| 4 | Code scan (SAST) is clean | Pass | Pass. CodeQL green on PRs 36 to 38 after two test-file regex fixes. |
| 5 | AI security review done and triaged | Not run |  |
| 6 | Second reviewer on risky code | Not run |  |
| 7 | Build and supply chain locked down | Not run |  |
| 8 | Accounts and tokens are safe | Not run |  |
| 9 | Licences checked | Not run |  |
| 10 | Privacy reviewed | Not run |  |
| 11 | Threat model written | Not run |  |
| 12 | Backup restored once, rollback rehearsed | Not run |  |
| 13 | Monitoring on | Not run |  |
| 14 | Security contact and incident plan | Pass | Pass. SECURITY.md added in PR 38. |
| 15 | README lets a stranger build, run and verify it | Not run |  |

## Website track

Not run. Work through the Website track in the Pre-Launch Review sheet and record results here.

## Live scanners (2026-11-26, https://jarrettd.com/)

| Tool | Result |
|------|--------|
| securityheaders.com | A+ |
| MDN HTTP Observatory | A+, 140/100, 12/12 tests |
| SSL Labs | A+ on all 4 endpoints |
| PageSpeed Insights (mobile) | 100 / 100 / 100 / 100 |

## Open findings

None recorded.

## Accepted risks

None recorded.
