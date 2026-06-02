import { invoke } from "@tauri-apps/api/core";

/** OS keyring に保存するキー一覧 */
export const KeyringKey = {
  AnthropicApiKey: "anthropic_api_key",
  QiitaToken: "qiita_token",
  GithubPat: "github_pat",
} as const;
export type KeyringKey = (typeof KeyringKey)[keyof typeof KeyringKey];

/** 秘匿値を keyring に保存（中身は Rust 側でしか復号できない・JS 側に返さない） */
export async function keyringSet(key: KeyringKey, value: string): Promise<void> {
  await invoke("keyring_set", { key, value });
}

/** 値が設定済みか確認（存在のみ・中身は取得しない） */
export async function keyringHas(key: KeyringKey): Promise<boolean> {
  return await invoke<boolean>("keyring_has", { key });
}

/** 値を削除 */
export async function keyringDelete(key: KeyringKey): Promise<void> {
  await invoke("keyring_delete", { key });
}

// ---- Claude Code ログ取込 ---------------------------------------------------

export interface ClaudeLogProject {
  project_path: string;
  encoded_dir: string;
  session_count: number;
  last_modified: string; // ISO8601
  last_session_id: string | null;
}

export interface MessageCounts {
  user: number;
  assistant: number;
  tool_use: number;
}

export interface ClaudeLogResult {
  content: string;
  char_count: number;
  session_count: number;
  message_counts: MessageCounts;
  project_path: string | null;
  session_ids: string[];
  truncated: boolean;
}

/** `~/.claude/projects/` 配下のプロジェクト一覧（mtime 降順）。 */
export async function listClaudeProjects(): Promise<ClaudeLogProject[]> {
  return await invoke<ClaudeLogProject[]>("list_claude_projects");
}

export interface ReadSessionsArgs {
  project_path: string;
  since?: string | null; // ISO8601
  include_tool_calls?: boolean;
  latest_only?: boolean;
  include_user?: boolean;
  include_assistant?: boolean;
  include_sidechains?: boolean;
  max_chars?: number | null;
}

/** 指定プロジェクトのセッションログを Markdown 素材に整形。null は「該当プロジェクトなし」。 */
export async function readClaudeSessions(
  args: ReadSessionsArgs,
): Promise<ClaudeLogResult | null> {
  return await invoke<ClaudeLogResult | null>("read_claude_sessions", { args });
}

// ---- Claude API（記事生成・接続テスト）-------------------------------------

export interface GenerationResult {
  title_options: string[];
  suggested_tags: string[];
  body_markdown: string;
  prompt_used: string;
  tokens_used: number;
  parse_ok: boolean;
  model: string;
}

export interface ClaudeTestResult {
  model: string;
  stop_reason: string | null;
}

/** Anthropic API への接続テスト（最小トークン）。Settings 画面の動作確認用。 */
export async function claudeTestConnection(model?: string): Promise<ClaudeTestResult> {
  return await invoke<ClaudeTestResult>("claude_test_connection", { model });
}

/** 素材から記事を生成。20〜60秒程度ブロックする。
 *  Tauri 2 は JS→Rust 引数を camelCase で渡す（Rust 側は自動で snake_case にマップされる）。
 *  platform は "qiita" | "note"。省略時は "qiita"。 */
export async function claudeGenerateArticle(args: {
  sourceType: string;
  title?: string | null;
  rawContent: string;
  styleHint?: string;
  targetLength?: "short" | "medium" | "long";
  model?: string;
  platform?: "qiita" | "note";
}): Promise<GenerationResult> {
  return await invoke<GenerationResult>("claude_generate_article", args);
}

/** 公開前 AI 書き換え。`targets` の機密ワードを伏字化した Markdown を返す。10〜30 秒。 */
export async function claudeRewriteForPublish(args: {
  body: string;
  targets: string[];
  model?: string;
}): Promise<string> {
  return await invoke<string>("claude_rewrite_for_publish", args);
}

/** 記事を紹介する X (Twitter) 投稿文 3 パターンを生成。10〜20 秒。 */
export async function claudeGenerateTweets(args: {
  title: string;
  body: string;
  tags: string[];
  url?: string | null;
  model?: string;
}): Promise<string[]> {
  return await invoke<string[]>("claude_generate_tweets", args);
}

// ---- Qiita API ---------------------------------------------------------------

export interface QiitaUser {
  id: string;
  permanent_id: number | null;
  name: string | null;
  profile_image_url: string | null;
}

export interface QiitaItem {
  id: string;
  url: string;
  title: string;
  private: boolean;
  created_at: string;
  updated_at: string;
}

/** Qiita PAT の有効性確認（Settings の接続テスト用）。 */
export async function qiitaTestConnection(): Promise<QiitaUser> {
  return await invoke<QiitaUser>("qiita_test_connection");
}

/** Qiita 記事を作成または更新。`itemId` ありで PATCH（partial OK）、無しで POST（title・tags 必須）。
 *  PATCH 時に `private` のみ指定すれば、タイトル重複検査をスキップして状態のみ切替えできる。 */
export async function qiitaSyncItem(args: {
  itemId?: string | null;
  title?: string;
  body?: string;
  tags?: string[];
  private?: boolean;
}): Promise<QiitaItem> {
  return await invoke<QiitaItem>("qiita_sync_item", { args });
}

// ---- 自動アップデート ---------------------------------------------------------

export interface UpdateInfo {
  available: boolean;
  version: string | null;
  currentVersion: string;
  notes: string | null;
  date: string | null;
}

/** GitHub Releases の `latest.json` を見て新版があるか確認。ダウンロードはしない。 */
export async function checkForUpdates(): Promise<UpdateInfo> {
  return await invoke<UpdateInfo>("check_for_updates");
}

/** 新版をダウンロード→Ed25519署名検証→置換→再起動。再起動が成功するとこの promise は解決しない。 */
export async function installUpdate(): Promise<void> {
  return await invoke("install_update");
}
