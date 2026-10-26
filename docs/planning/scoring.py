"""Winner scoring for published posts (draft). See plan-review.md §3.

A post's score is the log of the business value it produced relative to its
personality's recent baseline, measured at a fixed post age:

    score          = rate_component + reach_weight * reach_component
    rate_component = ln(shrunk weighted action rate / baseline weighted rate)
    reach_component = ln(impressions / baseline median impressions)

reach_weight = 0 is the pure per-impression rate from the original plan;
reach_weight = 1 is total value per post. Rates are shrunk toward the baseline
so a post with 300 impressions and one lucky click can't top the leaderboard.

Pure functions over frozen dataclasses, standard library only, so this can sit
in the entities layer.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, fields
from statistics import NormalDist, mean, median, variance

EPSILON = 1e-9


@dataclass(frozen=True)
class Metrics:
    impressions: float
    link_clicks: float = 0
    profile_visits: float = 0
    bookmarks: float = 0
    reposts: float = 0
    quotes: float = 0
    replies: float = 0
    likes: float = 0


ACTIONS: tuple[str, ...] = tuple(f.name for f in fields(Metrics) if f.name != "impressions")

# Business value per action: clicks and profile visits > bookmarks > reposts > likes.
# Re-tune once the primary conversion goal is decided.
DEFAULT_WEIGHTS: dict[str, float] = {
    "link_clicks": 10,
    "profile_visits": 5,
    "bookmarks": 3,
    "reposts": 2,
    "quotes": 2,
    "replies": 1,
    "likes": 1,
}


@dataclass(frozen=True)
class Snapshot:
    age_hours: float
    metrics: Metrics


@dataclass(frozen=True)
class Baseline:
    n: int
    rates: dict[str, float]
    median_impressions: float


@dataclass(frozen=True)
class Score:
    score: float
    rate_component: float
    reach_component: float


@dataclass(frozen=True)
class ArmComparison:
    n_variant: int
    n_control: int
    lift: float  # difference in mean score, log units
    prob_variant_better: float


@dataclass(frozen=True)
class PromotionDecision:
    comparison: ArmComparison
    promote: bool
    reason: str


def metrics_at_age(snapshots: list[Snapshot], target_hours: float) -> Metrics | None:
    """Cumulative metrics at exactly target_hours, interpolated between the
    bracketing snapshots. Counts are zero at age 0, so one later snapshot is
    enough. None if no snapshot has reached the target age yet."""
    ordered = sorted(snapshots, key=lambda s: s.age_hours)
    after = next((s for s in ordered if s.age_hours >= target_hours), None)
    if after is None:
        return None
    before = next((s for s in reversed(ordered) if s.age_hours <= target_hours), Snapshot(0, Metrics(0)))
    if after.age_hours == before.age_hours:
        return after.metrics

    t = (target_hours - before.age_hours) / (after.age_hours - before.age_hours)
    values = {
        f.name: getattr(before.metrics, f.name) + (getattr(after.metrics, f.name) - getattr(before.metrics, f.name)) * t
        for f in fields(Metrics)
    }
    return Metrics(**values)


def build_baseline(history: list[Metrics], min_posts: int = 10) -> Baseline | None:
    """Baseline from the personality's recent posts at the same age (for example
    the last 30 posts from the last 60 days, excluding the post being scored).
    Pooled rates for actions, median for impressions."""
    if len(history) < min_posts:
        return None
    total_impressions = sum(m.impressions for m in history)
    if total_impressions <= 0:
        return None
    rates = {a: sum(getattr(m, a) for m in history) / total_impressions for a in ACTIONS}
    return Baseline(n=len(history), rates=rates, median_impressions=median(m.impressions for m in history))


def score_post(
    metrics: Metrics,
    baseline: Baseline,
    *,
    weights: dict[str, float] = DEFAULT_WEIGHTS,
    prior_impressions: float = 500,
    reach_weight: float = 0.5,
) -> Score:
    """prior_impressions is the prior strength: a post needs about this many
    impressions before its own rates outweigh the baseline's."""
    k = prior_impressions
    weighted_rate = 0.0
    baseline_weighted_rate = 0.0
    for a in ACTIONS:
        shrunk = (getattr(metrics, a) + k * baseline.rates[a]) / (metrics.impressions + k)
        weighted_rate += weights[a] * shrunk
        baseline_weighted_rate += weights[a] * baseline.rates[a]

    rate_component = math.log((weighted_rate + EPSILON) / (baseline_weighted_rate + EPSILON))
    reach_component = math.log((metrics.impressions + 1) / (baseline.median_impressions + 1))
    return Score(rate_component + reach_weight * reach_component, rate_component, reach_component)


def is_winner(
    score: float,
    recent_scores: list[float],
    *,
    top_fraction: float = 0.2,
    min_lift: float = math.log(1.25),
    min_history: int = 10,
) -> bool:
    """A post wins if it is in the top slice of its personality's recent scores
    and clearly above baseline. Winners feed the analyst; they don't change the
    playbook by themselves (see should_promote)."""
    if score < min_lift or len(recent_scores) < min_history:
        return False
    return score >= _quantile(recent_scores, 1 - top_fraction)


def compare_arms(variant_scores: list[float], control_scores: list[float]) -> ArmComparison:
    """Normal approximation to P(mean variant score > mean control score), with
    unequal variances. Scores are logs, so they're close enough to normal at
    these sample sizes for a promotion gate."""
    n_v, n_c = len(variant_scores), len(control_scores)
    if n_v < 2 or n_c < 2:
        lift = (mean(variant_scores) if n_v else 0.0) - (mean(control_scores) if n_c else 0.0)
        return ArmComparison(n_v, n_c, lift, 0.5)

    lift = mean(variant_scores) - mean(control_scores)
    se = math.sqrt(variance(variant_scores) / n_v + variance(control_scores) / n_c)
    if se == 0:
        prob = 1.0 if lift > 0 else 0.0 if lift < 0 else 0.5
    else:
        prob = NormalDist().cdf(lift / se)
    return ArmComparison(n_v, n_c, lift, prob)


def should_promote(
    variant_scores: list[float],
    control_scores: list[float],
    *,
    min_per_arm: int = 8,
    min_prob: float = 0.9,
    min_lift: float = math.log(1.1),
) -> PromotionDecision:
    """Replaces "wins 2 to 3 times": a variant enters the playbook only with
    enough posts on both arms, high confidence, and a lift worth having."""
    c = compare_arms(variant_scores, control_scores)
    if c.n_variant < min_per_arm or c.n_control < min_per_arm:
        return PromotionDecision(c, False, f"need {min_per_arm} scored posts per arm")
    if c.prob_variant_better < min_prob:
        return PromotionDecision(c, False, "not confident the variant is better")
    if c.lift < min_lift:
        return PromotionDecision(c, False, "lift too small to be worth a playbook change")
    return PromotionDecision(c, True, "variant beats control")


def _quantile(xs: list[float], q: float) -> float:
    """Linear-interpolation quantile (numpy's default)."""
    ordered = sorted(xs)
    pos = (len(ordered) - 1) * q
    lo, hi = math.floor(pos), math.ceil(pos)
    return ordered[lo] + (ordered[hi] - ordered[lo]) * (pos - lo)
