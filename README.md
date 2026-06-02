# qiitto-desktop

> **Claude Code の開発セッションログから Qiita 技術記事を半自動生成・公開する、ネイティブ macOS アプリ。**
> Web 版 [qiitto](https://github.com/cotton1101/qiitto) のローカルファースト再実装。
>
> *A native desktop app that turns your Claude Code development sessions into Qiita tech articles, all running locally on your machine.*

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
![Tauri](https://img.shields.io/badge/Tauri-2-FFC131)
![React](https://img.shields.io/badge/React-19-61DAFB)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6)
![Rust](https://img.shields.io/badge/Rust-stable-DEA584)
![SQLite](https://img.shields.io/badge/SQLite-003B57)

**[Cotton-Web](https://cotton-web.jp) 屋号で運営する自社プロダクト群の 6 本目。** Web 版 qiitto が「Claude Code ログはローカルにある」という構造的問題（ブラウザから読めない＝アップロード必要）を抱えていたため、**Tauri 2 でネイティブアプリ化**して `~/.claude/projects/` を直接読み取り可能にしました。

---

## Web 版との違い

| 項目 | [qiitto (Web)](https://github.com/cotton1101/qiitto) | qiitto-desktop（本リポジトリ）|
|---|---|---|
| Claude Code ログ取込 | ⚠️ コピペが必要（ブラウザから `~/.claude/projects/` は読めない） | ✅ **ローカル直読み**（fs アクセス）|
| 認証 | 自前 JWT + bcrypt + PostgreSQL | **不要**（OS ユーザー = アプリユーザー）|
| データ保存 | PostgreSQL（VPS）| **SQLite**（ローカル・WAL）|
| API キー保管 | Fernet 暗号化 → PostgreSQL | **ローカルファイル**（`~/Library/Application Support/.../secrets.json`・600）|
| 外部 API 呼び出し | FastAPI(httpx) | **Rust reqwest**（JS にキー露出しない設計）|
| 配信 | nginx + PM2 + Let's Encrypt + ConoHA VPS | **`.app`/`.dmg`** をユーザーがインストール |
| バイナリサイズ | (VPS 起動)| **7.9 MB**（Electron 比 1/20）|
| 月額コスト | VPS 代 | **ゼロ** |

> Web 版は 2026-05-28 に CVE-2025-55182（React2Shell）で侵害されたのもデスクトップ化動機の一つ：自社運用 VPS のリスクをゼロにしたい。

---

## ✅ 実装済み機能（v0.4.0 時点）

### v0.1 — 基盤

1. **Claude Code ログ取込** — `~/.claude/projects/*.jsonl` を Rust の `std::fs` で直接読込、`## User:` / `## Claude:` 形式に整形
2. **Claude API 呼び出し** — Rust 側 reqwest で `/v1/messages` 直叩き。API キーは JS 側に露出しない設計
3. **Markdown エディタ + Qiita 風プレビュー** — 左 [`@uiw/react-md-editor`](https://github.com/uiwjs/react-md-editor) ＋ 右 [react-markdown](https://github.com/remarkjs/react-markdown)（`:::note info|warn|alert` 対応、`highlight.js` シンタックスハイライト、`remark-gfm` で表・チェックボックス）
4. **Qiita API v2 同期** — create/update（既定で限定共有 `private:true`）→ 2 段階モーダルで `private:false` 公開 → 取り下げ可
5. **macOS DMG 配布** — Universal Binary（Intel + Apple Silicon）

### v0.2.0 — 公開前チェック + 自動アップデート

6. 🛡 **公開前スキャン** — 既定 6 ルール（API キー / メール / IPv4 / Zero-width 文字 等）+ ユーザー追加ルールで機密情報検出
7. ✨ **AI 書き換え** — 検出ワードを Claude API で伏字化（before/after 比較モーダル）
8. 🐦 **X 投稿生成** — 記事から X ポスト案を 3 パターン生成、コピー or X intent URL で投稿
9. 🔄 **自動アップデーター** — `tauri-plugin-updater` + Ed25519 署名検証 → Settings から1クリック更新（Gatekeeper 不要）

### v0.3.x — マルチプラットフォーム

10. 📝 **note 対応** — note エッセイ調プロンプト + コピー & note.com 起動ボタン
11. 🩹 **アップデートボタン修正**（v0.3.1）— Tauri 2 WebView の `confirm()` 不具合を回避

### v0.4.0 — 並列同時生成

12. ⚡ **複数プラットフォーム並列生成** — 同じ素材から Qiita + note を Claude API 並列呼出で **1 操作・約 30〜60 秒** で 2 件生成

---

## 🛣 ロードマップ（実検討中）

| 優先 | 項目 | 状態 | 詳細 |
|---|---|---|---|
| ⭐⭐⭐ | Apple Developer ID + Notarization | 月末売上後 | Gatekeeper 警告を完全解消（$99/年）|
| ⭐⭐ | スクリーンショット README 同梱 | 未着手 | 各機能の screenshot をドキュメント化 |
| ⭐⭐ | Zenn 対応 | 検討中 | GitHub 連携で記事 push（Markdown 直公開可）|
| ⭐ | dev.to 対応 | 検討中 | 公式 API あり・自動投稿可 |
| ⭐ | 月間トークン使用量ダッシュボード | 検討中 | Anthropic API のコスト可視化 |
| ⭐ | iCloud / Dropbox 同期 | 検討中 | 複数 Mac で下書き共有 |
| - | Windows / Linux ビルド | 未検証 | Tauri 的には可能、要テスト |

---

## アーキテクチャ

```
+---------------------------+
|  React (Vite + TS)        |  ← UI / Markdown editor / Qiita preview
|  Tailwind + react-router  |
+-------------▲-------------+
              │ invoke() / tauri-plugin-sql
+-------------▼-------------+
|  Rust (Tauri 2 backend)   |
|  - claude_log_reader      |  → ~/.claude/projects/*.jsonl (std::fs)
|  - claude_api (reqwest)   |  → api.anthropic.com
|  - qiita_api (reqwest)    |  → qiita.com/api/v2
|  - keyring_store (file)   |  → ~/Library/Application Support/.../secrets.json
+-------------▲-------------+
              │
+-------------▼-------------+
|  SQLite (qiitto.db)       |  ← drafts / sources / generations / user_settings
+---------------------------+
```

**設計原則**：
- API キーは JS 側に絶対に渡さない（Rust 内で keyring から取得 → reqwest で直接外部 API へ）
- ファイル読み取りは Rust 側（`std::fs`）で完結。capability は SQL 系のみ JS に開放
- 同期生成は最大 3 分の HTTP タイムアウト（Claude 応答待ち）

---

## 📥 インストール（一般ユーザー向け）

> macOS のみ（Intel / Apple Silicon どちらも対応）

### 方法 1: ワンライナー（最も簡単・ターミナル使用）

```bash
curl -fsSL https://raw.githubusercontent.com/cotton1101/qiitto-desktop/main/scripts/install.sh | bash
```

最新版を自動取得 → `/Applications` にインストール → quarantine 除去 → 起動、まで全自動。

### 方法 2: 手動 + ヘルパー（ターミナル不要）

1. [**最新リリースページ**](https://github.com/cotton1101/qiitto-desktop/releases/latest) を開く
2. **`qiitto-desktop_X.X.X_universal.dmg`** をダウンロード
3. ダブルクリックで開き、**qiitto-desktop.app** を `Applications` フォルダにドラッグ
4. 同じリリースから **`install-helper.zip`** をダウンロード → 解凍
5. 出てきた **`install-helper.command`** をダブルクリック
6. ターミナルが自動で起動して quarantine 解除 + アプリ起動。完了

### 方法 3: 上級者向け（最短）

```bash
# .dmg をマウント・ドラッグで /Applications に置いた後：
xattr -cr /Applications/qiitto-desktop.app && open /Applications/qiitto-desktop.app
```

### ⚠️ なぜこの手順が必要？

現バージョンの qiitto-desktop は **Apple Developer ID 署名なしで配布** されています。そのため macOS の Gatekeeper が「壊れている可能性があるためゴミ箱に移動」と表示し、起動を拒否します（**ファイル自体は問題ありません**。Tauri の Ed25519 自動アップデート署名で改ざん検証は別途されています）。

**Cotton-Web 月末売上後に Apple Developer Program 加入 → Notarization 対応予定**です。それまでは上記いずれかの方法でインストールしてください。

### 🔄 次回以降のアップデート

v0.2.0 以降をインストール済みなら、アプリ内の **設定 → 「アップデートを確認」** から自動更新できます（Gatekeeper も発動しません）。 **v0.3.0 の自動アップデートボタンには不具合がありました — v0.3.1 以降で解消済み**です。

---

## クイックスタート（開発者向け）

### 必要環境

- **macOS**（v0.2 は macOS のみ。Windows/Linux 動作は要検証）
- [Node.js 20+](https://nodejs.org/) と [pnpm 10+](https://pnpm.io/)
- [Rust stable](https://www.rust-lang.org/tools/install)（`rustup`）
- Xcode Command Line Tools（`xcode-select --install`）
- Anthropic API キー（`sk-ant-…`）
- Qiita Personal Access Token（`read_qiita`, `write_qiita` スコープ）

### 起動

```bash
git clone https://github.com/cotton1101/qiitto-desktop.git
cd qiitto-desktop
pnpm install
pnpm tauri dev
```

初回は Rust 依存のコンパイルで 3〜5 分かかります。ウィンドウが立ち上がったら：

1. **設定** → Anthropic API Key / Qiita PAT を保存
2. **新規生成** → Claude Code ログを選択 or テキスト貼付 → 「保存して生成」
3. 生成された下書きを左右分割エディタで編集
4. 「Qiita 同期」→「公開する」（2 段階モーダル）

### ビルド

```bash
pnpm tauri build
```

成果物：

- `.app` バンドル: `src-tauri/target/release/bundle/macos/qiitto-desktop.app`
- `.dmg` インストーラ: `src-tauri/target/release/bundle/dmg/qiitto-desktop_*.dmg`

---

## 設計ハイライト（実装で踏んだ罠）

開発過程で踏んだ罠と解法：

1. **Tauri 2 の引数自動 camelCase 変換は struct の中身まで行かない** — トップレベル引数は camelCase ↔ snake_case 自動変換だが、ネストした struct のフィールドは serde 任せ。`#[serde(rename_all = "camelCase")]` を struct に明示する必要あり。これに気づかず Qiita 記事が POST で重複作成された。
2. **macOS Keychain は dev では脆い** — 未署名バイナリが再ビルドのたびに ACL を失い、保存した API キーが読めなくなる。ファイル + 600 perm に切替えで解決。
3. **Qiita API PATCH のタイトル重複検査** — 同タイトルの限定共有が別に存在すると 422 で拒否される。Qiita 側で削除するか、タイトルを少し変える。
4. **`@uiw/react-md-editor` + 自前 Qiita プレビュー** — エディタ標準のプレビューは Qiita スタイルではないので、`preview="edit"` で抑止し `react-markdown + remark-gfm + rehype-highlight + rehype-raw` で自前プレビューを並べる。`:::note` は regex 前処理で `<div class="qiita-note-*">` に変換。
5. **Tauri 2 WebView の `window.confirm()` 不具合**（v0.3.1 で修正）— Wry の WebKit ラッパーが silently 無視するため、確認ダイアログが必要な箇所は React 自前モーダル + Tauri Plugin Dialog で代替する必要あり。

---

## 関連 Qiita 記事

- 第1弾 [Claude Code で作ったツールで、Claude Code の開発ログを Qiita 記事にする](https://qiita.com/sorabcjanne1/items/095eeb211d5617e1649b)
- 第2弾 [続編](https://qiita.com/sorabcjanne1/items/a9e414350978238008d3)
- 第3弾「Web 版を Tauri デスクトップに作り直した話 — Rust 初挑戦の躓きまとめ」（公開済み・近日 URL 追記）

---

## このリポジトリについて

- **シングルユーザ設計**：OS ユーザー = アプリユーザー。サインアップなし。Anthropic / Qiita のキーは OS のホームディレクトリ内（600 perm）に保存
- **継続開発**：v0.1 〜 v0.4.x までこのリポジトリで継続。`main` ブランチ + タグ駆動リリース（CI が自動ビルド・公開）
- **メンテナンス**：Cotton-Web の自社運用に必要な範囲で実施。Issue / PR は歓迎しますが対応保証なし
- **未署名**：現バージョンは ad-hoc 未署名 `.app`。Apple Developer ID 取得後（Cotton-Web 月末売上以降）の署名 + Notarization 対応を予定
- **動作環境**：macOS Universal（Intel + Apple Silicon どちらも対応）で動作確認済み。Windows/Linux は未検証

---

## License

[MIT](LICENSE) © 2026 山田 英紀 / Cotton-Web
