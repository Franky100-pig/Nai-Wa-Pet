#!/bin/bash
# 打一个 Windows 免安装版（x64）。可以在这台 Mac 上交叉打，不需要 Windows 机器。
# 用法：npm run pack:win
set -e
cd "$(dirname "$0")/.."

VER=$(node -p "require('./package.json').version")
OUT="dist/NaiwaPet-win32-x64"
ZIP="dist/NaiwaPet-$VER-win32-x64.zip"

# Electron 的 Windows 包：先找本地缓存，找不到就让调用方自己指定
CACHE_ZIP=$(find "$HOME/Library/Caches/electron" "$HOME/.cache/electron" \
  -name "electron-v*-win32-x64.zip" 2>/dev/null | sort | tail -1)
if [ -z "$CACHE_ZIP" ] && [ -n "$ELECTRON_WIN_ZIP" ]; then
  CACHE_ZIP="$ELECTRON_WIN_ZIP"
fi
if [ -z "$CACHE_ZIP" ]; then
  echo "找不到 electron-v*-win32-x64.zip。"
  echo "先随便跑一次带 Windows 目标的操作让它下载，或用 ELECTRON_WIN_ZIP 指定路径："
  echo "  ELECTRON_WIN_ZIP=/path/to/electron-v44.9.1-win32-x64.zip npm run pack:win"
  exit 1
fi
echo "==> 使用 $CACHE_ZIP"

echo "==> 解包到 $OUT"
rm -rf "$OUT"
mkdir -p "$OUT"
unzip -q -o "$CACHE_ZIP" -d "$OUT"

echo "==> 改名 + 换成我们自己的入口"
mv "$OUT/electron.exe" "$OUT/NaiwaPet.exe"
rm -f "$OUT/resources/default_app.asar"
mkdir -p "$OUT/resources/app"
cp -R main.js preload.js package.json renderer assets "$OUT/resources/app/"
rm -rf "$OUT/resources/app/assets/AppIcon.iconset"

echo "==> 装图标"
node tools/set-exe-icon.js "$OUT/NaiwaPet.exe" || echo "（图标没换上，用默认 Electron 图标继续）"

echo "==> 压缩"
rm -f "$ZIP"
( cd dist && zip -qr "$(basename "$ZIP")" "$(basename "$OUT")" )

echo "==> 完成：$ZIP"
du -sh "$ZIP"
