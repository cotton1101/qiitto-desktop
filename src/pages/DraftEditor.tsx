import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import toast from "react-hot-toast";
import {
  ArrowLeft,
  Save,
  Tag,
  Eye,
  FileEdit,
  Upload,
  Globe,
  ExternalLink,
  EyeOff,
  Shield,
  Send,
  Copy,
} from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import MDEditor from "@uiw/react-md-editor";
import "@uiw/react-md-editor/markdown-editor.css";
import { DraftRow, getDraft, markDraftQiitaSynced, updateDraft } from "../lib/db";
import { qiitaSyncItem } from "../lib/api";
import QiitaPreview from "../components/QiitaPreview";
import PublishModal from "../components/PublishModal";
import ScanModal from "../components/ScanModal";
import RewriteModal from "../components/RewriteModal";
import TweetModal from "../components/TweetModal";

type PaneMode = "split" | "edit" | "preview";

export default function DraftEditor() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [draft, setDraft] = useState<DraftRow | null>(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [tagsInput, setTagsInput] = useState(""); // カンマ区切り表示
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [paneMode, setPaneMode] = useState<PaneMode>("split");
  const [syncing, setSyncing] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);
  const [rewriteOpen, setRewriteOpen] = useState(false);
  const [rewriteTargets, setRewriteTargets] = useState<string[]>([]);
  const [tweetOpen, setTweetOpen] = useState(false);
  const autosaveTimer = useRef<number | null>(null);

  const parsedTags = tagsInput
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);

  useEffect(() => {
    if (!id) return;
    getDraft(id).then((d) => {
      if (!d) {
        toast.error("下書きが見つかりません");
        navigate("/drafts");
        return;
      }
      setDraft(d);
      setTitle(d.title);
      setBody(d.body);
      try {
        const t: string[] = JSON.parse(d.tags || "[]");
        setTagsInput(t.join(", "));
      } catch {
        setTagsInput("");
      }
    });
  }, [id, navigate]);

  // 入力変更で dirty 化 + 800ms autosave
  useEffect(() => {
    if (!draft) return;
    setDirty(true);
    if (autosaveTimer.current) window.clearTimeout(autosaveTimer.current);
    autosaveTimer.current = window.setTimeout(() => {
      void save(true);
    }, 800);
    return () => {
      if (autosaveTimer.current) window.clearTimeout(autosaveTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, body, tagsInput]);

  const save = async (silent = false) => {
    if (!draft || !dirty) return;
    setSaving(true);
    try {
      const tags = tagsInput
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
      await updateDraft(draft.id, {
        title: title.trim() || "(無題)",
        body,
        tags: JSON.stringify(tags),
      });
      setSavedAt(new Date());
      setDirty(false);
      if (!silent) toast.success("保存しました");
    } catch (e) {
      toast.error(`保存失敗: ${e}`);
    } finally {
      setSaving(false);
    }
  };

  /**
   * Qiita 同期
   * @param makePublic 公開=true / 限定共有=false
   * @param stateOnly true なら `private` だけ PATCH（title/body/tags は送らない）。
   *                  Qiita のタイトル重複検査(422)を回避したいときに使う（取り下げ等）。
   */
  const syncToQiita = async (makePublic: boolean, stateOnly = false) => {
    if (!draft) return;
    if (stateOnly && !draft.qiita_item_id) {
      toast.error(
        "Qiita item ID が DB に無いため取り下げできません。先に「Qiita 同期」を押してください。",
      );
      return;
    }
    setSyncing(true);
    const t = toast.loading(
      stateOnly
        ? makePublic
          ? "Qiita 公開中…"
          : "Qiita を取り下げ中…"
        : draft.qiita_item_id
          ? makePublic
            ? "Qiita 公開中…"
            : "Qiita 下書きを更新中…"
          : "Qiita に下書きを作成中…",
    );
    try {
      // フル同期のときは先にローカル保存
      if (!stateOnly && dirty) await save(true);

      // Qiita PATCH は title/body/tags を含むフルペイロードが必須（partial PATCH は 400）。
      // stateOnly フラグは現在は実質的に「メッセージ表記の切替」のみ。
      const args = {
        itemId: draft.qiita_item_id,
        title: title.trim() || "(無題)",
        body,
        tags: parsedTags,
        private: !makePublic,
      };
      const item = await qiitaSyncItem(args);

      await markDraftQiitaSynced(draft.id, {
        qiita_item_id: item.id,
        qiita_url: item.url,
        qiita_private: item.private,
      });
      // ローカル state にも反映
      setDraft({
        ...draft,
        qiita_item_id: item.id,
        qiita_url: item.url,
        qiita_private: item.private ? 1 : 0,
        qiita_status: item.private ? "draft" : "published",
        last_synced_at: new Date().toISOString(),
      });

      toast.success(
        makePublic ? "公開しました 🌐" : "Qiita 下書きを同期しました",
        { id: t },
      );
    } catch (e) {
      toast.error(`同期失敗: ${e}`, { id: t });
    } finally {
      setSyncing(false);
    }
  };

  if (!draft) {
    return <div className="p-6 text-sm text-gray-500">読込中…</div>;
  }

  const tagCount = parsedTags.length;
  const isPublished = draft.qiita_status === "published";
  const isSynced = !!draft.qiita_item_id;
  const isNote = draft.platform === "note";

  const copyForNote = async () => {
    const hashtags = parsedTags.map((t) => `#${t}`).join(" ");
    const text = hashtags ? `${body}\n\n${hashtags}` : body;
    try {
      await navigator.clipboard.writeText(text);
      toast.success("本文をコピーしました（ハッシュタグも含む）");
    } catch (e) {
      toast.error(`コピー失敗: ${e}`);
    }
  };

  const openNoteEditor = async () => {
    await copyForNote();
    try {
      await openUrl("https://note.com/notes/new");
    } catch {
      window.open("https://note.com/notes/new", "_blank", "noopener,noreferrer");
    }
    toast.success("note を開きました。エディタで Cmd+V で貼付してください", {
      duration: 5000,
    });
  };

  return (
    <div className="flex flex-col h-screen">
      {/* ヘッダ */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-gray-200 bg-white">
        <Link
          to="/drafts"
          className="text-sm text-gray-500 hover:text-gray-700 flex items-center gap-1"
        >
          <ArrowLeft className="w-4 h-4" />
          下書き一覧
        </Link>

        <div className="flex items-center gap-2">
          <div className="flex border border-gray-200 rounded overflow-hidden text-xs">
            <button
              className={[
                "flex items-center gap-1 px-2 py-1",
                paneMode === "edit"
                  ? "bg-qiitto-50 text-qiitto-700 font-medium"
                  : "bg-white text-gray-600 hover:bg-gray-50",
              ].join(" ")}
              onClick={() => setPaneMode("edit")}
              title="編集のみ"
            >
              <FileEdit className="w-3 h-3" />
              編集
            </button>
            <button
              className={[
                "flex items-center gap-1 px-2 py-1 border-l border-gray-200",
                paneMode === "split"
                  ? "bg-qiitto-50 text-qiitto-700 font-medium"
                  : "bg-white text-gray-600 hover:bg-gray-50",
              ].join(" ")}
              onClick={() => setPaneMode("split")}
              title="左右分割"
            >
              分割
            </button>
            <button
              className={[
                "flex items-center gap-1 px-2 py-1 border-l border-gray-200",
                paneMode === "preview"
                  ? "bg-qiitto-50 text-qiitto-700 font-medium"
                  : "bg-white text-gray-600 hover:bg-gray-50",
              ].join(" ")}
              onClick={() => setPaneMode("preview")}
              title="プレビューのみ"
            >
              <Eye className="w-3 h-3" />
              プレビュー
            </button>
          </div>

          <span className="text-xs text-gray-400 min-w-[5rem] text-right">
            {saving
              ? "保存中…"
              : savedAt
                ? `${savedAt.toLocaleTimeString("ja-JP")} 保存`
                : dirty
                  ? "未保存"
                  : "保存済み"}
          </span>

          {/* 公開支援：スキャン / X 投稿 */}
          <div className="flex border border-gray-200 rounded overflow-hidden text-xs">
            <button
              className="flex items-center gap-1 px-2 py-1 bg-white text-emerald-700 hover:bg-emerald-50"
              onClick={() => setScanOpen(true)}
              title="公開前スキャン（機密情報の検出 → AI 書き換え）"
            >
              <Shield className="w-3 h-3" />
              スキャン
            </button>
            <button
              className="flex items-center gap-1 px-2 py-1 border-l border-gray-200 bg-white text-sky-700 hover:bg-sky-50 disabled:opacity-40 disabled:cursor-not-allowed"
              onClick={() => setTweetOpen(true)}
              disabled={!body.trim() || !title.trim()}
              title={
                body.trim() && title.trim()
                  ? "Claude で X 投稿文を 3 パターン生成"
                  : "タイトルと本文があるときに使えます"
              }
            >
              <Send className="w-3 h-3" />X 投稿
            </button>
          </div>

          {/* プラットフォーム別アクション */}
          {isNote ? (
            <>
              <span className="text-xs px-2 py-0.5 bg-emerald-50 text-emerald-700 rounded font-medium">
                📝 note
              </span>
              <button
                className="btn-secondary text-sm"
                onClick={copyForNote}
                title="本文 + ハッシュタグをクリップボードにコピー"
              >
                <Copy className="w-3.5 h-3.5 mr-1" />
                コピー
              </button>
              <button
                className="btn-primary text-sm bg-emerald-600 hover:bg-emerald-700"
                onClick={openNoteEditor}
                title="コピー & note.com で書く"
              >
                <ExternalLink className="w-3.5 h-3.5 mr-1" />
                note で書く
              </button>
            </>
          ) : (
            <>
              <span className="text-xs px-2 py-0.5 bg-qiitto-50 text-qiitto-700 rounded font-medium">
                📘 Qiita
              </span>
              {isSynced && draft.qiita_url && (
                <a
                  href={draft.qiita_url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="text-xs text-qiitto-700 underline flex items-center gap-1"
                  title="Qiita で開く"
                >
                  <ExternalLink className="w-3 h-3" />
                  Qiita で開く
                </a>
              )}
              <button
                className="btn-secondary text-sm"
                onClick={() => syncToQiita(isPublished)}
                disabled={syncing || tagCount === 0 || tagCount > 5}
                title={
                  tagCount === 0
                    ? "Qiita にはタグが最低1つ必要です"
                    : tagCount > 5
                      ? "タグは5つ以下にしてください"
                      : isSynced
                        ? "Qiita を最新の内容で更新"
                        : "Qiita に限定共有として下書き作成"
                }
              >
                <Upload className="w-3.5 h-3.5 mr-1" />
                {isSynced ? "Qiita 更新" : "Qiita 同期"}
              </button>
              {isPublished ? (
                <button
                  className="btn-secondary text-sm"
                  onClick={() => syncToQiita(false, true)}
                  disabled={syncing}
                  title="公開を取り下げて限定共有に戻す（状態のみ変更）"
                >
                  <EyeOff className="w-3.5 h-3.5 mr-1" />
                  取り下げ
                </button>
              ) : (
                <button
                  className="btn-primary text-sm bg-emerald-600 hover:bg-emerald-700"
                  onClick={() => setPublishOpen(true)}
                  disabled={syncing || !isSynced}
                  title={isSynced ? "公開する" : "先に Qiita 同期してください"}
                >
                  <Globe className="w-3.5 h-3.5 mr-1" />
                  公開する
                </button>
              )}
            </>
          )}

          <button
            className="btn-secondary text-sm"
            onClick={() => save(false)}
            disabled={!dirty || saving}
          >
            <Save className="w-3.5 h-3.5 mr-1" />
            保存
          </button>
        </div>
      </div>

      <PublishModal
        open={publishOpen}
        title={title.trim() || "(無題)"}
        tags={parsedTags}
        bodyLength={body.length}
        onClose={() => setPublishOpen(false)}
        onConfirm={() => syncToQiita(true)}
      />

      <ScanModal
        open={scanOpen}
        body={body}
        onClose={() => setScanOpen(false)}
        onRewrite={(targets) => {
          setRewriteTargets(targets);
          setScanOpen(false);
          setRewriteOpen(true);
        }}
      />

      <RewriteModal
        open={rewriteOpen}
        body={body}
        targets={rewriteTargets}
        onClose={() => setRewriteOpen(false)}
        onApply={(newBody) => {
          setBody(newBody);
          setRewriteOpen(false);
          toast.success("本文を AI 書き換え版に置き換えました");
        }}
      />

      <TweetModal
        open={tweetOpen}
        title={title.trim() || "(無題)"}
        body={body}
        tags={parsedTags}
        url={draft?.qiita_url ?? null}
        onClose={() => setTweetOpen(false)}
      />

      {/* タイトル + タグ */}
      <div className="px-6 py-3 border-b border-gray-200 bg-white space-y-2">
        <input
          className="input text-base !py-1.5 font-medium"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="記事タイトル"
        />
        <div className="flex items-center gap-2">
          <Tag className="w-3.5 h-3.5 text-gray-400" />
          <input
            className="input !py-1 text-sm flex-1"
            value={tagsInput}
            onChange={(e) => setTagsInput(e.target.value)}
            placeholder={
              isNote
                ? "カンマ区切り（例: 個人開発, AI活用, フリーランス）"
                : "カンマ区切り（例: Next.js, Tauri, ClaudeAPI）"
            }
          />
          {isNote ? (
            <span className="text-xs text-gray-400">{tagCount} 個</span>
          ) : (
            <span
              className={`text-xs ${tagCount > 5 ? "text-red-600 font-medium" : "text-gray-400"}`}
            >
              {tagCount}/5
            </span>
          )}
        </div>
      </div>

      {/* 編集 + プレビュー */}
      <div className="flex-1 flex overflow-hidden" data-color-mode="light">
        {(paneMode === "edit" || paneMode === "split") && (
          <div
            className={
              paneMode === "split"
                ? "w-1/2 border-r border-gray-200"
                : "w-full"
            }
          >
            <MDEditor
              value={body}
              onChange={(v) => setBody(v ?? "")}
              preview="edit"
              hideToolbar={false}
              height="100%"
              visibleDragbar={false}
              textareaProps={{
                placeholder: "Markdown で本文を編集…",
                spellCheck: false,
              }}
              style={{ height: "100%", borderRadius: 0 }}
            />
          </div>
        )}
        {(paneMode === "preview" || paneMode === "split") && (
          <div
            className={
              paneMode === "split" ? "w-1/2 overflow-auto" : "w-full overflow-auto"
            }
          >
            <QiitaPreview markdown={body} />
          </div>
        )}
      </div>

      {/* フッタ統計 */}
      <div className="px-6 py-1.5 border-t border-gray-200 bg-gray-50 text-xs text-gray-500 flex justify-between">
        <span>
          {body.length.toLocaleString()} 文字 ·
          {body.split("\n").length.toLocaleString()} 行
        </span>
        <span>
          編集モード: <b>{paneMode}</b>
        </span>
      </div>
    </div>
  );
}
