# GrokChat plan review

Draft, 2026-10-26. Companion files in this folder:

- [schema.sql](schema.sql): the Postgres + pgvector schema. It loads cleanly on Postgres 16 (checked with PGlite), and its rule-backing constraints were each checked to reject a bad write.
- [scoring.py](scoring.py) and [test_scoring.py](test_scoring.py): the winner score and the promotion gate. Pure standard-library Python; the 12 tests pass on 3.12.
- [mvp-tasks.md](mvp-tasks.md): the MVP broken into build tasks with estimates.

## 1. What I'd change, most important first

### 1.1 A post with a link costs 13× as much as one without

X's pricing page lists **$0.015** to create a post and **$0.200** to create a post that contains a URL. Reads cost $0.005 per post returned. The cheaper "owned reads" rate ($0.001) applies only when the authenticated user owns the developer app, so with one app it covers at most one of our accounts. The read cap is 3M a month, not 2M.

| Scenario (900 posts/month) | Writes | Metric reads (5 snapshots) | Total |
|---|---|---|---|
| Every post has a link | $180 | $22.50 | ~$203 |
| 1 in 4 posts has a link | $55 | $22.50 | ~$78 |
| No links (link in bio) | $13.50 | $22.50 | ~$36 |

Each part of a thread is a separate post create. Reads of the same post within one UTC day are charged once, so the 1h and 6h snapshots are often billed together.

This doesn't break the budget, but it makes **links a decision per post, not a default**, and it feeds Q2 below. The `post_link_is_promotional` constraint in the schema assumes that only promotional posts carry links.

### 1.2 The learning loop has less data than it needs

At 3 posts a day, a personality publishes ~90 posts a month, and the 10% experiment share is ~9 of them. Engagement on X is heavy-tailed: one post in twenty can do 10× the median by luck. That has three consequences:

- **"Wins 2–3 times" will promote luck.** With noise this size, two or three wins are routine for a variant that is no better. [scoring.py](scoring.py) replaces the rule with a gate:
  - at least 8 scored posts on each arm;
  - P(variant beats control) ≥ 0.9;
  - a lift of at least 10%.
- **A Thompson-sampling bandit over many arms won't converge** at ~9 experimental posts a month. Run **one experiment per personality at a time**, with fixed 70/20/10 quotas, and gate it with `should_promote`. Revisit a bandit only if volume grows a lot. Phase 3 gets simpler as a result.
- **Test structured features, not free-form "formulas".** These are hook type, format, length bucket, posting window and CTA style. The generator labels each post from these fixed vocabularies (they are columns on `post`). That lets results pool across posts, and across personalities for the structural lessons in global insights.

### 1.3 Per-impression rates reward posts nobody saw

A post with 300 impressions and 3 clicks has a 1% click rate. A post with 20,000 impressions and 100 clicks has 0.5%. The first wins on rate, but the second sent 33× the traffic. The scarce resource is the posting slot, not the impression, so value per post matters. Raw rates are also noisiest exactly when impressions are low.

The scoring function handles both problems:

```text
score = ln(shrunk weighted rate / baseline rate) + reach_weight × ln(impressions / baseline median impressions)
```

- **Shrinkage.** Each rate is pulled toward the personality's baseline until the post has ~500 impressions of its own evidence.
- **`reach_weight`.** At 0 the score is your original per-impression rate; at 1 it is total value per post. The default is 0.5, because some of a post's reach is luck and timing rather than quality. Set it once you have baseline data.

The rest of your winner definition stays: baseline per personality, business weighting, and comparison at equal post age. The age comparison now interpolates between snapshots instead of trusting that each job ran exactly on time.

### 1.4 The analyst LLM will explain noise

Give an LLM a winner and a loser and it will always find a convincing reason for the difference. Keep the roles separate:

- **The analyst proposes.** Its hypotheses are expressed in the fixed feature vocabulary and cite the posts behind them (`playbook_proposal.evidence_post_ids`).
- **The statistics decide.** A proposal becomes an experiment, and only `should_promote` can turn it into a playbook version.
- **The human approves.**

### 1.5 Learning will pull accounts toward each other

If every personality optimises for the same audience behaviour, and global insights share what works, the playbooks converge. Every account then posts the same format, with the same hook style, at the same hour. Embedding dedup catches similar *text*, but not similar *behaviour*, and behaviour is what "substantially similar purposes" is about. Add:

- **A cross-account check before any playbook change is adopted.** Compare the proposed playbook with the other accounts' current ones, and block changes that close the gap.
- **Staggered schedules.** Never post the same campaign link from two accounts within N hours. Spread posting windows so accounts don't fire together.
- **Narrower global insights.** Share timing and format findings only as constraints (for example "threads underperform for everyone"), never as targets that every account chases.

### 1.6 A claim can only be checked against a list of approved claims

The critic can't judge "product claim accuracy" from nothing. The schema adds:

- **`approved_claim`:** the claim, its evidence and its validity dates.
- **`post_claim`:** the critic maps every claim in a post to an approved row and fails any post with a claim it can't map.

The generator's prompt carries only the approved claims for the active brief.

### 1.7 The satire lane carries the most risk

Satire riffs on current events and real people. That is where an automated account gets into defamation or brand-safety trouble, and where X's automation rules restrict automated posting on trending topics. I couldn't re-fetch the rules page (it returned 403), so check that point against help.x.com.

Recommendations:

- Keep human approval for satire permanently.
- Put "no named private individuals" in the off-limits list.
- Don't build trend-chasing into generation.

### 1.8 X's metrics stop at the click

`url_link_clicks` and `user_profile_clicks` are non-public metrics. Both need the posting account's user token, and both are available only for 30 days after posting. The 7-day snapshot is fine, but any backfill must happen inside that window. Neither metric tells you whether anyone signed up.

