# Flux Explorer

A lightweight, modern file explorer built with Tauri v2 and Rust, designed for Linux (Wayland/Hyprland) with a Gruvbox dark theme.

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Platform](https://img.shields.io/badge/platform-Linux-orange.svg)
![Tauri](https://img.shields.io/badge/Tauri-v2-yellow.svg)

## Features

### Navigation
- Tab support with `Ctrl+T` / `Ctrl+W`, each tab keeps its own history and selection
- Breadcrumb navigation with editable path bar (`Ctrl+L`)
- Path autocomplete with Tab completion
- Back / forward / up history (`Alt+Left`, `Alt+Right`, `Alt+Up`)
- Quick access sidebar (Home, Documents, Downloads, Pictures, Music, Videos, Prism Launcher)
- Custom folder bookmarks via right-click
- Resizable sidebar with persistent width

### File operations
- Copy, cut, paste with `Ctrl+C` / `Ctrl+X` / `Ctrl+V`
- Drag and drop (move by default, hold `Ctrl` to copy)
- Create folders (`Ctrl+Shift+N`) and files
- Rename (`F2`) and delete (`Delete`) with safe trash fallback
- Smart conflict resolution with auto-rename
- Detailed file properties dialog (owner, group, MIME, recursive size, dates)

### Display
- Grid and list view modes
- Sort by name, type, size or modification date
- Image thumbnails (PNG, JPG, GIF, WebP, BMP, ICO, AVIF)
- Video thumbnails via ffmpeg
- On-disk thumbnail cache invalidated by mtime
- Hidden files toggle (`Ctrl+H`)
- Symlink indicators
- File icons colored by type (folder, image, video, audio, code, archive, document)

### Preview (Space key)
- Text and code with syntax highlighting (15+ languages : JS, TS, Python, Rust, Go, C/C++, Java, HTML, CSS, shell, JSON, etc.)
- Images at high resolution
- Audio playback with controls (MP3, FLAC, WAV, OGG, AAC, M4A, Opus)
- Video playback with controls (MP4, WebM, MOV, OGG)
- PDF first page preview (requires `poppler-utils`)
- File metadata for unsupported formats

### Search
- Recursive search up to 10 levels deep, 500 results
- Optional content search inside text files (grep mode)
- Debounced input with progress indicator

### Performance
- Virtual scrolling for directories with 500+ files
- Async filesystem operations via tokio (no UI freezes)
- Lazy thumbnail loading with IntersectionObserver
- File watcher with debounced auto-refresh

### UI
- Custom Gruvbox dark titlebar with min/max/close
- Disk usage indicator with color-coded bar
- Toast notifications for actions and errors
- Status bar with selection info, size and permissions
- French interface

### Keyboard shortcuts
| Shortcut | Action |
|----------|--------|
| `Ctrl+T` / `Ctrl+W` | New tab / close tab |
| `Ctrl+L` | Edit path bar |
| `Ctrl+F` | Focus search |
| `Ctrl+H` | Toggle hidden files |
| `Ctrl+Shift+N` | New folder |
| `Ctrl+A` | Select all |
| `Ctrl+C` / `Ctrl+X` / `Ctrl+V` | Copy / cut / paste |
| `F2` | Rename |
| `F5` | Refresh |
| `Delete` | Delete selection |
| `Space` | Preview file |
| `Enter` | Open file or folder |
| `Backspace` | Go to parent |
| `Alt+Left` / `Alt+Right` / `Alt+Up` | Back / forward / up |
| Arrow keys | Navigate between files |
| `Home` / `End` | First / last file |
| `Escape` | Clear selection or close preview |

## Installation

### Arch Linux (AUR)

```bash
yay -S flux-explorer
# or
paru -S flux-explorer
```

### Pre-built binaries

Download the latest `.deb`, `.rpm` or `.AppImage` from the [releases page](https://github.com/zefarie/flux-explorer/releases).

```bash
# Debian / Ubuntu
sudo dpkg -i flux-explorer_*_amd64.deb

# Fedora / RHEL
sudo rpm -i flux-explorer-*.x86_64.rpm

# Any Linux (AppImage)
chmod +x flux-explorer_*_amd64.AppImage
./flux-explorer_*_amd64.AppImage
```

### Build from source

#### Runtime dependencies
- `webkit2gtk-4.1`
- `gtk3`
- `ffmpeg` (video thumbnails)
- `poppler` / `poppler-utils` (PDF preview)

#### Build dependencies
- Rust toolchain
- Node.js + npm

```bash
git clone https://github.com/zefarie/flux-explorer.git
cd flux-explorer
npm install
npm run build
```

The binary will be at `src-tauri/target/release/flux-explorer` and bundles in `src-tauri/target/release/bundle/`.

#### Distro-specific deps

```bash
# Arch
sudo pacman -S webkit2gtk-4.1 gtk3 ffmpeg poppler rust nodejs npm

# Debian / Ubuntu
sudo apt install libwebkit2gtk-4.1-dev libgtk-3-dev libsoup-3.0-dev \
                 librsvg2-dev patchelf ffmpeg poppler-utils \
                 rustc cargo nodejs npm

# Fedora
sudo dnf install webkit2gtk4.1-devel gtk3-devel libsoup3-devel \
                 rust cargo nodejs npm ffmpeg poppler-utils
```

## Development

```bash
npm run dev
```

This starts a static server on port 1420 and launches Tauri in dev mode with hot reload.

## Architecture

- **Frontend**: vanilla JavaScript (ES modules), HTML5, CSS3 with Gruvbox variables
- **Backend**: Rust + Tauri v2
- **No frontend framework**: kept intentionally lightweight

```
src/
├── app.js              # Entry point
├── index.html          # HTML structure
├── style.css           # Gruvbox dark theme
└── modules/            # ES modules
    ├── state.js        # Global state and prefs
    ├── navigation.js   # Path / history / breadcrumb
    ├── files.js        # Rendering with virtual scroll
    ├── tabs.js         # Multi-tab management
    ├── clipboard.js    # Copy / cut / paste
    ├── dialogs.js      # Modal dialogs
    ├── preview.js      # File preview overlay
    ├── highlight.js    # Custom syntax highlighter
    ├── properties.js   # Properties dialog
    ├── bookmarks.js    # Custom favorites
    ├── search.js       # Recursive search
    ├── sidebar.js      # Quick access + disk
    ├── thumbnails.js   # Lazy thumbnail loader
    ├── dragdrop.js     # Drag and drop
    ├── context-menu.js # Right-click menu
    ├── titlebar.js     # Custom window decorations
    ├── resize.js       # Sidebar resize
    ├── keyboard.js     # Keyboard shortcuts
    ├── statusbar.js    # Status bar
    ├── icons.js        # File icons by type
    └── utils.js        # Format helpers + toast

src-tauri/
├── src/main.rs         # Tauri commands (filesystem, thumbnails, watcher)
├── Cargo.toml          # Rust dependencies
├── tauri.conf.json     # Tauri configuration
└── icons/              # App icons
```

## License

MIT
