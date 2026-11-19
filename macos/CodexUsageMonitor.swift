import AppKit
import Foundation

private struct AppConfig: Decodable {
    let nodePath: String
    let codexPath: String
    let mainCodexHome: String
    let secondaryCodexHome: String
    let snapshotScriptPath: String
    let refreshIntervalSeconds: TimeInterval
}

private struct QuotaWindow: Decodable {
    let label: String
    let usedPercent: Int
    let remainingPercent: Int
    let resetsAt: String?
}

private struct AccountSnapshot: Decodable {
    let alias: String
    let shortAlias: String
    let connection: String
    let email: String?
    let planType: String?
    let fiveHour: QuotaWindow?
    let weekly: QuotaWindow?
    let fetchedAt: String
}

private struct MenuSnapshot: Decodable {
    let title: String
    let accounts: [AccountSnapshot]
    let fetchedAt: String
}

private enum SnapshotFailure: LocalizedError {
    case invalidConfiguration(String)
    case commandFailed(String)

    var errorDescription: String? {
        switch self {
        case .invalidConfiguration(let message), .commandFailed(let message):
            return message
        }
    }
}

@MainActor
private final class AppDelegate: NSObject, NSApplicationDelegate {
    private let statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
    private var config: AppConfig?
    private var timer: Timer?
    private var refreshInProgress = false
    private var latestSnapshot: MenuSnapshot?
    private var latestError: String?

    func applicationDidFinishLaunching(_ notification: Notification) {
        statusItem.button?.title = "额度…"
        statusItem.button?.font = NSFont.monospacedDigitSystemFont(
            ofSize: NSFont.systemFontSize,
            weight: .medium
        )
        rebuildMenu()

        do {
            config = try Self.loadConfig()
            refresh()
            if let interval = config?.refreshIntervalSeconds {
                timer = Timer.scheduledTimer(
                    timeInterval: interval,
                    target: self,
                    selector: #selector(refresh),
                    userInfo: nil,
                    repeats: true
                )
            }
        } catch {
            applyFailure(error)
        }
    }

    @objc private func refresh() {
        guard !refreshInProgress, let config else { return }
        refreshInProgress = true
        rebuildMenu()

        DispatchQueue.global(qos: .utility).async { [weak self] in
            let result = Result { try Self.readSnapshot(config: config) }
            DispatchQueue.main.async {
                guard let self else { return }
                self.refreshInProgress = false
                switch result {
                case .success(let snapshot):
                    self.latestSnapshot = snapshot
                    self.latestError = nil
                    self.statusItem.button?.title = snapshot.title
                    self.rebuildMenu()
                case .failure(let error):
                    self.applyFailure(error)
                }
            }
        }
    }

    @objc private func quit() {
        NSApplication.shared.terminate(nil)
    }

    private func applyFailure(_ error: Error) {
        refreshInProgress = false
        latestError = error.localizedDescription
        statusItem.button?.title = latestSnapshot?.title ?? "额度 !"
        rebuildMenu()
    }

