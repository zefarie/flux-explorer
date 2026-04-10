#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use base64::Engine;
use exif;
use image::imageops::FilterType;
use notify::RecursiveMode;
use notify_debouncer_mini::{new_debouncer, Debouncer, notify::RecommendedWatcher};
use serde::Serialize;
use std::fs;
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::io::{BufRead, BufReader, Cursor, Write as IoWrite};
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;
use std::time::{Duration, Instant, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager};

#[derive(Serialize, Clone)]
struct FileEntry {
    name: String,
    path: String,
    is_dir: bool,
    is_hidden: bool,
    is_symlink: bool,
    size: u64,
    modified: i64,
    extension: String,
    permissions: String,
}

#[derive(Serialize)]
struct DiskInfo {
    total: u64,
    available: u64,
    used: u64,
}

#[derive(Serialize)]
struct QuickAccess {
    name: String,
    path: String,
    icon: String,
}

struct WatcherState {
    watcher: Option<Debouncer<RecommendedWatcher>>,
    watched_path: Option<String>,
}

#[tauri::command]
async fn list_directory(path: String, show_hidden: bool) -> Result<Vec<FileEntry>, String> {
    tokio::task::spawn_blocking(move || list_directory_sync(path, show_hidden))
        .await
        .map_err(|e| e.to_string())?
}

fn list_directory_sync(path: String, show_hidden: bool) -> Result<Vec<FileEntry>, String> {
    let dir_path = Path::new(&path);
    if !dir_path.exists() {
        return Err(format!("Path does not exist: {}", path));
    }
    if !dir_path.is_dir() {
        return Err(format!("Not a directory: {}", path));
    }

    let mut entries: Vec<FileEntry> = Vec::new();
    let read_dir = fs::read_dir(dir_path).map_err(|e| format!("Cannot read directory: {}", e))?;

    for entry in read_dir.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        let is_hidden = name.starts_with('.');

        if !show_hidden && is_hidden {
            continue;
        }

        let path_buf = entry.path();
        let metadata = match fs::symlink_metadata(&path_buf) {
            Ok(m) => m,
            Err(_) => continue,
        };

        let is_symlink = metadata.is_symlink();
        let real_metadata = if is_symlink {
            fs::metadata(&path_buf).unwrap_or(metadata.clone())
        } else {
            metadata.clone()
        };

        let modified = metadata
            .modified()
            .ok()
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0);

        let extension = path_buf
            .extension()
            .map(|e| e.to_string_lossy().to_lowercase())
            .unwrap_or_default();

        let permissions = format_permissions(metadata.permissions().mode());

        entries.push(FileEntry {
            name,
            path: path_buf.to_string_lossy().to_string(),
            is_dir: real_metadata.is_dir(),
            is_hidden,
            is_symlink,
            size: if real_metadata.is_dir() { 0 } else { real_metadata.len() },
            modified,
            extension,
            permissions,
        });
    }

    // Sort: directories first, then alphabetically (case-insensitive)
    entries.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });

    Ok(entries)
}

#[tauri::command]
fn get_quick_access() -> Vec<QuickAccess> {
    let home = dirs_home();
    let desktop = format!("{}/Desktop", home);
    let documents = format!("{}/Documents", home);
    let pictures = format!("{}/Pictures", home);
    let music = format!("{}/Music", home);
    let videos = format!("{}/Videos", home);

    // Prefer Téléchargements over Downloads (avoid duplicates from symlinks)
    let telechargements = format!("{}/Téléchargements", home);
    let downloads = format!("{}/Downloads", home);
    let dl_path = if Path::new(&telechargements).exists() {
        &telechargements
    } else {
        &downloads
    };

    let prism = format!("{}/.local/share/PrismLauncher/instances", home);

    let dirs: Vec<(&str, &str, &str)> = vec![
        ("Accueil", &home, "home"),
        ("Bureau", &desktop, "desktop"),
        ("Documents", &documents, "documents"),
        ("T\u{00e9}l\u{00e9}chargements", dl_path, "downloads"),
        ("Images", &pictures, "images"),
        ("Musique", &music, "music"),
        ("Vid\u{00e9}os", &videos, "videos"),
        ("Prism Launcher", &prism, "gaming"),
    ];

    dirs.into_iter()
        .filter(|(_, path, _)| Path::new(path).exists())
        .map(|(name, path, icon)| QuickAccess {
            name: name.to_string(),
            path: path.to_string(),
            icon: icon.to_string(),
        })
        .collect()
}

#[tauri::command]
fn get_home() -> String {
    dirs_home()
}

#[tauri::command]
fn create_folder(path: String, name: String) -> Result<String, String> {
    let full_path = PathBuf::from(&path).join(&name);
    fs::create_dir_all(&full_path).map_err(|e| format!("Cannot create folder: {}", e))?;
    Ok(full_path.to_string_lossy().to_string())
}

#[tauri::command]
fn create_file(path: String, name: String) -> Result<String, String> {
    let full_path = PathBuf::from(&path).join(&name);
    fs::File::create(&full_path).map_err(|e| format!("Cannot create file: {}", e))?;
    Ok(full_path.to_string_lossy().to_string())
}

#[tauri::command]
fn rename_item(path: String, new_name: String) -> Result<String, String> {
    let old_path = PathBuf::from(&path);
    let parent = old_path
        .parent()
        .ok_or_else(|| "Cannot get parent directory".to_string())?;
    let new_path = parent.join(&new_name);

    if new_path.exists() {
        return Err(format!("'{}' already exists", new_name));
    }

    fs::rename(&old_path, &new_path).map_err(|e| format!("Cannot rename: {}", e))?;
    Ok(new_path.to_string_lossy().to_string())
}

#[tauri::command]
async fn delete_items(paths: Vec<String>) -> Result<(), String> {
    tokio::task::spawn_blocking(move || delete_items_sync(paths))
        .await
        .map_err(|e| e.to_string())?
}

fn delete_items_sync(paths: Vec<String>) -> Result<(), String> {
    for path in &paths {
        let p = Path::new(path);
        if !p.exists() {
            continue;
        }
        // Try trash first, fallback to permanent delete
        if trash::delete(p).is_err() {
            if p.is_dir() {
                fs::remove_dir_all(p).map_err(|e| format!("Cannot delete {}: {}", path, e))?;
            } else {
                fs::remove_file(p).map_err(|e| format!("Cannot delete {}: {}", path, e))?;
            }
        }
    }
    Ok(())
}

// Cancellation flag for in-progress operations
static OPERATION_CANCEL: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

#[tauri::command]
fn cancel_operation() {
    OPERATION_CANCEL.store(true, std::sync::atomic::Ordering::SeqCst);
}

#[derive(Serialize, Clone)]
struct ProgressUpdate {
    operation_id: String,
    current_file: String,
    bytes_done: u64,
    bytes_total: u64,
    files_done: u64,
    files_total: u64,
}

fn count_total_size(sources: &[String]) -> (u64, u64) {
    let mut size = 0u64;
    let mut count = 0u64;
    for src in sources {
        let p = Path::new(src);
        if let Ok(meta) = fs::symlink_metadata(p) {
            if meta.is_dir() && !meta.is_symlink() {
                count_dir_size(p, &mut size, &mut count);
            } else {
                size += meta.len();
                count += 1;
            }
        }
    }
    (size, count)
}

fn count_dir_size(path: &Path, size: &mut u64, count: &mut u64) {
    if let Ok(entries) = fs::read_dir(path) {
        for entry in entries.flatten() {
            let p = entry.path();
            if let Ok(meta) = fs::symlink_metadata(&p) {
                if meta.is_dir() && !meta.is_symlink() {
                    count_dir_size(&p, size, count);
                } else {
                    *size += meta.len();
                    *count += 1;
                }
            }
        }
    }
}

#[tauri::command]
async fn copy_items_progress(
    sources: Vec<String>,
    destination: String,
    operation_id: String,
    app: AppHandle,
) -> Result<(), String> {
    OPERATION_CANCEL.store(false, std::sync::atomic::Ordering::SeqCst);
    tokio::task::spawn_blocking(move || copy_items_progress_sync(sources, destination, operation_id, app))
        .await
        .map_err(|e| e.to_string())?
}

