#!/bin/sh
# Installs (or updates) the kol-find skill into ~/.agents/skills, which Codex and Grok Build both read:
#   curl -fsSL https://raw.githubusercontent.com/zhihao93li/kol-find/main/install.sh | sh
# Another agent's skills directory can be given instead: ... | sh -s -- ~/.other/skills
set -eu

SRC="https://raw.githubusercontent.com/zhihao93li/kol-find/main/plugin/skills/kol-find"
dir="${1:-$HOME/.agents/skills}/kol-find"

command -v node >/dev/null 2>&1 || echo "注意：没找到 node，kol-find 要 Node 20 以上才能跑。" >&2

# Download next to the old copy first, so a failed download leaves it working.
tmp="$dir.new"
rm -rf "$tmp"
mkdir -p "$tmp/scripts"
curl -fsSL "$SRC/SKILL.md" -o "$tmp/SKILL.md"
curl -fsSL "$SRC/scripts/kol-find.mjs" -o "$tmp/scripts/kol-find.mjs"
rm -rf "$dir"
mv "$tmp" "$dir"
echo "已装好：$dir"
