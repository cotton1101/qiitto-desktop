//! Claude Code セッションログ取込（qiitto Web 版 `backend/app/services/claude_log_reader.py` の Rust 移植）。
//!
//! ## 仕様の要点
//! 1. **エンコード不可逆**: `~/.claude/projects/<encoded>/` のディレクトリ名は実機で日本語等が
//!    すべて "-" に変換され、別パスが同名になる。素朴な逆変換は不可。
//!    そこで各 JSONL の `cwd` を読んで、要求された `project_path` と突合する。
//! 2. **オーナー検証**: 探索の起点は常に `~/.claude/projects/` のみ。他人の領域には踏み込まない。
//! 3. **ストリーム処理 + max_chars 打切り**: 大きな JSONL でも安全。

use crate::error::{AppError, AppResult};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::time::SystemTime;

/// user メッセージに紛れ込む「本人の発言ではない」合成テキスト接頭辞。
const SYNTHETIC_USER_PREFIXES: &[&str] = &[
    "<task-notification>",
    "<ide_opened_file>",
    "<ide_selection>",
    "<ide_diagnostics>",
    "<command-name>",
    "<command-message>",
    "<command-args>",
    "<local-command-stdout>",
    "<local-command-stderr>",
    "<bash-stdout>",
    "<bash-stderr>",
    "<system-reminder>",
    "<user-prompt-submit-hook>",
    "<post-tool-use-hook>",
];

fn default_base_dir() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("/"))
        .join(".claude")
        .join("projects")
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClaudeLogProject {
    pub project_path: String,
    pub encoded_dir: String,
    pub session_count: usize,
    pub last_modified: DateTime<Utc>,
    pub last_session_id: Option<String>,
}

#[derive(Debug, Default, Clone, Serialize, Deserialize)]
pub struct MessageCounts {
    pub user: usize,
    pub assistant: usize,
    pub tool_use: usize,
}

#[derive(Debug, Default, Clone, Serialize, Deserialize)]
pub struct ClaudeLogResult {
    pub content: String,
    pub char_count: usize,
    pub session_count: usize,
    pub message_counts: MessageCounts,
    pub project_path: Option<String>,
    pub session_ids: Vec<String>,
    pub truncated: bool,
}

// ---------------------------------------------------------------------------
// 内部ヘルパ
// ---------------------------------------------------------------------------

fn norm_path(p: &str) -> String {
    let trimmed = p.trim().trim_end_matches('/');
    let expanded: String = if let Some(rest) = trimmed.strip_prefix('~') {
        match dirs::home_dir() {
            Some(home) => format!("{}{}", home.to_string_lossy(), rest),
            None => trimmed.to_string(),
        }
    } else {
        trimmed.to_string()
    };
    // 簡易 normpath: `.` と `..` の解決
    let absolute = expanded.starts_with('/');
    let mut parts: Vec<&str> = Vec::new();
    for seg in expanded.split('/') {
        match seg {
            "" | "." => continue,
            ".." => {
                parts.pop();
            }
            other => parts.push(other),
        }
    }
    if absolute {
        format!("/{}", parts.join("/"))
    } else {
        parts.join("/")
    }
}

fn parse_ts(raw: &str) -> Option<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(raw)
        .ok()
        .map(|d| d.with_timezone(&Utc))
}

fn iter_lines(path: &Path) -> std::io::Result<Vec<Value>> {
    let file = fs::File::open(path)?;
    let reader = BufReader::new(file);
    let mut out = Vec::new();
    for line in reader.lines() {
        let Ok(line) = line else { continue };
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        if let Ok(v) = serde_json::from_str::<Value>(trimmed) {
            if v.is_object() {
                out.push(v);
            }
        }
    }
    Ok(out)
}

/// 先頭付近の有効行から cwd / sessionId を 1 件拾う。
fn first_meta(path: &Path) -> (Option<String>, Option<String>) {
    let Ok(lines) = iter_lines(path) else {
        return (None, None);
    };
    for obj in lines {
        let cwd = obj.get("cwd").and_then(|v| v.as_str()).map(String::from);
        if cwd.is_some() {
            let sid = obj
                .get("sessionId")
                .and_then(|v| v.as_str())
                .map(String::from);
            return (cwd, sid);
        }
    }
    (None, None)
}

