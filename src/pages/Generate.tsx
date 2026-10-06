import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { useNavigate } from "react-router-dom";
import {
  FileText,
  Sparkles,
  RefreshCw,
  FolderOpen,
  Wand2,
  Check,
} from "lucide-react";
import {
  ClaudeLogProject,
  ClaudeLogResult,
  PreviousArticle,
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
  listPreviousDrafts,
  PreviousDraft,
} from "../lib/db";

type Tab = "claude_log" | "text";
type TargetLength = "short" | "medium" | "long";

interface SaveAndGenerateOptions {
  sourceType: "claude_log" | "text";
  title: string | null;
  rawContent: string;
  metadata?: Record<string, unknown>;
  targetLength: TargetLength;
  /** 指定したプラットフォームは前回記事の続編として生成する */
  previous?: Partial<Record<Platform, PreviousArticle>>;
}

async function generateOnePlatform(
  sourceId: string,
  opts: SaveAndGenerateOptions,
  platform: Platform,
): Promise<string> {
  const generationId = await insertGenerationPending(sourceId);
  try {
    const result = await claudeGenerateArticle({
      sourceType: opts.sourceType,
      title: opts.title,
      rawContent: opts.rawContent,
      targetLength: opts.targetLength,
      platform,
      previousArticle: opts.previous?.[platform] ?? null,
    });

    const selectedTitle = result.title_options[0] ?? null;
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
      platform,
    });

    if (!result.parse_ok) {
      toast(
        `${platform === "note" ? "note" : "Qiita"}の応答パース失敗（fallback）。タイトル/タグは手動で設定してください。`,
        { icon: "⚠️", duration: 6000 },
      );
    }
    return draftId;
  } catch (e) {
    await markGenerationError(generationId, String(e));
    throw e;
  }
}

/** 1 つの素材から 1 つ or 複数のプラットフォーム向けに記事を生成する。
 *  複数プラットフォーム指定時は Claude API を並列呼び出しする（wall-clock 約 30〜60秒）。 */
async function saveAndGenerateMulti(
  opts: SaveAndGenerateOptions,
  platforms: Platform[],
  setProgress: (s: string) => void,
): Promise<string[]> {
  setProgress("素材を保存中…");
  const sourceId = await insertSource({
    source_type: opts.sourceType,
    title: opts.title,
    raw_content: opts.rawContent,
    metadata: opts.metadata,
  });

  const label =
    platforms.length === 1
      ? platforms[0] === "note"
        ? "note エッセイ"
        : "Qiita 技術記事"
      : "Qiita + note を並列";
  setProgress(`Claude API で ${label} 生成中…（20〜60秒）`);

  return await Promise.all(
    platforms.map((p) => generateOnePlatform(sourceId, opts, p)),
  );
}

// --- プラットフォーム切替（タブ共通・複数選択可） ---

