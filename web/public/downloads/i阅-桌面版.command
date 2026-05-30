#!/bin/bash
DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR" || exit 1

if [ ! -d "node_modules" ]; then
  echo "首次启动，正在安装依赖..."
  npm install
fi

echo "正在启动 i阅 桌面版..."
npm run start