If signups matter, route links through a redirect you own, with a per-post `tracking_code` (`tracked_link_event` in the schema). That redirect counts real clicks and conversions independently of X.

### 1.9 Smaller points

- **Credentials.** Store OAuth 2.0 user tokens (PKCE) per account, never passwords. Tokens are encrypted in Postgres with a key held in Infisical, per the team's secrets rule.
- **Idempotent publishing.** A retried publish that double-posts creates duplicate content and pays for it twice. `publish_attempt` records each try. A timeout leaves the attempt in state `unknown`, and the publisher reconciles it against the account's timeline before retrying.
- **No cross-amplification by construction.** The X client port exposes create, delete and read only. With no like, repost or reply method, a bug can't produce one. Phase 4 replies get a hard check that refuses to reply to any of our own accounts.
- **Stack.** Agents/CLAUDE.md §7.2 sets the team stack to Python 3.12, `uv`, `pytest` and `pydantic`, which settles the backend as FastAPI. The scoring draft is already Python.
  - **Queue:** a Postgres-backed queue such as Procrastinate, rather than Celery with Redis or Temporal. At ~30 posts and ~150 metric jobs a day, a second datastore isn't worth running.
  - **Dashboard:** Next.js is fine; generate its API client from FastAPI's OpenAPI schema.
  - **Decision records:** each new dependency needs one (§7.1).
- **Critic.** Voice fit, brand safety, tag present and claim mapped are bounded yes/no and choice questions. That is exactly the criteria-gated admission Jevson does over the Decisions API.
  - **Known weaknesses:** on `gpt-6-luna` it over-rejected (53% of its rejections met their criteria) and passed 5 of 80 drafts it should have failed.
  - **Implication:** keep human approval on until its accuracy is measured on our own posts.
  - **Deterministic checks first:** check the tag, length and links in code before any model call.

## 2. The open questions: my recommendations

**Q1. Primary conversion goal.** Score on **tracked link clicks**, with signups as a lagging check reviewed monthly:

- Clicks happen often enough to score each post.
- Signups are too rare per post (a handful a week) to drive the per-post winner score, but they tell you whether the clicks are worth anything.
- Follows can't be attributed to a single post through the API; track them per account on the overview.

`DEFAULT_WEIGHTS` in [scoring.py](scoring.py) already ranks clicks > profile visits > bookmarks > reposts > likes.

**Q2. Promote in every post, or build an audience first?** A mix: roughly 1 in 4 posts promotes, with the link and the tag, and the rest are native to the lane.

- Every-post promotion caps reach and costs ~2.6× more ($203 against $78 a month).
- It also conflicts with "every post is tagged": tagging posts that aren't ads waters the tag down.

My suggestion is to tag every post that promotes, and have the bio and the automated label disclose the account as a whole.

**Q3. Should each bio visibly connect the account to the firm?** **Yes.**

- **The automated label already does it.** X's label shows which account manages the bot, so the connection is visible anyway. Hiding it in the bio only makes the account look less honest.
- **Endorsement rules.** If these accounts promote clients' products, the FTC Endorsement Guides require clear disclosure of the material connection. Have counsel confirm the exact wording.
- **Platform risk.** Visibly connected accounts are your best defence against a platform-manipulation report.

**Q4. How much human review in the long term?** Tiered:

- **Always reviewed:**
  - any post with a product claim or a link;
  - everything in the satire lane.
- **Auto-approved:** non-promotional posts from a personality after a trust streak, for example 50 consecutive approvals with no edits. Keep a random 10% for human spot checks.
- **Back to full review automatically:** the personality's playbook changes, or a spot check fails.
- **Kill switch:** each account has a pause switch (`account.status = 'paused'`).

## 3. How the score works (see scoring.py)

1. **Metrics at a fixed age.** `metrics_at_age` interpolates the cumulative counts to exactly 24h, with 72h as the confirmation.
2. **Baseline.** `build_baseline` uses the personality's last ~30 posts at the same age: pooled action rates and median impressions. It returns nothing until there are 10 posts. Older posts age out of the window, which gives the decay you asked for.
3. **Score.** `score_post` produces the log score above. 0 is baseline, and +0.69 is about 2× the baseline value.
4. **Winner.** `is_winner` requires the post to be in the personality's top 20% *and* at least 25% above baseline. A winner goes to the analyst; it doesn't change the playbook on its own.
5. **Promotion.** `should_promote` compares the variant and control arms of an experiment.

Every threshold is a keyword argument, so you can tune it once the MVP has produced real baselines.

## 4. Questions still open for the team

- **Whose product do the accounts promote:** the firm's own, or clients'? This changes the disclosure wording (the endorsement rules matter most for clients' products) and whether `brand` rows are clients.
- **Is there signup tracking on the product side?** If yes, MVP task 13 (tracked links) is in scope and signups become the lagging check in Q1.
- **Sign-off on Q1–Q4 above.** They are recommendations, not decisions yet.

## 5. Sources

- [X API pricing](https://docs.x.com/x-api/getting-started/pricing): creation, URL, read and owned-read prices, the 3M cap, 24-hour deduplication.
- [X API metrics](https://docs.x.com/x-api/fundamentals/metrics): public and non-public fields, the 30-day limit, user-context requirement.
- Third-party price history: pay-per-use launched on 2026-02-06 at $0.01 per post and rose to $0.015 in April ([Kalen](https://kalen.si/blog/x-api-pricing-per-post), [Postproxy](https://postproxy.dev/blog/x-api-pricing-2026/)). Confirm current rates in the X Developer Console before you budget.
