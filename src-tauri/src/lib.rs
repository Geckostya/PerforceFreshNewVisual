mod commands;
mod diagnostics;
mod locales;
mod models;
mod operations;
mod p4;
mod settings;
pub mod updates;
mod workspace_scan_cache;

use tauri::{Manager, PhysicalPosition, PhysicalSize, WebviewWindow, Window, WindowEvent};

const MIN_WINDOW_WIDTH: u32 = 860;
const MIN_WINDOW_HEIGHT: u32 = 620;

fn settings_path(app: &tauri::AppHandle) -> Option<std::path::PathBuf> {
    app.path()
        .app_config_dir()
        .ok()
        .map(|directory| directory.join("settings.json"))
}

fn saved_window_state_is_valid(state: &models::WindowState) -> bool {
    state.width >= MIN_WINDOW_WIDTH
        && state.height >= MIN_WINDOW_HEIGHT
        && state.width <= 10_000
        && state.height <= 10_000
}

fn saved_window_position_is_visible(window: &WebviewWindow, state: &models::WindowState) -> bool {
    let right = state
        .x
        .saturating_add(state.width.min(i32::MAX as u32) as i32);
    let bottom = state
        .y
        .saturating_add(state.height.min(i32::MAX as u32) as i32);
    window.available_monitors().is_ok_and(|monitors| {
        monitors.iter().any(|monitor| {
            let position = monitor.position();
            let size = monitor.size();
            let monitor_right = position
                .x
                .saturating_add(size.width.min(i32::MAX as u32) as i32);
            let monitor_bottom = position
                .y
                .saturating_add(size.height.min(i32::MAX as u32) as i32);
            right > position.x + 64
                && bottom > position.y + 64
                && state.x < monitor_right - 64
                && state.y < monitor_bottom - 64
        })
    })
}

fn restore_main_window(window: &WebviewWindow, state: &models::WindowState) {
    if !saved_window_state_is_valid(state) {
        return;
    }
    let _ = window.set_size(PhysicalSize::new(state.width, state.height));
    if saved_window_position_is_visible(window, state) {
        let _ = window.set_position(PhysicalPosition::new(state.x, state.y));
    }
    if state.maximized {
        let _ = window.maximize();
    }
}

