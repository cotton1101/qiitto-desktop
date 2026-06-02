#!/bin/bash
# qiitto-desktop インストール後のヘルパー
# Apple Developer ID 未署名のため Gatekeeper にブロックされるのを解除する。
# v0.3 以降で本物の署名+Notarization に切り替え予定。

set -e

APP="/Applications/qiitto-desktop.app"

clear
cat << 'BANNER'
╔════════════════════════════════════════════╗
║                                            ║
║   qiitto-desktop  起動ヘルパー              ║
║   Cotton-Web                               ║
║                                            ║
╚════════════════════════════════════════════╝

BANNER

if [ ! -d "$APP" ]; then
    cat << 'EOF'
❌ /Applications/qiitto-desktop.app が見つかりません

先に以下を実行してください：
  1. qiitto-desktop_*.dmg をダブルクリックして開く
  2. qiitto-desktop.app を Applications フォルダにドラッグ
  3. このスクリプトをもう一度ダブルクリック

EOF
    read -r -p "Enter キーで閉じる..."
    exit 1
fi

echo "✓ アプリ検出: $APP"
echo ""

echo "🔧 quarantine 属性を除去中..."
xattr -cr "$APP"
echo "  ✓ 完了"
echo ""

echo "🔐 ad-hoc 署名を再付与中（Apple Silicon 対策）..."
codesign --force --deep --sign - "$APP" > /dev/null 2>&1 || true
echo "  ✓ 完了"
echo ""

echo "🚀 qiitto-desktop を起動中..."
open "$APP"
echo "  ✓ 起動コマンド送信"
echo ""

cat << 'EOF'
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ 完了！qiitto-desktop が立ち上がるはずです。

次回からは Applications フォルダの qiitto-desktop を
直接ダブルクリックで起動できます。

このターミナルウィンドウは閉じて構いません。
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

EOF
