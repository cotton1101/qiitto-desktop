import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { ShieldCheck, KeySquare, Trash2 } from "lucide-react";
import {
  KeyringKey,
  keyringDelete,
  keyringHas,
  keyringSet,
} from "../lib/api";
import { loadSettings, saveSettings, UserSettings } from "../lib/db";

function KeyField({
  label,
  storeKey,
  description,
}: {
  label: string;
  storeKey: KeyringKey;
  description?: string;
}) {
  const [hasKey, setHasKey] = useState<boolean | null>(null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    keyringHas(storeKey).then(setHasKey).catch(() => setHasKey(false));
  }, [storeKey]);

  const save = async () => {
    if (!input.trim()) return;
    setBusy(true);
    try {
      await keyringSet(storeKey, input.trim());
      toast.success(`${label} を保存しました`);
      setInput("");
      setHasKey(true);
    } catch (e) {
      toast.error(`保存失敗: ${e}`);
    } finally {
      setBusy(false);
    }
  };

  const clear = async () => {
    if (!confirm(`${label} を削除しますか？`)) return;
    setBusy(true);
    try {
      await keyringDelete(storeKey);
      toast.success(`${label} を削除しました`);
      setHasKey(false);
    } catch (e) {
      toast.error(`削除失敗: ${e}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-2">
        <label className="label !mb-0 flex items-center gap-2">
          {hasKey ? (
            <ShieldCheck className="w-4 h-4 text-qiitto-600" />
          ) : (
            <KeySquare className="w-4 h-4 text-gray-400" />
          )}
          {label}
        </label>
        {hasKey && (
          <span className="text-xs text-qiitto-700 bg-qiitto-50 px-2 py-0.5 rounded">
            設定済み（OS Keyring）
          </span>
        )}
      </div>
      {description && (
        <p className="text-xs text-gray-500 mb-2">{description}</p>
      )}
      <div className="flex gap-2">
        <input
          type="password"
          className="input"
          placeholder={hasKey ? "新しい値で上書きする場合のみ入力" : "未設定"}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          autoComplete="off"
          disabled={busy}
        />
        <button
          className="btn-primary"
          onClick={save}
          disabled={busy || !input.trim()}
        >
          保存
        </button>
        {hasKey && (
          <button
            className="btn-secondary"
            onClick={clear}
            disabled={busy}
            title="削除"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  );
}

export default function Settings() {
  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadSettings()
      .then(setSettings)
      .catch((e) => toast.error(`設定読込失敗: ${e}`));
  }, []);

  const handleSave = async () => {
    if (!settings) return;
    setSaving(true);
    try {
      await saveSettings({
        default_tags: settings.default_tags,
        qiita_organization: settings.qiita_organization,
        model: settings.model,
        monthly_token_limit: settings.monthly_token_limit,
        default_private: settings.default_private,
      });
      toast.success("設定を保存しました");
    } catch (e) {
      toast.error(`保存失敗: ${e}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto p-6 space-y-6">
      <header>
        <h1 className="text-2xl font-bold">設定</h1>
        <p className="text-sm text-gray-500 mt-1">
          API キーは OS の Keyring（macOS Keychain）に保存され、アプリには戻ってきません。
        </p>
      </header>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">認証（API キー）</h2>
        <KeyField
          label="Anthropic API Key"
          storeKey={KeyringKey.AnthropicApiKey}
          description="Claude API を呼び出すためのキー（sk-ant-... 形式）"
        />
        <KeyField
          label="Qiita Personal Access Token"
          storeKey={KeyringKey.QiitaToken}
          description="Qiita 下書き作成・更新に使用（権限: read_qiita, write_qiita）"
        />
        <KeyField
          label="GitHub PAT（任意）"
          storeKey={KeyringKey.GithubPat}
          description="git diff からの素材取込用（v1.2 以降で使用）"
        />
      </section>

      {settings && (
        <section className="card space-y-4">
          <h2 className="text-lg font-semibold">既定設定</h2>
          <div>
            <label className="label">既定タグ（カンマ区切り）</label>
            <input
              className="input"
              value={JSON.parse(settings.default_tags || "[]").join(", ")}
              onChange={(e) => {
                const tags = e.target.value
                  .split(",")
                  .map((t) => t.trim())
                  .filter(Boolean);
                setSettings({ ...settings, default_tags: JSON.stringify(tags) });
              }}
              placeholder="Cotton-Web, Claude"
            />
          </div>
          <div>
            <label className="label">Qiita Organization（任意）</label>
            <input
              className="input"
              value={settings.qiita_organization ?? ""}
              onChange={(e) =>
                setSettings({ ...settings, qiita_organization: e.target.value || null })
              }
              placeholder="cotton-web"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">使用モデル</label>
              <select
                className="input"
                value={settings.model}
                onChange={(e) => setSettings({ ...settings, model: e.target.value })}
              >
                <option value="claude-sonnet-4-6">claude-sonnet-4-6</option>
                <option value="claude-opus-4-7">claude-opus-4-7</option>
                <option value="claude-haiku-4-5-20251001">claude-haiku-4-5</option>
              </select>
            </div>
            <div>
              <label className="label">月間トークン上限</label>
              <input
                type="number"
                className="input"
                value={settings.monthly_token_limit}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    monthly_token_limit: Number(e.target.value) || 0,
                  })
                }
              />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={settings.default_private === 1}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  default_private: e.target.checked ? 1 : 0,
                })
              }
            />
            既定で限定共有（private）にする
          </label>
          <button className="btn-primary" onClick={handleSave} disabled={saving}>
            設定を保存
          </button>
        </section>
      )}
    </div>
  );
}
