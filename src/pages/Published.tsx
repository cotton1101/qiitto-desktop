import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Globe, ExternalLink } from "lucide-react";
import { DraftRow, listDraftsPublished } from "../lib/db";

export default function Published() {
  const [items, setItems] = useState<DraftRow[] | null>(null);

  useEffect(() => {
    listDraftsPublished(100).then(setItems);
  }, []);

  if (items === null) {
    return <div className="p-6 text-sm text-gray-500">読込中…</div>;
  }

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-4">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Globe className="w-6 h-6 text-qiitto-600" />
          公開済み
        </h1>
        <Link to="/drafts" className="text-sm text-gray-500 hover:text-gray-700">
          下書きへ
        </Link>
      </header>

      {items.length === 0 ? (
        <div className="card text-center py-12 text-sm text-gray-500">
          まだ公開した記事はありません。
          <Link to="/drafts" className="text-qiitto-600 underline ml-1">
            下書き一覧
          </Link>
          から「公開する」を押してください。
        </div>
      ) : (
        <ul className="space-y-2">
          {items.map((d) => {
            const tags: string[] = (() => {
              try {
                return JSON.parse(d.tags || "[]");
              } catch {
                return [];
              }
            })();
            return (
              <li key={d.id}>
                <div className="card hover:border-qiitto-500 hover:shadow transition">
                  <div className="flex items-center justify-between gap-3">
                    <Link
                      to={`/drafts/${d.id}`}
                      className="font-medium truncate hover:text-qiitto-700"
                    >
                      {d.title || "(無題)"}
                    </Link>
                    {d.qiita_url && (
                      <a
                        href={d.qiita_url}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="text-xs text-qiitto-700 hover:text-qiitto-800 flex items-center gap-1 shrink-0"
                        title="Qiita で開く"
                      >
                        <ExternalLink className="w-3 h-3" />
                        Qiita で開く
                      </a>
                    )}
                  </div>
                  {tags.length > 0 && (
                    <div className="mt-1 text-xs text-gray-500">
                      {tags.join(" · ")}
                    </div>
                  )}
                  <div className="mt-1 text-xs text-gray-400">
                    {d.last_synced_at
                      ? `${new Date(d.last_synced_at).toLocaleString("ja-JP")} 公開`
                      : `${new Date(d.updated_at).toLocaleString("ja-JP")} 更新`}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
