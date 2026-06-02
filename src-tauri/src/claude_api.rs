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
const REWRITE_MAX_TOKENS: u32 = 8192;
const TWEET_MAX_TOKENS: u32 = 1024;
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
    platform: &str,
) -> String {
    match platform {
        "note" => build_note_prompt(source_type, title, raw_content, style_hint, target_length),
        _ => build_qiita_prompt(source_type, title, raw_content, style_hint, target_length),
    }
}

fn build_qiita_prompt(
    source_type: &str,
    title: &str,
    raw_content: &str,
    style_hint: &str,
    target_length: &str,
) -> String {
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

fn build_note_prompt(
    source_type: &str,
    title: &str,
    raw_content: &str,
    style_hint: &str,
    target_length: &str,
) -> String {
    format!(
r#"あなたは個人事業主・クリエイター・副業志望層向けの note 編集者です。以下の「開発セッション素材」を読み、note向けのエッセイ調記事を Markdown で生成してください。

<source_type>{source_type}</source_type>
<source_title>{title}</source_title>
<source_content>
{raw_content}
</source_content>

<style_hint>{style_hint}</style_hint>
<target_length>{target_length}</target_length>
<length_guide>short=800字 / medium=1500字 / long=2500字目安</length_guide>

【note 記事の特徴】
- 想定読者: フリーランス / 個人開発者 / AI活用層 / 副業志望者（必ずしも技術者ではない）
- 一人称ナラティブ（「やってみた」「気づいた」「思った」「正直しんどかった」）
- 技術詳細より「体験・気づき・心の動き・お金や時間の話」を優先
- コードは最小限（必要なら 2〜3 行の抜粋まで）。専門用語は最小限 or 平易な言い換え
- 起承転結のストーリー構成（「導入」「やってみた」「気づき」「これからの人へ」など）
- 締めは読者への問いかけや、共有したい実感
- "技術ブログ" ではない。"開発者の振り返り日記" や "新しい挑戦記" のテンション
- AI活用・個人事業・プロダクト開発の文脈で書くと note 読者に共感を呼ぶ

【厳守ルール】
- まず "TITLE_OPTIONS:" に続けてタイトル候補3つを JSON 配列で出力（読み手の感情に訴えるもの・引き込み力ある）
- 次に "SUGGESTED_TAGS:" に続けて note ハッシュタグ最大5つを JSON 配列で出力（例: SUGGESTED_TAGS: ["個人開発", "AI活用", "フリーランス", "プロダクト開発"]）
- 次に "ARTICLE_BODY:" の行を置き、その次の行以降に Markdown 本文を書く
- 本文には流れ重視の見出しを含める（例: 「はじめに」「やってみたこと」「気づいたこと」「これから挑戦する人へ」）
- 個人情報・社内秘情報は具体名を伏せて一般化する
- 主観・所感は note では歓迎されるが、断定口調にならず「個人の感想」と分かるように
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

/// 429 (rate limit) を自動リトライする Anthropic API 呼び出し。
///
/// - 成功 → response body JSON
/// - 429 + リトライ余地あり → `retry-after` ヘッダ優先、無ければ 5s/15s/45s の指数バックオフ
///   + 0〜999ms のジッター（並列リクエストの衝突を緩和）で待機して再試行
/// - リトライ上限到達 or その他のエラー → 親切メッセージで AppError::External
async fn anthropic_call_with_retry(
    client: &Client,
    api_key: &str,
    body: &Value,
    max_retries: u32,
) -> AppResult<Value> {
    let mut attempt: u32 = 0;
    loop {
        let resp = client
            .post(ANTHROPIC_API_URL)
            .header("x-api-key", api_key)
            .header("anthropic-version", ANTHROPIC_API_VERSION)
            .header("content-type", "application/json")
            .json(body)
            .send()
            .await?;

        let status = resp.status();
        if status.is_success() {
            return resp.json::<Value>().await.map_err(AppError::from);
        }

        // 429 = レート制限 → リトライ可能
        if status.as_u16() == 429 && attempt < max_retries {
            let retry_after_secs: u64 = resp
                .headers()
                .get("retry-after")
                .and_then(|v| v.to_str().ok())
                .and_then(|s| s.parse().ok())
                .unwrap_or(match attempt {
                    0 => 5,
                    1 => 15,
                    _ => 45,
                });

            // 並列リクエストの衝突を緩和するためのジッター（0〜999ms）
            let jitter_ms = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| u64::from(d.subsec_nanos() / 1_000_000))
                .unwrap_or(0);
            tokio::time::sleep(Duration::from_millis(
                retry_after_secs * 1000 + jitter_ms,
            ))
            .await;
            attempt += 1;
            continue;
        }

        // 非リトライ or リトライ上限到達 → エラー化
        let json: Value = resp.json().await.map_err(AppError::from)?;
        let msg = json
            .get("error")
            .and_then(|e| e.get("message"))
            .and_then(|m| m.as_str())
            .unwrap_or("Anthropic API エラー");

        if status.as_u16() == 429 {
            return Err(AppError::External(format!(
                "レート制限に達しました（{} 回試行してもダメでした）。対処:\n  ① 「最大文字数」を 30000 以下に下げる（新規生成画面）\n  ② Qiita か note のどちらか単独で生成する（並列をやめる）\n  ③ 1〜2 分待ってから再実行\n  ④ Tier 2 へアップグレード（$40 デポジット）: https://console.anthropic.com/settings/billing\n元エラー: {}",
                attempt + 1,
                msg
            )));
        }

        return Err(AppError::External(format!("[{}] {}", status, msg)));
    }
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

    // 接続テストは軽いので 1 回だけリトライ
    let json = anthropic_call_with_retry(&client, &api_key, &body, 1).await?;

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
    platform: Option<String>,
) -> AppResult<GenerationResult> {
    if raw_content.trim().is_empty() {
        return Err(AppError::InvalidInput("素材が空です。".into()));
    }
    let api_key = load_api_key(&app)?;
    let model = model.unwrap_or_else(|| DEFAULT_MODEL.to_string());
    let style_hint = style_hint.unwrap_or_else(|| DEFAULT_STYLE_HINT.to_string());
    let target_length = target_length.unwrap_or_else(|| DEFAULT_TARGET_LENGTH.to_string());
    let platform = platform.unwrap_or_else(|| "qiita".to_string());

    let prompt = build_prompt(
        &source_type,
        title.as_deref().unwrap_or("(無題)"),
        &raw_content,
        &style_hint,
        &target_length,
        &platform,
    );

    let client = http_client(180)?; // 同期生成は最大3分
    let body = serde_json::json!({
        "model": &model,
        "max_tokens": MAX_TOKENS,
        "messages": [{"role": "user", "content": prompt}]
    });

    // 大型素材なので 429 は十分起こり得る → 3 回までリトライ
    let json = anthropic_call_with_retry(&client, &api_key, &body, 3).await?;

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

// ---------------------------------------------------------------------------
// 公開前 AI 書き換え（伏字化）
// ---------------------------------------------------------------------------

fn build_rewrite_prompt(body: &str, targets: &[String]) -> String {
    let targets_block = if targets.is_empty() {
        "（明示指定なし：API キー / メール / IPv4 / 個人名・社内秘らしき固有名詞を自動で検出して伏字化してください）".to_string()
    } else {
        targets
            .iter()
            .enumerate()
            .map(|(i, t)| format!("{}. `{}`", i + 1, t))
            .collect::<Vec<_>>()
            .join("\n")
    };

    let mut s = String::new();
    s.push_str("以下の Markdown 記事から、指定された機密情報を「公開しても安全な形」に書き換えてください。\n\n");
    s.push_str("【厳守ルール】\n");
    s.push_str("- 完全削除ではなく、文脈が成立する範囲で**一般化・伏字化**する\n");
    s.push_str("  例: `160.251.X.X` → `<旧VPS>` / `info@my-domain.com` → `info@<your-domain>` / `田中太郎` → `担当エンジニア`\n");
    s.push_str("- API キー (`sk-...`, `ghp_...` 等)・トークンらしき長文字列は `<REDACTED>` に置換\n");
    s.push_str("- 技術的内容・コード例の構造・見出し階層は**絶対に変更しない**\n");
    s.push_str("- セクションの追加・削除・並び替えをしない\n");
    s.push_str("- 出力は書き換え後の Markdown 本文のみ。前置きや説明・コードフェンスでの全体ラップは不要\n\n");
    s.push_str("【伏字化対象】\n");
    s.push_str(&targets_block);
    s.push_str("\n\n【元の Markdown】\n");
    s.push_str(body);
    s
}

/// 公開前の AI 書き換え。`targets` に渡した文字列群を伏字化する。
#[tauri::command]
pub async fn claude_rewrite_for_publish(
    app: AppHandle,
    body: String,
    targets: Vec<String>,
    model: Option<String>,
) -> AppResult<String> {
    if body.trim().is_empty() {
        return Err(AppError::InvalidInput("本文が空です。".into()));
    }
    let api_key = load_api_key(&app)?;
    let model = model.unwrap_or_else(|| DEFAULT_MODEL.to_string());

    let prompt = build_rewrite_prompt(&body, &targets);

    let client = http_client(180)?;
    let req_body = serde_json::json!({
        "model": &model,
        "max_tokens": REWRITE_MAX_TOKENS,
        "messages": [{"role": "user", "content": prompt}]
    });

    let json = anthropic_call_with_retry(&client, &api_key, &req_body, 3).await?;
    let text = extract_response_text(&json);

    // 万一全体が ``` で囲まれていた場合に剥がす
    let fence_re = Regex::new(r"(?s)^```(?:markdown|md)?\s*\n(.*)\n```\s*$").unwrap();
    let cleaned = if let Some(caps) = fence_re.captures(text.trim()) {
        caps.get(1).unwrap().as_str().trim().to_string()
    } else {
        text.trim().to_string()
    };

    if cleaned.is_empty() {
        return Err(AppError::External("書き換え結果が空でした。再試行してください。".into()));
    }

    Ok(cleaned)
}

// ---------------------------------------------------------------------------
// X (Twitter) 投稿文生成
// ---------------------------------------------------------------------------

fn build_tweet_prompt(title: &str, body: &str, tags: &[String], url: Option<&str>) -> String {
    let body_excerpt: String = body.chars().take(2500).collect();
    let tags_str = tags.join(", ");
    let url_block = url
        .map(|u| format!("\n【記事URL（参考・本文には含めない）】\n{}\n", u))
        .unwrap_or_default();

    let mut s = String::new();
    s.push_str("以下の Qiita 記事を紹介する X (旧 Twitter) のポスト案を 3 パターン作ってください。\n\n");
    s.push_str("【厳守ルール】\n");
    s.push_str("- 各ポスト 140 字以内（日本語）\n");
    s.push_str("- 「読みたい」と思わせる導入 → 記事の核心 1 行 → 関連ハッシュタグ 2〜3 個（記事内容に合うもの）\n");
    s.push_str("- URL は出力に**含めない**（呼び出し側で末尾に付加するため）\n");
    s.push_str("- 3 案を `---` で区切るだけ。番号・前置き・解説・コードフェンスは不要\n");
    s.push_str("- 各案は異なるトーンで。例: 1=技術的成果アピール / 2=ハマりポイント共有 / 3=エモ寄り\n\n");
    s.push_str("【記事タイトル】\n");
    s.push_str(title);
    s.push_str("\n\n【タグ】\n");
    s.push_str(&tags_str);
    s.push_str("\n\n【本文抜粋（先頭 2500 字）】\n");
    s.push_str(&body_excerpt);
    s.push_str(&url_block);
    s
}

/// 記事を紹介する X 投稿文を 3 パターン生成する。
#[tauri::command]
pub async fn claude_generate_tweets(
    app: AppHandle,
    title: String,
    body: String,
    tags: Vec<String>,
    url: Option<String>,
    model: Option<String>,
) -> AppResult<Vec<String>> {
    if body.trim().is_empty() {
        return Err(AppError::InvalidInput("本文が空です。".into()));
    }
    let api_key = load_api_key(&app)?;
    let model = model.unwrap_or_else(|| DEFAULT_MODEL.to_string());

    let prompt = build_tweet_prompt(&title, &body, &tags, url.as_deref());

    let client = http_client(60)?;
    let req_body = serde_json::json!({
        "model": &model,
        "max_tokens": TWEET_MAX_TOKENS,
        "messages": [{"role": "user", "content": prompt}]
    });

    let json = anthropic_call_with_retry(&client, &api_key, &req_body, 2).await?;
    let text = extract_response_text(&json);

    let tweets: Vec<String> = text
        .split("---")
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect();

    if tweets.is_empty() {
        return Err(AppError::External("投稿案を取得できませんでした。再試行してください。".into()));
    }

    Ok(tweets)
}