fn is_within(base: &Path, target: &Path) -> bool {
    let (Ok(b), Ok(t)) = (base.canonicalize(), target.canonicalize()) else {
        return false;
    };
    t == b || t.starts_with(&b)
}

fn mtime_of(path: &Path) -> SystemTime {
    path.metadata()
        .and_then(|m| m.modified())
        .unwrap_or(SystemTime::UNIX_EPOCH)
}

fn jsonl_files_sorted_desc(dir: &Path) -> Vec<(PathBuf, SystemTime)> {
    let mut files: Vec<(PathBuf, SystemTime)> = Vec::new();
    let Ok(entries) = fs::read_dir(dir) else {
        return files;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_file() && path.extension().and_then(|s| s.to_str()) == Some("jsonl") {
            files.push((path.clone(), mtime_of(&path)));
        }
    }
    files.sort_by(|a, b| b.1.cmp(&a.1)); // mtime 降順
    files
}

fn jsonl_files_sorted_asc(dir: &Path) -> Vec<PathBuf> {
    let mut v = jsonl_files_sorted_desc(dir);
    v.reverse();
    v.into_iter().map(|(p, _)| p).collect()
}

fn summarize_tool_use(block: &Value) -> (String, String) {
    let name = block
        .get("name")
        .and_then(|v| v.as_str())
        .unwrap_or("?")
        .to_string();
    let input = block.get("input").cloned().unwrap_or(Value::Null);

    let mut summary = String::new();
    if let Some(obj) = input.as_object() {
        if name == "Bash" {
            if let Some(cmd) = obj.get("command").and_then(|v| v.as_str()) {
                summary = cmd.to_string();
            }
        } else if matches!(name.as_str(), "Read" | "Write" | "Edit" | "NotebookEdit") {
            if let Some(fp) = obj.get("file_path").and_then(|v| v.as_str()) {
                summary = fp.to_string();
            }
        } else if matches!(name.as_str(), "Grep" | "Glob") {
            if let Some(p) = obj.get("pattern").and_then(|v| v.as_str()) {
                summary = p.to_string();
            } else if let Some(q) = obj.get("query").and_then(|v| v.as_str()) {
                summary = q.to_string();
            }
        }
        if summary.is_empty() {
            summary = serde_json::to_string(&input).unwrap_or_default();
        }
    } else if !input.is_null() {
        summary = match input.as_str() {
            Some(s) => s.to_string(),
            None => input.to_string(),
        };
    }

    let summary = summary.trim().to_string();
    let char_count = summary.chars().count();
    let summary = if char_count > 400 {
        let truncated: String = summary.chars().take(400).collect();
        format!("{} …", truncated)
    } else {
        summary
    };
    (name, summary)
}

fn user_texts(content: &Value) -> Vec<String> {
    let blocks: Vec<Value> = if let Some(s) = content.as_str() {
        vec![serde_json::json!({ "type": "text", "text": s })]
    } else if let Some(arr) = content.as_array() {
        arr.clone()
    } else {
        return Vec::new();
    };

    let mut out = Vec::new();
    for b in &blocks {
        let Some(obj) = b.as_object() else { continue };
        if obj.get("type").and_then(|v| v.as_str()) != Some("text") {
            continue;
        }
        let text = obj
            .get("text")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim()
            .to_string();
        if text.is_empty() {
            continue;
        }
        if SYNTHETIC_USER_PREFIXES.iter().any(|p| text.starts_with(p)) {
            continue;
        }
        out.push(text);
    }
    out
}

fn canonical_cwd(d: &Path) -> Option<String> {
    let files = jsonl_files_sorted_desc(d);
    if let Some((p, _)) = files.first() {
        let (cwd, _) = first_meta(p);
        return cwd;
    }
    None
}

// ---------------------------------------------------------------------------
// 公開 API（内部）
// ---------------------------------------------------------------------------