function PlatformPicker({
  values,
  onChange,
  disabled,
}: {
  values: Set<Platform>;
  onChange: (next: Set<Platform>) => void;
  disabled?: boolean;
}) {
  const toggle = (p: Platform) => {
    const next = new Set(values);
    if (next.has(p)) {
      if (next.size === 1) return; // 最低 1 つは選択
      next.delete(p);
    } else {
      next.add(p);
    }
    onChange(next);
  };

  return (
    <div className="card !p-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium text-gray-700">
          🎯 投稿先プラットフォーム
          <span className="text-xs text-gray-400 font-normal ml-2">
            （複数選択可・最低 1 つ）
          </span>
        </span>
        {values.size === 2 && (
          <span className="text-xs text-emerald-600 font-medium animate-pulse">
            ⚡ Claude API を並列で 2 件生成
          </span>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2">
        {(
          [
            {
              id: "qiita" as const,
              icon: "📘",
              label: "Qiita",
              desc: "技術記事 · コード多め · ハマったポイント中心",
              activeBorder: "border-qiitto-600",
              activeBg: "bg-qiitto-50",
              checkColor: "text-qiitto-600",
            },
            {
              id: "note" as const,
              icon: "📝",
              label: "note",
              desc: "エッセイ調 · 体験と気づき · 個人開発の振り返り",
              activeBorder: "border-emerald-600",
              activeBg: "bg-emerald-50",
              checkColor: "text-emerald-600",
            },
          ] as const
        ).map((p) => {
          const active = values.has(p.id);
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => toggle(p.id)}
              disabled={disabled}
              className={[
                "rounded border-2 px-3 py-2 text-left transition relative",
                active
                  ? `${p.activeBorder} ${p.activeBg}`
                  : "border-gray-200 bg-white hover:border-gray-300",
                disabled ? "opacity-60 cursor-not-allowed" : "",
              ].join(" ")}
            >
              <div className="flex items-center justify-between">
                <span className="font-semibold text-sm flex items-center gap-1">
                  <span>{p.icon}</span> {p.label}
                </span>
                {active && <Check className={`w-4 h-4 ${p.checkColor}`} />}
              </div>
              <div className="text-xs text-gray-500 mt-0.5">{p.desc}</div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// --- Claude ログタブ ---

function ClaudeLogTab({ platforms }: { platforms: Set<Platform> }) {
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
  // 続編の元記事の候補（新しい順）と、投稿先ごとに選んだ元記事 id（"" は続けない）
  const [candidates, setCandidates] = useState<Record<Platform, PreviousDraft[]>>({
    qiita: [],
    note: [],
  });
  const [chosenId, setChosenId] = useState<Record<Platform, string>>({ qiita: "", note: "" });
  const [continueSeries, setContinueSeries] = useState(true);

  // 選択中プロジェクトの過去記事（Qiita / note それぞれ）。既定は最新の記事
  useEffect(() => {
    if (!selected) return;
    let cancelled = false;
    (async () => {
      const [qiita, note] = await Promise.all([
        listPreviousDrafts(selected, "qiita"),
        listPreviousDrafts(selected, "note"),
      ]);
      if (cancelled) return;
      setCandidates({ qiita, note });
      setChosenId({ qiita: qiita[0]?.id ?? "", note: note[0]?.id ?? "" });
    })().catch((e) => toast.error(`前回記事の取得失敗: ${e}`));
    return () => {
      cancelled = true;
    };
  }, [selected]);

  const previous: Partial<Record<Platform, PreviousDraft>> = {};
  for (const p of ["qiita", "note"] as const) {
    const d = candidates[p].find((c) => c.id === chosenId[p]);
    if (d) previous[p] = d;
  }

  const seriesPlatforms = Array.from(platforms).filter((p) => previous[p]);
  const continuing = continueSeries && seriesPlatforms.length > 0;
  // 素材は「選択中の投稿先の前回記事のうち古い方」以降の会話に絞る（どちらの続きも欠けないように）
  const sinceIso = continuing
    ? seriesPlatforms.map((p) => previous[p]!.created_at).sort()[0]
    : null;

  // 素材の範囲（since）が変わったら読み込み済み素材は使えないのでクリア
  useEffect(() => {
    setResult(null);
  }, [sinceIso]);

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
        // 続編モードは「前回記事以降の会話すべて」が素材なので最新セッションに限定しない
        latest_only: continuing ? false : latestOnly,
        since: sinceIso,
        max_chars: maxChars,
      });
      if (!r) toast.error("該当プロジェクトが見つかりません（cwd 不一致）");
      else if (continuing && r.char_count === 0)
        toast("前回記事より後の会話がありません。", { icon: "ℹ️" });
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
      const platformList = Array.from(platforms);
      const draftIds = await saveAndGenerateMulti(
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
              latest_only: continuing ? false : latestOnly,
              since: sinceIso,
              max_chars: maxChars,
            },
            continued_from: continuing
              ? Object.fromEntries(seriesPlatforms.map((p) => [p, previous[p]!.id]))
              : undefined,
          },
          targetLength,
          previous: continuing
            ? Object.fromEntries(
                seriesPlatforms.map((p) => [
                  p,
                  {
                    title: previous[p]!.title,
                    body: previous[p]!.body,
                    url: previous[p]!.qiita_url,
                  },
                ]),
              )
            : undefined,
        },
        platformList,
        (s) => {
          setProgress(s);
          toast.loading(s, { id: t });
        },
      );

      if (draftIds.length === 1) {
        toast.success("記事を生成しました", { id: t });
        navigate(`/drafts/${draftIds[0]}`);
      } else {
        toast.success(
          `${draftIds.length} 件の記事を生成しました（Qiita + note）`,
          { id: t, duration: 5000 },
        );
        navigate("/drafts");
      }
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
              checked={continuing ? false : latestOnly}
              onChange={(e) => setLatestOnly(e.target.checked)}
              disabled={busy || continuing}
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

        {(candidates.qiita.length > 0 || candidates.note.length > 0) && (
          <div className="rounded border border-gray-200 bg-gray-50 p-3 text-sm space-y-1">
            <label className="flex items-center gap-2 font-medium">
              <input
                type="checkbox"
                checked={continueSeries}
                onChange={(e) => {
                  setContinueSeries(e.target.checked);
                  setResult(null); // 素材の範囲が変わるので読み直し
                }}
                disabled={busy}
              />
              前回の続きとして書く
            </label>
            {(["qiita", "note"] as const).map((p) =>
              candidates[p].length > 0 ? (
                <label
                  key={p}
                  className={`flex items-center gap-2 text-xs ${platforms.has(p) ? "text-gray-600" : "text-gray-400"}`}
                >
                  <span className="shrink-0">
                    {p === "qiita" ? "📘 Qiita" : "📝 note"} の続き元:
                  </span>
                  <select
                    className="input !py-1 !text-xs"
                    value={chosenId[p]}
                    onChange={(e) => setChosenId({ ...chosenId, [p]: e.target.value })}
                    disabled={busy || !continueSeries || !platforms.has(p)}
                  >
                    <option value="">（続けない・最初から書く）</option>
                    {candidates[p].map((c) => (
                      <option key={c.id} value={c.id}>
                        {new Date(c.created_at).toLocaleString("ja-JP")}『{c.title}』
                      </option>
                    ))}
                  </select>
                </label>
              ) : null,
            )}
            {continuing && (
              <div className="text-xs text-gray-500">
                素材は {new Date(sinceIso!).toLocaleString("ja-JP")} 以降の会話のみ。選んだ記事の内容は繰り返さず続編として生成します。
              </div>
            )}
          </div>
        )}

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
              {busy
                ? progress || "生成中…"
                : platforms.size === 1
                  ? "保存して記事を生成"
                  : `保存して ${platforms.size} 件同時生成`}
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

function TextTab({ platforms }: { platforms: Set<Platform> }) {
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
      const platformList = Array.from(platforms);
      const draftIds = await saveAndGenerateMulti(
        {
          sourceType: "text",
          title: title.trim() || null,
          rawContent: content,
          targetLength,
        },
        platformList,
        (s) => toast.loading(s, { id: t }),
      );
      if (draftIds.length === 1) {
        toast.success("記事を生成しました", { id: t });
        navigate(`/drafts/${draftIds[0]}`);
      } else {
        toast.success(
          `${draftIds.length} 件の記事を生成しました（Qiita + note）`,
          { id: t, duration: 5000 },
        );
        navigate("/drafts");
      }
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
        {busy
          ? "生成中…"
          : platforms.size === 1
            ? "保存して記事を生成"
            : `保存して ${platforms.size} 件同時生成`}
      </button>
    </div>
  );
}

export default function Generate() {
  const [tab, setTab] = useState<Tab>("claude_log");
  const [platforms, setPlatforms] = useState<Set<Platform>>(
    new Set(["qiita"]),
  );

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-4">
      <header>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Sparkles className="w-6 h-6 text-qiitto-600" />
          新規生成
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          素材を取り込んで Claude API で記事を生成します。プラットフォームを複数選ぶと、同じ素材から並列で複数記事を一度に生成できます。
        </p>
      </header>

      <PlatformPicker values={platforms} onChange={setPlatforms} />

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
        <ClaudeLogTab platforms={platforms} />
      ) : (
        <TextTab platforms={platforms} />
      )}
    </div>
  );
}
