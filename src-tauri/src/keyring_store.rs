//! 秘匿情報の保存。アプリ専用ディレクトリ（`~/Library/Application Support/<bundle-id>/`）
//! 配下の `secrets.json` に保存する。**OS Keyring を使わない**理由：
//!
//! - Tauri 2 dev モードは Rust 変更のたびに未署名バイナリを再ビルドし、macOS Keychain の
//!   ACL が前回バイナリと一致せずに読み取り拒否されるケースが頻発（symptom: 保存後にナビゲートで
//!   バッジが消える、`keyring_get_internal` が失敗）。
//! - パーソナル用途のデスクトップアプリで、保存先がユーザーのホームディレクトリ配下・600 で
//!   あれば、同 macOS ユーザー権限外からは読めない（実用上の脅威モデルに対して十分）。
//!
//! より高い安全性が欲しい場合は将来 `tauri-plugin-stronghold` への切替えを検討。

use crate::error::{AppError, AppResult};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

const SECRETS_FILENAME: &str = "secrets.json";

#[derive(Default, Serialize, Deserialize)]
struct Secrets {
    #[serde(default)]
    map: HashMap<String, String>,
}

fn secrets_path(app: &AppHandle) -> AppResult<PathBuf> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| AppError::other(format!("app_data_dir: {e}")))?;
    fs::create_dir_all(&dir)?;
    Ok(dir.join(SECRETS_FILENAME))
}

fn load_secrets(app: &AppHandle) -> AppResult<Secrets> {
    let path = secrets_path(app)?;
    if !path.exists() {
        return Ok(Secrets::default());
    }
    let bytes = fs::read(&path)?;
    Ok(serde_json::from_slice::<Secrets>(&bytes).unwrap_or_default())
}

fn save_secrets(app: &AppHandle, secrets: &Secrets) -> AppResult<()> {
    let path = secrets_path(app)?;
    let bytes = serde_json::to_vec_pretty(secrets)?;
    fs::write(&path, &bytes)?;
    // unix では 600（所有者 read/write のみ）に強制
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = fs::metadata(&path)?.permissions();
        perms.set_mode(0o600);
        fs::set_permissions(&path, perms)?;
    }
    Ok(())
}

#[tauri::command]
pub fn keyring_set(app: AppHandle, key: String, value: String) -> AppResult<()> {
    let mut s = load_secrets(&app)?;
    s.map.insert(key, value);
    save_secrets(&app, &s)?;
    Ok(())
}

#[tauri::command]
pub fn keyring_has(app: AppHandle, key: String) -> AppResult<bool> {
    let s = load_secrets(&app)?;
    Ok(s.map.contains_key(&key))
}

#[tauri::command]
pub fn keyring_delete(app: AppHandle, key: String) -> AppResult<()> {
    let mut s = load_secrets(&app)?;
    s.map.remove(&key);
    save_secrets(&app, &s)?;
    Ok(())
}

/// 内部用：Rust 側から直接呼ぶ（Claude / Qiita API クライアントから）。
/// 値そのものを返すため JS には公開しない。
pub fn keyring_get_internal(app: &AppHandle, key: &str) -> AppResult<Option<String>> {
    let s = load_secrets(app)?;
    Ok(s.map.get(key).cloned())
}
