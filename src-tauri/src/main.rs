#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use base64::Engine;
use image::imageops::FilterType;
use serde::Serialize;
use std::fs;
use std::io::{BufRead, BufReader, Cursor};
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::UNIX_EPOCH;

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

#[tauri::command]
fn list_directory(path: String, show_hidden: bool) -> Result<Vec<FileEntry>, String> {
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
        ("Telechargements", dl_path, "downloads"),
        ("Images", &pictures, "images"),
        ("Musique", &music, "music"),
        ("Videos", &videos, "videos"),
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
fn delete_items(paths: Vec<String>) -> Result<(), String> {
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
fn copy_items(sources: Vec<String>, destination: String) -> Result<(), String> {
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
fn move_items(sources: Vec<String>, destination: String) -> Result<(), String> {
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
fn search_files(path: String, query: String, show_hidden: bool) -> Result<Vec<FileEntry>, String> {
    let mut results = Vec::new();
    let query_lower = query.to_lowercase();
    search_recursive(Path::new(&path), &query_lower, show_hidden, &mut results, 0, 5);
    Ok(results)
}

fn search_recursive(
    dir: &Path,
    query: &str,
    show_hidden: bool,
    results: &mut Vec<FileEntry>,
    depth: usize,
    max_depth: usize,
) {
    if depth > max_depth || results.len() >= 100 {
        return;
    }

    let entries = match fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return,
    };

    for entry in entries.flatten() {
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

        if name.to_lowercase().contains(query) {
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
            search_recursive(&path_buf, query, show_hidden, results, depth + 1, max_depth);
        }
    }
}

#[tauri::command]
fn get_thumbnail(path: String, size: u32) -> Result<String, String> {
    let img = image::open(&path).map_err(|e| format!("Cannot open image: {}", e))?;
    let thumb = img.resize(size, size, FilterType::Triangle);
    let mut buf = Cursor::new(Vec::new());
    thumb
        .write_to(&mut buf, image::ImageFormat::Jpeg)
        .map_err(|e| format!("Cannot encode thumbnail: {}", e))?;
    let b64 = base64::engine::general_purpose::STANDARD.encode(buf.into_inner());
    Ok(format!("data:image/jpeg;base64,{}", b64))
}

#[tauri::command]
fn get_video_thumbnail(path: String, size: u32) -> Result<String, String> {
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

    let b64 = base64::engine::general_purpose::STANDARD.encode(&output.stdout);
    Ok(format!("data:image/jpeg;base64,{}", b64))
}

fn format_permissions(mode: u32) -> String {
    let flags = [
        (0o400, 'r'), (0o200, 'w'), (0o100, 'x'),
        (0o040, 'r'), (0o020, 'w'), (0o010, 'x'),
        (0o004, 'r'), (0o002, 'w'), (0o001, 'x'),
    ];
    flags.iter().map(|(bit, ch)| if mode & bit != 0 { *ch } else { '-' }).collect()
}

fn dirs_home() -> String {
    std::env::var("HOME").unwrap_or_else(|_| "/home".to_string())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running Flux Explorer");
}