fn copy_items_progress_sync(
    sources: Vec<String>,
    destination: String,
    operation_id: String,
    app: AppHandle,
) -> Result<(), String> {
    let dest = PathBuf::from(&destination);
    if !dest.is_dir() {
        return Err(format!("Destination is not a directory: {}", destination));
    }

    let (total_bytes, total_files) = count_total_size(&sources);
    let mut bytes_done = 0u64;
    let mut files_done = 0u64;

    for src in &sources {
        if OPERATION_CANCEL.load(std::sync::atomic::Ordering::SeqCst) {
            return Err("Annule".to_string());
        }
        let src_path = Path::new(src);
        let file_name = src_path.file_name().ok_or_else(|| "Invalid path".to_string())?;
        let target = dest.join(file_name);
        let target = unique_path(&target);
        if src_path.is_dir() {
            copy_dir_progress(src_path, &target, &operation_id, &app, &mut bytes_done, &mut files_done, total_bytes, total_files)?;
        } else {
            copy_file_progress(src_path, &target, &operation_id, &app, &mut bytes_done, &mut files_done, total_bytes, total_files)?;
        }
    }
    Ok(())
}

fn emit_progress(
    app: &AppHandle,
    operation_id: &str,
    current_file: &str,
    bytes_done: u64,
    bytes_total: u64,
    files_done: u64,
    files_total: u64,
) {
    let _ = app.emit("copy-progress", ProgressUpdate {
        operation_id: operation_id.to_string(),
        current_file: current_file.to_string(),
        bytes_done,
        bytes_total,
        files_done,
        files_total,
    });
}

fn copy_file_progress(
    src: &Path,
    dst: &Path,
    operation_id: &str,
    app: &AppHandle,
    bytes_done: &mut u64,
    files_done: &mut u64,
    total_bytes: u64,
    total_files: u64,
) -> Result<(), String> {
    use std::io::{Read, Write};
    let name = src.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
    emit_progress(app, operation_id, &name, *bytes_done, total_bytes, *files_done, total_files);

    let mut input = fs::File::open(src).map_err(|e| format!("Open {}: {}", src.display(), e))?;
    let mut output = fs::File::create(dst).map_err(|e| format!("Create {}: {}", dst.display(), e))?;
    let mut buf = vec![0u8; 64 * 1024];
    let mut last_emit = Instant::now();

    loop {
        if OPERATION_CANCEL.load(std::sync::atomic::Ordering::SeqCst) {
            let _ = fs::remove_file(dst);
            return Err("Annule".to_string());
        }
        let n = input.read(&mut buf).map_err(|e| format!("Read: {}", e))?;
        if n == 0 { break; }
        output.write_all(&buf[..n]).map_err(|e| format!("Write: {}", e))?;
        *bytes_done += n as u64;

        if last_emit.elapsed() >= Duration::from_millis(100) {
            emit_progress(app, operation_id, &name, *bytes_done, total_bytes, *files_done, total_files);
            last_emit = Instant::now();
        }
    }
    *files_done += 1;
    Ok(())
}

fn copy_dir_progress(
    src: &Path,
    dst: &Path,
    operation_id: &str,
    app: &AppHandle,
    bytes_done: &mut u64,
    files_done: &mut u64,
    total_bytes: u64,
    total_files: u64,
) -> Result<(), String> {
    fs::create_dir_all(dst).map_err(|e| format!("Cannot create dir: {}", e))?;
    for entry in fs::read_dir(src).map_err(|e| format!("Cannot read dir: {}", e))? {
        if OPERATION_CANCEL.load(std::sync::atomic::Ordering::SeqCst) {
            return Err("Annule".to_string());
        }
        let entry = entry.map_err(|e| format!("Read error: {}", e))?;
        let src_child = entry.path();
        let dst_child = dst.join(entry.file_name());
        if src_child.is_dir() {
            copy_dir_progress(&src_child, &dst_child, operation_id, app, bytes_done, files_done, total_bytes, total_files)?;
        } else {
            copy_file_progress(&src_child, &dst_child, operation_id, app, bytes_done, files_done, total_bytes, total_files)?;
        }
    }
    Ok(())
}

#[tauri::command]
async fn copy_items(sources: Vec<String>, destination: String) -> Result<(), String> {
    tokio::task::spawn_blocking(move || copy_items_sync(sources, destination))
        .await
        .map_err(|e| e.to_string())?
}

fn copy_items_sync(sources: Vec<String>, destination: String) -> Result<(), String> {
    let dest = PathBuf::from(&destination);
    if !dest.is_dir() {
        return Err(format!("Destination is not a directory: {}", destination));
    }
    for src in &sources {
        let src_path = Path::new(src);
        let file_name = src_path.file_name().ok_or_else(|| "Invalid path".to_string())?;
        let target = dest.join(file_name);
        let target = unique_path(&target);
        if src_path.is_dir() {
            copy_dir_recursive(src_path, &target)?;
        } else {
            fs::copy(src_path, &target).map_err(|e| format!("Cannot copy {}: {}", src, e))?;
        }
    }
    Ok(())
}

#[tauri::command]
async fn move_items(sources: Vec<String>, destination: String) -> Result<(), String> {
    tokio::task::spawn_blocking(move || move_items_sync(sources, destination))
        .await
        .map_err(|e| e.to_string())?
}

fn move_items_sync(sources: Vec<String>, destination: String) -> Result<(), String> {
    let dest = PathBuf::from(&destination);
    if !dest.is_dir() {
        return Err(format!("Destination is not a directory: {}", destination));
    }
    for src in &sources {
        let src_path = Path::new(src);
        let file_name = src_path.file_name().ok_or_else(|| "Invalid path".to_string())?;
        let target = dest.join(file_name);
        let target = unique_path(&target);
        // Try rename first (same filesystem = instant), fallback to copy+delete
        if fs::rename(src_path, &target).is_err() {
            if src_path.is_dir() {
                copy_dir_recursive(src_path, &target)?;
                fs::remove_dir_all(src_path)
                    .map_err(|e| format!("Cannot remove source {}: {}", src, e))?;
            } else {
                fs::copy(src_path, &target)
                    .map_err(|e| format!("Cannot copy {}: {}", src, e))?;
                fs::remove_file(src_path)
                    .map_err(|e| format!("Cannot remove source {}: {}", src, e))?;
            }
        }
    }
    Ok(())
}

fn copy_dir_recursive(src: &Path, dst: &Path) -> Result<(), String> {
    fs::create_dir_all(dst).map_err(|e| format!("Cannot create dir: {}", e))?;
    for entry in fs::read_dir(src).map_err(|e| format!("Cannot read dir: {}", e))? {
        let entry = entry.map_err(|e| format!("Read error: {}", e))?;
        let src_child = entry.path();
        let dst_child = dst.join(entry.file_name());
        if src_child.is_dir() {
            copy_dir_recursive(&src_child, &dst_child)?;
        } else {
            fs::copy(&src_child, &dst_child)
                .map_err(|e| format!("Cannot copy: {}", e))?;
        }
    }
    Ok(())
}

fn unique_path(path: &Path) -> PathBuf {
    if !path.exists() {
        return path.to_path_buf();
    }
    let stem = path.file_stem().unwrap_or_default().to_string_lossy().to_string();
    let ext = path.extension().map(|e| format!(".{}", e.to_string_lossy())).unwrap_or_default();
    let parent = path.parent().unwrap_or(Path::new("/"));
    let mut i = 1;
    loop {
        let candidate = parent.join(format!("{} ({}){}", stem, i, ext));
        if !candidate.exists() {
            return candidate;
        }
        i += 1;
    }
}

