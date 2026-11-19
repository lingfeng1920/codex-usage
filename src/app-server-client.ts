import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";

interface JsonRpcError {
  code?: number;
  message?: string;
}

interface JsonRpcMessage {
  id?: number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: JsonRpcError;
}

interface PendingRequest {
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

interface NotificationWaiter<T = unknown> {
  method: string;
  predicate: (params: T) => boolean;
  resolve: (params: T) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

export interface ClientInfo {
  name: string;
  title: string;
  version: string;
}

export interface AppServerClientOptions {
  readable: Readable;
  writable: Writable;
  close?: () => void;
  requestTimeoutMs?: number;
}

export interface SpawnAppServerOptions {
  codexHome: string;
  codexExecutable?: string;
  cwd?: string;
}

function childEnvironment(codexHome: string): NodeJS.ProcessEnv {
  const allowedKeys = [
    "PATH",
    "HOME",
    "TMPDIR",
    "TEMP",
    "TMP",
    "LANG",
    "LC_ALL",
    "SSL_CERT_FILE",
    "SSL_CERT_DIR",
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "ALL_PROXY",
    "NO_PROXY",
    "http_proxy",
    "https_proxy",
    "all_proxy",
    "no_proxy",
  ];
  const env: NodeJS.ProcessEnv = { CODEX_HOME: codexHome };
  for (const key of allowedKeys) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  return env;
}

export class AppServerClient {
  private readonly readable: Readable;
  private readonly writable: Writable;
  private readonly closeTransport?: () => void;
  private readonly requestTimeoutMs: number;
  private readonly pending = new Map<number, PendingRequest>();
  private readonly notificationWaiters: NotificationWaiter<unknown>[] = [];
  private nextId = 1;
  private closed = false;

  constructor(options: AppServerClientOptions) {
    this.readable = options.readable;
    this.writable = options.writable;
    this.closeTransport = options.close;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 30_000;

    const lines = createInterface({ input: this.readable });
    lines.on("line", (line) => this.handleLine(line));
    lines.on("close", () => this.failAll(new Error("Codex app-server connection closed")));
    this.readable.on("close", () =>
      this.failAll(new Error("Codex app-server connection closed")),
    );
    this.readable.on("end", () =>
      this.failAll(new Error("Codex app-server connection closed")),
    );
    this.readable.on("error", () =>
      this.failAll(new Error("Codex app-server connection failed")),
    );
    this.writable.on("error", () =>
      this.failAll(new Error("Codex app-server connection failed")),
    );
  }

  static async spawn(options: SpawnAppServerOptions): Promise<AppServerClient> {
    await mkdir(options.codexHome, { recursive: true, mode: 0o700 });
    const child: ChildProcessWithoutNullStreams = spawn(
      options.codexExecutable ?? process.env.CODEX_BIN ?? "codex",
      ["app-server", "--stdio"],
      {
        cwd: options.cwd ?? process.cwd(),
        env: childEnvironment(options.codexHome),
        stdio: ["pipe", "pipe", "pipe"],
      },
    );

    const client = new AppServerClient({
      readable: child.stdout,
      writable: child.stdin,
      close: () => {
        child.stdin.end();
        if (!child.killed) child.kill("SIGTERM");
      },
    });
    child.on("error", () =>
      client.failAll(new Error("Unable to start the Codex app-server process")),
    );
    child.on("exit", () =>
      client.failAll(new Error("Codex app-server connection closed")),
    );
    child.stderr.resume();

    await client.initialize({
      name: "multi_account_usage",
      title: "Multi-account usage",
      version: "0.1.0",
    });
    return client;
  }

  async initialize(clientInfo: ClientInfo): Promise<void> {
    try {
      await this.request("initialize", { clientInfo });
      this.notify("initialized", {});
    } catch (error) {
      this.close();
      throw error;
    }
  }

  request<T>(method: string, params: unknown = {}): Promise<T> {
    if (this.closed) {
      return Promise.reject(new Error("Codex app-server connection closed"));
    }
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        const pending = this.pending.get(id);
        if (!pending) return;
        this.pending.delete(id);
        pending.reject(
          new Error(`Timed out waiting for Codex app-server response to ${method}`),
        );
        this.closeTransport?.();
        this.failAll(new Error("Codex app-server connection closed"));
      }, this.requestTimeoutMs);
      this.pending.set(id, {
        resolve: (result) => resolve(result as T),
        reject,
        timer,
      });
      try {
        this.write({ method, id, params });
      } catch {
        this.pending.delete(id);
        clearTimeout(timer);
        reject(new Error("Codex app-server connection failed"));
      }
    });
  }

  waitForNotification<T>(
    method: string,
    predicate: (params: T) => boolean = () => true,
    timeoutMs = 120_000,
  ): Promise<T> {
    if (this.closed) {
      return Promise.reject(new Error("Codex app-server connection closed"));
    }
    return new Promise<T>((resolve, reject) => {
      const waiter: NotificationWaiter<T> = {
        method,
        predicate,
        resolve,
        reject,
        timer: setTimeout(() => {
          const index = this.notificationWaiters.indexOf(
            waiter as NotificationWaiter<unknown>,
          );
          if (index >= 0) this.notificationWaiters.splice(index, 1);
          reject(new Error(`Timed out waiting for ${method}`));
        }, timeoutMs),
      };
      waiter.timer.unref?.();
      this.notificationWaiters.push(waiter as NotificationWaiter<unknown>);
    });
  }

  close(): void {
    if (this.closed) return;
    this.closeTransport?.();
    this.failAll(new Error("Codex app-server connection closed"));
  }

  private notify(method: string, params: unknown): void {
    this.write({ method, params });
  }

  private write(message: JsonRpcMessage): void {
    if (this.closed || this.writable.destroyed) {
      throw new Error("Codex app-server connection closed");
    }
    this.writable.write(`${JSON.stringify(message)}\n`);
  }

  private handleLine(line: string): void {
    let message: JsonRpcMessage;
    try {
      message = JSON.parse(line) as JsonRpcMessage;
    } catch {
      return;
    }

    if (message.id !== undefined) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error) {
        const text = message.error.message ?? "Codex app-server request failed";
        const suffix =
          message.error.code === undefined ? "" : ` (${message.error.code})`;
        pending.reject(new Error(`${text}${suffix}`));
      } else {
        pending.resolve(message.result);
      }
      return;
    }

    if (!message.method) return;
    for (let index = 0; index < this.notificationWaiters.length; index += 1) {
      const waiter = this.notificationWaiters[index];
      if (waiter.method !== message.method || !waiter.predicate(message.params)) continue;
      this.notificationWaiters.splice(index, 1);
      clearTimeout(waiter.timer);
      waiter.resolve(message.params);
      break;
    }
  }

  private failAll(error: Error): void {
    if (this.closed) return;
    this.closed = true;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
    for (const waiter of this.notificationWaiters) {
      clearTimeout(waiter.timer);
      waiter.reject(error);
    }
    this.notificationWaiters.length = 0;
  }
}
