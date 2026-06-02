//! qiitto-desktop の Tauri 2 エントリポイント。
//! プラグイン登録・SQLite マイグレーション宣言・コマンド登録をここで行う。

mod claude_api;
mod claude_log;
mod error;
mod keyring_store;
mod qiita_api;
mod updater;

use tauri_plugin_sql::{Migration, MigrationKind};

/// アプリ起動時に走らせる SQLite マイグレーション群（昇順で適用）。
fn migrations() -> Vec<Migration> {
    vec![Migration {
        version: 1,
        description: "initial schema",
        sql: include_str!("../migrations/001_init.sql"),
        kind: MigrationKind::Up,
    }]
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:qiitto.db", migrations())
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            keyring_store::keyring_set,
            keyring_store::keyring_has,
            keyring_store::keyring_delete,
            claude_log::list_claude_projects,
            claude_log::read_claude_sessions,
            claude_api::claude_test_connection,
            claude_api::claude_generate_article,
            claude_api::claude_rewrite_for_publish,
            claude_api::claude_generate_tweets,
            qiita_api::qiita_test_connection,
            qiita_api::qiita_sync_item,
            updater::check_for_updates,
            updater::install_update,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
