#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
app_parent="$HOME/Applications"
app_target="$app_parent/Codex Usage Monitor.app"
main_home="${MAIN_CODEX_HOME:-$HOME/.codex}"
secondary_home="${MULTI_ACCOUNT_CODEX_HOME:-}"

for command_name in node codex swiftc; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "$command_name is required." >&2
    exit 1
  fi
done

if [[ -z "$secondary_home" ]]; then
  newest_auth=""
  while IFS= read -r auth_path; do
    if [[ -z "$newest_auth" || "$auth_path" -nt "$newest_auth" ]]; then
      newest_auth="$auth_path"
    fi
  done < <(find "$HOME/.codex/plugins/data/agent-plugins" -path '*/secondary-codex/auth.json' -type f 2>/dev/null)
  if [[ -n "$newest_auth" ]]; then
    secondary_home="$(dirname "$newest_auth")"
  fi
fi

if [[ -z "$secondary_home" || ! -f "$secondary_home/auth.json" ]]; then
  echo "Secondary account login was not found. Log in through the multi-account-usage tool first." >&2
  exit 1
fi

node_path="$(command -v node)"
codex_path="$(command -v codex)"
build_root="$(mktemp -d "${TMPDIR:-/tmp}/codex-usage-monitor.XXXXXX")"
trap 'rm -rf -- "$build_root"' EXIT

cd "$project_root"
npm run check

bundle="$build_root/Codex Usage Monitor.app"
mkdir -p "$bundle/Contents/MacOS" "$bundle/Contents/Resources/runtime"
swiftc -parse-as-library -O -framework AppKit -framework Foundation \
  "$project_root/macos/CodexUsageMonitor.swift" \
  -o "$bundle/Contents/MacOS/CodexUsageMonitor"
cp "$project_root/macos/Info.plist" "$bundle/Contents/Info.plist"
cp "$project_root"/dist/src/*.js "$bundle/Contents/Resources/runtime/"

NODE_PATH_VALUE="$node_path" \
CODEX_PATH_VALUE="$codex_path" \
MAIN_HOME_VALUE="$main_home" \
SECONDARY_HOME_VALUE="$secondary_home" \
SNAPSHOT_PATH_VALUE="$app_target/Contents/Resources/runtime/menu-snapshot.js" \
node - "$bundle/Contents/Resources/config.json" <<'NODE'
const fs = require("node:fs");
const [configPath] = process.argv.slice(2);
const config = {
  nodePath: process.env.NODE_PATH_VALUE,
  codexPath: process.env.CODEX_PATH_VALUE,
  mainCodexHome: process.env.MAIN_HOME_VALUE,
  secondaryCodexHome: process.env.SECONDARY_HOME_VALUE,
  snapshotScriptPath: process.env.SNAPSHOT_PATH_VALUE,
  refreshIntervalSeconds: 300,
};
fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
NODE

mkdir -p "$app_parent"
if [[ -d "$app_target" ]]; then
  backup_target="$app_target.backup-$(date +%Y%m%d%H%M%S)"
  /usr/bin/osascript -e 'tell application id "local.openai.CodexUsageMonitor" to quit' >/dev/null 2>&1 || true
  mv "$app_target" "$backup_target"
  echo "Previous app moved to: $backup_target"
fi
mv "$bundle" "$app_target"
/usr/bin/open "$app_target"

echo "Installed and started: $app_target"
echo "Menu title format: 个<5h remaining>/<weekly remaining> · 团<5h remaining>/<weekly remaining>"
