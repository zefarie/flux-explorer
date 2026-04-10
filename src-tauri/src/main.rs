#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use base64::Engine;
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running Flux Explorer");
}
