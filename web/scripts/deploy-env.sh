#!/usr/bin/env bash
# 把 web/.env.local 里的环境变量批量推送到 Vercel 的生产环境。
# 用法（在 web 目录下）：
#   vercel login         # 首次登录（会打开浏览器）
#   vercel link          # 把当前目录关联/创建一个 Vercel 项目
#   bash scripts/deploy-env.sh
#
# 说明：本脚本运行时才读取 .env.local（该文件已被 .gitignore 忽略，密钥不会进仓库）。

set -euo pipefail

ENV_FILE="$(cd "$(dirname "$0")/.." && pwd)/.env.local"
TARGET="${1:-production}"   # production | preview | development

if [ ! -f "$ENV_FILE" ]; then
  echo "找不到 $ENV_FILE，请确认在 web 目录结构下运行。" >&2
  exit 1
fi

echo "将把 .env.local 中的变量推送到 Vercel [$TARGET] 环境..."

while IFS= read -r line || [ -n "$line" ]; do
  # 跳过空行与注释
  [[ -z "$line" || "$line" =~ ^[[:space:]]*# ]] && continue
  key="${line%%=*}"
  value="${line#*=}"
  key="$(echo "$key" | xargs)"
  [ -z "$key" ] && continue

  # 先删除同名变量（若存在），避免重复报错；忽略删除失败。
  vercel env rm "$key" "$TARGET" -y >/dev/null 2>&1 || true
  printf '%s' "$value" | vercel env add "$key" "$TARGET" >/dev/null
  echo "  ✓ $key"
done < "$ENV_FILE"

echo "完成。接着可以运行：vercel --prod  来触发一次生产部署。"
