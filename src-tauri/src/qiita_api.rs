//! Qiita API v2 クライアント。
//!
//! 主な仕様
//! - 認証: `Authorization: Bearer <PAT>`（PAT は OS 不依存のローカル secrets.json に保存）
//! - 下書き保存: 既存 item_id があれば `PATCH /api/v2/items/:id`、無ければ `POST /api/v2/items`
//! - 重要: PATCH は **partial 不可・full payload 必須**（Web 版から踏襲した罠）
//! - 公開/取り下げ: `private` フィールドの切替えで実現（別エンドポイント不要）
//! - レート制限: 429 → Retry-After を尊重して1回リトライ
//!
//! 参考: <https://qiita.com/api/v2/docs>

use crate::error::{AppError, AppResult};
use reqwest::{Client, Response, StatusCode};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::time::Duration;
use tauri::AppHandle;

const QIITA_API_BASE: &str = "https://qiita.com/api/v2";
const QIITA_TOKEN_KEY: &str = "qiita_token";

// ---------------------------------------------------------------------------
// 型
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QiitaUser {
    pub id: String,
    pub permanent_id: Option<i64>,
    pub name: Option<String>,
    pub profile_image_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QiitaItem {
    pub id: String,
    pub url: String,
    pub title: String,
    pub private: bool,
    pub created_at: String,
    pub updated_at: String,
}

// ---------------------------------------------------------------------------
// 内部ヘルパ
// ---------------------------------------------------------------------------

fn http_client(timeout: u64) -> AppResult<Client> {
    Client::builder()
        .timeout(Duration::from_secs(timeout))
        .build()
        .map_err(AppError::from)
}

fn load_token(app: &AppHandle) -> AppResult<String> {
    crate::keyring_store::keyring_get_internal(app, QIITA_TOKEN_KEY)?
        .ok_or_else(|| {
            AppError::InvalidInput(
                "Qiita Personal Access Token が未設定です。設定画面で保存してください。".into(),
            )
        })
}

async fn parse_qiita_error_for_status(resp: Response) -> AppResult<Value> {
    let status = resp.status();
    let body_text = resp.text().await.map_err(AppError::from)?;
    let parsed: Value = serde_json::from_str(&body_text).unwrap_or(Value::Null);
    if !status.is_success() {
        // message を優先、無ければ生 body の先頭 200 文字
        let msg = parsed
            .get("message")
            .and_then(|m| m.as_str())
            .map(String::from)
            .or_else(|| {
                parsed
                    .get("error")
                    .and_then(|e| e.as_str())
                    .map(String::from)
            })
            .unwrap_or_else(|| {
                let snippet: String = body_text.chars().take(200).collect();
                if snippet.is_empty() {
                    "Qiita API エラー".to_string()
                } else {
                    snippet
                }
            });
        // Qiita はエラー本文に詳細を message 以外の field でも返すので一緒にダンプ
        let detail = if parsed.is_object() && parsed.as_object().map(|m| m.len() > 1).unwrap_or(false) {
            format!(" / detail={}", serde_json::to_string(&parsed).unwrap_or_default())
        } else {
            String::new()
        };
        return Err(AppError::External(format!("[{}] {}{}", status, msg, detail)));
    }
    Ok(parsed)
}

/// タグ文字列配列 → Qiita API 形式の `[{ "name": "..." }]` に変換
fn tags_to_qiita_payload(tags: &[String]) -> Vec<Value> {
    tags.iter()
        .filter(|t| !t.trim().is_empty())
        .map(|t| serde_json::json!({ "name": t.trim() }))
        .collect()
}

/// 429 を 1 回だけ Retry-After 秒待ってリトライするヘルパ
async fn send_with_retry(
    builder_fn: impl Fn() -> reqwest::RequestBuilder,
) -> AppResult<Response> {
    let resp = builder_fn().send().await.map_err(AppError::from)?;
    if resp.status() != StatusCode::TOO_MANY_REQUESTS {
        return Ok(resp);
    }
    let wait = resp
        .headers()
        .get("retry-after")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.parse::<u64>().ok())
        .unwrap_or(2)
        .min(30); // 安全上限 30 秒
    tokio::time::sleep(Duration::from_secs(wait)).await;
    builder_fn().send().await.map_err(AppError::from)
}

