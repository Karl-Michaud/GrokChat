import type { Account } from "../../entities/accounts/account";
import { ANALYTICS_RANGES, type AnalyticsRange } from "../../entities/analytics/range";
import { accountId } from "../../entities/identity/ids";
import type { Analytics } from "../../use_cases/get_analytics/output_data";
import type { GetMediaUsageOutputData } from "../../use_cases/get_media_usage/output_data";
import {
  accountOptions,
  badgeOf,
  loadAccounts,
  type AccountBadge,
  type AccountOption,
} from "./account_directory";
import { ADMIN } from "./admin_actor";
import {
  accountRows,
  CHART_METRICS,
  comparison,
  followersChart,
  kpis,
  METRIC_LABELS,
  metricChart,
  RANGE_LABELS,
  topPostRows,
  type AccountRow,
  type ChartMetric,
  type KpiGroups,
  type TopPostRow,
} from "./analytics_views";
import { barRows, type BarRow, type LineChartView } from "./charts";
import { compact, dollars, exact, signedCompact } from "./format";
import { filled } from "./form_values";
import { href } from "./links";
import { mediaMeters, type MediaMeter } from "./media_views";
import { invalid, page, refused, type Outcome } from "./outcome";
import { runUseCase } from "./presenter";
import { oneOf } from "./query";
import type { AnalyticsUseCases } from "./use_cases";

export const ANALYTICS_PAGE = "/dashboard/analytics";

export interface AnalyticsQuery {
  readonly range: string | null;
  readonly metric: string | null;
  readonly account: string | null;
}

export interface Tab {
  readonly label: string;
  readonly href: string;
  readonly current: boolean;
}

export interface AnalyticsView {
  readonly range: AnalyticsRange;
  readonly metric: ChartMetric;
  readonly rangeLabel: string;
  /** "Compared with the 7 days before"; null for all time. */
  readonly compared: string | null;
  readonly ranges: readonly Tab[];
  readonly metrics: readonly Tab[];
  readonly metricLabel: string;
  readonly accounts: readonly AccountOption[];
  /** The account the page is scoped to; null for every account. */
  readonly account: AccountBadge | null;
  readonly kpis: KpiGroups;
  readonly chart: LineChartView;
  readonly followers: LineChartView;
  readonly followersNow: string;
  readonly followerGrowth: string;
  readonly comparison: readonly BarRow[];
  readonly accountRows: readonly AccountRow[];
  readonly topPosts: readonly TopPostRow[];
  readonly spend: {
    readonly total: string;
    readonly calls: string;
    readonly unknownPriced: number;
  };
  readonly spendByAccount: readonly BarRow[];
  readonly media: readonly MediaMeter[];
  readonly mediaMonth: string;
}

const SHORT_RANGES: Readonly<Record<AnalyticsRange, string>> = {
  "24h": "24h",
  "3d": "3d",
  "7d": "7d",
  "14d": "14d",
  "30d": "30d",
  all: "All",
};

const COMPARED: Readonly<Record<AnalyticsRange, string | null>> = {
  "24h": "vs the 24 hours before",
  "3d": "vs the 3 days before",
  "7d": "vs the 7 days before",
  "14d": "vs the 14 days before",
  "30d": "vs the 30 days before",
  all: null,
};

interface Chosen {
  readonly range: AnalyticsRange;
  readonly metric: ChartMetric;
  readonly account: string | null;
}

const link = (chosen: Chosen) =>
  href(ANALYTICS_PAGE, { range: chosen.range, metric: chosen.metric, account: chosen.account });

function tabs(chosen: Chosen): {
  readonly ranges: readonly Tab[];
  readonly metrics: readonly Tab[];
} {
  return {
    ranges: ANALYTICS_RANGES.map((range) => ({
      label: SHORT_RANGES[range],
      href: link({ ...chosen, range }),
      current: range === chosen.range,
    })),
    metrics: CHART_METRICS.map((metric) => ({
      label: METRIC_LABELS[metric],
      href: link({ ...chosen, metric }),
      current: metric === chosen.metric,
    })),
  };
}

function spendRows(analytics: Analytics, accounts: readonly Account[]): readonly BarRow[] {
  const rows = analytics.accounts.map((row) => ({
    label: badgeOf(accounts, row.accountId).handle,
    value: row.spend.micros,
  }));
  return barRows(rows, dollars);
}

/** The analytics page (GROKCHAT-15): every account or one, over a range, against the one before. */
export class AnalyticsController {
  constructor(private readonly useCases: AnalyticsUseCases) {}

  async analytics(query: AnalyticsQuery): Promise<Outcome<AnalyticsView>> {
    const range = oneOf(query.range, ANALYTICS_RANGES, "7d");
    const metric = oneOf(query.metric, CHART_METRICS, "impressions");
    if (range === null || metric === null) {
      return invalid("Unknown range or metric.");
    }
    const chosen = { range, metric, account: filled(query.account) };
    const input = {
      actor: ADMIN,
      range,
      // Stryker disable next-line ConditionalExpression: the id brands are identity casts, so null maps to null either way.
      accountId: chosen.account === null ? null : accountId(chosen.account),
    };
    const result = await runUseCase(this.useCases.analytics, input, (output) => output);
    if (!result.ok) {
      return refused(result.code);
    }
    const accounts = await loadAccounts(this.useCases);
    const media = await runUseCase(
      this.useCases.mediaUsage,
      { actor: ADMIN },
      (output: GetMediaUsageOutputData) => output,
    );
    return page(this.view(result, accounts, chosen, media));
  }

  private view(
    analytics: Analytics,
    accounts: readonly Account[],
    chosen: Chosen,
    media: GetMediaUsageOutputData,
  ): AnalyticsView {
    const { current } = analytics;
    return {
      range: chosen.range,
      metric: chosen.metric,
      rangeLabel: RANGE_LABELS[chosen.range],
      compared: COMPARED[chosen.range],
      ...tabs(chosen),
      metricLabel: METRIC_LABELS[chosen.metric],
      accounts: accountOptions(accounts, chosen.account),
      account: chosen.account === null ? null : badgeOf(accounts, chosen.account),
      kpis: kpis(current, analytics.previous, analytics.buckets),
      chart: metricChart(analytics, chosen.metric),
      followers: followersChart(analytics),
      followersNow: analytics.followers === null ? "—" : exact(analytics.followers),
      followerGrowth: signedCompact(current.growth),
      comparison: comparison(analytics, accounts, chosen.metric),
      accountRows: accountRows(analytics, accounts, (id) => link({ ...chosen, account: id })),
      topPosts: topPostRows(analytics.topPosts, accounts),
      spend: {
        total: dollars(current.spend.micros),
        calls: compact(current.spend.calls),
        unknownPriced: current.spend.unknownPriced,
      },
      spendByAccount: spendRows(analytics, accounts),
      media: media.ok ? mediaMeters(media.usage, media.guards, media.allowance) : [],
      mediaMonth: media.ok ? media.usage.month : "",
    };
  }
}
