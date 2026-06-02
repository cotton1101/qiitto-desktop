import { useState } from "react";
import { AlertTriangle, Globe, X } from "lucide-react";

export interface PublishModalProps {
  open: boolean;
  title: string;
  tags: string[];
  bodyLength: number;
  onClose: () => void;
  /** 公開を実行（呼び出し側で同期 + state 更新） */
  onConfirm: () => Promise<void>;
}

/**
 * 公開モーダル：「Step1: 内容確認」→「Step2: チェックボックス + 公開実行」の2段階。
 * 誤公開を防ぐため明示的な OK を 2 回要求する。
 */
export default function PublishModal({
  open,
  title,
  tags,
  bodyLength,
  onClose,
  onConfirm,
}: PublishModalProps) {
  const [step, setStep] = useState<1 | 2>(1);
  const [agreed, setAgreed] = useState(false);
  const [publishing, setPublishing] = useState(false);

  if (!open) return null;

  const close = () => {
    setStep(1);
    setAgreed(false);
    onClose();
  };

  const tooFewBody = bodyLength < 200;
  const noTags = tags.length === 0;
  const tooManyTags = tags.length > 5;

  const blocking = tooFewBody || noTags || tooManyTags;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
          <h3 className="font-semibold flex items-center gap-2">
            <Globe className="w-4 h-4 text-qiitto-600" />
            Qiita に公開（{step === 1 ? "Step 1/2: 確認" : "Step 2/2: 最終確認"}）
          </h3>
          <button
            className="text-gray-400 hover:text-gray-700"
            onClick={close}
            disabled={publishing}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-4 py-3 space-y-3 text-sm">
          {step === 1 ? (
            <>
              <p className="text-gray-600">
                以下の内容で <b>限定共有から公開（private=false）</b> に切り替えます。Qiita の規約に違反していないか最終確認してください。
              </p>
              <dl className="bg-gray-50 rounded p-3 space-y-1">
                <div>
                  <dt className="text-xs text-gray-500">タイトル</dt>
                  <dd className="font-medium break-words">{title || "(無題)"}</dd>
                </div>
                <div>
                  <dt className="text-xs text-gray-500">タグ ({tags.length})</dt>
                  <dd>{tags.length ? tags.join(" · ") : "（未設定）"}</dd>
                </div>
                <div>
                  <dt className="text-xs text-gray-500">本文</dt>
                  <dd>{bodyLength.toLocaleString()} 文字</dd>
                </div>
              </dl>

              {blocking && (
                <div className="bg-red-50 border border-red-200 rounded p-2 text-red-700 text-xs space-y-0.5">
                  <div className="flex items-center gap-1 font-medium">
                    <AlertTriangle className="w-3.5 h-3.5" />
                    公開できません
                  </div>
                  {tooFewBody && <div>· 本文が 200 文字未満です</div>}
                  {noTags && <div>· タグを 1 つ以上設定してください</div>}
                  {tooManyTags && <div>· タグは最大 5 個までです</div>}
                </div>
              )}
            </>
          ) : (
            <>
              <p className="text-gray-700">
                公開後は誰でも閲覧できる状態になります。AI 生成のため、以下を最終確認してください：
              </p>
              <ul className="text-xs text-gray-600 list-disc list-inside space-y-0.5">
                <li>個人情報・社内秘情報が含まれていない</li>
                <li>事実と異なる内容（hallucination）が無い</li>
                <li>引用元の表記がある（必要な場合）</li>
                <li>「個人の感想」「未検証」と明示すべき箇所が示されている</li>
              </ul>
              <label className="flex items-start gap-2 mt-2 text-sm">
                <input
                  type="checkbox"
                  checked={agreed}
                  onChange={(e) => setAgreed(e.target.checked)}
                  className="mt-1"
                  disabled={publishing}
                />
                <span>上記をすべて確認した上で公開します。</span>
              </label>
            </>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-gray-200 bg-gray-50 rounded-b-lg">
          <button
            className="btn-secondary text-sm"
            onClick={close}
            disabled={publishing}
          >
            キャンセル
          </button>
          {step === 1 ? (
            <button
              className="btn-primary text-sm"
              onClick={() => setStep(2)}
              disabled={blocking}
            >
              次へ
            </button>
          ) : (
            <button
              className="btn-primary text-sm"
              disabled={!agreed || publishing}
              onClick={async () => {
                setPublishing(true);
                try {
                  await onConfirm();
                  close();
                } finally {
                  setPublishing(false);
                }
              }}
            >
              {publishing ? "公開中…" : "公開する"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