fn save_main_window_state(window: &Window) {
    let Some(path) = settings_path(window.app_handle()) else {
        return;
    };
    let (Ok(position), Ok(size), Ok(maximized)) = (
        window.outer_position(),
        window.inner_size(),
        window.is_maximized(),
    ) else {
        return;
    };
    let _ = settings::save_window_state(
        &path,
        models::WindowState {
            x: position.x,
            y: position.y,
            width: size.width,
            height: size.height,
            maximized,
        },
    );
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let operations = operations::OperationRegistry::default();
    let scans = commands::WorkspaceScanRegistry::default();
    let scheduler_operations = operations.clone();
    let scheduler_scans = scans.clone();
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(move |app| {
            if let Ok(executable) = std::env::current_exe()
                && let Some(target) = executable.parent()
                && let Err(error) = updates::recover_interrupted_update(target)
            {
                updates::record_recovery_error(target, &error);
            }
            let cache_path = app
                .path()
                .app_config_dir()
                .map_err(|error| std::io::Error::other(error.to_string()))?
                .join("workspace-scan-cache-v1.gz");
            app.manage(commands::WorkspaceScanScheduler::new(
                scheduler_scans.clone(),
                scheduler_operations.clone(),
                workspace_scan_cache::WorkspaceScanCacheStore::new(cache_path),
            ));
            if let (Some(window), Some(path)) =
                (app.get_webview_window("main"), settings_path(app.handle()))
                && let Ok(settings) = settings::load(&path)
                && let Some(state) = settings.window_state.as_ref()
            {
                restore_main_window(&window, state);
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() == "main"
                && matches!(
                    event,
                    WindowEvent::CloseRequested { .. }
                        | WindowEvent::Moved(_)
                        | WindowEvent::Resized(_)
                )
            {
                save_main_window_state(window);
            }
        })
        .manage(operations)
        .manage(updates::UpdateCoordinator::default())
        .manage(commands::WorkspaceRootRegistry::default())
        .manage(scans)
        .invoke_handler(tauri::generate_handler![
            commands::detect_p4,
            commands::test_connection,
            commands::open_workspace,
            commands::login,
            commands::begin_auth,
            commands::select_auth_method,
            commands::check_auth,
            commands::login_status,
            commands::logout,
            commands::list_trust,
            commands::inspect_trust,
            commands::confirm_trust,
            commands::load_settings,
            commands::save_language,
            commands::save_theme,
            commands::save_revert_preference,
            commands::load_locales,
            commands::remember_connection,
            commands::toggle_favorite_connection,
            commands::list_workspaces,
            commands::inspect_workspace,
            commands::update_workspace,
            commands::inspect_workspace_mapping_editor,
            commands::preview_workspace_mappings,
            commands::apply_workspace_mappings,
            commands::create_workspace,
            commands::delete_workspace,
            commands::rename_workspace,
            commands::list_streams,
            commands::inspect_stream,
            commands::preview_stream_integration,
            commands::start_stream_integration,
            commands::preview_create_stream,
            commands::create_stream,
            commands::stream_view_paths_from_local_directories,
            commands::switch_stream,
            commands::list_depots,
            commands::list_depot_directories,
            commands::list_depot_files,
            commands::compare_depot_states,
            commands::list_pending_changes,
            commands::list_jobs,
            commands::inspect_job_form,
            commands::save_job,
            commands::list_labels,
            commands::inspect_label,
            commands::create_label,
            commands::update_label,
            commands::delete_label,
            commands::preview_label_tag,
            commands::apply_label_tag,
            commands::list_fixes,
            commands::fix_job,
            commands::unfix_job,
            commands::list_submitted_changes,
            commands::list_submitted_history_page,
            commands::list_submitted_filter_options,
            commands::describe_change,
            commands::preview_undo,
            commands::undo_change,
            commands::preview_cherry_pick,
            commands::cherry_pick_change,
            commands::list_shelved_changes,
            commands::list_opened_files,
            commands::list_workspace_files,
            commands::search_workspace_files,
            commands::map_workspace_paths,
            commands::configure_workspace_scan,
            commands::get_workspace_scan_snapshot,
            commands::refresh_workspace_scan,
            commands::cancel_workspace_scan,
            commands::list_local_workspace_directory,
            commands::ignore_local_file,
            commands::delete_local_file,
            commands::preview_sync,
            commands::preview_sync_at_date,
            commands::repair_sync_have_list,
            commands::start_sync,
            commands::start_submit,
            commands::cancel_operation,
            commands::edit_files,
            commands::add_files,
            commands::delete_files,
            commands::lock_files,
            commands::unlock_files,
            commands::resolve_files,
            commands::resolve_specialized,
            commands::preview_resolve,
            commands::load_resolve_content,
            commands::save_resolve_result,
            commands::move_file,
            commands::reconcile_scope_from_local_directory,
            commands::start_reconcile,
            commands::start_reconcile_preview,
            commands::list_shelved_files,
            commands::reopen_files,
            commands::diff_file,
            commands::file_history,
            commands::file_history_page,
            commands::print_revision,
            commands::save_revision,
            commands::save_change_files,
            commands::save_shelved_file,
            commands::save_shelved_files,
            commands::diff_revisions,
            commands::diff_revision_workspace,
            commands::annotate_file,
            commands::diff_shelved_file,
            commands::submit_preflight,
            commands::shelve_file,
            commands::preview_unshelve,
            commands::unshelve_files,
            commands::reshelve_files,
            commands::delete_shelf_files,
            commands::revert_files,
            commands::preview_revert_unchanged,
            commands::preview_revert_all,
            commands::preview_revert_selected,
            commands::revert_unchanged,
            commands::edit_change,
            commands::preview_change_identity,
            commands::update_change_identity,
            commands::delete_change,
            commands::create_change,
            commands::list_cli_log,
            commands::clear_cli_log,
            commands::ui_snapshot_enabled,
            commands::write_ui_snapshot,
            commands::read_ui_agent_command,
            commands::write_ui_agent_response,
            commands::reveal_path,
            updates::check_for_update,
            updates::install_update,
            updates::cancel_update,
            updates::take_update_diagnostic
        ])
        .run(tauri::generate_context!())
        .expect("failed to run P4FNV");
}
