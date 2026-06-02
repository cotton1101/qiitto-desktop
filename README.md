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

## スクリーンショット

> （v0.2 で同梱予定）

---

## 主要機能

1. **取込** — Claude Code のセッションログ（`~/.claude/projects/*.jsonl`）を一覧から選択 → User/Claude 発言を `## User:` / `## Claude:` 形式で整形
2. **生成** — Anthropic Claude API（Sonnet 4.6 既定）で `TITLE_OPTIONS` / `SUGGESTED_TAGS` / `ARTICLE_BODY` の構造化応答 → 自動パース
3. **編集** — 左 [`@uiw/react-md-editor`](https://github.com/uiwjs/react-md-editor) ＋ 右 [react-markdown](https://github.com/remarkjs/react-markdown) ベースの Qiita 風プレビュー（`:::note info|warn|alert` 対応、コード `highlight.js` シンタックスハイライト、`remark-gfm` で表・チェックボックス）
4. **Qiita 同期** — Qiita API v2 で create/update（既定で限定共有 `private:true`）
5. **公開** — 2 段階確認モーダル → `private:false` で公開
6. **取り下げ** — `private:true` に戻す

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

## クイックスタート（開発）

### 必要環境

- **macOS**（v0.1 は macOS のみ。Windows/Linux 動作は要検証）
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

> 未署名なので Gatekeeper バイパスが必要：右クリック → 開く、または `xattr -dr com.apple.quarantine path/to/.app`。

---

## 設計ハイライト（実装で踏んだ罠）

開発過程で踏んだ罠と解法を Qiita 記事化予定。要点：

1. **Tauri 2 の引数自動 camelCase 変換は struct の中身まで行かない** — トップレベル引数は camelCase ↔ snake_case 自動変換だが、ネストした struct のフィールドは serde 任せ。`#[serde(rename_all = "camelCase")]` を struct に明示する必要あり。これに気づかず Qiita 記事が POST で重複作成された。
2. **macOS Keychain は dev では脆い** — 未署名バイナリが再ビルドのたびに ACL を失い、保存した API キーが読めなくなる。ファイル + 600 perm に切替えで解決。
3. **Qiita API PATCH のタイトル重複検査** — 同タイトルの限定共有が別に存在すると 422 で拒否される。Qiita 側で削除するか、タイトルを少し変える。
4. **`@uiw/react-md-editor` + 自前 Qiita プレビュー** — エディタ標準のプレビューは Qiita スタイルではないので、`preview="edit"` で抑止し `react-markdown + remark-gfm + rehype-highlight + rehype-raw` で自前プレビューを並べる。`:::note` は regex 前処理で `<div class="qiita-note-*">` に変換。

---

## 関連 Qiita 記事

- 第1弾 [Claude Code で作ったツールで、Claude Code の開発ログを Qiita 記事にする](https://qiita.com/sorabcjanne1/items/095eeb211d5617e1649b)
- 第2弾 [続編](https://qiita.com/sorabcjanne1/items/a9e414350978238008d3)
- 第3弾（予定）「Web 版を Tauri デスクトップに作り直した話 — Rust 初挑戦の躓きまとめ」

---

## このリポジトリについて

- **シングルユーザ設計**：OS ユーザー = アプリユーザー。サインアップなし。Anthropic / Qiita のキーは OS のホームディレクトリ内（600 perm）に保存
- **スナップショット公開**：開発当時の commit 履歴は含まないクリーン公開。今後の開発はこのリポジトリで継続予定
- **メンテナンス**：Cotton-Web の自社運用に必要な範囲で実施。Issue / PR は歓迎しますが対応保証なし
- **未署名**：v0.1 は ad-hoc 未署名 `.app`。Developer ID 取得後の署名 + Notarization は v0.2 以降を予定
- **動作環境**：macOS（Intel）で動作確認済み。ARM ターゲットビルドは未検証（`cargo build --target aarch64-apple-darwin` で可能なはず）

---

## License

[MIT](LICENSE) © 2026 山田 英紀 / Cotton-Web