#[tauri::command]
fn autocomplete_path(partial: String) -> Vec<String> {
    let path = Path::new(&partial);

    // If partial ends with '/', list contents of that directory
    if partial.ends_with('/') && path.is_dir() {
        return match fs::read_dir(path) {
            Ok(entries) => {
                let mut results: Vec<String> = entries
                    .flatten()
                    .map(|e| {
                        let p = e.path();
                        if p.is_dir() {
                            format!("{}/", p.to_string_lossy())
                        } else {
                            p.to_string_lossy().to_string()
                        }
                    })
                    .collect();
                results.sort_by(|a, b| {
                    let a_dir = a.ends_with('/');
                    let b_dir = b.ends_with('/');
                    b_dir.cmp(&a_dir).then_with(|| a.to_lowercase().cmp(&b.to_lowercase()))
                });
                results.into_iter().take(20).collect()
            }
            Err(_) => Vec::new(),
        };
    }

    // Otherwise, get parent dir and match prefix
    let parent = path.parent().unwrap_or(Path::new("/"));
    let prefix = path
        .file_name()
        .map(|f| f.to_string_lossy().to_lowercase())
        .unwrap_or_default();

    match fs::read_dir(parent) {
        Ok(entries) => {
            let mut results: Vec<String> = entries
                .flatten()
                .filter(|e| {
                    e.file_name()
                        .to_string_lossy()
                        .to_lowercase()
                        .starts_with(&prefix)
                })
                .map(|e| {
                    let p = e.path();
                    if p.is_dir() {
                        format!("{}/", p.to_string_lossy())
                    } else {
                        p.to_string_lossy().to_string()
                    }
                })
                .collect();
            results.sort_by(|a, b| {
                let a_dir = a.ends_with('/');
                let b_dir = b.ends_with('/');
                b_dir.cmp(&a_dir).then_with(|| a.to_lowercase().cmp(&b.to_lowercase()))
            });
            results.into_iter().take(20).collect()
        }
        Err(_) => Vec::new(),
    }
}

#[tauri::command]
fn read_text_preview(path: String, max_lines: u32) -> Result<String, String> {
    let file = fs::File::open(&path).map_err(|e| format!("Cannot open file: {}", e))?;
    let reader = BufReader::new(file);
    let mut lines = Vec::new();
    for line in reader.lines().take(max_lines as usize) {
        match line {
            Ok(l) => lines.push(l),
            Err(_) => return Err("Binary file".to_string()),
        }
    }
    Ok(lines.join("\n"))
}

#[tauri::command]
fn open_file(path: String) -> Result<(), String> {
    Command::new("xdg-open")
        .arg(&path)
        .spawn()
        .map_err(|e| format!("Cannot open file: {}", e))?;
    Ok(())
}

#[tauri::command]
fn open_terminal(path: String) -> Result<(), String> {
    // Detect terminal from environment, fallback to common ones
    let terminal = std::env::var("TERMINAL").ok();
    let candidates = ["alacritty", "kitty", "foot", "wezterm", "ghostty", "xterm"];

    let term = terminal.as_deref().unwrap_or_else(|| {
        candidates.iter()
            .find(|t| which(t))
            .copied()
            .unwrap_or("xterm")
    });

    let mut cmd = Command::new(term);
    match term {
        "alacritty" => { cmd.arg("--working-directory").arg(&path); }
        "kitty" => { cmd.arg("--directory").arg(&path); }
        "foot" => { cmd.arg("--working-directory").arg(&path); }
        "wezterm" => { cmd.arg("start").arg("--cwd").arg(&path); }
        "ghostty" => { cmd.arg(format!("--working-directory={}", path)); }
        _ => { cmd.current_dir(&path); }
    }

    cmd.spawn().map_err(|e| format!("Cannot open terminal '{}': {}", term, e))?;
    Ok(())
}

fn which(name: &str) -> bool {
    Command::new("which").arg(name).output().map(|o| o.status.success()).unwrap_or(false)
}

#[tauri::command]
fn get_parent(path: String) -> Option<String> {
    Path::new(&path)
        .parent()
        .map(|p| p.to_string_lossy().to_string())
}

#[tauri::command]
async fn search_files(
    path: String,
    query: String,
    show_hidden: bool,
    max_depth: Option<usize>,
    max_results: Option<usize>,
    search_content: Option<bool>,
) -> Result<Vec<FileEntry>, String> {
    tokio::task::spawn_blocking(move || search_files_sync(path, query, show_hidden, max_depth, max_results, search_content))
        .await
        .map_err(|e| e.to_string())?
}

fn search_files_sync(
    path: String,
    query: String,
    show_hidden: bool,
    max_depth: Option<usize>,
    max_results: Option<usize>,
    search_content: Option<bool>,
) -> Result<Vec<FileEntry>, String> {
    let mut results = Vec::new();
    let query_lower = query.to_lowercase();
    let depth_limit = max_depth.unwrap_or(10);
    let result_limit = max_results.unwrap_or(500);
    let content = search_content.unwrap_or(false);
    search_recursive(
        Path::new(&path),
        &query_lower,
        show_hidden,
        &mut results,
        0,
        depth_limit,
        result_limit,
        content,
    );
    Ok(results)
}

fn search_recursive(
    dir: &Path,
    query: &str,
    show_hidden: bool,
    results: &mut Vec<FileEntry>,
    depth: usize,
    max_depth: usize,
    max_results: usize,
    search_content: bool,
) {
    if depth > max_depth || results.len() >= max_results {
        return;
    }

    let entries = match fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return,
    };

    for entry in entries.flatten() {
        if results.len() >= max_results {
            return;
        }

        let name = entry.file_name().to_string_lossy().to_string();
        let is_hidden = name.starts_with('.');

        if !show_hidden && is_hidden {
            continue;
        }

        let path_buf = entry.path();
        let metadata = match fs::symlink_metadata(&path_buf) {
            Ok(m) => m,
            Err(_) => continue,
        };

        let name_match = name.to_lowercase().contains(query);

        // Content search for text files
        let content_match = if !name_match && search_content && !metadata.is_dir() && metadata.len() < 1_000_000 {
            file_contains(&path_buf, query)
        } else {
            false
        };

        if name_match || content_match {
            let is_symlink = metadata.is_symlink();
            let real_metadata = if is_symlink {
                fs::metadata(&path_buf).unwrap_or(metadata.clone())
            } else {
                metadata.clone()
            };

            let modified = metadata
                .modified()
                .ok()
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map(|d| d.as_secs() as i64)
                .unwrap_or(0);

            let extension = path_buf
                .extension()
                .map(|e| e.to_string_lossy().to_lowercase())
                .unwrap_or_default();

            let permissions = format_permissions(metadata.permissions().mode());

            results.push(FileEntry {
                name,
                path: path_buf.to_string_lossy().to_string(),
                is_dir: real_metadata.is_dir(),
                is_hidden,
                is_symlink,
                size: if real_metadata.is_dir() { 0 } else { real_metadata.len() },
                modified,
                extension,
                permissions,
            });
        }

        if metadata.is_dir() && !metadata.is_symlink() {
            search_recursive(&path_buf, query, show_hidden, results, depth + 1, max_depth, max_results, search_content);
        }
    }
}

fn file_contains(path: &Path, query: &str) -> bool {
    use std::io::Read;
    // Read up to 256 KB in one go - faster than line-by-line for short files
    let mut file = match fs::File::open(path) {
        Ok(f) => f,
        Err(_) => return false,
    };
    let mut buf = Vec::with_capacity(64 * 1024);
    let cap = 256 * 1024;
    if (&mut file).take(cap as u64).read_to_end(&mut buf).is_err() {
        return false;
    }
    // Reject likely binary content (NUL bytes)
    if buf.contains(&0) {
        return false;
    }
    // Convert to lowercase string lazily
    match std::str::from_utf8(&buf) {
        Ok(s) => s.to_lowercase().contains(query),
        Err(_) => false,
    }
}

fn thumb_cache_dir() -> PathBuf {
    let home = dirs_home();
    PathBuf::from(home).join(".cache").join("flux-explorer").join("thumbs")
}

fn thumb_cache_key(path: &str, size: u32, mtime: i64) -> String {
    let mut hasher = DefaultHasher::new();
    path.hash(&mut hasher);
    size.hash(&mut hasher);
    mtime.hash(&mut hasher);
    format!("{:016x}.jpg", hasher.finish())
}

