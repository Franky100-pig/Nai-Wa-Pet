#!/bin/bash
# 打一个能双击运行的 .app（不用 electron-builder，纯离线）
# 用法：npm run pack
set -e
cd "$(dirname "$0")/.."

APP="dist/NaiwaPet.app"
NAME="奶蛙桌宠"

echo "==> 清理旧产物"
rm -rf "$APP"
mkdir -p dist

echo "==> 复制 Electron 骨架"
cp -R node_modules/electron/dist/Electron.app "$APP"
mv "$APP/Contents/MacOS/Electron" "$APP/Contents/MacOS/NaiwaPet"
rm -rf "$APP/Contents/Resources/default_app.asar"

echo "==> 放入应用代码"
mkdir -p "$APP/Contents/Resources/app"
cp -R main.js preload.js package.json renderer assets "$APP/Contents/Resources/app/"
rm -rf "$APP/Contents/Resources/app/assets/AppIcon.iconset"

echo "==> 图标"
if [ -f assets/AppIcon.icns ]; then
  cp assets/AppIcon.icns "$APP/Contents/Resources/AppIcon.icns"
fi

echo "==> Info.plist"
cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key><string>zh_CN</string>
  <key>CFBundleDisplayName</key><string>$NAME</string>
  <key>CFBundleExecutable</key><string>NaiwaPet</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>CFBundleIdentifier</key><string>site.franky.naiwapet</string>
  <key>CFBundleInfoDictionaryVersion</key><string>6.0</string>
  <key>CFBundleName</key><string>$NAME</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>0.1.0</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>LSMinimumSystemVersion</key><string>10.15</string>
  <key>LSUIElement</key><false/>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSRequiresAquaSystemAppearance</key><false/>
</dict>
</plist>
PLIST

echo "==> 自签名（Apple Silicon 必须，改过 Info.plist 后签名会失效）"
codesign --force --deep --sign - "$APP"

echo "==> 完成：$APP"
du -sh "$APP"
