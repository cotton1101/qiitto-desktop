//! Anthropic Claude API クライアント（記事生成）。Web版 `backend/app/services/claude.py` を Rust に移植。
//!
//! - API キーは OS Keyring から取得（JS 側には渡さない）
//! - reqwest で /v1/messages を直接叩く（Anthropic 公式 SDK の Rust 版は無し）
//! - 応答を TITLE_OPTIONS / SUGGESTED_TAGS / ARTICLE_BODY にパース

use crate::error::{AppError, AppResult};
use regex::Regex;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::time::Duration;
use tauri::AppHandle;

const DEFAULT_MODEL: &str = "claude-sonnet-4-6";
const MAX_TOKENS: u32 = 8192;
const ANTHROPIC_API_URL: &str = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_API_VERSION: &str = "2023-06-01";
const DEFAULT_STYLE_HINT: &str = "実装ログ系、ハマったポイント中心、コード例を多めに";
const DEFAULT_TARGET_LENGTH: &str = "medium";

#[derive(Debug, Default, Clone, Serialize, Deserialize)]
pub struct ParsedArticle {
    pub title_options: Vec<String>,
    pub suggested_tags: Vec<String>,
    pub body_markdown: String,
    pub parse_ok: bool,
}

#[derive(Debug, Default, Clone, Serialize, Deserialize)]
pub struct GenerationResult {
    pub title_options: Vec<String>,
    pub suggested_tags: Vec<String>,
    pub body_markdown: String,
    pub prompt_used: String,
    pub tokens_used: i32,
    pub parse_ok: bool,
    pub model: String,
}

#[derive(Debug, Serialize)]
pub struct TestConnectionResult {
    pub model: String,
    pub stop_reason: Option<String>,
}

// ---------------------------------------------------------------------------
// プロンプト生成・パース
// ---------------------------------------------------------------------------

