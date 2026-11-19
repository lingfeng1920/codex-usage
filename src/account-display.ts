import type { QuotaSnapshot, QuotaWindow } from "./quota.js";

export interface NamedAccountSnapshot {
  alias: string;
  shortAlias: string;
  snapshot: QuotaSnapshot;
}

export interface MenuAccountSnapshot {
  alias: string;
  shortAlias: string;
  connection: QuotaSnapshot["connection"];
  email: string | null;
  planType: string | null;
  fiveHour: QuotaWindow | null;
  weekly: QuotaWindow | null;
  fetchedAt: string;
}

export interface MenuSnapshot {
  title: string;
  accounts: MenuAccountSnapshot[];
  fetchedAt: string;
}

function remaining(window: QuotaWindow | null): string {
  return window === null ? "—" : String(window.remainingPercent);
}

function accountTitle(account: NamedAccountSnapshot): string {
  if (account.snapshot.connection === "disconnected") {
    return `${account.shortAlias}离线`;
  }
  return `${account.shortAlias}${remaining(account.snapshot.fiveHour)}/${remaining(account.snapshot.weekly)}`;
}

export function buildMenuSnapshot(accounts: NamedAccountSnapshot[]): MenuSnapshot {
  return {
    title: accounts.map(accountTitle).join(" · "),
    accounts: accounts.map(({ alias, shortAlias, snapshot }) => ({
      alias,
      shortAlias,
      connection: snapshot.connection,
      email: snapshot.email,
      planType: snapshot.planType,
      fiveHour: snapshot.fiveHour,
      weekly: snapshot.weekly,
      fetchedAt: snapshot.fetchedAt,
    })),
    fetchedAt: accounts.map(({ snapshot }) => snapshot.fetchedAt).sort().at(-1) ?? new Date(0).toISOString(),
  };
}
