import { useEffect, useMemo, useState } from "react";
import {
  X,
  Search,
  Settings as SettingsIcon,
  Shield,
  ChevronDown,
  ChevronRight,
  Sparkles,
} from "lucide-react";
import {
  DEFAULT_RULES,
  ScanMatch,
  ScanRule,
  loadCustomRulesText,
  parseCustomRules,
  saveCustomRulesText,
  scanText,
  uniqueMatchedTexts,
} from "../lib/scanner";

interface Props {
  open: boolean;
  body: string;
  onClose: () => void;
  onRewrite: (targets: string[]) => void;
}

export default function ScanModal({ open, body, onClose, onRewrite }: Props) {
  const [customText, setCustomText] = useState("");
  const [rulesOpen, setRulesOpen] = useState(false);
  const [matches, setMatches] = useState<ScanMatch[] | null>(null);

  useEffect(() => {
    if (open) {
      setCustomText(loadCustomRulesText());
      setMatches(null);
      setRulesOpen(false);
    }
  }, [open]);

  const allRules: ScanRule[] = useMemo(
    () => [...DEFAULT_RULES, ...parseCustomRules(customText)],
    [customText],
  );

  const runScan = () => {
    saveCustomRulesText(customText);
    setMatches(scanText(body, allRules));
  };

  if (!open) return null;

  const grouped = (matches ?? []).reduce<Record<string, ScanMatch[]>>(
    (acc, m) => {
      const k = m.rule.category;
      if (!acc[k]) acc[k] = [];
      acc[k].push(m);
      return acc;
    },
    {},
  );

  const uniqueTexts = matches ? uniqueMatchedTexts(matches) : [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-3xl max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-3 border-b">
          <h2 className="font-semibold text-base flex items-center gap-2">
            <Shield className="w-4 h-4 text-emerald-600" />
            公開前スキャン
          </h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-700"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          <div className="border rounded">
            <button
              className="w-full px-3 py-2 text-sm font-medium text-gray-700 flex items-center gap-2 hover:bg-gray-50"
              onClick={() => setRulesOpen((o) => !o)}
            >
              {rulesOpen ? (
                <ChevronDown className="w-3 h-3" />
              ) : (
                <ChevronRight className="w-3 h-3" />
              )}
              <SettingsIcon className="w-3.5 h-3.5" />
              スキャンルール
              <span className="text-xs text-gray-400 font-normal">
                （既定 {DEFAULT_RULES.length} + ユーザー{" "}
                {parseCustomRules(customText).length}）
              </span>
            </button>
            {rulesOpen && (
              <div className="px-3 pb-3 space-y-2">
                <div className="text-xs text-gray-500 leading-relaxed">
                  既定: API キー / メール / IPv4 / Zero-width 文字
                  <br />
                  下のエリアに{" "}
                  <span className="font-mono bg-gray-100 px-1">
                    1 行 1 ルール
                  </span>
                  。
                  <span className="font-mono bg-gray-100 px-1">
                    /pattern/
                  </span>{" "}
                  で正規表現、
                  <span className="font-mono bg-gray-100 px-1">#</span>{" "}
                  で始まる行はコメント
                </div>
                <textarea
                  className="w-full border rounded px-2 py-1.5 text-xs font-mono"
                  rows={6}
                  value={customText}
                  onChange={(e) => setCustomText(e.target.value)}
                  placeholder={
                    "# 1 行 1 ルール\n160.251.140.121\ninfo@my-domain.com\n/[0-9a-f]{20,}/  # 20 文字以上の hex"
                  }
                  spellCheck={false}
                />
              </div>
            )}
          </div>

          <button onClick={runScan} className="btn-primary w-full">
            <Search className="w-4 h-4 mr-1.5" />
            スキャン実行（{body.length.toLocaleString()} 文字 ·{" "}
            {allRules.length} ルール）
          </button>

          {matches !== null &&
            (matches.length === 0 ? (
              <div className="text-center py-8 text-emerald-600 font-medium">
                ✅ 機密情報は検出されませんでした
              </div>
            ) : (
              <div className="space-y-3">
                <div className="text-sm text-red-600 font-medium">
                  ⚠️ {matches.length} 件の検出（{uniqueTexts.length}{" "}
                  ユニーク値）
                </div>
                {Object.entries(grouped).map(([category, list]) => (
                  <div key={category} className="border rounded">
                    <div className="px-3 py-1.5 bg-gray-50 text-xs font-medium border-b flex justify-between">
                      <span>{category}</span>
                      <span className="text-gray-400 font-normal">
                        ×{list.length}
                      </span>
                    </div>
                    <ul className="divide-y text-xs">
                      {list.slice(0, 20).map((m, i) => (
                        <li
                          key={i}
                          className="px-3 py-1.5 flex gap-3 items-start"
                        >
                          <span className="font-mono text-gray-400 shrink-0">
                            L{m.line}:{m.column}
                          </span>
                          <span className="font-mono text-red-700 break-all shrink-0 max-w-[40%]">
                            {m.text}
                          </span>
                          <span className="text-gray-500 truncate flex-1">
                            {m.context}
                          </span>
                        </li>
                      ))}
                      {list.length > 20 && (
                        <li className="px-3 py-1 text-gray-400 italic text-center">
                          …他 {list.length - 20} 件
                        </li>
                      )}
                    </ul>
                  </div>
                ))}
              </div>
            ))}
        </div>

        <div className="px-5 py-3 border-t flex justify-end gap-2">
          <button onClick={onClose} className="btn-secondary text-sm">
            閉じる
          </button>
          {matches && matches.length > 0 && (
            <button
              onClick={() => onRewrite(uniqueTexts)}
              className="btn-primary bg-purple-600 hover:bg-purple-700 text-sm"
            >
              <Sparkles className="w-4 h-4 mr-1" />
              AI で書き換え（{uniqueTexts.length} 項目）
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
