//! 自動アップデート（tauri-plugin-updater）の薄いラッパー。
//! GitHub Releases にアップロードした `latest.json` を起点に、新版があれば
//! ダウンロード→Ed25519署名検証→置換→再起動 を行う。

use serde::Serialize;
use tauri::AppHandle;
use tauri_plugin_updater::UpdaterExt;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub available: bool,
    pub version: Option<String>,
    pub current_version: String,
    pub notes: Option<String>,
    pub date: Option<String>,
}

/// 利用可能なアップデートを問い合わせる（ダウンロードはしない）。
#[tauri::command]
pub async fn check_for_updates(app: AppHandle) -> Result<UpdateInfo, String> {
    let current = app.package_info().version.to_string();
    let updater = app.updater().map_err(|e| e.to_string())?;

    match updater.check().await {
        Ok(Some(update)) => Ok(UpdateInfo {
            available: true,
            version: Some(update.version.to_string()),
            current_version: current,
            notes: update.body.clone(),
            date: update.date.map(|d| d.to_string()),
        }),
        Ok(None) => Ok(UpdateInfo {
            available: false,
            version: None,
            current_version: current,
            notes: None,
            date: None,
        }),
        Err(e) => Err(format!("更新確認エラー: {}", e)),
    }
}

/// 最新版をダウンロード→検証→置換し、アプリを再起動する。
/// 再起動が成功する場合この関数からは戻らない。
#[tauri::command]
pub async fn install_update(app: AppHandle) -> Result<(), String> {
    let updater = app.updater().map_err(|e| e.to_string())?;
    let Some(update) = updater.check().await.map_err(|e| e.to_string())? else {
        return Err("利用可能なアップデートがありません。".into());
    };

    update
        .download_and_install(|_, _| {}, || {})
        .await
        .map_err(|e| e.to_string())?;

    app.restart();
}
