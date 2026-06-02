-- qiitto-desktop initial schema (SQLite)
-- シングルテナント前提のためユーザーテーブルなし。設定は単一行で持つ。
-- API キーは SQLite に入れない（OS keyring に格納）。

PRAGMA foreign_keys = ON;

-- 設定（単一行・id=1 のみ）
CREATE TABLE IF NOT EXISTS user_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    default_tags TEXT NOT NULL DEFAULT '[]',           -- JSON 配列
    qiita_organization TEXT,
    model TEXT NOT NULL DEFAULT 'claude-sonnet-4-6',
    monthly_token_limit INTEGER NOT NULL DEFAULT 1000000,
    default_private INTEGER NOT NULL DEFAULT 1,        -- bool (1=true)
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO user_settings (id) VALUES (1);

-- 素材
CREATE TABLE IF NOT EXISTS sources (
    id TEXT PRIMARY KEY,                                -- UUID v4
    source_type TEXT NOT NULL,                          -- 'claude_log' | 'text' | 'git_diff'
    title TEXT,
    raw_content TEXT NOT NULL,
    metadata TEXT NOT NULL DEFAULT '{}',                -- JSON
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_sources_created ON sources(created_at DESC);

-- 生成ジョブ
CREATE TABLE IF NOT EXISTS generations (
    id TEXT PRIMARY KEY,
    source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'pending',             -- pending | running | done | error
    title_options TEXT,                                 -- JSON 配列
    selected_title TEXT,
    body_markdown TEXT,
    suggested_tags TEXT,                                -- JSON 配列
    prompt_used TEXT,
    tokens_used INTEGER,
    error TEXT,
    started_at TEXT DEFAULT (datetime('now')),
    completed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_generations_started ON generations(started_at DESC);

-- 下書き
CREATE TABLE IF NOT EXISTS drafts (
    id TEXT PRIMARY KEY,
    generation_id TEXT REFERENCES generations(id) ON DELETE SET NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    tags TEXT NOT NULL DEFAULT '[]',                    -- JSON 配列
    qiita_item_id TEXT,
    qiita_url TEXT,
    qiita_private INTEGER DEFAULT 1,
    qiita_status TEXT,                                  -- draft | published
    last_synced_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_drafts_updated ON drafts(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_drafts_qiita ON drafts(qiita_item_id) WHERE qiita_item_id IS NOT NULL;
