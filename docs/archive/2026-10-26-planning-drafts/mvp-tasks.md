# GrokChat MVP: build tasks

Draft, 2026-10-26. Scope is phase 1 of the plan:

- accounts and personalities with static playbooks;
- generation, the critic and dedup;
- the approval queue, scheduling and publishing;
- metric collection, the scoring job (score only, no learning), and a basic dashboard.

## How to read the estimates

- **Units.** Estimates are engineer-days for someone who knows Python and Postgres.
- **What's included.** Every task includes tests to the team standard (Agents/CLAUDE.md §7.1): ≥90% line and branch coverage, a contract suite for every port, and Clean Architecture enforced with import-linter.
- **Tickets.** Each task is roughly one PR, so roughly one `GROKCHAT-N` ticket.

| # | Task | Done when | Days | Needs |
|---|---|---|---|---|
| 0 | **Access and decisions** (not code) | X developer app created with pay-per-use credits; automated label on each account; bios updated; Q1–Q4 answered; decision record for the stack | 2 + X lead time | — |
| 1 | **Scaffold** | `uv` project with the Clean Architecture layout, plus: FastAPI; Postgres 16 + pgvector in docker compose; Alembic; Procrastinate worker; CI running ruff, pyright `--strict`, pytest, the coverage gate and import-linter; secrets from Infisical | 3–4 | 0 |
| 2 | **Schema and repositories** | [schema.sql](schema.sql) as Alembic migrations, plus repository ports with their Postgres drivers and contract tests | 3 | 1 |
| 3 | **Account onboarding** | OAuth 2.0 PKCE connect flow per account; tokens encrypted at rest; refresh job; account can't go active without the label confirmed | 3 | 2 |
| 4 | **X client** | Port and driver for: create single, thread and poll; delete; batched metric lookup (public + non-public, 100 ids per call). A spend-metering decorator writes to `api_spend`. The port has **no** like, repost or reply. Stub driver passes the same contract suite | 4 | 1 |
| 5 | **Briefs, claims, personalities, playbooks** | CRUD use cases and API for: briefs and approved claims; personalities (voice locked); playbook versions with JSON Patch diffs and rollback | 3 | 2 |
| 6 | **Generation** | For a slot: assemble the prompt from voice, playbook, brief and approved claims; generate N candidates, each labelled with the fixed features (hook type, length bucket, topic, CTA style); record prompt, model and cost | 4 | 5 |
| 7 | **Critic** | Deterministic checks first: promo tag, length, links only on promotional posts, off-limits terms. Then model checks: voice fit, brand safety, each claim mapped to `approved_claim`. Verdicts stored in `post_review` | 3 | 6 |
| 8 | **Dedup** | Embedding port and driver. pgvector search across **all** accounts' recent posts, with the threshold calibrated on a hand-labelled set of ~50 pairs. Same-link-within-N-hours rule across accounts | 2–3 | 6 |
| 9 | **Scheduler and publisher** | Slots planned from posting windows, staggered across accounts. Idempotent publish job with retries, and `unknown`-state reconciliation against the account's timeline. Per-account pause switch | 3–4 | 4, 7, 8 |
| 10 | **Metric collector** | Snapshots at 1h, 6h, 24h, 72h and 7d, storing the actual age. Daily follower snapshots. Alert if a non-public read would fall outside 30 days | 2–3 | 4 |
| 11 | **Scoring job** | Nightly: [scoring.py](scoring.py) baselines and scores at 24h and 72h, written to `post_score`. Winners flagged, no playbook changes | 1–2 | 10 |
| 12 | **Dashboard** | Google SSO and roles. Approval queue: approve, edit (re-runs critic and dedup) and reject with a reason. Account, personality and playbook history views; post view with metric curve; overview with spend | 8–10 | 2, 5, 7 |
| 13 | **Tracked links** (only if Q1 = signups) | Redirect with a per-post `tracking_code`; click and signup events into `tracked_link_event` | 2 | 2 |
| 14 | **Launch readiness** | A week of "paper" running (generate and approve, but don't publish); runbook; alerts on publish failures, spend and token expiry | 2–3 | 9, 12 |

**Total: 43–51 engineer-days**, plus 2 if task 13 is needed. That is about 9–10 weeks for one engineer, or 5–6 weeks for two. Split it so one person takes tasks 3, 4, 9 and 10 and the other takes 6–8 and 12.

**Critical path:** 0 → 1 → 2 → 5 → 6 → 7/8 → 9 → 14. The approval queue (part of 12) must exist before the first live post, because every post is human-approved at first.

## After the build: the baseline period

Run live for 3–4 weeks before starting phase 2.

- **Baseline size.** At 3 posts a day, each personality reaches the 10-post minimum in about 4 days and a stable ~30-post baseline in about 10.
- **What the period settles:**
  - tuning `reach_weight` and the dedup threshold;
  - the real LLM cost per post;
  - critic accuracy against human decisions. Every human approve or reject is a label for it.

**Phase 1 exit criteria (proposed):**

- every active personality has ≥30 scored posts;
- zero rule incidents, meaning no duplicates and no unlabelled or untagged posts;
- spend within budget;
- critic agreement with human reviewers measured and recorded.