    private func rebuildMenu() {
        let menu = NSMenu()

        if let snapshot = latestSnapshot {
            for (index, account) in snapshot.accounts.enumerated() {
                if index > 0 { menu.addItem(.separator()) }
                addAccount(account, to: menu)
            }
            menu.addItem(.separator())
            menu.addItem(disabledItem("更新于 \(Self.localTime(snapshot.fetchedAt))"))
        } else if latestError == nil {
            menu.addItem(disabledItem("正在读取两个账号…"))
        }

        if let latestError {
            let errorItem = disabledItem("读取失败：\(latestError)")
            errorItem.toolTip = latestError
            menu.addItem(errorItem)
        }

        let refreshItem = NSMenuItem(
            title: refreshInProgress ? "正在刷新…" : "立即刷新",
            action: refreshInProgress ? nil : #selector(refresh),
            keyEquivalent: "r"
        )
        refreshItem.target = self
        menu.addItem(refreshItem)
        menu.addItem(.separator())
        menu.addItem(disabledItem("菜单栏数字：5 小时剩余 / 每周剩余"))

        let quitItem = NSMenuItem(title: "退出账号用量", action: #selector(quit), keyEquivalent: "q")
        quitItem.target = self
        menu.addItem(quitItem)

        statusItem.menu = menu
    }

    private func addAccount(_ account: AccountSnapshot, to menu: NSMenu) {
        let plan = account.planType?.capitalized ?? "未识别套餐"
        let heading = disabledItem("\(account.alias) · \(plan)")
        heading.attributedTitle = NSAttributedString(
            string: heading.title,
            attributes: [.font: NSFont.boldSystemFont(ofSize: NSFont.systemFontSize)]
        )
        menu.addItem(heading)

        if account.connection != "connected" {
            menu.addItem(disabledItem("  未登录"))
            return
        }

        if let email = account.email {
            menu.addItem(disabledItem("  \(email)"))
        }
        menu.addItem(disabledItem(Self.windowLine("5 小时", account.fiveHour)))
        menu.addItem(disabledItem(Self.windowLine("每周", account.weekly)))
    }

    private func disabledItem(_ title: String) -> NSMenuItem {
        let item = NSMenuItem(title: title, action: nil, keyEquivalent: "")
        item.isEnabled = false
        return item
    }

    private static func windowLine(_ name: String, _ window: QuotaWindow?) -> String {
        guard let window else { return "  \(name)：暂无数据" }
        let reset = window.resetsAt.map(localTime) ?? "未知"
        return "  \(name)：剩余 \(window.remainingPercent)% · 已用 \(window.usedPercent)% · \(reset) 重置"
    }

    private static func localTime(_ isoTimestamp: String) -> String {
        let parser = ISO8601DateFormatter()
        parser.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard let date = parser.date(from: isoTimestamp) else { return isoTimestamp }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "zh_CN")
        formatter.dateFormat = "M月d日 HH:mm"
        return formatter.string(from: date)
    }

    private static func loadConfig() throws -> AppConfig {
        guard let url = Bundle.main.url(forResource: "config", withExtension: "json") else {
            throw SnapshotFailure.invalidConfiguration("缺少 config.json")
        }
        return try JSONDecoder().decode(AppConfig.self, from: Data(contentsOf: url))
    }

    private nonisolated static func readSnapshot(config: AppConfig) throws -> MenuSnapshot {
        let process = Process()
        let stdout = Pipe()
        let stderr = Pipe()
        process.executableURL = URL(fileURLWithPath: config.nodePath)
        process.arguments = [config.snapshotScriptPath]
        process.standardOutput = stdout
        process.standardError = stderr

        var environment = ProcessInfo.processInfo.environment
        environment["CODEX_BIN"] = config.codexPath
        environment["MAIN_CODEX_HOME"] = config.mainCodexHome
        environment["SECONDARY_CODEX_HOME"] = config.secondaryCodexHome
        environment["MAIN_ACCOUNT_ALIAS"] = "个人"
        environment["MAIN_ACCOUNT_SHORT_ALIAS"] = "个"
        environment["SECONDARY_ACCOUNT_ALIAS"] = "团队"
        environment["SECONDARY_ACCOUNT_SHORT_ALIAS"] = "团"
        process.environment = environment

        try process.run()
        process.waitUntilExit()
        let output = stdout.fileHandleForReading.readDataToEndOfFile()
        let errorOutput = stderr.fileHandleForReading.readDataToEndOfFile()
        guard process.terminationStatus == 0 else {
            let message = String(data: errorOutput, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines)
            throw SnapshotFailure.commandFailed(message?.isEmpty == false ? message! : "本地用量命令执行失败")
        }
        return try JSONDecoder().decode(MenuSnapshot.self, from: output)
    }
}

@main
private struct CodexUsageMonitorApp {
    @MainActor
    static func main() {
        let app = NSApplication.shared
        let delegate = AppDelegate()
        app.setActivationPolicy(.accessory)
        app.delegate = delegate
        app.run()
    }
}