fn build_prompt(
    source_type: &str,
    title: &str,
    raw_content: &str,
    style_hint: &str,
    target_length: &str,
) -> String {
    // r#"..."# 内では中括弧をそのまま書くため、format! には個別ローカル変数を渡す
    format!(
r#"あなたは熟練の技術ライターです。以下の「開発セッション素材」を読み、Qiita向けの技術記事Markdownを生成してください。

<source_type>{source_type}</source_type>
<source_title>{title}</source_title>
<source_content>
{raw_content}
</source_content>

<style_hint>{style_hint}</style_hint>
<target_length>{target_length}</target_length>
<length_guide>short=800字 / medium=1500字 / long=2500字目安</length_guide>

【厳守ルール】
- まず "TITLE_OPTIONS:" に続けてタイトル候補3つを JSON 配列で出力（例: TITLE_OPTIONS: ["案1", "案2", "案3"]）
- 次に "SUGGESTED_TAGS:" に続けて推奨タグ最大5つを JSON 配列で出力（例: SUGGESTED_TAGS: ["Python", "Claude"]）
- 次に "ARTICLE_BODY:" の行を置き、その次の行以降に Markdown 本文を書く
- 本文には必ず「はじめに」「やったこと」「ハマったポイント」「学び」の見出しを含める
- コードは ```言語名 で囲む
- 個人情報・社内秘情報は具体名を伏せて一般化する
- 主観・所感は「個人の感想」として明示する
- 上記3ラベル以外の前置きや、全体をコードフェンスで囲むことはしない"#
    )
}

fn extract_json_array(text: &str, label: &str) -> Option<Vec<String>> {
    let pattern = format!(r"{}\s*:\s*(\[[\s\S]*?\])", regex::escape(label));
    let re = Regex::new(&pattern).ok()?;
    let caps = re.captures(text)?;
    let json_str = caps.get(1)?.as_str();
    let v: Value = serde_json::from_str(json_str).ok()?;
    let arr = v.as_array()?;
    let out: Vec<String> = arr
        .iter()
        .filter_map(|x| match x {
            Value::String(s) => Some(s.trim().to_string()),
            other => Some(other.to_string().trim().to_string()),
        })
        .filter(|s| !s.is_empty())
        .collect();
    Some(out)
}

pub fn parse_article_response(text: &str) -> ParsedArticle {
    let raw = text.trim();

    // 万一全体が ``` で囲まれていたら剥がす
    let fence_re = Regex::new(r"(?s)^```[a-zA-Z0-9]*\n(.*)\n```$").unwrap();
    let raw_owned;
    let raw: &str = if let Some(caps) = fence_re.captures(raw) {
        raw_owned = caps.get(1).unwrap().as_str().trim().to_string();
        &raw_owned
    } else {
        raw
    };

    let body_marker_re = Regex::new(r"ARTICLE_BODY\s*:").unwrap();
    let Some(m) = body_marker_re.find(raw) else {
        return ParsedArticle {
            body_markdown: raw.to_string(),
            parse_ok: false,
            ..Default::default()
        };
    };

    let head = &raw[..m.start()];
    let body = raw[m.end()..].trim_start_matches('\n').trim();

    let titles = extract_json_array(head, "TITLE_OPTIONS").unwrap_or_default();
    let mut tags = extract_json_array(head, "SUGGESTED_TAGS").unwrap_or_default();
    tags.truncate(5);

    if body.is_empty() {
        return ParsedArticle {
            title_options: titles,
            suggested_tags: tags,
            body_markdown: raw.to_string(),
            parse_ok: false,
        };
    }

    ParsedArticle {
        title_options: titles,
        suggested_tags: tags,
        body_markdown: body.to_string(),
        parse_ok: true,
    }
}

// ---------------------------------------------------------------------------
// HTTP 呼び出し
// ---------------------------------------------------------------------------

fn http_client(timeout: u64) -> AppResult<Client> {
    Client::builder()
        .timeout(Duration::from_secs(timeout))
        .build()
        .map_err(AppError::from)
}

fn anthropic_request(client: &Client, api_key: &str, body: Value) -> reqwest::RequestBuilder {
    client
        .post(ANTHROPIC_API_URL)
        .header("x-api-key", api_key)
        .header("anthropic-version", ANTHROPIC_API_VERSION)
        .header("content-type", "application/json")
        .json(&body)
}

async fn anthropic_error_for_status(resp: reqwest::Response) -> AppResult<Value> {
    let status = resp.status();
    let json: Value = resp.json().await?;
    if !status.is_success() {
        let msg = json
            .get("error")
            .and_then(|e| e.get("message"))
            .and_then(|m| m.as_str())
            .unwrap_or("Anthropic API エラー");
        return Err(AppError::External(format!("[{}] {}", status, msg)));
    }
    Ok(json)
}

fn extract_response_text(json: &Value) -> String {
    json.get("content")
        .and_then(|c| c.as_array())
        .map(|blocks| {
            blocks
                .iter()
                .filter_map(|b| {
                    if b.get("type").and_then(|t| t.as_str()) == Some("text") {
                        b.get("text").and_then(|t| t.as_str()).map(String::from)
                    } else {
                        None
                    }
                })
                .collect::<Vec<_>>()
                .join("")
        })
        .unwrap_or_default()
}

fn extract_tokens_used(json: &Value) -> i32 {
    json.get("usage")
        .map(|u| {
            let i = u.get("input_tokens").and_then(|v| v.as_i64()).unwrap_or(0) as i32;
            let o = u.get("output_tokens").and_then(|v| v.as_i64()).unwrap_or(0) as i32;
            i + o
        })
        .unwrap_or(0)
}

fn load_api_key(app: &AppHandle) -> AppResult<String> {
    crate::keyring_store::keyring_get_internal(app, "anthropic_api_key")?
        .ok_or_else(|| {
            AppError::InvalidInput("Anthropic API Key が未設定です。設定画面で保存してください。".into())
        })
}

// ---------------------------------------------------------------------------
// Tauri コマンド
// ---------------------------------------------------------------------------

/// Anthropic API への接続テスト（設定画面・最小トークン）。
#[tauri::command]
pub async fn claude_test_connection(
    app: AppHandle,
    model: Option<String>,
) -> AppResult<TestConnectionResult> {
    let api_key = load_api_key(&app)?;
    let model = model.unwrap_or_else(|| DEFAULT_MODEL.to_string());

    let client = http_client(15)?;
    let body = serde_json::json!({
        "model": &model,
        "max_tokens": 8,
        "messages": [{"role": "user", "content": "ping"}]
    });

    let resp = anthropic_request(&client, &api_key, body).send().await?;
    let json = anthropic_error_for_status(resp).await?;

    Ok(TestConnectionResult {
        model: json
            .get("model")
            .and_then(|m| m.as_str())
            .unwrap_or(&model)
            .to_string(),
        stop_reason: json
            .get("stop_reason")
            .and_then(|s| s.as_str())
            .map(String::from),
    })
}

/// 素材から記事を生成。20〜60秒程度かかる同期 API 呼び出し。
#[tauri::command]
pub async fn claude_generate_article(
    app: AppHandle,
    source_type: String,
    title: Option<String>,
    raw_content: String,
    style_hint: Option<String>,
    target_length: Option<String>,
    model: Option<String>,
) -> AppResult<GenerationResult> {
    if raw_content.trim().is_empty() {
        return Err(AppError::InvalidInput("素材が空です。".into()));
    }
    let api_key = load_api_key(&app)?;
    let model = model.unwrap_or_else(|| DEFAULT_MODEL.to_string());
    let style_hint = style_hint.unwrap_or_else(|| DEFAULT_STYLE_HINT.to_string());
    let target_length = target_length.unwrap_or_else(|| DEFAULT_TARGET_LENGTH.to_string());

    let prompt = build_prompt(
        &source_type,
        title.as_deref().unwrap_or("(無題)"),
        &raw_content,
        &style_hint,
        &target_length,
    );

    let client = http_client(180)?; // 同期生成は最大3分
    let body = serde_json::json!({
        "model": &model,
        "max_tokens": MAX_TOKENS,
        "messages": [{"role": "user", "content": prompt}]
    });

    let resp = anthropic_request(&client, &api_key, body).send().await?;
    let json = anthropic_error_for_status(resp).await?;

    let text = extract_response_text(&json);
    let tokens_used = extract_tokens_used(&json);
    let model_used = json
        .get("model")
        .and_then(|m| m.as_str())
        .unwrap_or(&model)
        .to_string();

    let parsed = parse_article_response(&text);

    Ok(GenerationResult {
        title_options: parsed.title_options,
        suggested_tags: parsed.suggested_tags,
        body_markdown: parsed.body_markdown,
        prompt_used: prompt,
        tokens_used,
        parse_ok: parsed.parse_ok,
        model: model_used,
    })
}
