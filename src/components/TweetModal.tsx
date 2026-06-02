import { useEffect, useState } from "react";
import {
  X,
  Send,
  Copy,
  RefreshCw,
  ExternalLink,
  Loader2,
} from "lucide-react";
import toast from "react-hot-toast";
import { claudeGenerateTweets } from "../lib/api";
import { openUrl } from "@tauri-apps/plugin-opener";

interface Props {
  open: boolean;
  title: string;
  body: string;
  tags: string[];
  url?: string | null;
  onClose: () => void;
}

// 日本語混じり文字列の素朴な文字数（X の重み付けは複雑なので、目安）
function countTweetChars(s: string): number {
  return [...s].length;
}

export default function TweetModal({
  open,
  title,
  body,
  tags,
  url,
  onClose,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [tweets, setTweets] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await claudeGenerateTweets({ title, body, tags, url });
      setTweets(result);
    } catch (e) {
      setError(String(e));
      toast.error(`生成失敗: ${e}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open && tweets.length === 0 && !loading) {
      void run();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const copy = async (text: string) => {
    const full = url ? `${text}\n${url}` : text;
    try {
      await navigator.clipboard.writeText(full);
      toast.success("クリップボードにコピーしました");
    } catch {
      toast.error("コピー失敗");
    }
  };

  const openX = async (text: string) => {
    const full = url ? `${text}\n${url}` : text;
    const intent = `https://x.com/intent/tweet?text=${encodeURIComponent(full)}`;
    try {
      await openUrl(intent);
    } catch {
      window.open(intent, "_blank", "noopener,noreferrer");
    }
  };

  const handleClose = () => {
    setTweets([]);
    setError(null);
    onClose();
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-3 border-b">
          <h2 className="font-semibold text-base flex items-center gap-2">
            <Send className="w-4 h-4 text-sky-600" />X 投稿文を生成
          </h2>
          <button
            onClick={handleClose}
            className="text-gray-400 hover:text-gray-700"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          {loading && tweets.length === 0 && (
            <div className="text-center text-gray-500 py-12">
              <Loader2 className="w-8 h-8 animate-spin text-sky-500 mx-auto" />
              <div className="mt-3 text-sm">
                Claude が投稿案を作成中…（10〜20 秒）
              </div>
            </div>
          )}

          {error && !loading && (
            <div className="text-center text-red-600 text-sm py-8">
              {error}
            </div>
          )}

          {tweets.map((t, i) => {
            const chars = countTweetChars(t);
            const overLimit = chars > 140;
            return (
              <div key={i} className="border rounded p-3 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium text-gray-500">
                    案 {i + 1}
                  </span>
                  <span
                    className={
                      overLimit ? "text-red-600 font-medium" : "text-gray-400"
                    }
                  >
                    {chars}/140
                  </span>
                </div>
                <p className="text-sm whitespace-pre-wrap leading-relaxed">
                  {t}
                </p>
                {url && (
                  <p className="text-xs text-gray-400">+ URL: {url}</p>
                )}
                <div className="flex gap-2 justify-end">
                  <button
                    onClick={() => copy(t)}
                    className="text-xs px-2 py-1 border rounded hover:bg-gray-50 flex items-center gap-1"
                  >
                    <Copy className="w-3 h-3" />
                    コピー
                  </button>
                  <button
                    onClick={() => openX(t)}
                    className="text-xs px-2 py-1 bg-sky-600 text-white rounded hover:bg-sky-700 flex items-center gap-1"
                  >
                    <ExternalLink className="w-3 h-3" />X で投稿
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        <div className="px-5 py-3 border-t flex justify-end gap-2">
          <button
            onClick={() => {
              setTweets([]);
              void run();
            }}
            disabled={loading}
            className="btn-secondary text-sm"
          >
            <RefreshCw
              className={`w-3.5 h-3.5 mr-1 ${loading ? "animate-spin" : ""}`}
            />
            再生成
          </button>
          <button onClick={handleClose} className="btn-secondary text-sm">
            閉じる
          </button>
        </div>
      </div>
    </div>
  );
}