// ---------------------------------------------------------------------------
// Tauri コマンド
// ---------------------------------------------------------------------------

/// PAT の有効性確認＋ユーザ情報取得（Settings 画面の接続テスト用）
#[tauri::command]
pub async fn qiita_test_connection(app: AppHandle) -> AppResult<QiitaUser> {
    let token = load_token(&app)?;
    let client = http_client(15)?;
    let url = format!("{}/authenticated_user", QIITA_API_BASE);

    let resp = client
        .get(&url)
        .header("Authorization", format!("Bearer {}", token))
        .send()
        .await?;
    let json = parse_qiita_error_for_status(resp).await?;
    let user: QiitaUser = serde_json::from_value(json)?;
    Ok(user)
}

/// JS 側からの引数。
/// Tauri 2 は struct 内のフィールド名は自動変換しないので、明示的に camelCase 受け入れを宣言する。
#[derive(Debug, Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
pub struct SyncItemArgs {
    /// 既存の item_id（更新時）。None で新規作成。
    pub item_id: Option<String>,
    pub title: Option<String>,
    pub body: Option<String>,
    pub tags: Option<Vec<String>>,
    /// true で限定共有・false で公開。None なら現状維持。
    pub private: Option<bool>,
}

/// Qiita に下書き/公開記事を作成または更新する。
///
/// - POST（新規）: title と tags が必須
/// - PATCH（更新）: 指定したフィールドのみ送信（partial update）
///   `private` のみを送れば、タイトル重複検査（重複タイトル 422）を回避して状態のみ切替えられる
#[tauri::command]
pub async fn qiita_sync_item(app: AppHandle, args: SyncItemArgs) -> AppResult<QiitaItem> {
    let token = load_token(&app)?;
    let client = http_client(30)?;

    // 共通: タグが指定されていれば 0〜5 を強制
    if let Some(tags) = args.tags.as_ref() {
        if tags.len() > 5 {
            return Err(AppError::InvalidInput("タグは最大5つまでです。".into()));
        }
    }
    if let Some(t) = args.title.as_ref() {
        if t.trim().is_empty() {
            return Err(AppError::InvalidInput("タイトルが空です。".into()));
        }
    }

    // 送信ボディ: 指定された field のみ含める
    let mut payload = serde_json::Map::new();
    if let Some(t) = args.title.as_ref() {
        payload.insert("title".into(), serde_json::json!(t.trim()));
    }
    if let Some(b) = args.body.as_ref() {
        payload.insert("body".into(), serde_json::json!(b));
    }
    if let Some(tags) = args.tags.as_ref() {
        payload.insert("tags".into(), serde_json::json!(tags_to_qiita_payload(tags)));
    }
    if let Some(p) = args.private {
        payload.insert("private".into(), serde_json::json!(p));
    }
    // tweet は新規作成時専用フィールド。PATCH に含めると 400 になる Qiita 仕様。
    if args.item_id.is_none() {
        payload.insert("tweet".into(), serde_json::json!(false));
    }

    let body_value = serde_json::Value::Object(payload);

    let resp = if let Some(ref id) = args.item_id {
        // PATCH /api/v2/items/:item_id（partial OK）
        let url = format!("{}/items/{}", QIITA_API_BASE, id);
        send_with_retry(|| {
            client
                .patch(&url)
                .header("Authorization", format!("Bearer {}", token))
                .json(&body_value)
        })
        .await?
    } else {
        // POST /api/v2/items - title と tags が必須
        if args
            .title
            .as_ref()
            .map(|t| t.trim().is_empty())
            .unwrap_or(true)
        {
            return Err(AppError::InvalidInput(
                "新規作成にはタイトルが必要です。".into(),
            ));
        }
        let has_tags = args.tags.as_ref().map(|t| !t.is_empty()).unwrap_or(false);
        if !has_tags {
            return Err(AppError::InvalidInput(
                "Qiita はタグが最低1つ必要です。".into(),
            ));
        }
        let url = format!("{}/items", QIITA_API_BASE);
        send_with_retry(|| {
            client
                .post(&url)
                .header("Authorization", format!("Bearer {}", token))
                .json(&body_value)
        })
        .await?
    };

    let json = parse_qiita_error_for_status(resp).await?;
    let item: QiitaItem = serde_json::from_value(json)?;
    Ok(item)
}
