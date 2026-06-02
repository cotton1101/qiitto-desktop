#!/bin/bash
# qiitto-desktop ワンラインインストーラ
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/cotton1101/qiitto-desktop/main/scripts/install.sh | bash
# GitHub Releases から最新版 .dmg を取得 → /Applications にインストール → quarantine 除去 → 起動

set -euo pipefail

REPO="cotton1101/qiitto-desktop"
APP_NAME="qiitto-desktop"
DST="/Applications/${APP_NAME}.app"

cat << 'BANNER'
╔════════════════════════════════════════════╗
║   qiitto-desktop インストーラ               ║
║   Cotton-Web                               ║
╚════════════════════════════════════════════╝

BANNER

echo "🔍 最新版を取得中..."
LATEST_JSON=$(curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest")

DMG_URL=$(echo "$LATEST_JSON" | python3 -c "
import json, sys
d = json.load(sys.stdin)
print(next(a['browser_download_url'] for a in d['assets'] if a['name'].endswith('.dmg')))
")
VERSION=$(echo "$LATEST_JSON" | python3 -c "
import json, sys
print(json.load(sys.stdin)['tag_name'])
")

echo "  ✓ 最新版: ${VERSION}"
echo ""

TMP=$(mktemp -d)
trap "rm -rf $TMP" EXIT
DMG_PATH="${TMP}/${APP_NAME}.dmg"

echo "📥 ダウンロード中..."
curl -fL --progress-bar -o "$DMG_PATH" "$DMG_URL"
echo ""

echo "💾 マウント中..."
MOUNT_INFO=$(hdiutil attach "$DMG_PATH" -nobrowse -readonly)
MOUNT_POINT=$(echo "$MOUNT_INFO" | grep -E '^/dev/' | grep '/Volumes/' | awk -F'\t' '{print $NF}' | tail -1)
echo "  ✓ ${MOUNT_POINT}"
echo ""

echo "📦 Applications にコピー中..."
if [ -d "$DST" ]; then
    echo "  ℹ️  既存の ${DST} を上書きします"
    rm -rf "$DST"
fi
cp -R "${MOUNT_POINT}/${APP_NAME}.app" "/Applications/"
hdiutil detach "$MOUNT_POINT" -quiet
echo "  ✓ 完了"
echo ""

echo "🔧 quarantine 属性を除去 + ad-hoc 署名..."
xattr -cr "$DST"
codesign --force --deep --sign - "$DST" > /dev/null 2>&1 || true
echo "  ✓ 完了"
echo ""

echo "🚀 起動中..."
open "$DST"
echo ""

cat << EOF
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ ${VERSION} のインストール完了

次回からは Applications フォルダの qiitto-desktop を
直接ダブルクリックで起動できます。
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
EOF
