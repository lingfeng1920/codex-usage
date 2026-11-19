import { homedir } from "node:os";
import { join } from "node:path";
import { AppServerClient } from "./app-server-client.js";
import {
  normalizeRateLimits,
  type AccountSummary,
  type QuotaSnapshot,
  type RateLimitsReadResult,
} from "./quota.js";

export interface AppServerPort {
  request<T>(method: string, params?: unknown): Promise<T>;
  close(): void;
}

interface AccountReadResult {
  account: null | {
    type: string;
    email?: string | null;
    planType?: string | null;
  };
  requiresOpenaiAuth?: boolean;
}

interface LoginStartResult {
  type: string;
  loginId: string;
  authUrl: string;
}

export interface LoginResult {
  status: "login_required";
  loginId: string;
  authUrl: string;
}

export interface UsageServiceOptions {
  clientFactory?: () => Promise<AppServerPort>;
  now?: () => Date;
  codexHome?: string;
}

function defaultCodexHome(): string {
  if (process.env.MULTI_ACCOUNT_CODEX_HOME) {
    return process.env.MULTI_ACCOUNT_CODEX_HOME;
  }
  if (process.env.PLUGIN_DATA) {
    return join(process.env.PLUGIN_DATA, "secondary-codex");
  }
  return join(homedir(), ".codex-multi-account-usage", "secondary-codex");
}

export class UsageService {
  private readonly clientFactory: () => Promise<AppServerPort>;
  private readonly now: () => Date;
  private clientPromise: Promise<AppServerPort> | null = null;

  constructor(options: UsageServiceOptions = {}) {
    const codexHome = options.codexHome ?? defaultCodexHome();
    this.clientFactory =
      options.clientFactory ?? (() => AppServerClient.spawn({ codexHome }));
    this.now = options.now ?? (() => new Date());
  }

  async getUsage(): Promise<QuotaSnapshot> {
    return this.withClient(async (client) => {
      const accountResult = await client.request<AccountReadResult>("account/read", {
        refreshToken: false,
      });
      if (!accountResult.account) {
        return normalizeRateLimits(null, null, this.now());
      }

      const account: AccountSummary = {
        email: accountResult.account.email ?? null,
        planType: accountResult.account.planType ?? null,
      };
      const rateLimits = await client.request<RateLimitsReadResult>(
        "account/rateLimits/read",
        {},
      );
      return normalizeRateLimits(account, rateLimits, this.now());
    });
  }

  async startLogin(): Promise<LoginResult> {
    return this.withClient(async (client) => {
      const result = await client.request<LoginStartResult>("account/login/start", {
        type: "chatgpt",
        useHostedLoginSuccessPage: true,
        appBrand: "chatgpt",
      });
      return {
        status: "login_required",
        loginId: result.loginId,
        authUrl: result.authUrl,
      };
    });
  }

  async logout(): Promise<QuotaSnapshot> {
    return this.withClient(async (client) => {
      await client.request("account/logout", {});
      return normalizeRateLimits(null, null, this.now());
    });
  }

  close(): void {
    void this.clientPromise?.then((client) => client.close());
    this.clientPromise = null;
  }

  private client(): Promise<AppServerPort> {
    this.clientPromise ??= this.clientFactory().catch((error) => {
      this.clientPromise = null;
      throw error;
    });
    return this.clientPromise;
  }

  private async withClient<T>(operation: (client: AppServerPort) => Promise<T>): Promise<T> {
    const client = await this.client();
    try {
      return await operation(client);
    } catch (error) {
      client.close();
      this.clientPromise = null;
      throw error;
    }
  }
}
