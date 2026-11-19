import { describe, expect, it, vi } from "vitest";
import { buildMenuSnapshot } from "../src/account-display.js";
import { readAccountSnapshots } from "../src/menu-snapshot.js";
import type { QuotaSnapshot, QuotaWindow } from "../src/quota.js";

function window(
  label: string,
  usedPercent: number,
  resetsAt: string,
): QuotaWindow {
  return {
    limitId: "codex",
    limitName: null,
    label,
    usedPercent,
    remainingPercent: 100 - usedPercent,
    windowDurationMins: label === "5 小时" ? 300 : 10_080,
    resetsAt,
  };
}

function connected(
  planType: string,
  fiveHourUsed: number,
  weeklyUsed: number,
): QuotaSnapshot {
  return {
    connection: "connected",
    email: "same@example.com",
    planType,
    fiveHour: window("5 小时", fiveHourUsed, "2026-11-19T12:00:00.000Z"),
    weekly: window("每周", weeklyUsed, "2026-11-24T07:00:00.000Z"),
    other: [],
    fetchedAt: "2026-11-19T07:00:00.000Z",
  };
}

describe("buildMenuSnapshot", () => {
  it("shows both account aliases with five-hour and weekly remaining percentages", () => {
    const result = buildMenuSnapshot([
      {
        alias: "个人",
        shortAlias: "个",
        snapshot: connected("plus", 47, 49),
      },
      {
        alias: "团队",
        shortAlias: "团",
        snapshot: connected("team", 0, 53),
      },
    ]);

    expect(result).toMatchObject({
      title: "个53/51 · 团100/47",
      accounts: [
        {
          alias: "个人",
          shortAlias: "个",
          planType: "plus",
          fiveHour: { usedPercent: 47, remainingPercent: 53 },
        },
        {
          alias: "团队",
          shortAlias: "团",
          planType: "team",
          weekly: { usedPercent: 53, remainingPercent: 47 },
        },
      ],
    });
  });

  it("marks a signed-out account without hiding the other account", () => {
    const disconnected: QuotaSnapshot = {
      connection: "disconnected",
      email: null,
      planType: null,
      fiveHour: null,
      weekly: null,
      other: [],
      fetchedAt: "2026-11-19T07:00:00.000Z",
    };

    expect(
      buildMenuSnapshot([
        { alias: "个人", shortAlias: "个", snapshot: connected("plus", 47, 49) },
        { alias: "团队", shortAlias: "团", snapshot: disconnected },
      ]).title,
    ).toBe("个53/51 · 团离线");
  });

  it("uses a dash when a connected account has no matching quota window", () => {
    const snapshot = connected("plus", 47, 49);
    snapshot.weekly = null;

    expect(
      buildMenuSnapshot([{ alias: "个人", shortAlias: "个", snapshot }]).title,
    ).toBe("个53/—");
  });
});

describe("readAccountSnapshots", () => {
  it("reads both services concurrently, preserves account order, and closes them", async () => {
    let releasePersonal: ((snapshot: QuotaSnapshot) => void) | undefined;
    let releaseTeam: ((snapshot: QuotaSnapshot) => void) | undefined;
    const personalPromise = new Promise<QuotaSnapshot>((resolve) => {
      releasePersonal = resolve;
    });
    const teamPromise = new Promise<QuotaSnapshot>((resolve) => {
      releaseTeam = resolve;
    });
    const personal = {
      getUsage: vi.fn(() => personalPromise),
      close: vi.fn(),
    };
    const team = {
      getUsage: vi.fn(() => teamPromise),
      close: vi.fn(),
    };

    const pending = readAccountSnapshots([
      { alias: "个人", shortAlias: "个", service: personal },
      { alias: "团队", shortAlias: "团", service: team },
    ]);

    expect(personal.getUsage).toHaveBeenCalledTimes(1);
    expect(team.getUsage).toHaveBeenCalledTimes(1);
    releaseTeam?.(connected("team", 0, 53));
    releasePersonal?.(connected("plus", 47, 49));

    await expect(pending).resolves.toMatchObject({
      title: "个53/51 · 团100/47",
      accounts: [{ alias: "个人" }, { alias: "团队" }],
    });
    expect(personal.close).toHaveBeenCalledTimes(1);
    expect(team.close).toHaveBeenCalledTimes(1);
  });
});
