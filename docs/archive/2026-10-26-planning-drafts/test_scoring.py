import math

from scoring import (
    Metrics,
    Snapshot,
    build_baseline,
    compare_arms,
    is_winner,
    metrics_at_age,
    score_post,
    should_promote,
)

# 20 posts at 2,000 impressions: 0.5% link clicks, 2% likes, 0.3% bookmarks.
HISTORY = [
    Metrics(2000, link_clicks=10, likes=40, bookmarks=6, reposts=4, profile_visits=8) for _ in range(20)
]
BASELINE = build_baseline(HISTORY)
assert BASELINE is not None

CONTROL = [0, 0.1, -0.1, 0.05, -0.05, 0.02, -0.02, 0.08]


def test_interpolates_between_bracketing_snapshots():
    m = metrics_at_age(
        [Snapshot(6, Metrics(1000, likes=10)), Snapshot(24, Metrics(1900, likes=28))],
        15,
    )
    assert m == Metrics(1450, likes=19)


def test_interpolates_from_zero_when_only_a_later_snapshot_exists():
    assert metrics_at_age([Snapshot(2, Metrics(400, likes=8))], 1) == Metrics(200, likes=4)


def test_none_before_the_post_reaches_the_target_age():
    assert metrics_at_age([Snapshot(6, Metrics(1000))], 24) is None


def test_needs_enough_history_for_a_baseline():
    assert build_baseline(HISTORY[:9]) is None
    assert BASELINE.n == 20
    assert BASELINE.median_impressions == 2000
    assert BASELINE.rates["link_clicks"] == 0.005


def test_a_post_matching_the_baseline_scores_about_zero():
    assert abs(score_post(HISTORY[0], BASELINE).score) < 1e-6


def test_shrinkage_stops_a_low_reach_lucky_post_beating_a_proven_one_on_rate():
    # Same 2% click rate; 100 impressions against 10,000.
    lucky = score_post(Metrics(100, link_clicks=2), BASELINE, reach_weight=0)
    proven = score_post(Metrics(10000, link_clicks=200), BASELINE, reach_weight=0)
    assert proven.rate_component > lucky.rate_component


def test_reach_weight_scales_the_reach_component():
    post = Metrics(8000, link_clicks=40, likes=160, bookmarks=24, reposts=16, profile_visits=32)
    assert abs(score_post(post, BASELINE, reach_weight=0).score) < 1e-6  # same rates as baseline
    assert abs(score_post(post, BASELINE, reach_weight=1).score - math.log(8001 / 2001)) < 1e-9  # 4x reach


def test_a_link_click_is_worth_more_than_a_like():
    clicks = score_post(Metrics(2000, link_clicks=20, likes=40), BASELINE)
    likes = score_post(Metrics(2000, link_clicks=10, likes=50), BASELINE)
    assert clicks.score > likes.score


def test_a_winner_must_be_in_the_top_slice_and_above_the_minimum_lift():
    recent = [(i - 10) / 20 for i in range(20)]  # -0.5 .. 0.45
    assert is_winner(0.6, recent)
    assert not is_winner(0.24, recent)  # above the lift, not in the top 20%
    assert not is_winner(0.6, recent[:5])  # too little history


def test_compare_arms_is_confident_when_arms_differ_and_neutral_when_not():
    assert compare_arms([x + 0.5 for x in CONTROL], CONTROL).prob_variant_better > 0.99
    assert compare_arms(CONTROL, CONTROL).prob_variant_better == 0.5


def test_no_promotion_without_enough_posts_per_arm():
    decision = should_promote([2, 2.1, 1.9], CONTROL)
    assert not decision.promote
    assert "per arm" in decision.reason


def test_promotes_a_clear_sizeable_well_sampled_win():
    assert should_promote([x + 0.3 for x in CONTROL], CONTROL).promote
