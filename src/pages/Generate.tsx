import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { useNavigate } from "react-router-dom";
import {
  FileText,
  Sparkles,
  RefreshCw,
  FolderOpen,
  Wand2,
} from "lucide-react";
import {
  ClaudeLogProject,
  ClaudeLogResult,
  claudeGenerateArticle,
  listClaudeProjects,
  readClaudeSessions,
} from "../lib/api";
import {
  Platform,
  insertSource,
  insertGenerationPending,
  markGenerationDone,
  markGenerationError,
  insertDraft,
} from "../lib/db";

type Tab = "claude_log" | "text";
type TargetLength = "short" | "medium" | "long";

interface SaveAndGenerateOptions {
  sourceType: "claude_log" | "text";
  title: string | null;
  rawContent: string;
  metadata?: Record<string, unknown>;
  targetLength: TargetLength;
  platform: Platform;
}

async function saveAndGenerate(
  opts: SaveAndGenerateOptions,
  setProgress: (s: string) => void,
): Promise<string> {
  setProgress("素材を保存中…");
  const sourceId = await insertSource({
    source_type: opts.sourceType,
    title: opts.title,
    raw_content: opts.rawContent,
    metadata: opts.metadata,
    platform: opts.platform,
  });

  setProgress("生成ジョブを作成中…");
  const generationId = await insertGenerationPending(sourceId);

  try {
    setProgress(
      `Claude API で${opts.platform === "note" ? "note エッセイ" : "Qiita 技術記事"}を生成中…（20〜60秒）`,
    );
    const result = await claudeGenerateArticle({
      sourceType: opts.sourceType,
      title: opts.title,
      rawContent: opts.rawContent,
      targetLength: opts.targetLength,
      platform: opts.platform,
    });

    const selectedTitle = result.title_options[0] ?? null;
    setProgress("結果を保存中…");
    await markGenerationDone(generationId, {
      title_options: result.title_options,
      suggested_tags: result.suggested_tags,
      body_markdown: result.body_markdown,
      selected_title: selectedTitle,
      prompt_used: result.prompt_used,
      tokens_used: result.tokens_used,
    });

    const draftId = await insertDraft({
      generation_id: generationId,
      title: selectedTitle ?? "(無題)",
      body: result.body_markdown,
      tags: result.suggested_tags,
      platform: opts.platform,
    });

    if (!result.parse_ok) {
      toast(
        "応答パースに失敗しました（全文を本文に入れた fallback）。タイトル/タグは手動で設定してください。",
        { icon: "⚠️", duration: 6000 },
      );
    }
    return draftId;
  } catch (e) {
    await markGenerationError(generationId, String(e));
    throw e;
  }
}

// --- プラットフォーム切替（タブ共通） ---

function PlatformPicker({
  value,
  onChange,
  disabled,
}: {
  value: Platform;
  onChange: (v: Platform) => void;
  disabled?: boolean;
}) {
  return (
    <div className="card !p-3">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-sm font-medium text-gray-700">
          🎯 投稿先プラットフォーム
        </span>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => onChange("qiita")}
          disabled={disabled}
          className={[
            "rounded border-2 px-3 py-2 text-left transition",
            value === "qiita"
              ? "border-qiitto-600 bg-qiitto-50"
              : "border-gray-200 bg-white hover:border-gray-300",
            disabled ? "opacity-60 cursor-not-allowed" : "",
          ].join(" ")}
        >
          <div className="font-semibold text-sm flex items-center gap-1">
            <span className="text-qiitto-600">📘</span> Qiita
          </div>
          <div className="text-xs text-gray-500 mt-0.5">
            技術記事 · コード多め · ハマったポイント中心
          </div>
        </button>
        <button
          type="button"
          onClick={() => onChange("note")}
          disabled={disabled}
          className={[
            "rounded border-2 px-3 py-2 text-left transition",
            value === "note"
              ? "border-emerald-600 bg-emerald-50"
              : "border-gray-200 bg-white hover:border-gray-300",
            disabled ? "opacity-60 cursor-not-allowed" : "",
          ].join(" ")}
        >
          <div className="font-semibold text-sm flex items-center gap-1">
            <span className="text-emerald-600">📝</span> note
          </div>
          <div className="text-xs text-gray-500 mt-0.5">
            エッセイ調 · 体験と気づき · 個人開発の振り返り
          </div>
        </button>
      </div>
    </div>
  );
}

// --- Claude ログタブ ---

