# Layout Studio desktop builds

Electron wraps the existing editor, using bundled files at the stable `layout-studio://studio` origin. It runs offline without a Python server, installed Node runtime, or installed Blender. The build machine needs Node.js 24 and npm; end users do not.

## Local development and builds

Run these commands from `design/coffee_bar_3d/desktop`. Every shell command is a single line.

```text
npm ci
npm start
```

Windows x64 installer and portable ZIP (build on Windows):

```text
npm run dist:win
npm run test:packaged
```

macOS DMG and ZIP, separately for Apple Silicon and Intel (build on a Mac):

```text
npm run dist:mac
npm run test:packaged
```

For just the current Mac architecture, use one of these commands:

```text
npx electron-builder --config electron-builder.cjs --mac --arm64 --publish never
npx electron-builder --config electron-builder.cjs --mac --x64 --publish never
node scripts/checksums.cjs
```

Outputs are under `desktop/dist/`. Windows produces an NSIS setup executable and a ZIP containing the application folder. Keep the entire extracted ZIP folder together; the EXE depends on its adjacent Electron files. The installer supports a per-user installation directory and preserves saved data on uninstall. macOS produces an application in a DMG and a ZIP for each architecture. `SHA256SUMS.txt` hashes the distributable artifacts.

`npm run pack` creates an unpacked application for the current platform. `npm test` validates assets and protocol handling; `npm run test:desktop` exercises the development Electron shell; `npm run test:packaged` runs the same checks against the packaged executable for the host architecture. Tests use a temporary profile, not your saved layouts. Reports, screenshots and sample exports are in `desktop/test-results/`.

## Experimental Mac ZIP builds from Windows

The installed electron-builder rejects macOS targets on Windows. The alternative `@electron/packager` supports unsigned cross-packaging, but Mac framework symlinks require a POSIX filesystem (or additional Windows symlink privileges). The WSL route uses the existing Ubuntu distribution, a temporary Linux filesystem and a checksum-verified Node 24.21.0 runtime. It does not install system packages or change Windows developer settings.

From Windows, with Ubuntu-22.04 already installed in WSL and the npm dependencies installed:

```text
npm run dist:mac:wsl -- --from-windows
```

This uses `dist/win-unpacked/resources/app.asar` from the previously built Windows app, so both platforms contain the same application source. Build Windows first if that file is absent. Omit `--from-windows` to stage the current editor working tree instead. Set `LAYOUT_STUDIO_WSL_DISTRO` to use another existing WSL distribution; it must have Python 3.10+, tar and xz support. The temporary Node runtime currently targets x86-64 Linux. On an existing Linux build host with Node 24 and Python 3.10+, `npm run dist:mac:unsigned` uses the same packager directly.

Outputs are `dist/mac-cross/Layout-Studio-0.1.0-mac-arm64-unsigned.zip` (Apple Silicon) and `Layout-Studio-0.1.0-mac-x64-unsigned.zip` (Intel), plus checksums and `mac-cross-report.json`. Versions in filenames follow the package version. Extract the ZIP on the Mac, preserving its `.app` directory; do not unpack and repack it with Windows tools that discard Unix permissions or symlinks.

These are experimental, unsigned/unnotarized bundles, not the native Mac CI releases. The export validates ZIP CRCs, Mach-O CPU architecture, executable permissions and framework symlinks. It cannot launch or test macOS behavior. Electron Packager also skips the new framework-embedded ASAR integrity digest on non-Mac hosts because it cannot re-sign the framework. macOS may block launching the unsigned app; use the native Mac workflow for signing and runtime validation. The WSL fallback does not create DMGs or universal binaries.

## GitHub Actions pipeline

The repository workflow `.github/workflows/layout-studio-desktop.yml` runs three native build jobs: Windows x64, macOS arm64, and macOS x64. It installs locked dependencies, validates the asset bundle, runs the Electron smoke test, builds the installers, tests the packaged executable, and uploads the installers/ZIPs/checksums as Actions artifacts. The smoke test checks both IK workers, editable JSON import, SVG/GLB/PNG export, 720p recording and decoding, and autosave/snapshots across a full restart.

