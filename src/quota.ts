export interface AccountSummary {
  email: string | null;
  planType: string | null;
}

export interface RateLimitWindowInput {
  usedPercent: number;
  windowDurationMins: number;
  resetsAt: number | null;
}

export interface RateLimitBucketInput {
  limitId: string;
  limitName?: string | null;
  primary?: RateLimitWindowInput | null;
  secondary?: RateLimitWindowInput | null;
  planType?: string | null;
}

export interface RateLimitsReadResult {
  rateLimits?: RateLimitBucketInput | null;
  rateLimitsByLimitId?: Record<string, RateLimitBucketInput> | null;
}

export interface QuotaWindow {
  limitId: string;
  limitName: string | null;
  label: string;
  usedPercent: number;
  remainingPercent: number;
  windowDurationMins: number;
  resetsAt: string | null;
}

export interface QuotaSnapshot {
  connection: "connected" | "disconnected";
  email: string | null;
  planType: string | null;
  fiveHour: QuotaWindow | null;
  weekly: QuotaWindow | null;
  other: QuotaWindow[];
  fetchedAt: string;
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
}

function toIsoTimestamp(value: number | null): string | null {
  if (value === null || !Number.isFinite(value)) return null;
  const milliseconds = value < 10_000_000_000 ? value * 1_000 : value;
  const date = new Date(milliseconds);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function durationLabel(minutes: number): string {
  if (minutes === 300) return "5 小时";
  if (minutes === 10_080) return "每周";
  if (minutes > 0 && minutes % 60 === 0) return `${minutes / 60} 小时`;
  return `${minutes} 分钟`;
}

function normalizeWindow(
  bucket: RateLimitBucketInput,
  window: RateLimitWindowInput,
  canonical: boolean,
): QuotaWindow {
  const usedPercent = clampPercent(window.usedPercent);
  const duration = durationLabel(window.windowDurationMins);
  const standardWindow =
    canonical &&
    (window.windowDurationMins === 300 || window.windowDurationMins === 10_080);

  return {
    limitId: bucket.limitId,
    limitName: bucket.limitName ?? null,
    label: standardWindow
      ? duration
      : `${bucket.limitName ?? bucket.limitId} · ${duration}`,
    usedPercent,
    remainingPercent: 100 - usedPercent,
    windowDurationMins: window.windowDurationMins,
    resetsAt: toIsoTimestamp(window.resetsAt),
  };
}

interface CollectedBucket {
  bucket: RateLimitBucketInput;
  canonical: boolean;
}

function collectBuckets(result: RateLimitsReadResult | null): CollectedBucket[] {
  if (!result) return [];
  const byId = result.rateLimitsByLimitId
    ? Object.values(result.rateLimitsByLimitId)
    : [];
  if (byId.length === 0) {
    return result.rateLimits ? [{ bucket: result.rateLimits, canonical: true }] : [];
  }

  const canonicalId =
    result.rateLimits?.limitId ??
    (byId.some((bucket) => bucket.limitId === "codex") ? "codex" : byId[0].limitId);
  const buckets = [...byId];
  if (
    result.rateLimits &&
    !buckets.some((bucket) => bucket.limitId === result.rateLimits?.limitId)
  ) {
    buckets.unshift(result.rateLimits);
  }
  return buckets.map((bucket) => ({ bucket, canonical: bucket.limitId === canonicalId }));
}

export function normalizeRateLimits(
  account: AccountSummary | null,
  result: RateLimitsReadResult | null,
  fetchedAt = new Date(),
): QuotaSnapshot {
  if (!account) {
    return {
      connection: "disconnected",
      email: null,
      planType: null,
      fiveHour: null,
      weekly: null,
      other: [],
      fetchedAt: fetchedAt.toISOString(),
    };
  }

  const buckets = collectBuckets(result);
  const windows = buckets.flatMap(({ bucket, canonical }) =>
    [bucket.primary, bucket.secondary]
      .filter((window): window is RateLimitWindowInput => Boolean(window))
      .map((window) => ({ quota: normalizeWindow(bucket, window, canonical), canonical })),
  );

  const fiveHour =
    windows.find(({ quota, canonical }) => canonical && quota.windowDurationMins === 300)
      ?.quota ?? null;
  const weekly =
    windows.find(
      ({ quota, canonical }) => canonical && quota.windowDurationMins === 10_080,
    )?.quota ?? null;
  const other = windows.filter(
    ({ quota, canonical }) =>
      !canonical ||
      (quota.windowDurationMins !== 300 && quota.windowDurationMins !== 10_080),
  ).map(({ quota }) => quota);
  const bucketPlan = buckets.find(({ bucket }) => bucket.planType)?.bucket.planType;

  return {
    connection: "connected",
    email: account.email,
    planType: account.planType ?? bucketPlan ?? null,
    fiveHour,
    weekly,
    other,
    fetchedAt: fetchedAt.toISOString(),
  };
}
