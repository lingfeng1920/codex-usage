import { homedir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildMenuSnapshot,
  type MenuSnapshot,
  type NamedAccountSnapshot,
} from "./account-display.js";
import type { QuotaSnapshot } from "./quota.js";
import { UsageService } from "./service.js";

export interface UsageReader {
  getUsage(): Promise<QuotaSnapshot>;
  close(): void;
}

export interface AccountSource {
  alias: string;
  shortAlias: string;
  service: UsageReader;
}

export async function readAccountSnapshots(
  sources: AccountSource[],
): Promise<MenuSnapshot> {
  try {
    const snapshots = await Promise.all(
      sources.map(async ({ alias, shortAlias, service }): Promise<NamedAccountSnapshot> => ({
        alias,
        shortAlias,
        snapshot: await service.getUsage(),
      })),
    );
    return buildMenuSnapshot(snapshots);
  } finally {
    for (const source of sources) source.service.close();
  }
}

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

export async function runSnapshotCommand(): Promise<void> {
  const mainHome = process.env.MAIN_CODEX_HOME ?? resolve(homedir(), ".codex");
  const secondaryHome = requiredEnvironment("SECONDARY_CODEX_HOME");
  const result = await readAccountSnapshots([
    {
      alias: process.env.MAIN_ACCOUNT_ALIAS ?? "个人",
      shortAlias: process.env.MAIN_ACCOUNT_SHORT_ALIAS ?? "个",
      service: new UsageService({ codexHome: mainHome }),
    },
    {
      alias: process.env.SECONDARY_ACCOUNT_ALIAS ?? "团队",
      shortAlias: process.env.SECONDARY_ACCOUNT_SHORT_ALIAS ?? "团",
      service: new UsageService({ codexHome: secondaryHome }),
    },
  ]);
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null;
if (invokedPath === fileURLToPath(import.meta.url)) {
  runSnapshotCommand().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Unable to read account usage: ${message}\n`);
    process.exitCode = 1;
  });
}
