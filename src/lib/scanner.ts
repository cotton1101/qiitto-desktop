// 公開前スキャナ：既定ルール + ユーザー追加ルールで本文を走査する。
// 完全にクライアント完結（Rust は不要）。ルールは localStorage に保存。

export interface ScanRule {
  pattern: string;
  isRegex: boolean;
  category: string;
  description?: string;
  source: "default" | "custom";
}

export interface ScanMatch {
  rule: ScanRule;
  text: string;
  line: number;
  column: number;
  context: string;
}

export const DEFAULT_RULES: ScanRule[] = [
  {
    pattern: "sk-ant-[A-Za-z0-9_\\-]{10,}",
    isRegex: true,
    category: "🔑 API Key",
    description: "Anthropic API Key",
    source: "default",
  },
  {
    pattern: "ghp_[A-Za-z0-9]{20,}",
    isRegex: true,
    category: "🔑 API Key",
    description: "GitHub Personal Access Token",
    source: "default",
  },
  {
    pattern: "(?i)(api[_-]?key|secret|password|token)\\s*[=:]\\s*[\"'][^\"']{8,}[\"']",
    isRegex: true,
    category: "🔑 API Key",
    description: "インラインのシークレット代入",
    source: "default",
  },
  {
    pattern: "[A-Za-z0-9._%+\\-]+@[A-Za-z0-9.\\-]+\\.[A-Za-z]{2,}",
    isRegex: true,
    category: "📧 Email",
    description: "メールアドレス",
    source: "default",
  },
  {
    pattern:
      "\\b(?:(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)\\.){3}(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)\\b",
    isRegex: true,
    category: "🌐 IP",
    description: "IPv4 アドレス",
    source: "default",
  },
  {
    pattern: "[\\u200B-\\u200D\\uFEFF]",
    isRegex: true,
    category: "👻 Hidden",
    description: "Zero-width 文字（不可視）",
    source: "default",
  },
];

const CUSTOM_RULES_KEY = "qiitto:scan_custom_rules";

export function loadCustomRulesText(): string {
  return localStorage.getItem(CUSTOM_RULES_KEY) ?? "";
}

export function saveCustomRulesText(text: string): void {
  localStorage.setItem(CUSTOM_RULES_KEY, text);
}

// 1 行 1 ルール。`# コメント` 可。`/.../フラグ` で正規表現扱い。
export function parseCustomRules(text: string): ScanRule[] {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .filter((l) => !l.startsWith("#"))
    .map((line) => {
      const m = line.match(/^\/(.+)\/([gimsuy]*)$/);
      if (m) {
        return {
          pattern: m[1],
          isRegex: true,
          category: "🏷 Custom",
          description: "ユーザー追加（regex）",
          source: "custom" as const,
        };
      }
      return {
        pattern: line,
        isRegex: false,
        category: "🏷 Custom",
        description: "ユーザー追加（部分一致）",
        source: "custom" as const,
      };
    });
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function scanText(text: string, rules: ScanRule[]): ScanMatch[] {
  const matches: ScanMatch[] = [];
  const lines = text.split("\n");

  for (const rule of rules) {
    let regex: RegExp;
    try {
      const pattern = rule.isRegex ? rule.pattern : escapeRegex(rule.pattern);
      // カスタム部分一致は case-insensitive、regex は素直に
      const flags = rule.isRegex ? "g" : "gi";
      regex = new RegExp(pattern, flags);
    } catch {
      continue; // 不正な regex はスキップ
    }

    for (let i = 0; i < lines.length; i++) {
      regex.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = regex.exec(lines[i])) !== null) {
        matches.push({
          rule,
          text: m[0],
          line: i + 1,
          column: m.index + 1,
          context: lines[i].trim().slice(0, 240),
        });
        if (m[0].length === 0) regex.lastIndex++; // 0幅マッチ無限ループ防止
      }
    }
  }

  return matches;
}

export function uniqueMatchedTexts(matches: ScanMatch[]): string[] {
  return [...new Set(matches.map((m) => m.text))];
}