function ClaudeLogTab({ platform }: { platform: Platform }) {
  const navigate = useNavigate();
  const [projects, setProjects] = useState<ClaudeLogProject[]>([]);
  const [selected, setSelected] = useState<string>("");
  const [includeToolCalls, setIncludeToolCalls] = useState(false);
  const [latestOnly, setLatestOnly] = useState(true);
  const [maxChars, setMaxChars] = useState<number>(200_000);
  const [targetLength, setTargetLength] = useState<TargetLength>("medium");
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [result, setResult] = useState<ClaudeLogResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string>("");

  const loadProjects = async () => {
    setRefreshing(true);
    try {
      const ps = await listClaudeProjects();
      setProjects(ps);
      if (ps.length && !selected) setSelected(ps[0].project_path);
      if (ps.length === 0) {
        toast("~/.claude/projects/ が空でした。", { icon: "ℹ️" });
      }
    } catch (e) {
      toast.error(`プロジェクト一覧取得失敗: ${e}`);
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    loadProjects();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadSessions = async () => {
    if (!selected) return;
    setLoading(true);
    setResult(null);
    try {
      const r = await readClaudeSessions({
        project_path: selected,
        include_tool_calls: includeToolCalls,
        latest_only: latestOnly,
        max_chars: maxChars,
      });
      if (!r) toast.error("該当プロジェクトが見つかりません（cwd 不一致）");
      else {
        setResult(r);
        toast.success(
          `${r.session_count} セッション・${r.char_count.toLocaleString()} 文字を取得`,
        );
      }
    } catch (e) {
      toast.error(`読込失敗: ${e}`);
    } finally {
      setLoading(false);
    }
  };

  const doGenerate = async () => {
    if (!result || !result.content.trim()) return;
    setBusy(true);
    setProgress("");
    const t = toast.loading("素材を保存中…");
    try {
      const draftId = await saveAndGenerate(
        {
          sourceType: "claude_log",
          title: `Claude Code: ${selected.split("/").slice(-1)[0] || selected}`,
          rawContent: result.content,
          metadata: {
            project_path: result.project_path,
            session_count: result.session_count,
            message_counts: result.message_counts,
            session_ids: result.session_ids,
            truncated: result.truncated,
            options: {
              include_tool_calls: includeToolCalls,
              latest_only: latestOnly,
              max_chars: maxChars,
            },
          },
          targetLength,
          platform,
        },
        (s) => {
          setProgress(s);
          toast.loading(s, { id: t });
        },
      );
      toast.success("記事を生成しました", { id: t });
      navigate(`/drafts/${draftId}`);
    } catch (e) {
      toast.error(`生成失敗: ${e}`, { id: t });
    } finally {
      setBusy(false);
      setProgress("");
    }
  };

  return (
    <div className="space-y-4">
      <div className="card space-y-4">
        <div className="flex items-center justify-between">
          <label className="label !mb-0 flex items-center gap-2">
            <FolderOpen className="w-4 h-4 text-qiitto-600" />
            Claude Code プロジェクト
          </label>
          <button
            className="btn-secondary text-xs"
            onClick={loadProjects}
            disabled={refreshing || busy}
            title="再読込"
          >
            <RefreshCw
              className={`w-3.5 h-3.5 mr-1 ${refreshing ? "animate-spin" : ""}`}
            />
            再読込
          </button>
        </div>
        <select
          className="input"
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          disabled={projects.length === 0 || busy}
        >
          {projects.length === 0 && <option>（プロジェクトなし）</option>}
          {projects.map((p) => (
            <option key={p.encoded_dir} value={p.project_path}>
              {p.project_path} （{p.session_count} sessions・
              {new Date(p.last_modified).toLocaleString("ja-JP")}）
            </option>
          ))}
        </select>

        <div className="grid grid-cols-2 gap-3 text-sm">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={latestOnly}
              onChange={(e) => setLatestOnly(e.target.checked)}
              disabled={busy}
            />
            最新セッションのみ
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={includeToolCalls}
              onChange={(e) => setIncludeToolCalls(e.target.checked)}
              disabled={busy}
            />
            ツール呼出を含める
          </label>
          <label className="flex items-center gap-2">
            最大文字数
            <input
              type="number"
              className="input !w-28 !py-1"
              value={maxChars}
              onChange={(e) =>
                setMaxChars(Number(e.target.value) || 200_000)
              }
              min={1000}
              step={10_000}
              disabled={busy}
            />
          </label>
          <label className="flex items-center gap-2">
            目標文字数
            <select
              className="input !w-32 !py-1"
              value={targetLength}
              onChange={(e) => setTargetLength(e.target.value as TargetLength)}
              disabled={busy}
            >
              <option value="short">short (~800)</option>
              <option value="medium">medium (~1500)</option>
              <option value="long">long (~2500)</option>
            </select>
          </label>
        </div>

        <button
          className="btn-primary"
          onClick={loadSessions}
          disabled={loading || !selected || projects.length === 0 || busy}
        >
          {loading ? "読込中…" : "セッションを読み込む"}
        </button>
      </div>

      {result && (
        <div className="card space-y-3">
          <div className="flex items-center justify-between text-sm">
            <div className="space-x-4">
              <span>
                <b>{result.session_count}</b> セッション
              </span>
              <span>
                <b>{result.char_count.toLocaleString()}</b> 文字
              </span>
              <span>
                User <b>{result.message_counts.user}</b> / Claude{" "}
                <b>{result.message_counts.assistant}</b>
                {result.message_counts.tool_use > 0 && (
                  <>
                    {" "}
                    / Tool <b>{result.message_counts.tool_use}</b>
                  </>
                )}
              </span>
              {result.truncated && (
                <span className="text-amber-600">⚠ 上限で打切り</span>
              )}
            </div>
            <button
              className="btn-primary text-sm"
              onClick={doGenerate}
              disabled={busy || !result.content.trim()}
            >
              <Wand2 className="w-3.5 h-3.5 mr-1" />
              {busy ? progress || "生成中…" : "保存して記事を生成"}
            </button>
          </div>
          <div className="border border-gray-200 rounded bg-gray-50 p-3 max-h-96 overflow-auto">
            <pre className="text-xs whitespace-pre-wrap break-words font-mono">
              {result.content || "(空)"}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}

// --- テキストタブ ---

function TextTab({ platform }: { platform: Platform }) {
  const navigate = useNavigate();
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [targetLength, setTargetLength] = useState<TargetLength>("medium");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!content.trim()) return;
    setBusy(true);
    const t = toast.loading("素材を保存中…");
    try {
      const draftId = await saveAndGenerate(
        {
          sourceType: "text",
          title: title.trim() || null,
          rawContent: content,
          targetLength,
          platform,
        },
        (s) => toast.loading(s, { id: t }),
      );
      toast.success("記事を生成しました", { id: t });
      navigate(`/drafts/${draftId}`);
    } catch (e) {
      toast.error(`生成失敗: ${e}`, { id: t });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card space-y-3">
      <div>
        <label className="label">タイトル（任意）</label>
        <input
          className="input"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="例: Next.js standalone デプロイ罠まとめ"
          disabled={busy}
        />
      </div>
      <div>
        <label className="label">本文 / メモ</label>
        <textarea
          className="input font-mono text-sm"
          rows={16}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="Claude との会話ログ、git diff のメモ、手書きの要点…なんでも"
          disabled={busy}
        />
        <p className="text-xs text-gray-500 mt-1">
          {content.length.toLocaleString()} 文字
        </p>
      </div>
      <label className="flex items-center gap-2 text-sm">
        目標文字数
        <select
          className="input !w-32 !py-1"
          value={targetLength}
          onChange={(e) => setTargetLength(e.target.value as TargetLength)}
          disabled={busy}
        >
          <option value="short">short (~800)</option>
          <option value="medium">medium (~1500)</option>
          <option value="long">long (~2500)</option>
        </select>
      </label>
      <button
        className="btn-primary"
        onClick={submit}
        disabled={busy || !content.trim()}
      >
        <Wand2 className="w-3.5 h-3.5 mr-1" />
        {busy ? "生成中…" : "保存して記事を生成"}
      </button>
    </div>
  );
}

export default function Generate() {
  const [tab, setTab] = useState<Tab>("claude_log");
  const [platform, setPlatform] = useState<Platform>("qiita");

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-4">
      <header>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Sparkles className="w-6 h-6 text-qiitto-600" />
          新規生成
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          素材を取り込んで Claude API で記事を生成します（20〜60秒）。プラットフォームで文体・構成が変わります。
        </p>
      </header>

      <PlatformPicker value={platform} onChange={setPlatform} />

      <div className="flex border-b border-gray-200">
        {(
          [
            { id: "claude_log", label: "Claude Code ログ", icon: Sparkles },
            { id: "text", label: "テキスト", icon: FileText },
          ] as const
        ).map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            className={[
              "flex items-center gap-2 px-4 py-2 text-sm border-b-2 -mb-px transition",
              tab === id
                ? "border-qiitto-600 text-qiitto-700 font-medium"
                : "border-transparent text-gray-500 hover:text-gray-700",
            ].join(" ")}
            onClick={() => setTab(id)}
          >
            <Icon className="w-4 h-4" />
            {label}
          </button>
        ))}
      </div>

      {tab === "claude_log" ? (
        <ClaudeLogTab platform={platform} />
      ) : (
        <TextTab platform={platform} />
      )}
    </div>
  );
}
