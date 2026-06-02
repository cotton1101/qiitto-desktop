import Database from "@tauri-apps/plugin-sql";

let _db: Database | null = null;

/** SQLite データベースへの接続を遅延ロード（一度ロードしたら使い回す）。 */
export async function db(): Promise<Database> {
  if (_db) return _db;
  _db = await Database.load("sqlite:qiitto.db");
  return _db;
}

// ---- 設定（user_settings は単一行・id=1）-------------------------------------

export interface UserSettings {
  id: 1;
  default_tags: string; // JSON 配列文字列
  qiita_organization: string | null;
  model: string;
  monthly_token_limit: number;
  default_private: number; // 0|1
  created_at: string;
  updated_at: string;
}

export async function loadSettings(): Promise<UserSettings> {
  const conn = await db();
  const rows = await conn.select<UserSettings[]>(
    "SELECT * FROM user_settings WHERE id = 1 LIMIT 1",
  );
  return rows[0];
}

// ---- sources -----------------------------------------------------------------

export type Platform = "qiita" | "note";

export interface SourceRow {
  id: string;
  source_type: string;
  title: string | null;
  raw_content: string;
  metadata: string; // JSON
  platform: Platform;
  created_at: string;
}

/** sources テーブルに新規行を INSERT。id は UUID v4 を JS で発行。 */
export async function insertSource(input: {
  source_type: "claude_log" | "text" | "git_diff";
  title?: string | null;
  raw_content: string;
  metadata?: Record<string, unknown>;
  platform?: Platform;
}): Promise<string> {
  const conn = await db();
  const id = crypto.randomUUID();
  await conn.execute(
    `INSERT INTO sources (id, source_type, title, raw_content, metadata, platform)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.source_type,
      input.title ?? null,
      input.raw_content,
      JSON.stringify(input.metadata ?? {}),
      input.platform ?? "qiita",
    ],
  );
  return id;
}

export async function listSources(limit = 50): Promise<SourceRow[]> {
  const conn = await db();
  return await conn.select<SourceRow[]>(
    "SELECT * FROM sources ORDER BY created_at DESC LIMIT ?",
    [limit],
  );
}

export async function getSource(id: string): Promise<SourceRow | null> {
  const conn = await db();
  const rows = await conn.select<SourceRow[]>(
    "SELECT * FROM sources WHERE id = ? LIMIT 1",
    [id],
  );
  return rows[0] ?? null;
}

// ---- generations -------------------------------------------------------------

export interface GenerationRow {
  id: string;
  source_id: string;
  status: "pending" | "running" | "done" | "error";
  title_options: string | null; // JSON
  selected_title: string | null;
  body_markdown: string | null;
  suggested_tags: string | null; // JSON
  prompt_used: string | null;
  tokens_used: number | null;
  error: string | null;
  started_at: string;
  completed_at: string | null;
}

export async function insertGenerationPending(sourceId: string): Promise<string> {
  const conn = await db();
  const id = crypto.randomUUID();
  await conn.execute(
    `INSERT INTO generations (id, source_id, status) VALUES (?, ?, 'pending')`,
    [id, sourceId],
  );
  return id;
}

export async function markGenerationDone(
  id: string,
  data: {
    title_options: string[];
    suggested_tags: string[];
    body_markdown: string;
    selected_title: string | null;
    prompt_used: string;
    tokens_used: number;
  },
): Promise<void> {
  const conn = await db();
  await conn.execute(
    `UPDATE generations SET
       status = 'done',
       title_options = ?,
       selected_title = ?,
       body_markdown = ?,
       suggested_tags = ?,
       prompt_used = ?,
       tokens_used = ?,
       completed_at = datetime('now')
     WHERE id = ?`,
    [
      JSON.stringify(data.title_options),
      data.selected_title,
      data.body_markdown,
      JSON.stringify(data.suggested_tags),
      data.prompt_used,
      data.tokens_used,
      id,
    ],
  );
}

export async function markGenerationError(id: string, error: string): Promise<void> {
  const conn = await db();
  await conn.execute(
    `UPDATE generations SET status = 'error', error = ?, completed_at = datetime('now') WHERE id = ?`,
    [error, id],
  );
}

// ---- drafts ------------------------------------------------------------------

export interface DraftRow {
  id: string;
  generation_id: string | null;
  title: string;
  body: string;
  tags: string; // JSON
  qiita_item_id: string | null;
  qiita_url: string | null;
  qiita_private: number | null;
  qiita_status: string | null;
  last_synced_at: string | null;
  platform: Platform;
  created_at: string;
  updated_at: string;
}

export async function insertDraft(input: {
  generation_id: string | null;
  title: string;
  body: string;
  tags: string[];
  platform?: Platform;
}): Promise<string> {
  const conn = await db();
  const id = crypto.randomUUID();
  await conn.execute(
    `INSERT INTO drafts (id, generation_id, title, body, tags, platform)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.generation_id,
      input.title,
      input.body,
      JSON.stringify(input.tags),
      input.platform ?? "qiita",
    ],
  );
  return id;
}

