import { useState } from "react";
import { X, Sparkles, Check, Loader2 } from "lucide-react";
import toast from "react-hot-toast";
import { claudeRewriteForPublish } from "../lib/api";

interface Props {
  open: boolean;
  body: string;
  targets: string[];
  onClose: () => void;
  onApply: (newBody: string) => void;
}

export default function RewriteModal({
  open,
  body,
  targets,
  onClose,
  onApply,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const run = async () => {
    setLoading(true);
    try {
      const rewritten = await claudeRewriteForPublish({ body, targets });
      setResult(rewritten);
    } catch (e) {
      toast.error(`書き換え失敗: ${e}`);
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setResult(null);
    onClose();
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-6xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-3 border-b">
          <h2 className="font-semibold text-base flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-purple-600" />
            AI で機密情報を伏字化
          </h2>
          <button
            onClick={handleClose}
            className="text-gray-400 hover:text-gray-700"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 py-3 border-b text-xs text-gray-600 space-y-1">
          <div>
            伏字化対象{" "}
            <span className="text-gray-400">({targets.length} 項目)</span>:
          </div>
          <div className="flex flex-wrap gap-1">
            {targets.slice(0, 50).map((t, i) => (
              <span
                key={i}
                className="px-1.5 py-0.5 bg-red-50 text-red-700 rounded text-xs font-mono"
              >
                {t.length > 40 ? t.slice(0, 40) + "…" : t}
              </span>
            ))}
            {targets.length > 50 && (
              <span className="text-gray-400 self-center">
                …他 {targets.length - 50} 件
              </span>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-hidden flex min-h-0">
          <div className="w-1/2 border-r overflow-y-auto flex flex-col">
            <div className="px-3 py-1.5 text-xs font-medium bg-gray-50 border-b shrink-0">
              変更前
            </div>
            <pre className="text-xs p-3 whitespace-pre-wrap break-words font-mono leading-relaxed">
              {body}
            </pre>
          </div>
          <div className="w-1/2 overflow-y-auto flex flex-col">
            <div className="px-3 py-1.5 text-xs font-medium bg-gray-50 border-b shrink-0 flex justify-between">
              <span>変更後</span>
              {result && (
                <span className="text-purple-600">(Claude 生成)</span>
              )}
            </div>
            {loading ? (
              <div className="text-center text-gray-500 py-12 px-4">
                <Loader2 className="w-8 h-8 animate-spin text-purple-500 mx-auto" />
                <div className="mt-3 text-sm">
                  Claude が書き換え中…（10〜30 秒）
                </div>
              </div>
            ) : result ? (
              <pre className="text-xs p-3 whitespace-pre-wrap break-words font-mono leading-relaxed">
                {result}
              </pre>
            ) : (
              <div className="text-center text-gray-400 text-sm py-12 px-4">
                右下の「書き換え実行」を押すと、Claude が伏字化案を生成します
              </div>
            )}
          </div>
        </div>

        <div className="px-5 py-3 border-t flex justify-end gap-2">
          <button onClick={handleClose} className="btn-secondary text-sm">
            キャンセル
          </button>
          {!result ? (
            <button
              onClick={run}
              disabled={loading || targets.length === 0}
              className="btn-primary bg-purple-600 hover:bg-purple-700 text-sm disabled:opacity-50"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                  生成中…
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4 mr-1" />
                  書き換え実行
                </>
              )}
            </button>
          ) : (
            <>
              <button
                onClick={run}
                disabled={loading}
                className="btn-secondary text-sm"
              >
                <Sparkles className="w-4 h-4 mr-1" />
                再生成
              </button>
              <button
                onClick={() => {
                  onApply(result);
                  setResult(null);
                }}
                className="btn-primary bg-emerald-600 hover:bg-emerald-700 text-sm"
              >
                <Check className="w-4 h-4 mr-1" />
                本文に反映
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
