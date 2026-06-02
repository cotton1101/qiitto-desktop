import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { FileText, Globe } from "lucide-react";
import { DraftRow, listDraftsUnpublished } from "../lib/db";

function PlatformBadge({ d }: { d: DraftRow }) {
  if (d.platform === "note") {
    return (
      <span className="text-xs px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 font-medium shrink-0">
        📝 note
      </span>
    );
  }
  return (
    <span className="text-xs px-2 py-0.5 rounded bg-qiitto-50 text-qiitto-700 font-medium shrink-0">
      📘 Qiita
    </span>
  );
}

function StatusBadge({ d }: { d: DraftRow }) {
  if (d.platform === "note") {
    // note は同期APIなし。下書き=未投稿、公開=ユーザーが手動投稿済みのフラグ
    return (
      <span className="text-xs px-2 py-0.5 rounded bg-gray-100 text-gray-600">
        下書き
      </span>
    );
  }
  if (d.qiita_status === "published") {
    return (
      <span className="text-xs px-2 py-0.5 rounded bg-green-100 text-green-700 inline-flex items-center gap-1">
        <Globe className="w-3 h-3" />
        公開
      </span>
    );
  }
  if (d.qiita_item_id) {
    return (
      <span className="text-xs px-2 py-0.5 rounded bg-blue-100 text-blue-700">
        Qiita 下書き同期済み
      </span>
    );
  }
  return (
    <span className="text-xs px-2 py-0.5 rounded bg-gray-100 text-gray-600">
      下書き
    </span>
  );
}

export default function Drafts() {
  const [drafts, setDrafts] = useState<DraftRow[] | null>(null);

  useEffect(() => {
    listDraftsUnpublished(100).then(setDrafts);
  }, []);

  if (drafts === null) {
    return <div className="p-6 text-sm text-gray-500">読込中…</div>;
  }

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-4">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <FileText className="w-6 h-6 text-qiitto-600" />
          下書き
        </h1>
        <Link to="/generate" className="btn-primary text-sm">
          新規生成
        </Link>
      </header>

      {drafts.length === 0 ? (
        <div className="card text-center py-12 text-sm text-gray-500">
          まだ下書きはありません。
          <Link to="/generate" className="text-qiitto-600 underline ml-1">
            新規生成
          </Link>
          から始めてください。
        </div>
      ) : (
        <ul className="space-y-2">
          {drafts.map((d) => {
            const tags: string[] = (() => {
              try {
                return JSON.parse(d.tags || "[]");
              } catch {
                return [];
              }
            })();
            return (
              <li key={d.id}>
                <Link
                  to={`/drafts/${d.id}`}
                  className="card block hover:border-qiitto-500 hover:shadow transition"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="font-medium truncate flex items-center gap-2">
                      <PlatformBadge d={d} />
                      <span className="truncate">{d.title || "(無題)"}</span>
                    </div>
                    <StatusBadge d={d} />
                  </div>
                  {tags.length > 0 && (
                    <div className="mt-1 text-xs text-gray-500">
                      {tags.join(" · ")}
                    </div>
                  )}
                  <div className="mt-1 text-xs text-gray-400">
                    更新 {new Date(d.updated_at).toLocaleString("ja-JP")}
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