After these files are committed and pushed, open **Actions → Layout Studio desktop → Run workflow**. It also runs for tags matching `layout-studio-v*`. Build artifacts are retained for 14 days. There is no automatic release publication or auto-update service. Tagging does not change the app version: update `package.json` and the lockfile before making a version tag.

## Runtime assets and reproducibility

`scripts/prepare-studio.cjs` stages a small allowlist into the generated `desktop/studio/` directory. It includes the editor, Three.js and its license, robot GLBs and kinematics, the reference SVG, legacy ME6 assets, source scene configuration, and the two runtime files `../output/coffee_bar.glb` and `../output/built_config.json`. Those two generated files are intentionally no longer ignored by Git: **commit both together**, along with the editor sources, robot assets and desktop lockfile. A clean checkout needs them; CI does not depend on a developer's Blender installation or URDF folders. After rebuilding the scene, review and update both files together.

The preparation step rejects missing files, unresolved module imports, invalid GLBs and unresolved Git LFS pointers. It writes `desktop-assets.json` with exact file hashes, build version and source revision. Other renders, test outputs, exports, local layouts, reference media and caches are excluded. The current browser autosave is never silently included in a distributable; users can import their exported scene.

The original `output/coffee_bar.blend` authoring file is optional and excluded by default (it exceeds GitHub's ordinary single-file limit). The desktop Export menu explains when it is absent; **current-scene GLB export is always available**. To include the authoring file locally, place it in `../output/`, set `LAYOUT_STUDIO_INCLUDE_BLEND=1`, then build. For example, in PowerShell:

```powershell
$env:LAYOUT_STUDIO_INCLUDE_BLEND = '1'
npm run dist:win
```

On macOS:

```sh
LAYOUT_STUDIO_INCLUDE_BLEND=1 npm run dist:mac
```

Enabling it without the file fails the build. If distributing it through CI later, supply that file as a separate build input or use Git LFS; do not commit the raw large file without arranging storage. Standalone object-lab and historical concept viewers are separate tools and are not part of this package.

## Saved scenes and exports

The desktop profile uses `%APPDATA%/Layout Studio` on Windows and `~/Library/Application Support/Layout Studio` on macOS, independent of installation location and app version. **File → Open saved-data folder** opens it. Autosaves and named snapshots keep using the existing local storage schema in the dedicated `persist:layout-studio` session. Imports use the native file picker; exports use the native Save dialog. No application files need write access.

Browser and desktop profiles are separate. To transfer your current browser layout, use Export → JSON and Import in the desktop app. To transfer the snapshot library, use the browser's Snapshots → Export, then Snapshots → Import in the desktop app. Keep portable JSON backups as before. The app does not read or modify the browser profile automatically.

## Signing and notarization

Internal builds work without publisher credentials, but Windows/macOS may show unverified-publisher or Gatekeeper prompts. These builds have **not** been publisher-signed or Apple-notarized unless credentials were supplied. Both Mac architectures use an ad-hoc signature for internal builds, which is not publisher verification. Hardened runtime is enabled for certificate-signed builds.

For signed Windows builds, add repository secrets `WIN_CSC_LINK` (PFX path or base64 contents) and `WIN_CSC_KEY_PASSWORD`. For signed and notarized macOS builds, add `MAC_CSC_LINK` (Developer ID Application certificate), `MAC_CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, and `APPLE_TEAM_ID`. The workflow maps the Mac certificate to electron-builder's `CSC_LINK` / `CSC_KEY_PASSWORD` and enables notarization when the complete credential set is present. Local builds use those electron-builder variable names directly. Never commit certificates or credentials. Forked pull requests do not receive repository secrets.

The renderer is sandboxed, has no Node access or preload bridge, and uses a restricted local protocol and content security policy. Imported layouts remain data. New permissions, native bridges or remote pages need an explicit design change.

References: [Electron custom protocols](https://www.electronjs.org/docs/latest/api/protocol/), [Electron security guidance](https://www.electronjs.org/docs/latest/tutorial/security), [electron-builder signing](https://www.electron.build/code-signing.html), and [GitHub runner platforms](https://docs.github.com/en/actions/reference/runners/github-hosted-runners).
