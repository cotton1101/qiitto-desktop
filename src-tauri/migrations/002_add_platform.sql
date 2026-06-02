-- v0.3 マイグレーション：複数プラットフォーム対応（Qiita / note）
-- 既存行は qiita とみなす。

ALTER TABLE sources ADD COLUMN platform TEXT NOT NULL DEFAULT 'qiita';
ALTER TABLE drafts  ADD COLUMN platform TEXT NOT NULL DEFAULT 'qiita';

CREATE INDEX IF NOT EXISTS idx_drafts_platform ON drafts(platform);
