---
owner: raksha
reviewed: 2026-08-18
covers:
  - docs/
---

# Documentation gaps

What is not written down yet. This list should only ever shrink — when you close
a gap, delete the row rather than editing it into something vaguer.

| Gap | Audience affected | Why it matters | Priority |
|---|---|---|---|
| No runbook for "the catalog is empty in production" | DevOps | The most likely production incident: the stack is healthy but `/health` reports 0 products. The fix (restore a snapshot) is in `DEPLOY.md`, but not as an incident procedure. | High |
| No decision record for choosing server-rendered React over a single-page app | Engineers | The reasoning lives in `explanation/architecture.md`, but the alternatives considered and rejected are not recorded, so the question will be reopened. | Medium |
| No generated configuration reference | Engineers, DevOps | Environment variables are documented by hand in three places (`.env.example`, `.env.prod.example`, `DEPLOY.md`). They should be emitted from one source. | Medium |
| No onboarding tutorial | New engineers | `README.md` explains how to run it; nothing walks a newcomer through making their first change and seeing it work. | Medium |
| Scraper internals undocumented | Engineers | `scripts/scrape.mjs` encodes hard-won knowledge about the upstream site (Turbo-Stream pagination, expiring image URLs, the real-variant matrix). It is commented, but there is no page explaining the approach. | Low |
| No performance baseline | Engineers | Nothing records what a normal catalog page response time looks like, so a regression has nothing to be measured against. | Low |
