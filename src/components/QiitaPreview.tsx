import { useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import rehypeRaw from "rehype-raw";
import "highlight.js/styles/github.css";
import "./qiita-preview.css";

/**
 * Qiita 独自の `:::note` ブロック記法を HTML に前処理する。
 *
 * ```
 * :::note info
 * 補足です
 * :::
 * ```
 *
 * Qiita の type は info / warn / alert の 3 種類。
 */
function preprocessQiitaNote(md: string): string {
  return md.replace(
    /^:::note(?:\s+(info|warn|alert))?\n([\s\S]*?)\n:::$/gm,
    (_full, type = "info", body) => {
      const t = String(type || "info").toLowerCase();
      const label = t === "alert" ? "⚠ alert" : t === "warn" ? "🟡 warn" : "💬 info";
      // 中身の Markdown も react-markdown でレンダリングさせるため、空行で囲む
      return `<div class="qiita-note qiita-note-${t}">\n<div class="qiita-note-label">${label}</div>\n\n${body}\n\n</div>`;
    },
  );
}

export interface QiitaPreviewProps {
  markdown: string;
  /** 上限文字数を超えた場合の警告（任意） */
  maxChars?: number;
}

export default function QiitaPreview({ markdown, maxChars }: QiitaPreviewProps) {
  const processed = useMemo(() => preprocessQiitaNote(markdown), [markdown]);
  const overLimit =
    typeof maxChars === "number" && markdown.length > maxChars;

  return (
    <div className="qiita-preview">
      {overLimit && (
        <div className="qiita-overlimit">
          ⚠ {markdown.length.toLocaleString()} 文字（{maxChars?.toLocaleString()} 文字を超過）
        </div>
      )}
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeRaw, rehypeHighlight]}
      >
        {processed}
      </ReactMarkdown>
    </div>
  );
}