/** 全件（下書き＋公開済み）。 */
export async function listDrafts(limit = 50): Promise<DraftRow[]> {
  const conn = await db();
  return await conn.select<DraftRow[]>(
    "SELECT * FROM drafts ORDER BY updated_at DESC LIMIT ?",
    [limit],
  );
}

/** 未公開のみ（qiita_status が NULL か 'draft'）。 */
export async function listDraftsUnpublished(limit = 50): Promise<DraftRow[]> {
  const conn = await db();
  return await conn.select<DraftRow[]>(
    `SELECT * FROM drafts
     WHERE qiita_status IS NULL OR qiita_status <> 'published'
     ORDER BY updated_at DESC LIMIT ?`,
    [limit],
  );
}

/** 公開済みのみ（Qiita に published 状態で同期されているもの）。 */
export async function listDraftsPublished(limit = 50): Promise<DraftRow[]> {
  const conn = await db();
  return await conn.select<DraftRow[]>(
    `SELECT * FROM drafts
     WHERE qiita_status = 'published'
     ORDER BY last_synced_at DESC LIMIT ?`,
    [limit],
  );
}

export async function getDraft(id: string): Promise<DraftRow | null> {
  const conn = await db();
  const rows = await conn.select<DraftRow[]>(
    "SELECT * FROM drafts WHERE id = ? LIMIT 1",
    [id],
  );
  return rows[0] ?? null;
}

export async function updateDraft(
  id: string,
  patch: Partial<Pick<DraftRow, "title" | "body" | "tags">>,
): Promise<void> {
  const conn = await db();
  const set: string[] = [];
  const values: unknown[] = [];
  if (patch.title !== undefined) {
    set.push("title = ?");
    values.push(patch.title);
  }
  if (patch.body !== undefined) {
    set.push("body = ?");
    values.push(patch.body);
  }
  if (patch.tags !== undefined) {
    set.push("tags = ?");
    values.push(patch.tags);
  }
  if (set.length === 0) return;
  set.push("updated_at = datetime('now')");
  values.push(id);
  await conn.execute(`UPDATE drafts SET ${set.join(", ")} WHERE id = ?`, values);
}

/** Qiita 同期後の状態を反映する（item_id / url / private / status）。 */
export async function markDraftQiitaSynced(
  id: string,
  q: { qiita_item_id: string; qiita_url: string; qiita_private: boolean },
): Promise<void> {
  const conn = await db();
  await conn.execute(
    `UPDATE drafts SET
       qiita_item_id = ?,
       qiita_url = ?,
       qiita_private = ?,
       qiita_status = ?,
       last_synced_at = datetime('now'),
       updated_at = datetime('now')
     WHERE id = ?`,
    [
      q.qiita_item_id,
      q.qiita_url,
      q.qiita_private ? 1 : 0,
      q.qiita_private ? "draft" : "published",
      id,
    ],
  );
}

export async function saveSettings(
  partial: Partial<
    Pick<
      UserSettings,
      | "default_tags"
      | "qiita_organization"
      | "model"
      | "monthly_token_limit"
      | "default_private"
    >
  >,
): Promise<void> {
  const conn = await db();
  const set: string[] = [];
  const values: unknown[] = [];
  for (const [k, v] of Object.entries(partial)) {
    if (v === undefined) continue;
    set.push(`${k} = ?`);
    values.push(v);
  }
  if (set.length === 0) return;
  set.push("updated_at = datetime('now')");
  values.push(); // no extra
  await conn.execute(
    `UPDATE user_settings SET ${set.join(", ")} WHERE id = 1`,
    values,
  );
}
