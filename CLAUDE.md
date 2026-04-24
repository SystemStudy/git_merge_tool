# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.
始终使用中文和我对话
## Build & Run Commands

```bash
# Install dependencies
npm install

# Development (React hot-reload + Electron)
npm run electron-dev

# Build React app
npm run build

# Build Windows portable EXE
npm run electron-build-win-portable

# Build Windows installer
npm run electron-build-win

# Build macOS DMG
npm run electron-build-mac-dmg

# Run tests
npm test
```

## Architecture

Three-layer Electron app for Git branch merge operations with GitLab MR integration:

### 1. Electron Main Process (`public/electron.js`)
- All Git operations via `simple-git` (cherry-pick, push, fetch, checkout, stash, branch management)
- `electron-store` for settings persistence (recent projects, GitLab config, branch presets)
- GitLab API integration via `axios` (create MR, test token)
- Console logger (`build/logger.js`) hijacks `console.*` and writes to temp directory
- Build output goes to `build/`; final packages go to `dist/`

### 2. Preload Bridge (`public/preload.js`)
- `contextBridge.exposeInMainWorld('electronAPI', ...)` provides a typed API surface
- Categories: `projects`, `settings`, `git`, `gitlab`, `system`, `on` (event listeners)
- All IPCs are invoke/handle pattern (async, promise-based)

### 3. React Renderer (`src/`)
- **`App.js`** — top-level routing: shows `WelcomePage` or `MainWorkspace` based on project state
- **`WelcomePage`** — directory picker, recent projects list (with delete), settings drawer (GitLab, branches, log export)
- **`MainWorkspace`** — the core workspace with commit list (pagination, search, author filter), merge type selector (bug/test/release), target branch checkboxes, and operation buttons: cherry-pick & push, create merge branch, detect conflicts, detect changes

### Key Dependencies
- `antd` (UI components), `react-window` (virtualized lists), `simple-git` (Git), `electron-store` (config), `axios` (GitLab API), `archiver` (log export as ZIP)

### Git Merge Flow
Three merge types configured in settings (each has target branch lists):
1. **提测 (test)** → cherry-pick + push to smoke branches
2. **入库 (release)** → create merge branch + push + auto GitLab MR
3. **Bug提测 (bug)** → cherry-pick + push to bugfix branches
