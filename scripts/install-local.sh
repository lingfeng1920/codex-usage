#!/usr/bin/env bash
set -euo pipefail

plugin_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 22.6+ is required." >&2
  exit 1
fi

if ! command -v codex >/dev/null 2>&1; then
  echo "The Codex CLI is required." >&2
  exit 1
fi

node_major="$(node -p 'Number(process.versions.node.split(".")[0])')"
if (( node_major < 22 )); then
  echo "Node.js 22.6+ is required. Current version: $(node --version)" >&2
  exit 1
fi

cd "$plugin_root"
runtime_root="$plugin_root/.runtime/multi-account-usage"
case "$runtime_root" in
  "$plugin_root/.runtime/multi-account-usage") ;;
  *) echo "Invalid runtime package path." >&2; exit 1 ;;
esac
rm -rf -- "$runtime_root"

npm ci --registry=https://registry.npmjs.org
npm run check

mkdir -p "$runtime_root/assets" "$runtime_root/public" "$runtime_root/dist"
cp "$plugin_root/plugin.json" "$plugin_root/mcp.json" "$runtime_root/"
cp "$plugin_root/package.json" "$plugin_root/package-lock.json" "$runtime_root/"
cp -R "$plugin_root/assets/." "$runtime_root/assets/"
cp -R "$plugin_root/public/." "$runtime_root/public/"
cp -R "$plugin_root/dist/." "$runtime_root/dist/"
npm ci --omit=dev --registry=https://registry.npmjs.org --prefix "$runtime_root"

if ! codex plugin marketplace list | grep -F -- "$plugin_root" >/dev/null; then
  codex plugin marketplace add "$plugin_root"
fi

codex plugin add multi-account-usage@multi-account-local

echo
echo "Installed multi-account-usage. Restart ChatGPT desktop. Use the ChatGPT sidebar app, or ask Codex to 查看另一个账号用量."
