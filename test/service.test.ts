import { describe, expect, it, vi } from "vitest";
import { UsageService, type AppServerPort } from "../src/service.js";

function fakeClient(
  responder: (method: string, params: unknown) => unknown | Promise<unknown>,
): AppServerPort {
  const request = vi.fn(async (method: string, params: unknown) => responder(method, params));
  return {
    request: request as unknown as AppServerPort["request"],
    close: vi.fn(),
  };
}

describe("UsageService", () => {
  it("returns a disconnected snapshot when the secondary account is signed out", async () => {
    const client = fakeClient((method) => {
      if (method === "account/read") {
        return { account: null, requiresOpenaiAuth: true };
      }
      throw new Error(`unexpected ${method}`);
    });
    const service = new UsageService({
      clientFactory: async () => client,
      now: () => new Date("2026-11-19T06:00:00.000Z"),
    });

    await expect(service.getUsage()).resolves.toMatchObject({
      connection: "disconnected",
      fiveHour: null,
      weekly: null,
    });
  });

  it("starts the managed ChatGPT browser login flow", async () => {
    const client = fakeClient((method, params) => {
      if (method === "account/login/start") {
        expect(params).toEqual({
          type: "chatgpt",
          useHostedLoginSuccessPage: true,
          appBrand: "chatgpt",
        });
        return {
          type: "chatgpt",
          loginId: "login-123",
          authUrl: "https://auth.openai.com/authorize?state=abc",
        };
      }
      throw new Error(`unexpected ${method}`);
    });
    const service = new UsageService({ clientFactory: async () => client });

    await expect(service.startLogin()).resolves.toEqual({
      status: "login_required",
      loginId: "login-123",
      authUrl: "https://auth.openai.com/authorize?state=abc",
    });
  });

  it("reads and normalizes connected account limits", async () => {
    const client = fakeClient((method) => {
      if (method === "account/read") {
        return {
          account: {
            type: "chatgpt",
            email: "second@example.com",
            planType: "plus",
          },
          requiresOpenaiAuth: true,
        };
      }
      if (method === "account/rateLimits/read") {
        return {
          rateLimits: {
            limitId: "codex",
            primary: {
              usedPercent: 35,
              windowDurationMins: 300,
              resetsAt: 1_795_104_000,
            },
            secondary: {
              usedPercent: 70,
              windowDurationMins: 10_080,
              resetsAt: 1_795_622_400,
            },
          },
        };
      }
      throw new Error(`unexpected ${method}`);
    });
    const service = new UsageService({
      clientFactory: async () => client,
      now: () => new Date("2026-11-19T06:00:00.000Z"),
    });

    const snapshot = await service.getUsage();
    expect(snapshot).toMatchObject({
      connection: "connected",
      email: "second@example.com",
      planType: "plus",
      fiveHour: { usedPercent: 35, remainingPercent: 65 },
      weekly: { usedPercent: 70, remainingPercent: 30 },
    });
  });

  it("logs out only the secondary account", async () => {
    const client = fakeClient((method) => {
      if (method === "account/logout") return {};
      throw new Error(`unexpected ${method}`);
    });
    const service = new UsageService({
      clientFactory: async () => client,
      now: () => new Date("2026-11-19T06:00:00.000Z"),
    });

    await expect(service.logout()).resolves.toMatchObject({
      connection: "disconnected",
      fetchedAt: "2026-11-19T06:00:00.000Z",
    });
    expect(client.request).toHaveBeenCalledWith("account/logout", {});
  });

  it("reuses one app-server client across refreshes", async () => {
    const client = fakeClient((method) => {
      if (method === "account/read") return { account: null };
      throw new Error(`unexpected ${method}`);
    });
    const clientFactory = vi.fn(async () => client);
    const service = new UsageService({ clientFactory });

    await service.getUsage();
    await service.getUsage();

    expect(clientFactory).toHaveBeenCalledTimes(1);
  });

  it("recreates the app-server client after a request failure", async () => {
    const failedClient = fakeClient(() => {
      throw new Error("Timed out");
    });
    const recoveredClient = fakeClient((method) => {
      if (method === "account/read") return { account: null };
      throw new Error(`unexpected ${method}`);
    });
    const clientFactory = vi
      .fn<() => Promise<AppServerPort>>()
      .mockResolvedValueOnce(failedClient)
      .mockResolvedValueOnce(recoveredClient);
    const service = new UsageService({ clientFactory });

    await expect(service.getUsage()).rejects.toThrow("Timed out");
    await expect(service.getUsage()).resolves.toMatchObject({
      connection: "disconnected",
    });
    expect(clientFactory).toHaveBeenCalledTimes(2);
    expect(failedClient.close).toHaveBeenCalledTimes(1);
  });
});
