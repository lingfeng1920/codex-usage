# macOS 多账号用量菜单栏实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 subagent-driven-development（推荐）或 executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 构建一个本地 macOS 菜单栏应用，常驻显示个人 Plus 与团队 Team 账号的 5 小时/每周剩余百分比，并在下拉菜单展示完整详情与重置时间。

**架构：** 复用现有 TypeScript `UsageService`，新增一次性双账号快照命令，读取主账号 `~/.codex` 与插件隔离的第二账号目录。原生 AppKit 状态栏程序每 5 分钟调用随应用打包的快照命令，更新菜单栏短标题和详情菜单；查询只访问本机 `codex app-server`，不调用模型。

**技术栈：** TypeScript 7、Vitest、Node.js 22、Swift 6、AppKit、Codex app-server JSON-RPC。

---

## 文件结构

- `src/account-display.ts`：把两个账号快照转换成稳定的菜单栏标题和详情模型。
- `src/menu-snapshot.ts`：并行读取两个 `CODEX_HOME`，向原生应用输出单行 JSON。
- `test/account-display.test.ts`：覆盖账号别名、剩余量、离线和缺失窗口的显示规则。
- `macos/CodexUsageMonitor.swift`：AppKit 状态栏生命周期、定时刷新和菜单渲染。
- `macos/Info.plist`：无 Dock 图标的菜单栏应用元数据。
- `scripts/install-menu-bar.sh`：定位第二账号、构建并安装到 `~/Applications`，随后启动应用。
- `README.md`：记录显示含义、安装和刷新行为。

### 任务 1：双账号展示模型

**文件：**
- 创建：`test/account-display.test.ts`
- 创建：`src/account-display.ts`

- [x] **步骤 1：编写失败测试**

```ts
expect(buildMenuSnapshot([
  { alias: "个人", shortAlias: "个", snapshot: personal },
  { alias: "团队", shortAlias: "团", snapshot: team },
])).toMatchObject({
  title: "个53/51 · 团100/47",
  accounts: [
    { alias: "个人", planType: "plus", fiveHour: { remainingPercent: 53 } },
    { alias: "团队", planType: "team", weekly: { remainingPercent: 47 } },
  ],
});
```

- [x] **步骤 2：验证红灯**

运行：`npm test -- test/account-display.test.ts`
预期：FAIL，`../src/account-display.js` 不存在。

- [x] **步骤 3：实现最小展示模型**

实现 `buildMenuSnapshot()`：连接状态显示 `短别名5小时剩余/周剩余`；离线显示 `短别名离线`；窗口缺失显示 `—`。

- [x] **步骤 4：验证绿灯**

运行：`npm test -- test/account-display.test.ts`
预期：测试全部通过。

- [x] **步骤 5：提交**

```bash
git add src/account-display.ts test/account-display.test.ts
git commit -m "feat: add multi-account menu display model"
```

### 任务 2：双账号快照命令

**文件：**
- 创建：`src/menu-snapshot.ts`
- 修改：`package.json`

- [x] **步骤 1：编写失败测试**

在 `test/account-display.test.ts` 增加 `readAccountSnapshots()` 测试，注入两个假的 `UsageService`，断言并行结果按“个人、团队”排序且最终关闭服务。

- [x] **步骤 2：验证红灯**

运行：`npm test -- test/account-display.test.ts`
预期：FAIL，快照读取函数尚未导出。

- [x] **步骤 3：实现命令**

新增可注入的 `readAccountSnapshots()` 和 CLI 入口。CLI 要求 `MAIN_CODEX_HOME`、`SECONDARY_CODEX_HOME`，输出 `buildMenuSnapshot()` 的 JSON，并在 `finally` 中关闭两个服务。

- [x] **步骤 4：验证绿灯和构建**

运行：`npm run check`
预期：类型检查、全部 Vitest 测试与 TypeScript 构建通过。

- [x] **步骤 5：提交**

```bash
git add src/menu-snapshot.ts test/account-display.test.ts package.json
git commit -m "feat: add dual-account snapshot command"
```

### 任务 3：原生菜单栏应用与安装

**文件：**
- 创建：`macos/CodexUsageMonitor.swift`
- 创建：`macos/Info.plist`
- 创建：`scripts/install-menu-bar.sh`
- 修改：`README.md`

- [x] **步骤 1：实现 AppKit 菜单栏壳**

状态栏初始显示 `额度…`；后台执行配置中的 Node 与快照脚本；成功时显示 `个53/51 · 团100/47` 一类短标题，菜单内显示套餐、剩余/已用、重置时间、刷新和退出；失败时显示 `额度 !` 与错误摘要。

- [x] **步骤 2：实现可重复安装**

脚本先运行 `npm run check`，定位 `~/.codex/plugins/data/agent-plugins/*/secondary-codex/auth.json`，编译 Swift，创建 `~/Applications/Codex Usage Monitor.app`，写入只含路径的 `config.json`，复制快照运行时后启动应用。已有应用先移动到同目录时间戳备份。

- [x] **步骤 3：编译验证**

运行：`swiftc -parse-as-library -typecheck -framework AppKit -framework Foundation macos/CodexUsageMonitor.swift`
预期：退出码 0。

- [x] **步骤 4：端到端安装验证**

运行：`bash scripts/install-menu-bar.sh`
预期：全量检查通过，应用包存在，进程启动，调用打包快照脚本返回两个账号且标题字段同时包含 `个` 与 `团`。

- [x] **步骤 5：提交**

```bash
git add macos scripts/install-menu-bar.sh README.md docs/superpowers/plans/2026-11-19-macos-menu-bar-usage.md
git commit -m "feat: add native macOS usage menu bar"
```

## 自检

- 规格覆盖：常驻可见、两个账号清晰区分、5 小时和周窗口、详情与重置时间、自动刷新、纯本地读取均有对应任务。
- 类型一致：`buildMenuSnapshot()` 同时供测试、CLI 和 Swift JSON 解码使用；字段名在任务间一致。
- 验证条件：每项均有明确命令与退出条件，没有依赖人工主观判断作为唯一验证。