pub fn list_projects_impl(base_dir: Option<&Path>) -> AppResult<Vec<ClaudeLogProject>> {
    let owned;
    let base: &Path = match base_dir {
        Some(p) => p,
        None => {
            owned = default_base_dir();
            &owned
        }
    };
    if !base.is_dir() {
        return Ok(Vec::new());
    }

    let mut projects: Vec<ClaudeLogProject> = Vec::new();
    for entry in fs::read_dir(base)?.flatten() {
        let path = entry.path();
        if !path.is_dir() || !is_within(base, &path) {
            continue;
        }
        let files = jsonl_files_sorted_desc(&path);
        if files.is_empty() {
            continue;
        }
        let (cwd_opt, sid_opt) = first_meta(&files[0].0);
        let Some(cwd) = cwd_opt else { continue };

        let mtime: DateTime<Utc> = files[0].1.into();
        let encoded_dir = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("")
            .to_string();

        projects.push(ClaudeLogProject {
            project_path: cwd,
            encoded_dir,
            session_count: files.len(),
            last_modified: mtime,
            last_session_id: sid_opt,
        });
    }
    projects.sort_by(|a, b| b.last_modified.cmp(&a.last_modified));
    Ok(projects)
}

fn resolve_project_dirs(project_path: &str, base: &Path) -> Vec<PathBuf> {
    if !base.is_dir() {
        return Vec::new();
    }
    let target = norm_path(project_path);
    if target.is_empty() {
        return Vec::new();
    }
    let mut matched = Vec::new();
    let Ok(entries) = fs::read_dir(base) else {
        return matched;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() || !is_within(base, &path) {
            continue;
        }
        let files = jsonl_files_sorted_desc(&path);
        if files.is_empty() {
            continue;
        }
        let (cwd_opt, _) = first_meta(&files[0].0);
        if let Some(cwd) = cwd_opt {
            if norm_path(&cwd) == target {
                matched.push(path);
            }
        }
    }
    matched
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(default, rename_all = "snake_case")]
pub struct ReadSessionsArgs {
    pub project_path: String,
    pub since: Option<DateTime<Utc>>,
    pub include_tool_calls: bool,
    pub latest_only: bool,
    /// 既定 true
    pub include_user: Option<bool>,
    /// 既定 true
    pub include_assistant: Option<bool>,
    pub include_sidechains: bool,
    /// 既定 200_000、null で無制限
    pub max_chars: Option<usize>,
    /// テスト用（既定 ~/.claude/projects）
    pub base_dir: Option<PathBuf>,
}

