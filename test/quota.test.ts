import { describe, expect, it } from "vitest";
import { normalizeRateLimits } from "../src/quota.js";

const fetchedAt = new Date("2026-11-19T05:30:00.000Z");

describe("normalizeRateLimits", () => {
  it("maps primary and secondary windows to five-hour and weekly quotas", () => {
    const snapshot = normalizeRateLimits(
      { email: "second@example.com", planType: "plus" },
      {
        rateLimits: {
          limitId: "codex",
          limitName: "Codex",
          primary: {
            usedPercent: 25,
            windowDurationMins: 300,
            resetsAt: 1_795_100_400,
          },
          secondary: {
            usedPercent: 60,
            windowDurationMins: 10_080,
            resetsAt: 1_795_618_800,
          },
        },
      },
      fetchedAt,
    );

    expect(snapshot.connection).toBe("connected");
    expect(snapshot.email).toBe("second@example.com");
    expect(snapshot.planType).toBe("plus");
    expect(snapshot.fiveHour).toMatchObject({
      label: "5 小时",
      usedPercent: 25,
      remainingPercent: 75,
      windowDurationMins: 300,
    });
    expect(snapshot.weekly).toMatchObject({
      label: "每周",
      usedPercent: 60,
      remainingPercent: 40,
      windowDurationMins: 10_080,
    });
    expect(snapshot.fetchedAt).toBe("2026-11-19T05:30:00.000Z");
  });

  it("flattens multiple limit ids without duplicating the legacy bucket", () => {
    const codex = {
      limitId: "codex",
      primary: {
        usedPercent: 10,
        windowDurationMins: 300,
        resetsAt: 1_795_100_400,
      },
      secondary: null,
    };
    const snapshot = normalizeRateLimits(
      { email: "second@example.com", planType: "business" },
      {
        rateLimits: codex,
        rateLimitsByLimitId: {
          codex,
          codex_review: {
            limitId: "codex_review",
            limitName: "Code Review",
            primary: {
              usedPercent: 20,
              windowDurationMins: 1_440,
              resetsAt: 1_795_186_800,
            },
            secondary: null,
          },
        },
      },
      fetchedAt,
    );

    expect(snapshot.fiveHour?.limitId).toBe("codex");
    expect(snapshot.other).toHaveLength(1);
    expect(snapshot.other[0]).toMatchObject({
      limitId: "codex_review",
      label: "Code Review · 24 小时",
      usedPercent: 20,
    });
  });

  it("prefers the canonical codex bucket when another bucket has the same duration", () => {
    const codex = {
      limitId: "codex",
      limitName: "Codex",
      primary: {
        usedPercent: 20,
        windowDurationMins: 300,
        resetsAt: 1_795_100_400,
      },
      secondary: {
        usedPercent: 45,
        windowDurationMins: 10_080,
        resetsAt: 1_795_618_800,
      },
    };
    const snapshot = normalizeRateLimits(
      { email: "second@example.com", planType: "plus" },
      {
        rateLimits: codex,
        rateLimitsByLimitId: {
          codex_review: {
            limitId: "codex_review",
            limitName: "Code Review",
            primary: {
              usedPercent: 90,
              windowDurationMins: 300,
              resetsAt: 1_795_100_400,
            },
            secondary: null,
          },
          codex,
        },
      },
      fetchedAt,
    );

    expect(snapshot.fiveHour).toMatchObject({ limitId: "codex", usedPercent: 20 });
    expect(snapshot.weekly).toMatchObject({ limitId: "codex", usedPercent: 45 });
    expect(snapshot.other).toContainEqual(
      expect.objectContaining({
        limitId: "codex_review",
        label: "Code Review · 5 小时",
        usedPercent: 90,
      }),
    );
  });

  it("clamps invalid percentages and accepts millisecond reset timestamps", () => {
    const snapshot = normalizeRateLimits(
      { email: null, planType: null },
      {
        rateLimits: {
          limitId: "codex",
          primary: {
            usedPercent: 140,
            windowDurationMins: 300,
            resetsAt: 1_795_100_400_000,
          },
          secondary: {
            usedPercent: -12,
            windowDurationMins: 10_080,
            resetsAt: null,
          },
        },
      },
      fetchedAt,
    );

    expect(snapshot.fiveHour).toMatchObject({
      usedPercent: 100,
      remainingPercent: 0,
      resetsAt: "2026-11-19T15:00:00.000Z",
    });
    expect(snapshot.weekly).toMatchObject({
      usedPercent: 0,
      remainingPercent: 100,
      resetsAt: null,
    });
  });

  it("returns missing standard windows explicitly", () => {
    const snapshot = normalizeRateLimits(
      { email: "pro@example.com", planType: "pro" },
      { rateLimits: null },
      fetchedAt,
    );

    expect(snapshot.fiveHour).toBeNull();
    expect(snapshot.weekly).toBeNull();
    expect(snapshot.other).toEqual([]);
  });

  it("returns a disconnected snapshot without quota data", () => {
    const snapshot = normalizeRateLimits(null, null, fetchedAt);

    expect(snapshot).toEqual({
      connection: "disconnected",
      email: null,
      planType: null,
      fiveHour: null,
      weekly: null,
      other: [],
      fetchedAt: "2026-11-19T05:30:00.000Z",
    });
  });
});
