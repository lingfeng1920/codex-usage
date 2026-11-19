# Codex 多账号用量侧边栏实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 subagent-driven-development（推荐）或 executing-plans 逐任务实现此计划。步骤使用复选框（`- [x]`）语法来跟踪进度。

**目标：** 构建一个仅在本机运行的 Codex 插件，在全局左侧栏展示另一个 ChatGPT/Codex 账号的 5 小时和每周用量、剩余百分比及重置时间。

**架构：** 插件通过 stdio 启动本地 MCP Server。Server 再启动一个使用独立 `CODEX_HOME` 的 `codex app-server` 子进程，让用户登录第二账号，并调用 `account/read` 与 `account/rateLimits/read`。MCP App 以全局 entrypoint 出现在左侧栏，通过 MCP Apps bridge 调用登录、刷新和退出工具。

**技术栈：** Node.js 22、TypeScript、Vitest、`@modelcontextprotocol/sdk`、`@modelcontextprotocol/ext-apps`、Codex app-server JSON-RPC。

---

### 任务 1：初始化插件工程

**文件：**
- 创建：`package.json`
- 创建：`tsconfig.json`
- 创建：`plugin.json`
- 创建：`mcp.json`
- 创建：`.agents/plugins/marketplace.json`
- 创建：`.gitignore`

- [x] **步骤 1：声明 Node 22、构建、测试和类型检查命令**

`package.json` 使用 ESM，并定义 `build`、`test`、`typecheck` 与 `check` 命令。MCP Server 入口固定为 `dist/server.js`。

- [x] **步骤 2：声明本地 stdio MCP Server**

`mcp.json` 使用 `type: "stdio"`，以 `node ${PLUGIN_ROOT}/dist/server.js` 启动，并将工作目录设为 `${PLUGIN_ROOT}`。

- [x] **步骤 3：声明本地市场**

`.agents/plugins/marketplace.json` 暴露 `multi-account-usage`，便于通过 `codex plugin marketplace add` 和 `codex plugin add` 安装。

### 任务 2：用 TDD 实现限额归一化

**文件：**
- 创建：`src/quota.ts`
- 创建：`test/quota.test.ts`

- [x] **步骤 1：编写失败测试**

覆盖 300 分钟窗口识别为 5 小时、10080 分钟窗口识别为每周、缺失窗口、百分比钳制、重置时间转换和多 bucket 展平。

- [x] **步骤 2：运行 `npm test -- test/quota.test.ts` 并确认因模块缺失失败**

- [x] **步骤 3：实现 `normalizeRateLimits`**

输出稳定的 `QuotaSnapshot`，包含账号、套餐、连接状态、5 小时窗口、每周窗口、其他窗口和抓取时间。

- [x] **步骤 4：运行测试并确认通过**

### 任务 3：用 TDD 实现 Codex app-server JSON-RPC 客户端

**文件：**
- 创建：`src/app-server-client.ts`
- 创建：`test/app-server-client.test.ts`

- [x] **步骤 1：编写失败测试**

使用内存流验证 initialize 握手、并发请求按 id 解析、错误响应拒绝、进程退出清理 pending 请求，以及登录完成通知的等待逻辑。

- [x] **步骤 2：运行单测并确认预期失败**

- [x] **步骤 3：实现 `AppServerClient`**

子进程继承最小环境，并把第二账号凭据保存到 `MULTI_ACCOUNT_CODEX_HOME` 或默认的插件数据目录。任何 token 均不进入 MCP 工具结果或日志。

- [x] **步骤 4：运行单测并确认通过**

### 任务 4：实现 MCP 工具与全局侧边栏 UI

**文件：**
- 创建：`src/service.ts`
- 创建：`src/server.ts`
- 创建：`public/usage-widget.html`
- 创建：`test/service.test.ts`

- [x] **步骤 1：编写 service 失败测试**

覆盖未登录状态、开始登录、登录完成后刷新、退出，以及 5 小时和每周窗口展示数据。

- [x] **步骤 2：运行测试并确认预期失败**

- [x] **步骤 3：实现 MCP Server**

注册 `get_usage`、`start_login`、`refresh_usage`、`logout_secondary_account` 四个工具，以及 `ui://multi-account-usage/dashboard.html` 资源。每个工具绑定相同 UI 资源，并通过 `openai/ui.entrypoints: [{type: "global"}]` 添加全局侧边栏入口。

- [x] **步骤 4：实现 UI**

界面展示账号、套餐、两个进度条、剩余百分比、重置时间、刷新按钮、连接或退出按钮。登录链接使用 `window.openai.openExternal`，并将 `auth.openai.com` 放入资源 CSP 的 redirect allowlist。

- [x] **步骤 5：运行测试并确认通过**

### 任务 5：验证、安装与说明

**文件：**
- 创建：`README.md`
- 创建：`scripts/install-local.sh`

- [x] **步骤 1：运行 `npm run check`**

预期 TypeScript 构建、类型检查和全部 Vitest 测试通过。

- [x] **步骤 2：使用 MCP Inspector 验证**

通过 stdio 启动构建产物，确认初始化、资源读取、工具列表和未登录状态结果均正常。

- [x] **步骤 3：验证插件清单和本地市场**

运行 `codex plugin marketplace add <workspace>`，再运行 `codex plugin list --available --json` 确认 `multi-account-usage` 可发现。

- [x] **步骤 4：编写本地安装说明**

README 说明安装、重启桌面端、首次连接第二账号、凭据目录、卸载方式，以及“限额为动态百分比而非固定消息数”的产品限制。