fn get_mtime(path: &str) -> i64 {
    fs::metadata(path)
        .ok()
        .and_then(|m| m.modified().ok())
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

fn read_cached_thumb(path: &str, size: u32) -> Option<String> {
    let mtime = get_mtime(path);
    let key = thumb_cache_key(path, size, mtime);
    let cache_path = thumb_cache_dir().join(&key);
    if cache_path.exists() {
        let data = fs::read(&cache_path).ok()?;
        let b64 = base64::engine::general_purpose::STANDARD.encode(&data);
        Some(format!("data:image/jpeg;base64,{}", b64))
    } else {
        None
    }
}

fn write_cached_thumb(path: &str, size: u32, jpeg_data: &[u8]) {
    let mtime = get_mtime(path);
    let key = thumb_cache_key(path, size, mtime);
    let cache_dir = thumb_cache_dir();
    let _ = fs::create_dir_all(&cache_dir);
    let cache_path = cache_dir.join(&key);
    if let Ok(mut f) = fs::File::create(&cache_path) {
        let _ = f.write_all(jpeg_data);
    }
}

#[tauri::command]
fn get_thumbnail(path: String, size: u32) -> Result<String, String> {
    if let Some(cached) = read_cached_thumb(&path, size) {
        return Ok(cached);
    }

    let img = image::open(&path).map_err(|e| format!("Cannot open image: {}", e))?;
    let thumb = img.resize(size, size, FilterType::Triangle);
    let mut buf = Cursor::new(Vec::new());
    thumb
        .write_to(&mut buf, image::ImageFormat::Jpeg)
        .map_err(|e| format!("Cannot encode thumbnail: {}", e))?;
    let jpeg_data = buf.into_inner();

    write_cached_thumb(&path, size, &jpeg_data);

    let b64 = base64::engine::general_purpose::STANDARD.encode(&jpeg_data);
    Ok(format!("data:image/jpeg;base64,{}", b64))
}

#[tauri::command]
fn get_video_thumbnail(path: String, size: u32) -> Result<String, String> {
    if let Some(cached) = read_cached_thumb(&path, size) {
        return Ok(cached);
    }

    let output = Command::new("ffmpeg")
        .args([
            "-ss", "1",
            "-i", &path,
            "-vframes", "1",
            "-vf", &format!("scale={}:{}:force_original_aspect_ratio=decrease", size, size),
            "-f", "image2pipe",
            "-vcodec", "mjpeg",
            "-q:v", "8",
            "pipe:1",
        ])
        .output()
        .map_err(|e| format!("ffmpeg error: {}", e))?;

    if !output.status.success() {
        return Err("ffmpeg failed".to_string());
    }

    write_cached_thumb(&path, size, &output.stdout);

    let b64 = base64::engine::general_purpose::STANDARD.encode(&output.stdout);
    Ok(format!("data:image/jpeg;base64,{}", b64))
}

#[tauri::command]
fn get_pdf_preview(path: String) -> Result<String, String> {
    // Use pdftoppm (poppler-utils) to render first page as JPEG
    let output = Command::new("pdftoppm")
        .args([
            "-jpeg",
            "-f", "1",
            "-l", "1",
            "-r", "150",
            "-singlefile",
            &path,
        ])
        .output()
        .map_err(|e| format!("pdftoppm error: {}", e))?;

    if !output.status.success() {
        return Err("pdftoppm failed - install poppler-utils".to_string());
    }

    let b64 = base64::engine::general_purpose::STANDARD.encode(&output.stdout);
    Ok(format!("data:image/jpeg;base64,{}", b64))
}

#[derive(Serialize)]
struct FileProperties {
    name: String,
    path: String,
    is_dir: bool,
    is_symlink: bool,
    size: u64,
    permissions: String,
    owner: String,
    group: String,
    created: i64,
    modified: i64,
    accessed: i64,
    mime_type: String,
    file_count: Option<u64>,
    dir_count: Option<u64>,
}

#[tauri::command]
async fn get_file_properties(path: String) -> Result<FileProperties, String> {
    tokio::task::spawn_blocking(move || get_file_properties_sync(path))
        .await
        .map_err(|e| e.to_string())?
}

fn get_file_properties_sync(path: String) -> Result<FileProperties, String> {
    let p = Path::new(&path);
    let metadata = fs::symlink_metadata(p).map_err(|e| format!("Cannot read metadata: {}", e))?;
    let real_metadata = if metadata.is_symlink() {
        fs::metadata(p).unwrap_or(metadata.clone())
    } else {
        metadata.clone()
    };

    let is_dir = real_metadata.is_dir();
    let name = p.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_else(|| path.clone());

    // Owner/group via libc
    use std::os::unix::fs::MetadataExt;
    let uid = metadata.uid();
    let gid = metadata.gid();

    let owner = unsafe {
        let pw = libc::getpwuid(uid);
        if pw.is_null() {
            uid.to_string()
        } else {
            std::ffi::CStr::from_ptr((*pw).pw_name).to_string_lossy().to_string()
        }
    };

    let group = unsafe {
        let gr = libc::getgrgid(gid);
        if gr.is_null() {
            gid.to_string()
        } else {
            std::ffi::CStr::from_ptr((*gr).gr_name).to_string_lossy().to_string()
        }
    };

    let to_timestamp = |t: std::io::Result<std::time::SystemTime>| -> i64 {
        t.ok()
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0)
    };

    let created = to_timestamp(metadata.created());
    let modified = to_timestamp(metadata.modified());
    let accessed = to_timestamp(metadata.accessed());

    let permissions = format_permissions(metadata.permissions().mode());

    // Size: recursive for directories
    let size = if is_dir {
        dir_size(p)
    } else {
        real_metadata.len()
    };

    // MIME type from extension
    let ext = p.extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default();
    let mime_type = guess_mime(&ext, is_dir);

    // File/dir count for directories
    let (file_count, dir_count) = if is_dir {
        let (f, d) = count_contents(p);
        (Some(f), Some(d))
    } else {
        (None, None)
    };

    Ok(FileProperties {
        name,
        path,
        is_dir,
        is_symlink: metadata.is_symlink(),
        size,
        permissions,
        owner,
        group,
        created,
        modified,
        accessed,
        mime_type,
        file_count,
        dir_count,
    })
}

const DIR_SIZE_MAX_DEPTH: usize = 12;
const DIR_SIZE_MAX_ENTRIES: u64 = 50_000;

fn dir_size(path: &Path) -> u64 {
    let mut total = 0u64;
    let mut visited = 0u64;
    let deadline = Instant::now() + Duration::from_secs(5);
    dir_size_recursive(path, &mut total, &mut visited, 0, deadline);
    total
}

fn dir_size_recursive(path: &Path, total: &mut u64, visited: &mut u64, depth: usize, deadline: Instant) {
    if depth > DIR_SIZE_MAX_DEPTH || *visited >= DIR_SIZE_MAX_ENTRIES || Instant::now() > deadline {
        return;
    }
    if let Ok(entries) = fs::read_dir(path) {
        for entry in entries.flatten() {
            *visited += 1;
            if *visited >= DIR_SIZE_MAX_ENTRIES || Instant::now() > deadline {
                return;
            }
            let p = entry.path();
            let meta = match fs::symlink_metadata(&p) {
                Ok(m) => m,
                Err(_) => continue,
            };
            if meta.is_dir() && !meta.is_symlink() {
                dir_size_recursive(&p, total, visited, depth + 1, deadline);
            } else {
                *total += meta.len();
            }
        }
    }
}

fn count_contents(path: &Path) -> (u64, u64) {
    let mut files = 0u64;
    let mut dirs = 0u64;
    if let Ok(entries) = fs::read_dir(path) {
        for entry in entries.flatten() {
            let meta = match fs::symlink_metadata(entry.path()) {
                Ok(m) => m,
                Err(_) => continue,
            };
            if meta.is_dir() {
                dirs += 1;
            } else {
                files += 1;
            }
        }
    }
    (files, dirs)
}

