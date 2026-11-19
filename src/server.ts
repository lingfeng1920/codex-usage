import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  registerAppResource,
  registerAppTool,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { UsageService } from "./service.js";

const UI_URI = "ui://multi-account-usage/dashboard.html";
const pluginRoot = process.env.PLUGIN_ROOT ?? process.cwd();
const dashboardHtml = readFileSync(
  join(pluginRoot, "public", "usage-widget.html"),
  "utf8",
);
const service = new UsageService();

const emptyInput = z.object({});
const uiMeta = {
  ui: { resourceUri: UI_URI },
};

function toolResult(
  data: unknown,
  message: string,
  metadata?: Record<string, unknown>,
) {
  return {
    content: [{ type: "text" as const, text: message }],
    structuredContent: data as Record<string, unknown>,
    ...(metadata ? { _meta: metadata } : {}),
  };
}

function errorResult(error: unknown) {
  const message = error instanceof Error ? error.message : "Unknown local error";
  return {
    isError: true,
    content: [{ type: "text" as const, text: `读取另一个账号用量失败：${message}` }],
    structuredContent: { status: "error", message },
  };
}

const server = new McpServer(
  { name: "multi-account-usage", version: "0.1.0" },
  {
    instructions:
      "Read-only local dashboard for a secondary ChatGPT/Codex account. Use get_usage to inspect its current quota windows.",
  },
);

registerAppResource(
  server,
  "Codex 多账号用量",
  UI_URI,
  {
    _meta: {
      ui: {
        prefersBorder: false,
        csp: {},
      },
    },
  },
  async () => ({
    contents: [
      {
        uri: UI_URI,
        mimeType: RESOURCE_MIME_TYPE,
        text: dashboardHtml,
        _meta: {
          ui: {
            prefersBorder: false,
            csp: {},
          },
          "openai/widgetCSP": {
            redirect_domains: ["https://auth.openai.com", "https://chatgpt.com"],
          },
        },
      },
    ],
  }),
);

registerAppTool(
  server,
  "get_usage",
  {
    title: "查看账号用量",
    description: "读取另一个本地登录的 ChatGPT/Codex 账号的当前限额窗口。",
    inputSchema: emptyInput,
    _meta: {
      ...uiMeta,
      "openai/ui": { entrypoints: [{ type: "global" }] },
    },
  },
  async () => {
    try {
      const snapshot = await service.getUsage();
      return toolResult(snapshot, "已读取另一个账号的 Codex 用量。");
    } catch (error) {
      return errorResult(error);
    }
  },
);

registerAppTool(
  server,
  "refresh_usage",
  {
    title: "刷新账号用量",
    description: "刷新另一个账号的当前 Codex 限额窗口。",
    inputSchema: emptyInput,
    _meta: { ui: { resourceUri: UI_URI, visibility: ["app"] } },
  },
  async () => {
    try {
      const snapshot = await service.getUsage();
      return toolResult(snapshot, "用量已刷新。");
    } catch (error) {
      return errorResult(error);
    }
  },
);

registerAppTool(
  server,
  "start_login",
  {
    title: "连接另一个账号",
    description: "启动另一个 ChatGPT/Codex 账号的本地浏览器登录流程。",
    inputSchema: emptyInput,
    _meta: { ui: { resourceUri: UI_URI, visibility: ["app"] } },
  },
  async () => {
    try {
      const login = await service.startLogin();
      return toolResult(
        { status: login.status },
        "请在浏览器中完成另一个账号的登录。",
        { authUrl: login.authUrl, loginId: login.loginId },
      );
    } catch (error) {
      return errorResult(error);
    }
  },
);

registerAppTool(
  server,
  "logout_secondary_account",
  {
    title: "断开另一个账号",
    description: "退出插件保存的另一个 ChatGPT/Codex 账号。",
    inputSchema: emptyInput,
    _meta: { ui: { resourceUri: UI_URI, visibility: ["app"] } },
  },
  async () => {
    try {
      const snapshot = await service.logout();
      return toolResult(snapshot, "另一个账号已断开。");
    } catch (error) {
      return errorResult(error);
    }
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);

const shutdown = () => {
  service.close();
  void server.close();
};
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
