# Changelog

All notable changes to this project will be documented in this file.

## [0.6.1] - Slifer (2026-03-24)

### Added

- `fetch()` shim that proxies cross-origin requests through `/api/proxy` to bypass CORS restrictions
- Automatic `Origin: app://obsidian.md` header injection for cross-origin requests to match Obsidian desktop app
- User-Agent forwarding from browser to proxy for cross-origin requests

### Fixed

- Obsidian Sync API authentication now works in browser (was blocked by CORS)
- Proxy response headers cleaned to exclude hop-by-hop headers (`content-encoding`, `transfer-encoding`, `content-length`, `connection`)

## [0.6.0] - Slifer (2026-03-23)

### Added

- `zlib` shim using `pako` library for compression/decompression operations (deflate, inflate, gzip, gunzip, etc.)
- File descriptor operations: `fs.open()`, `fs.read()`, `fs.close()`, `fs.fstat()` and sync variants
- `fs.promises.open()` returning FileHandle objects with `stat()`, `read()`, `close()` methods
- `showOpenDialog` electron dialog shim with browser file picker and vault upload
- `showOpenDialogSync` hacky workaround using file staging registry and two-step upload flow
- Enhanced `Buffer` shim with `alloc()`, `allocUnsafe()`, `byteLength()`, and `isEncoding()` methods

### Fixed

- `MessageDialog` modal dismiss error when confirm button clicked
- Dialog shim modal event ordering to prevent null reference errors

## [0.5.0] - Scatha (2026-03-22)

### Added

- Compression middleware (gzip/brotli) for API responses to reduce bandwidth
- Plugin installation prompt system with per-vault trust flags
- Versioning system with cache-busting query parameters on script URLs
- Option to install ignis-bridge plugin to vaults imported at runtime

### Changed

- Auto-creation of default vault now requires `AUTO_CREATE_DEFAULT=true` environment variable
- Script URLs (`ignis-ui.js`, `shim-loader.js`) now include version query params for automatic cache invalidation
- Cache headers: versioned assets cached for 1 year, non-versioned for 5 minutes

### Fixed

- Vault manager not displaying when no vaults exist
- `window.close()` now shows vault manager when no vault is configured

### Removed

- Unused `VAULT_PATH` environment variable fallback logic

## [0.4.0] - Gostir (2026-03-18)

### Added

- Vault management: create, rename, delete vaults
- Last active vault persistence: remembers which vault was open
- Plugin trust preservation: keeps plugin trust status when renaming vaults

### Changed

- Refactored vault operations into shared service

### Fixed

- Issues with dialogs and vault rename operations

---

_Changelog tracking started at version 0.4.0. For earlier versions, please refer to commit history._