fn guess_mime(ext: &str, is_dir: bool) -> String {
    if is_dir { return "inode/directory".to_string(); }
    match ext {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "bmp" => "image/bmp",
        "ico" => "image/x-icon",
        "mp4" => "video/mp4",
        "mkv" => "video/x-matroska",
        "avi" => "video/x-msvideo",
        "mov" => "video/quicktime",
        "webm" => "video/webm",
        "mp3" => "audio/mpeg",
        "flac" => "audio/flac",
        "wav" => "audio/wav",
        "ogg" => "audio/ogg",
        "pdf" => "application/pdf",
        "zip" => "application/zip",
        "tar" => "application/x-tar",
        "gz" => "application/gzip",
        "js" => "text/javascript",
        "ts" => "text/typescript",
        "json" => "application/json",
        "html" => "text/html",
        "css" => "text/css",
        "py" => "text/x-python",
        "rs" => "text/x-rust",
        "go" => "text/x-go",
        "txt" | "md" | "log" | "cfg" | "conf" | "ini" => "text/plain",
        "sh" | "bash" | "zsh" => "text/x-shellscript",
        _ => "application/octet-stream",
    }.to_string()
}

// ============================================
// TRASH
// ============================================

#[derive(Serialize)]
struct TrashItem {
    id: String,
    name: String,
    original_path: String,
    deleted_at: i64,
    size: u64,
}

#[tauri::command]
fn list_trash() -> Result<Vec<TrashItem>, String> {
    use trash::os_limited;
    let items = os_limited::list().map_err(|e| format!("Cannot list trash: {}", e))?;

    let mut result = Vec::new();
    for item in items {
        let size = fs::metadata(item.original_path())
            .map(|m| m.len())
            .unwrap_or(0);
        let name = item.name.to_string_lossy().to_string();
        let original_path = item.original_path().to_string_lossy().to_string();
        let deleted_at = item.time_deleted;
        let id = original_path.clone();

        result.push(TrashItem {
            id,
            name,
            original_path,
            deleted_at,
            size,
        });
    }

    result.sort_by(|a, b| b.deleted_at.cmp(&a.deleted_at));
    Ok(result)
}

#[tauri::command]
fn restore_trash_items(ids: Vec<String>) -> Result<(), String> {
    use trash::os_limited;
    let all = os_limited::list().map_err(|e| e.to_string())?;
    let to_restore: Vec<_> = all.into_iter()
        .filter(|item| ids.contains(&item.original_path().to_string_lossy().to_string()))
        .collect();

    os_limited::restore_all(to_restore).map_err(|e| format!("Restore failed: {}", e))?;
    Ok(())
}

#[tauri::command]
fn purge_trash_items(ids: Vec<String>) -> Result<(), String> {
    use trash::os_limited;
    let all = os_limited::list().map_err(|e| e.to_string())?;
    let to_purge: Vec<_> = all.into_iter()
        .filter(|item| ids.contains(&item.original_path().to_string_lossy().to_string()))
        .collect();

    os_limited::purge_all(to_purge).map_err(|e| format!("Purge failed: {}", e))?;
    Ok(())
}

#[tauri::command]
fn empty_trash() -> Result<(), String> {
    use trash::os_limited;
    let all = os_limited::list().map_err(|e| e.to_string())?;
    os_limited::purge_all(all).map_err(|e| format!("Empty trash failed: {}", e))?;
    Ok(())
}

// ============================================
// OPEN WITH
// ============================================

#[derive(Serialize)]
struct DesktopApp {
    name: String,
    exec: String,
    icon: String,
    desktop_file: String,
}

#[tauri::command]
fn list_applications() -> Result<Vec<DesktopApp>, String> {
    let mut apps = Vec::new();
    let mut seen = std::collections::HashSet::new();

    let dirs = vec![
        "/usr/share/applications".to_string(),
        "/usr/local/share/applications".to_string(),
        format!("{}/.local/share/applications", dirs_home()),
        format!("{}/.local/share/flatpak/exports/share/applications", dirs_home()),
        "/var/lib/flatpak/exports/share/applications".to_string(),
    ];

    for dir in &dirs {
        if let Ok(entries) = fs::read_dir(dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.extension().and_then(|e| e.to_str()) != Some("desktop") { continue; }

                let content = match fs::read_to_string(&path) {
                    Ok(c) => c,
                    Err(_) => continue,
                };

                let mut name = String::new();
                let mut exec = String::new();
                let mut icon = String::new();
                let mut no_display = false;
                let mut hidden = false;
                let mut in_desktop_entry = false;

                for line in content.lines() {
                    let line = line.trim();
                    if line.starts_with('[') {
                        in_desktop_entry = line == "[Desktop Entry]";
                        continue;
                    }
                    if !in_desktop_entry { continue; }

                    if let Some(v) = line.strip_prefix("Name=") { if name.is_empty() { name = v.to_string(); } }
                    else if let Some(v) = line.strip_prefix("Exec=") { exec = v.to_string(); }
                    else if let Some(v) = line.strip_prefix("Icon=") { icon = v.to_string(); }
                    else if line == "NoDisplay=true" { no_display = true; }
                    else if line == "Hidden=true" { hidden = true; }
                }

                if name.is_empty() || exec.is_empty() || no_display || hidden { continue; }
                if !seen.insert(name.clone()) { continue; }

                apps.push(DesktopApp {
                    name,
                    exec,
                    icon,
                    desktop_file: path.to_string_lossy().to_string(),
                });
            }
        }
    }

    apps.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(apps)
}

#[tauri::command]
fn open_with(file_path: String, exec: String) -> Result<(), String> {
    // Strip Exec field codes (%f, %F, %u, %U, etc.)
    let clean = exec
        .replace("%f", "")
        .replace("%F", "")
        .replace("%u", "")
        .replace("%U", "")
        .replace("%i", "")
        .replace("%c", "")
        .replace("%k", "")
        .trim()
        .to_string();

    // Parse command and args
    let parts: Vec<&str> = clean.split_whitespace().collect();
    if parts.is_empty() {
        return Err("Commande vide".to_string());
    }

    let mut cmd = Command::new(parts[0]);
    for arg in &parts[1..] { cmd.arg(arg); }
    cmd.arg(&file_path);
    cmd.spawn().map_err(|e| format!("Cannot launch: {}", e))?;
    Ok(())
}

// ============================================
// BATCH RENAME
// ============================================

#[derive(Serialize)]
struct RenamePreview {
    old_path: String,
    new_name: String,
    conflict: bool,
}

#[tauri::command]
fn batch_rename_preview(
    paths: Vec<String>,
    pattern: String,
    find: String,
    replace: String,
    use_regex: bool,
    case_mode: String,
    start_index: u32,
) -> Result<Vec<RenamePreview>, String> {
    let mut results = Vec::new();
    let regex = if use_regex && !find.is_empty() {
        Some(regex_lite_compile(&find).map_err(|e| format!("Regex invalide: {}", e))?)
    } else {
        None
    };

    for (i, path) in paths.iter().enumerate() {
        let p = Path::new(path);
        let original_name = p.file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();
        let stem = p.file_stem()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();
        let ext = p.extension()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();

        let mut new_stem = stem.clone();

        // Apply find/replace
        if !find.is_empty() {
            if let Some(ref re) = regex {
                new_stem = regex_lite_replace(re, &new_stem, &replace);
            } else {
                new_stem = new_stem.replace(&find, &replace);
            }
        }

        // Apply pattern (supports {n}, {N}, {name}, {ext})
        if !pattern.is_empty() {
            new_stem = pattern.clone()
                .replace("{n}", &(start_index + i as u32).to_string())
                .replace("{N}", &format!("{:03}", start_index + i as u32))
                .replace("{name}", &new_stem)
                .replace("{ext}", &ext);
        }

        // Apply case
        new_stem = match case_mode.as_str() {
            "lower" => new_stem.to_lowercase(),
            "upper" => new_stem.to_uppercase(),
            "title" => title_case(&new_stem),
            _ => new_stem,
        };

        let new_name = if ext.is_empty() {
            new_stem
        } else {
            format!("{}.{}", new_stem, ext)
        };

        let parent = p.parent().unwrap_or(Path::new("/"));
        let conflict = parent.join(&new_name).exists() && new_name != original_name;

        results.push(RenamePreview {
            old_path: path.clone(),
            new_name,
            conflict,
        });
    }

    Ok(results)
}

