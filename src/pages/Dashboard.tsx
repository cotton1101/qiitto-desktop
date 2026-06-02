import { Link } from "react-router-dom";
import { Sparkles, FileText, Globe, Settings as SettingsIcon } from "lucide-react";

export default function Dashboard() {
  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      <header>
        <h1 className="text-3xl font-bold">qiitto-desktop</h1>
        <p className="text-sm text-gray-500 mt-1">
          Claude Code の開発ログから Qiita 記事を半自動生成・公開
        </p>
      </header>

      <section className="grid grid-cols-2 gap-4">
        <Link
          to="/generate"
          className="card hover:border-qiitto-500 hover:shadow transition group"
        >
          <Sparkles className="w-6 h-6 text-qiitto-600 mb-2 group-hover:scale-110 transition" />
          <h3 className="font-semibold">新しく生成</h3>
          <p className="text-sm text-gray-500 mt-1">
            Claude Code セッションログまたはテキストから記事を作る
          </p>
        </Link>
        <Link
          to="/drafts"
          className="card hover:border-qiitto-500 hover:shadow transition group"
        >
          <FileText className="w-6 h-6 text-qiitto-600 mb-2 group-hover:scale-110 transition" />
          <h3 className="font-semibold">下書き一覧</h3>
          <p className="text-sm text-gray-500 mt-1">
            編集中・公開済み下書きの管理
          </p>
        </Link>
        <Link
          to="/published"
          className="card hover:border-qiitto-500 hover:shadow transition group"
        >
          <Globe className="w-6 h-6 text-qiitto-600 mb-2 group-hover:scale-110 transition" />
          <h3 className="font-semibold">公開済み</h3>
          <p className="text-sm text-gray-500 mt-1">
            Qiita に公開した記事
          </p>
        </Link>
        <Link
          to="/settings"
          className="card hover:border-qiitto-500 hover:shadow transition group"
        >
          <SettingsIcon className="w-6 h-6 text-qiitto-600 mb-2 group-hover:scale-110 transition" />
          <h3 className="font-semibold">設定</h3>
          <p className="text-sm text-gray-500 mt-1">
            API キー（OS Keyring 保存）/ 既定タグ / モデル
          </p>
        </Link>
      </section>

      <section className="card">
        <h2 className="font-semibold mb-2">今後の実装予定</h2>
        <ul className="text-sm text-gray-600 space-y-1 list-disc list-inside">
          <li>Claude Code ログ取込（ローカル `~/.claude/projects/` から）</li>
          <li>Claude API 呼び出し（Rust 側で完結・API キー漏れリスク最小）</li>
          <li>Markdown エディタ + Qiita 風プレビュー（左右分割）</li>
          <li>Qiita API v2 同期（限定共有 → 公開の 2 段階モーダル）</li>
          <li>macOS DMG 配布（v0.1 で ad-hoc 署名）</li>
        </ul>
      </section>
    </div>
  );
}
