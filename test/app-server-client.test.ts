import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { AppServerClient } from "../src/app-server-client.js";

interface Harness {
  client: AppServerClient;
  serverOutput: PassThrough;
  nextSent: () => Promise<Record<string, unknown>>;
  closeTransport: ReturnType<typeof vi.fn>;
}

function createHarness(requestTimeoutMs = 30_000): Harness {
  const serverOutput = new PassThrough();
  const clientInput = new PassThrough();
  const sentQueue: Record<string, unknown>[] = [];
  const waiters: Array<(message: Record<string, unknown>) => void> = [];
  let buffer = "";

  clientInput.on("data", (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line) continue;
      const message = JSON.parse(line) as Record<string, unknown>;
      const waiter = waiters.shift();
      if (waiter) waiter(message);
      else sentQueue.push(message);
    }
  });

  const closeTransport = vi.fn();
  return {
    client: new AppServerClient({
      readable: serverOutput,
      writable: clientInput,
      close: closeTransport,
      requestTimeoutMs,
    }),
    serverOutput,
    closeTransport,
    nextSent: () =>
      sentQueue.length > 0
        ? Promise.resolve(sentQueue.shift()!)
        : new Promise((resolve) => waiters.push(resolve)),
  };
}

describe("AppServerClient", () => {
  it("performs initialize handshake before regular requests", async () => {
    const harness = createHarness();
    const initializing = harness.client.initialize({
      name: "multi_account_usage",
      title: "Multi-account usage",
      version: "0.1.0",
    });

    const initializeRequest = await harness.nextSent();
    expect(initializeRequest).toMatchObject({
      method: "initialize",
      params: {
        clientInfo: {
          name: "multi_account_usage",
          title: "Multi-account usage",
          version: "0.1.0",
        },
      },
    });
    harness.serverOutput.write(
      `${JSON.stringify({ id: initializeRequest.id, result: { userAgent: "test" } })}\n`,
    );

    await initializing;
    expect(await harness.nextSent()).toEqual({ method: "initialized", params: {} });
  });

  it("closes the transport when initialization returns an error", async () => {
    const harness = createHarness();
    const initializing = harness.client.initialize({
      name: "multi_account_usage",
      title: "Multi-account usage",
      version: "0.1.0",
    });
    const request = await harness.nextSent();
    harness.serverOutput.write(
      `${JSON.stringify({
        id: request.id,
        error: { code: -32000, message: "Initialization rejected" },
      })}\n`,
    );

    await expect(initializing).rejects.toThrow("Initialization rejected (-32000)");
    expect(harness.closeTransport).toHaveBeenCalledTimes(1);
    await expect(harness.client.request("account/read", {})).rejects.toThrow(
      "Codex app-server connection closed",
    );
  });

  it("matches concurrent responses by request id", async () => {
    const harness = createHarness();
    const first = harness.client.request<{ value: string }>("first", {});
    const second = harness.client.request<{ value: string }>("second", {});
    const firstRequest = await harness.nextSent();
    const secondRequest = await harness.nextSent();

    harness.serverOutput.write(
      `${JSON.stringify({ id: secondRequest.id, result: { value: "two" } })}\n`,
    );
    harness.serverOutput.write(
      `${JSON.stringify({ id: firstRequest.id, result: { value: "one" } })}\n`,
    );

    await expect(first).resolves.toEqual({ value: "one" });
    await expect(second).resolves.toEqual({ value: "two" });
  });

  it("rejects JSON-RPC errors with a safe message", async () => {
    const harness = createHarness();
    const pending = harness.client.request("account/read", {});
    const request = await harness.nextSent();
    harness.serverOutput.write(
      `${JSON.stringify({
        id: request.id,
        error: { code: -32000, message: "Not signed in", data: { token: "secret" } },
      })}\n`,
    );

    await expect(pending).rejects.toThrow("Not signed in (-32000)");
    await expect(pending).rejects.not.toThrow("secret");
  });

  it("resolves a waiter when the matching notification arrives", async () => {
    const harness = createHarness();
    const waiting = harness.client.waitForNotification<{ loginId: string; success: boolean }>(
      "account/login/completed",
      (params) => params.loginId === "login-2",
      1_000,
    );

    harness.serverOutput.write(
      `${JSON.stringify({
        method: "account/login/completed",
        params: { loginId: "login-1", success: true },
      })}\n`,
    );
    harness.serverOutput.write(
      `${JSON.stringify({
        method: "account/login/completed",
        params: { loginId: "login-2", success: true },
      })}\n`,
    );

    await expect(waiting).resolves.toEqual({ loginId: "login-2", success: true });
  });

  it("rejects pending work when the transport closes", async () => {
    const harness = createHarness();
    const pending = harness.client.request("account/read", {});
    await harness.nextSent();
    harness.serverOutput.destroy();

    await expect(pending).rejects.toThrow("Codex app-server connection closed");
  });

  it("times out an unresponsive request and closes the transport", async () => {
    const harness = createHarness(10);
    const pending = harness.client.request("account/rateLimits/read", {});
    await harness.nextSent();

    await expect(pending).rejects.toThrow(
      "Timed out waiting for Codex app-server response to account/rateLimits/read",
    );
    expect(harness.closeTransport).toHaveBeenCalledTimes(1);
    await expect(harness.client.request("account/read", {})).rejects.toThrow(
      "Codex app-server connection closed",
    );
  });
});