pub fn read_sessions_impl(args: ReadSessionsArgs) -> AppResult<Option<ClaudeLogResult>> {
    let owned_default;
    let base: &Path = match args.base_dir.as_ref() {
        Some(p) => p.as_path(),
        None => {
            owned_default = default_base_dir();
            &owned_default
        }
    };

    let dirs_matched = resolve_project_dirs(&args.project_path, base);
    if dirs_matched.is_empty() {
        return Ok(None);
    }

    // 対象 jsonl を集める
    let mut files: Vec<PathBuf> = Vec::new();
    for d in &dirs_matched {
        files.extend(jsonl_files_sorted_asc(d));
    }
    files.retain(|p| p.is_file());

    if files.is_empty() {
        return Ok(Some(ClaudeLogResult {
            content: String::new(),
            char_count: 0,
            session_count: 0,
            project_path: canonical_cwd(&dirs_matched[0]),
            ..Default::default()
        }));
    }

    files.sort_by_key(|p| mtime_of(p)); // 古い→新しい
    if args.latest_only {
        let last = files.pop();
        files.clear();
        if let Some(l) = last {
            files.push(l);
        }
    }

    let max_chars = args.max_chars.or(Some(200_000));
    let include_user = args.include_user.unwrap_or(true);
    let include_assistant = args.include_assistant.unwrap_or(true);
    let multi = files.len() > 1;

    let mut parts: Vec<String> = Vec::new();
    let mut total: usize = 0;
    let mut truncated = false;
    let mut counts = MessageCounts::default();
    let mut session_ids: Vec<String> = Vec::new();
    let mut seen_sids: HashMap<String, ()> = HashMap::new();

    // 文字数加算: chars().count() ベースで Python の len() 互換に近づける
    let mut emit = |text: &str, parts: &mut Vec<String>, total: &mut usize| -> bool {
        let n = text.chars().count();
        if let Some(limit) = max_chars {
            if *total + n > limit {
                return false;
            }
        }
        parts.push(text.to_string());
        *total += n;
        true
    };

    'outer: for f in &files {
        let sid_full = f
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_string();
        let mut emitted_header = !multi;

        let lines = iter_lines(f).unwrap_or_default();
        for obj in lines {
            if obj
                .get("isSidechain")
                .and_then(|v| v.as_bool())
                .unwrap_or(false)
                && !args.include_sidechains
            {
                continue;
            }
            let typ = obj.get("type").and_then(|v| v.as_str()).unwrap_or("");
            if typ != "user" && typ != "assistant" {
                continue;
            }

            let ts = obj
                .get("timestamp")
                .and_then(|v| v.as_str())
                .and_then(parse_ts);

            if let Some(since) = args.since {
                if let Some(t) = ts {
                    if t < since {
                        continue;
                    }
                }
            }

            if let Some(sid) = obj.get("sessionId").and_then(|v| v.as_str()) {
                if !seen_sids.contains_key(sid) {
                    seen_sids.insert(sid.to_string(), ());
                    session_ids.push(sid.to_string());
                }
            }

            let msg = obj.get("message").cloned().unwrap_or(Value::Null);
            let content = msg.get("content").cloned().unwrap_or(Value::Null);

            let mut chunks: Vec<String> = Vec::new();
            if typ == "user" && include_user {
                for t in user_texts(&content) {
                    chunks.push(format!("## User:\n{}\n", t));
                }
            } else if typ == "assistant" && include_assistant {
                if let Some(blocks) = content.as_array() {
                    for b in blocks {
                        let Some(obj) = b.as_object() else { continue };
                        let bt = obj.get("type").and_then(|v| v.as_str()).unwrap_or("");
                        if bt == "text" {
                            let text = obj
                                .get("text")
                                .and_then(|v| v.as_str())
                                .unwrap_or("")
                                .trim();
                            if !text.is_empty() {
                                chunks.push(format!("## Claude:\n{}\n", text));
                            }
                        } else if bt == "tool_use" && args.include_tool_calls {
                            let (name, summary) = summarize_tool_use(b);
                            let mut body = format!("## Tool: {}\n", name);
                            if !summary.is_empty() {
                                body.push_str(&format!("{}\n", summary));
                            }
                            chunks.push(body);
                        }
                    }
                }
            }

            if chunks.is_empty() {
                continue;
            }

            if !emitted_header {
                let label = ts
                    .map(|t| t.format("%Y-%m-%d %H:%M").to_string())
                    .unwrap_or_default();
                let head: String = sid_full.chars().take(8).collect();
                let header = format!("\n# === Session {} ({}) ===\n\n", head, label);
                if !emit(&header, &mut parts, &mut total) {
                    truncated = true;
                    break 'outer;
                }
                emitted_header = true;
            }

            for ch in &chunks {
                let line = format!("{}\n", ch);
                if !emit(&line, &mut parts, &mut total) {
                    truncated = true;
                    break;
                }
                if ch.starts_with("## User:") {
                    counts.user += 1;
                } else if ch.starts_with("## Claude:") {
                    counts.assistant += 1;
                } else if ch.starts_with("## Tool:") {
                    counts.tool_use += 1;
                }
            }
            if truncated {
                break 'outer;
            }
        }
    }

    let content = parts.join("").trim().to_string();
    Ok(Some(ClaudeLogResult {
        char_count: content.chars().count(),
        content,
        session_count: session_ids.len(),
        message_counts: counts,
        project_path: canonical_cwd(&dirs_matched[0]),
        session_ids,
        truncated,
    }))
}

// ---------------------------------------------------------------------------
// Tauri コマンド
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn list_claude_projects() -> AppResult<Vec<ClaudeLogProject>> {
    list_projects_impl(None)
}

#[tauri::command]
pub fn read_claude_sessions(args: ReadSessionsArgs) -> AppResult<Option<ClaudeLogResult>> {
    if args.project_path.trim().is_empty() {
        return Err(AppError::InvalidInput("project_path is required".into()));
    }
    read_sessions_impl(args)
}
