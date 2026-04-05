# Flux Explorer

A lightweight file explorer built with Tauri v2 and Rust, designed for Linux (Wayland/Hyprland).

## Features

- Grid and list view with file thumbnails (images + videos)
- Copy, cut, paste and drag & drop
- File preview (Space) for text, code and images
- Path autocomplete with Tab completion
- Recursive file search
- Context menu with common operations
- Unix permissions display
- Toast notifications for errors and actions
- Gruvbox dark theme

## Build

```
npm install
npm run build
```

## Dev

```
npm run dev
```

Requires: Rust, Node.js, Tauri v2 prerequisites, ffmpeg (for video thumbnails)
