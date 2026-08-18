---
owner: raksha
reviewed: 2026-08-18
covers:
  - README.md
  - docs/
---

# Documentation index

Every page here has exactly one audience and one job. Start with the row that
matches why you came.

## Which document do I want?

| I am… | I want to… | Read |
|---|---|---|
| a new engineer | understand what this is and run it locally | [`../README.md`](../README.md) |
| a new engineer | understand *why* it is built this way | [`explanation/architecture.md`](explanation/architecture.md) |
| a new engineer | find where a given thing lives | [`reference/repository-map.md`](reference/repository-map.md) |
| an engineer | know what I may and may not change | [`explanation/principles.md`](explanation/principles.md) |
| an engineer | run the checks before I push | [`how-to/run-the-checks.md`](how-to/run-the-checks.md) |
| an engineer | refresh the catalog data | [`how-to/refresh-the-catalog.md`](how-to/refresh-the-catalog.md) |
| DevOps | host this in production | [`../DEPLOY.md`](../DEPLOY.md) |
| a consumer (the connector) | pull the catalog | [`../INTEGRATION.md`](../INTEGRATION.md) |
| anyone | know what the API is contractually required to do | [`../TEST-MERCHANT-SITE.md`](../TEST-MERCHANT-SITE.md) |
| an AI agent | work in this repo without breaking it | [`../CLAUDE.md`](../CLAUDE.md) |

## How these pages are organised

Four kinds of page, never mixed — a page that both teaches and lists is worse at
both:

- **Reference** (`reference/`) — dry lookup. No narrative.
- **How-to** (`how-to/`) — solves one problem for someone who already knows what
  they want.
- **Explanation** (`explanation/`) — the why, the trade-offs, the history.
- **Runbooks** (`runbooks/`) — what to do when something is broken.

## Keeping this honest

Every page under `docs/` carries frontmatter naming an `owner`, the date it was
last `reviewed`, and the code paths it `covers`. `npm run check:repo` fails when
a page references a file that no longer exists, and warns when a page has no
owner. That is what stops this folder becoming a museum.

Known gaps are tracked in [`gaps.md`](gaps.md). That file should only ever
shrink.