#[tauri::command]
async fn batch_rename_apply(renames: Vec<(String, String)>) -> Result<Vec<String>, String> {
    tokio::task::spawn_blocking(move || {
        let mut errors = Vec::new();
        for (old_path, new_name) in renames {
            let old = Path::new(&old_path);
            if let Some(parent) = old.parent() {
                let new_path = parent.join(&new_name);
                if let Err(e) = fs::rename(&old, &new_path) {
                    errors.push(format!("{}: {}", old_path, e));
                }
            }
        }
        Ok(errors)
    })
    .await
    .map_err(|e| e.to_string())?
}

fn title_case(s: &str) -> String {
    s.split_whitespace()
        .map(|w| {
            let mut chars = w.chars();
            match chars.next() {
                Some(c) => c.to_uppercase().collect::<String>() + chars.as_str().to_lowercase().as_str(),
                None => String::new(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

// Tiny regex wrapper - we don't need a full regex crate, use simple wildcard matching
fn regex_lite_compile(pattern: &str) -> Result<String, String> {
    // For now, just validate it's not empty
    if pattern.is_empty() { return Err("empty".to_string()); }
    Ok(pattern.to_string())
}

fn regex_lite_replace(pattern: &str, input: &str, replacement: &str) -> String {
    // Simple substring replace for now (regex would need a crate)
    input.replace(pattern, replacement)
}

// ============================================
// MOUNT POINTS
// ============================================

#[derive(Serialize)]
struct MountPoint {
    name: String,
    path: String,
    fs_type: String,
    is_removable: bool,
    total: u64,
    available: u64,
    used: u64,
}

#[tauri::command]
fn get_mount_points() -> Result<Vec<MountPoint>, String> {
    let content = fs::read_to_string("/proc/mounts")
        .map_err(|e| format!("Cannot read /proc/mounts: {}", e))?;

    let home = dirs_home();
    let mut mounts = Vec::new();
    let mut seen_mount = std::collections::HashSet::new();
    let mut seen_device = std::collections::HashSet::new();
    let mut has_root = false;

    for line in content.lines() {
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() < 3 { continue; }

        let device = parts[0];
        let mount_point = parts[1];
        let fs_type = parts[2];

        // Skip pseudo filesystems and irrelevant mounts
        if !device.starts_with('/') { continue; }
        if matches!(fs_type, "proc" | "sysfs" | "tmpfs" | "devtmpfs" | "devpts" | "cgroup" | "cgroup2" | "pstore" | "bpf" | "tracefs" | "debugfs" | "mqueue" | "hugetlbfs" | "configfs" | "fusectl" | "fuse.gvfsd-fuse" | "autofs" | "binfmt_misc" | "rpc_pipefs" | "nfsd" | "squashfs" | "overlay") { continue; }

        // Skip system mount points (typical Linux FHS that users don't browse manually)
        if mount_point.starts_with("/snap/")
            || mount_point.starts_with("/var/")
            || mount_point.starts_with("/run/")
            || mount_point.starts_with("/sys/")
            || mount_point.starts_with("/proc/")
            || mount_point.starts_with("/dev/")
            || mount_point == "/boot"
            || mount_point.starts_with("/boot/")
            || mount_point == "/efi"
            || mount_point.starts_with("/efi/")
            || mount_point == "/root"
            || mount_point.starts_with("/root/")
            || mount_point == "/srv"
            || mount_point.starts_with("/srv/")
            || mount_point == "/tmp"
            || mount_point.starts_with("/tmp/")
        { continue; }

        let is_root = mount_point == "/";
        if is_root {
            if has_root { continue; }
            has_root = true;
        }

        // Dedupe by mount point
        if !seen_mount.insert(mount_point.to_string()) { continue; }

        // Get name (last segment) and detect removable (heuristic: under /mnt, /media, /run/media)
        let is_removable = mount_point.starts_with("/mnt/") || mount_point.starts_with("/media/") || mount_point.starts_with("/run/media/");

        // Dedupe by device for non-removable mounts: if same physical device already shown,
        // skip (handles btrfs subvolumes which appear once per subvol).
        if !is_removable && !seen_device.insert(device.to_string()) { continue; }

        // Skip mounts under home that are not removable (e.g. user-mounted FUSE)
        if !is_removable && !is_root && mount_point.starts_with(&home) {
            continue;
        }

        let name = if mount_point == "/" {
            "Systeme".to_string()
        } else {
            Path::new(mount_point)
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_else(|| mount_point.to_string())
        };

        // Get disk info
        let (total, available, used) = match get_disk_stats(mount_point) {
            Some((t, a)) => (t, a, t.saturating_sub(a)),
            None => (0, 0, 0),
        };

        mounts.push(MountPoint {
            name,
            path: mount_point.to_string(),
            fs_type: fs_type.to_string(),
            is_removable,
            total,
            available,
            used,
        });
    }

    Ok(mounts)
}

fn get_disk_stats(path: &str) -> Option<(u64, u64)> {
    use std::mem::MaybeUninit;
    let c_path = std::ffi::CString::new(path).ok()?;
    let mut stat = MaybeUninit::<libc::statvfs>::uninit();
    let ret = unsafe { libc::statvfs(c_path.as_ptr(), stat.as_mut_ptr()) };
    if ret != 0 { return None; }
    let stat = unsafe { stat.assume_init() };
    let total = stat.f_blocks * stat.f_frsize;
    let available = stat.f_bavail * stat.f_frsize;
    Some((total, available))
}

#[tauri::command]
fn unmount_path(path: String) -> Result<(), String> {
    let status = Command::new("udisksctl")
        .args(["unmount", "-b", &path])
        .status();

    match status {
        Ok(s) if s.success() => Ok(()),
        _ => {
            // Fallback to umount
            let status = Command::new("umount").arg(&path).status();
            match status {
                Ok(s) if s.success() => Ok(()),
                Ok(s) => Err(format!("Demontage echoue (code {})", s.code().unwrap_or(-1))),
                Err(e) => Err(format!("Erreur: {}", e)),
            }
        }
    }
}

// ============================================
// ARCHIVES
// ============================================

fn detect_archive_type(path: &str) -> Option<&'static str> {
    let lower = path.to_lowercase();
    if lower.ends_with(".zip") { Some("zip") }
    else if lower.ends_with(".tar.gz") || lower.ends_with(".tgz") { Some("tar.gz") }
    else if lower.ends_with(".tar.bz2") || lower.ends_with(".tbz2") { Some("tar.bz2") }
    else if lower.ends_with(".tar.xz") || lower.ends_with(".txz") { Some("tar.xz") }
    else if lower.ends_with(".tar.zst") { Some("tar.zst") }
    else if lower.ends_with(".tar") { Some("tar") }
    else if lower.ends_with(".7z") { Some("7z") }
    else if lower.ends_with(".rar") { Some("rar") }
    else if lower.ends_with(".gz") { Some("gz") }
    else if lower.ends_with(".xz") { Some("xz") }
    else if lower.ends_with(".bz2") { Some("bz2") }
    else { None }
}

#[tauri::command]
async fn extract_archive(path: String, destination: String) -> Result<(), String> {
    tokio::task::spawn_blocking(move || extract_archive_sync(path, destination))
        .await
        .map_err(|e| e.to_string())?
}

fn extract_archive_sync(path: String, destination: String) -> Result<(), String> {
    let kind = detect_archive_type(&path).ok_or_else(|| "Format d'archive non supporte".to_string())?;
    fs::create_dir_all(&destination).map_err(|e| format!("Cannot create dest: {}", e))?;

    let status = match kind {
        "zip" => Command::new("unzip").args(["-o", &path, "-d", &destination]).status(),
        "tar" => Command::new("tar").args(["-xf", &path, "-C", &destination]).status(),
        "tar.gz" => Command::new("tar").args(["-xzf", &path, "-C", &destination]).status(),
        "tar.bz2" => Command::new("tar").args(["-xjf", &path, "-C", &destination]).status(),
        "tar.xz" => Command::new("tar").args(["-xJf", &path, "-C", &destination]).status(),
        "tar.zst" => Command::new("tar").args(["--zstd", "-xf", &path, "-C", &destination]).status(),
        "7z" => Command::new("7z").args(["x", &path, &format!("-o{}", destination), "-y"]).status(),
        "rar" => Command::new("unrar").args(["x", "-o+", &path, &destination]).status(),
        "gz" => Command::new("sh").args(["-c", &format!("gunzip -k -c '{}' > '{}/{}'",
            path,
            destination,
            Path::new(&path).file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default()
        )]).status(),
        "xz" => Command::new("sh").args(["-c", &format!("unxz -k -c '{}' > '{}/{}'",
            path,
            destination,
            Path::new(&path).file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default()
        )]).status(),
        "bz2" => Command::new("sh").args(["-c", &format!("bunzip2 -k -c '{}' > '{}/{}'",
            path,
            destination,
            Path::new(&path).file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default()
        )]).status(),
        _ => return Err(format!("Type non supporte: {}", kind)),
    };

    match status {
        Ok(s) if s.success() => Ok(()),
        Ok(s) => Err(format!("L'extraction a echoue (code {})", s.code().unwrap_or(-1))),
        Err(e) => Err(format!("Outil manquant: {}", e)),
    }
}

#[tauri::command]
async fn create_archive(sources: Vec<String>, destination: String, format: String) -> Result<(), String> {
    tokio::task::spawn_blocking(move || create_archive_sync(sources, destination, format))
        .await
        .map_err(|e| e.to_string())?
}

fn create_archive_sync(sources: Vec<String>, destination: String, format: String) -> Result<(), String> {
    if sources.is_empty() {
        return Err("Aucun fichier selectionne".to_string());
    }

    // Get common parent directory and relative names
    let first = Path::new(&sources[0]);
    let parent = first.parent().ok_or_else(|| "Invalid source path".to_string())?;
    let names: Vec<String> = sources.iter()
        .filter_map(|s| Path::new(s).file_name().map(|n| n.to_string_lossy().to_string()))
        .collect();

    let status = match format.as_str() {
        "zip" => {
            let mut cmd = Command::new("zip");
            cmd.arg("-r").arg(&destination);
            for n in &names { cmd.arg(n); }
            cmd.current_dir(parent).status()
        }
        "tar.gz" => {
            let mut cmd = Command::new("tar");
            cmd.arg("-czf").arg(&destination);
            for n in &names { cmd.arg(n); }
            cmd.current_dir(parent).status()
        }
        "tar.xz" => {
            let mut cmd = Command::new("tar");
            cmd.arg("-cJf").arg(&destination);
            for n in &names { cmd.arg(n); }
            cmd.current_dir(parent).status()
        }
        "7z" => {
            let mut cmd = Command::new("7z");
            cmd.arg("a").arg(&destination);
            for n in &names { cmd.arg(n); }
            cmd.current_dir(parent).status()
        }
        _ => return Err(format!("Format non supporte: {}", format)),
    };

    match status {
        Ok(s) if s.success() => Ok(()),
        Ok(s) => Err(format!("La creation a echoue (code {})", s.code().unwrap_or(-1))),
        Err(e) => Err(format!("Outil manquant: {}", e)),
    }
}

#[tauri::command]
fn is_archive(path: String) -> bool {
    detect_archive_type(&path).is_some()
}

const PERM_FLAGS: &[(u32, char)] = &[
    (0o400, 'r'), (0o200, 'w'), (0o100, 'x'),
    (0o040, 'r'), (0o020, 'w'), (0o010, 'x'),
    (0o004, 'r'), (0o002, 'w'), (0o001, 'x'),
];

fn format_permissions(mode: u32) -> String {
    PERM_FLAGS.iter().map(|(bit, ch)| if mode & bit != 0 { *ch } else { '-' }).collect()
}

fn dirs_home() -> String {
    std::env::var("HOME").unwrap_or_else(|_| "/home".to_string())
}

#[derive(Serialize)]
struct ExifData {
    tags: Vec<(String, String)>,
}

#[tauri::command]
fn get_exif(path: String) -> Result<ExifData, String> {
    let file = fs::File::open(&path).map_err(|e| format!("Cannot open: {}", e))?;
    let mut bufreader = std::io::BufReader::new(&file);
    let exifreader = exif::Reader::new();
    let exif = exifreader.read_from_container(&mut bufreader)
        .map_err(|e| format!("No EXIF data: {}", e))?;

    let mut tags = Vec::new();
    let interesting = [
        ("Date prise", exif::Tag::DateTimeOriginal),
        ("Appareil", exif::Tag::Model),
        ("Marque", exif::Tag::Make),
        ("Objectif", exif::Tag::LensModel),
        ("Focale", exif::Tag::FocalLength),
        ("Ouverture", exif::Tag::FNumber),
        ("Vitesse", exif::Tag::ExposureTime),
        ("ISO", exif::Tag::PhotographicSensitivity),
        ("Largeur", exif::Tag::PixelXDimension),
        ("Hauteur", exif::Tag::PixelYDimension),
        ("Orientation", exif::Tag::Orientation),
        ("Flash", exif::Tag::Flash),
        ("Logiciel", exif::Tag::Software),
        ("Latitude", exif::Tag::GPSLatitude),
        ("Longitude", exif::Tag::GPSLongitude),
    ];

    for (label, tag) in &interesting {
        if let Some(field) = exif.get_field(*tag, exif::In::PRIMARY) {
            let value = field.display_value().with_unit(&exif).to_string();
            if !value.is_empty() {
                tags.push((label.to_string(), value));
            }
        }
    }

    Ok(ExifData { tags })
}

#[derive(Serialize)]
struct FileHashes {
    md5: String,
    sha1: String,
    sha256: String,
}

#[tauri::command]
async fn compute_hashes(path: String) -> Result<FileHashes, String> {
    tokio::task::spawn_blocking(move || {
        use md5::{Md5, Digest as Md5Digest};
        use sha1::Sha1;
        use sha2::Sha256;

        let mut file = fs::File::open(&path).map_err(|e| format!("Cannot open: {}", e))?;
        let mut md5 = Md5::new();
        let mut sha1 = Sha1::new();
        let mut sha256 = Sha256::new();
        let mut buf = vec![0u8; 64 * 1024];

        loop {
            use std::io::Read;
            let n = file.read(&mut buf).map_err(|e| format!("Read: {}", e))?;
            if n == 0 { break; }
            md5.update(&buf[..n]);
            sha1.update(&buf[..n]);
            sha256.update(&buf[..n]);
        }

        Ok(FileHashes {
            md5: format!("{:x}", md5.finalize()),
            sha1: format!("{:x}", sha1.finalize()),
            sha256: format!("{:x}", sha256.finalize()),
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[derive(Serialize)]
struct GitStatus {
    is_repo: bool,
    branch: String,
    statuses: std::collections::HashMap<String, String>,
}

#[tauri::command]
fn get_git_status(path: String) -> Result<GitStatus, String> {
    // Find the git root by walking up
    let mut current = PathBuf::from(&path);
    let mut git_root = None;
    loop {
        if current.join(".git").exists() {
            git_root = Some(current.clone());
            break;
        }
        if !current.pop() { break; }
    }

    let root = match git_root {
        Some(r) => r,
        None => return Ok(GitStatus { is_repo: false, branch: String::new(), statuses: Default::default() }),
    };

    // Get branch
    let branch = Command::new("git")
        .args(["-C", &root.to_string_lossy(), "branch", "--show-current"])
        .output()
        .ok()
        .and_then(|o| if o.status.success() { String::from_utf8(o.stdout).ok() } else { None })
        .map(|s| s.trim().to_string())
        .unwrap_or_default();

    // Get statuses (porcelain v1)
    let output = Command::new("git")
        .args(["-C", &root.to_string_lossy(), "status", "--porcelain", "--ignored"])
        .output()
        .map_err(|e| format!("git status failed: {}", e))?;

    if !output.status.success() {
        return Ok(GitStatus { is_repo: true, branch, statuses: Default::default() });
    }

    let mut statuses = std::collections::HashMap::new();
    let raw = String::from_utf8_lossy(&output.stdout);

    for line in raw.lines() {
        if line.len() < 4 { continue; }
        let xy = &line[..2];
        let file = &line[3..];

        let status = match xy {
            "!!" => "ignored",
            "??" => "untracked",
            s if s.starts_with('M') || s.starts_with('A') || s.starts_with('R') || s.starts_with('C') => "staged",
            s if s.contains('M') || s.contains('D') => "modified",
            _ => "modified",
        };

        // Convert file path to absolute
        let abs_path = root.join(file);
        statuses.insert(abs_path.to_string_lossy().to_string(), status.to_string());

        // Also mark all parent dirs of modified files (so dirs containing changes are highlighted)
        if !matches!(status, "ignored") {
            let mut p = abs_path.parent().map(|p| p.to_path_buf());
            while let Some(parent) = p {
                if parent == root || parent.starts_with(&root) {
                    let key = parent.to_string_lossy().to_string();
                    if !statuses.contains_key(&key) {
                        statuses.insert(key, "modified".to_string());
                    }
                    if parent == root { break; }
                    p = parent.parent().map(|p| p.to_path_buf());
                } else {
                    break;
                }
            }
        }
    }

    Ok(GitStatus { is_repo: true, branch, statuses })
}

#[derive(Serialize)]
struct DuplicateGroup {
    hash: String,
    size: u64,
    paths: Vec<String>,
}

#[tauri::command]
async fn find_duplicates(path: String) -> Result<Vec<DuplicateGroup>, String> {
    tokio::task::spawn_blocking(move || {
        use sha2::{Sha256, Digest};
        use std::collections::HashMap;
        use std::io::Read;

        // Step 1: collect all files with their sizes
        let mut by_size: HashMap<u64, Vec<PathBuf>> = HashMap::new();
        let mut stack = vec![PathBuf::from(&path)];
        let mut visited = 0usize;
        const MAX_FILES: usize = 200_000;

        while let Some(dir) = stack.pop() {
            let entries = match fs::read_dir(&dir) {
                Ok(e) => e,
                Err(_) => continue,
            };
            for entry in entries.flatten() {
                if visited >= MAX_FILES { break; }
                let p = entry.path();
                let meta = match entry.metadata() {
                    Ok(m) => m,
                    Err(_) => continue,
                };
                if meta.file_type().is_symlink() { continue; }
                if meta.is_dir() {
                    stack.push(p);
                } else if meta.is_file() {
                    let size = meta.len();
                    if size > 0 {
                        by_size.entry(size).or_default().push(p);
                        visited += 1;
                    }
                }
            }
        }

        // Step 2: for sizes with >1 file, hash them
        let mut groups: Vec<DuplicateGroup> = Vec::new();
        for (size, paths) in by_size {
            if paths.len() < 2 { continue; }

            let mut by_hash: HashMap<String, Vec<String>> = HashMap::new();
            for p in &paths {
                let mut file = match fs::File::open(p) {
                    Ok(f) => f,
                    Err(_) => continue,
                };
                let mut hasher = Sha256::new();
                let mut buf = vec![0u8; 64 * 1024];
                let mut ok = true;
                loop {
                    match file.read(&mut buf) {
                        Ok(0) => break,
                        Ok(n) => hasher.update(&buf[..n]),
                        Err(_) => { ok = false; break; }
                    }
                }
                if !ok { continue; }
                let hash = format!("{:x}", hasher.finalize());
                by_hash.entry(hash).or_default().push(p.to_string_lossy().to_string());
            }

            for (hash, dup_paths) in by_hash {
                if dup_paths.len() >= 2 {
                    groups.push(DuplicateGroup { hash, size, paths: dup_paths });
                }
            }
        }

        // Sort groups by size desc (biggest waste first)
        groups.sort_by(|a, b| (b.size * b.paths.len() as u64).cmp(&(a.size * a.paths.len() as u64)));
        Ok(groups)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[derive(Serialize)]
struct DiskUsageNode {
    name: String,
    path: String,
    size: u64,
    is_dir: bool,
    children: Vec<DiskUsageNode>,
}

fn scan_usage_recursive(path: &Path, depth: usize, max_depth: usize) -> DiskUsageNode {
    let name = path.file_name().map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| path.to_string_lossy().to_string());

    let meta = match fs::symlink_metadata(path) {
        Ok(m) => m,
        Err(_) => return DiskUsageNode {
            name, path: path.to_string_lossy().to_string(),
            size: 0, is_dir: false, children: vec![],
        },
    };

    if meta.file_type().is_symlink() || !meta.is_dir() {
        return DiskUsageNode {
            name,
            path: path.to_string_lossy().to_string(),
            size: meta.len(),
            is_dir: false,
            children: vec![],
        };
    }

    let mut children: Vec<DiskUsageNode> = Vec::new();
    let mut total: u64 = 0;

    if let Ok(entries) = fs::read_dir(path) {
        for entry in entries.flatten() {
            let p = entry.path();
            let child = scan_usage_recursive(&p, depth + 1, max_depth);
            total += child.size;
            children.push(child);
        }
    }

    children.sort_by(|a, b| b.size.cmp(&a.size));

    // Only keep children within depth limit
    if depth >= max_depth {
        children.clear();
    } else {
        // Limit children to top 50 to avoid huge payloads
        children.truncate(50);
    }

    DiskUsageNode {
        name,
        path: path.to_string_lossy().to_string(),
        size: total,
        is_dir: true,
        children,
    }
}

#[tauri::command]
async fn scan_disk_usage(path: String, max_depth: usize) -> Result<DiskUsageNode, String> {
    tokio::task::spawn_blocking(move || {
        let p = PathBuf::from(&path);
        if !p.exists() {
            return Err("Path does not exist".to_string());
        }
        Ok(scan_usage_recursive(&p, 0, max_depth.max(1)))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
fn get_disk_info(path: String) -> Result<DiskInfo, String> {
    use std::mem::MaybeUninit;
    let c_path = std::ffi::CString::new(path).map_err(|e| e.to_string())?;
    let mut stat = MaybeUninit::<libc::statvfs>::uninit();
    let ret = unsafe { libc::statvfs(c_path.as_ptr(), stat.as_mut_ptr()) };
    if ret != 0 {
        return Err("Cannot get disk info".to_string());
    }
    let stat = unsafe { stat.assume_init() };
    let total = stat.f_blocks * stat.f_frsize;
    let available = stat.f_bavail * stat.f_frsize;
    let used = total - available;
    Ok(DiskInfo { total, available, used })
}

#[tauri::command]
fn watch_directory(path: String, app: AppHandle) -> Result<(), String> {
    let watcher_state = app.state::<Mutex<WatcherState>>();
    let mut state = watcher_state.lock().map_err(|e| e.to_string())?;

    // Already watching this path
    if state.watched_path.as_deref() == Some(&path) {
        return Ok(());
    }

    // Drop old watcher
    state.watcher = None;
    state.watched_path = None;

    let app_handle = app.clone();
    let mut debouncer = new_debouncer(
        Duration::from_millis(300),
        move |res: notify_debouncer_mini::DebounceEventResult| {
            if res.is_ok() {
                let _ = app_handle.emit("fs-changed", ());
            }
        },
    ).map_err(|e| format!("Cannot create watcher: {}", e))?;

    debouncer
        .watcher()
        .watch(Path::new(&path), RecursiveMode::NonRecursive)
        .map_err(|e| format!("Cannot watch directory: {}", e))?;

    state.watcher = Some(debouncer);
    state.watched_path = Some(path);
    Ok(())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(Mutex::new(WatcherState {
            watcher: None,
            watched_path: None,
        }))
        .invoke_handler(tauri::generate_handler![
            list_directory,
            get_quick_access,
            get_home,
            create_folder,
            create_file,
            rename_item,
            delete_items,
            copy_items,
            move_items,
            read_text_preview,
            autocomplete_path,
            open_file,
            open_terminal,
            get_parent,
            search_files,
            get_thumbnail,
            get_video_thumbnail,
            watch_directory,
            get_disk_info,
            get_file_properties,
            get_pdf_preview,
            extract_archive,
            create_archive,
            is_archive,
            get_mount_points,
            unmount_path,
            copy_items_progress,
            cancel_operation,
            batch_rename_preview,
            batch_rename_apply,
            list_applications,
            open_with,
            list_trash,
            restore_trash_items,
            purge_trash_items,
            empty_trash,
            get_git_status,
            get_exif,
            compute_hashes,
            find_duplicates,
            scan_disk_usage,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Flux Explorer");
}
