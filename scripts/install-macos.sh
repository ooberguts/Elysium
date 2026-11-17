#!/bin/bash
# Installs a commit from the official repository. Compatible with macOS Bash 3.2.
set -Eeuo pipefail

REPOSITORY=https://github.com/ooberguts/Elysium.git
ROOT="${ELYSIUM_INSTALL_ROOT:-$HOME/Library/Application Support/Elysium}"
APP_DIR="$HOME/Applications"
COMMIT=""
WAIT_PID=""
LAUNCH=1

usage() {
  cat <<'HELP'
Install Elysium from GitHub (macOS 13.5+, Apple Silicon or Intel).
Usage: bash install-macos.sh [--commit FULL_SHA] [--app-dir DIRECTORY]
                            [--root DIRECTORY] [--wait-pid PID] [--no-launch]
Defaults: ~/Applications/Elysium.app; source/tools/logs in ~/Library/Application Support/Elysium.
Missing Apple Command Line Tools, Node.js 24, and Rust stable are installed first.
Private repositories require GitHub access through Git credentials (e.g. gh auth setup-git).
HELP
}
fail() { echo "Elysium: $*" >&2; exit 1; }
while [ "$#" -gt 0 ]; do
  case "$1" in
    --help|-h) usage; exit 0 ;;
    --commit|--app-dir|--root|--wait-pid)
      [ "$#" -ge 2 ] && [ -n "$2" ] || fail "Missing value for $1"
      case "$1" in
        --commit) COMMIT="$2" ;;
        --app-dir) APP_DIR="$2" ;;
        --root) ROOT="$2" ;;
        --wait-pid) WAIT_PID="$2" ;;
      esac
      shift 2 ;;
    --no-launch) LAUNCH=0; shift ;;
    *) fail "Unknown option: $1 (use --help)" ;;
  esac
done
if [ -n "$COMMIT" ]; then
  [[ "$COMMIT" =~ ^[0-9a-f]{40}$ ]] || fail "--commit must be a full lowercase Git SHA (40 characters)."
fi
if [ -n "$WAIT_PID" ]; then
  [[ "$WAIT_PID" =~ ^[1-9][0-9]*$ ]] || fail "Invalid process ID."
fi
[[ "$ROOT" = /* && "$APP_DIR" = /* ]] || fail "Installation folders must be absolute paths."
[ "$(uname -s)" = Darwin ] || fail "This installer runs on macOS. Use install-windows.ps1 on Windows."
[ "$(id -u)" != 0 ] || fail "Run as your normal user, without sudo. Apple may ask for a password for its tools."
OS_VERSION=$(sw_vers -productVersion)
OS_MAJOR=${OS_VERSION%%.*}
OS_MINOR=${OS_VERSION#*.}; OS_MINOR=${OS_MINOR%%.*}
(( OS_MAJOR > 13 || (OS_MAJOR == 13 && OS_MINOR >= 5) )) || fail "Building requires macOS 13.5 or newer (Node.js 24)."
case "$(uname -m)" in arm64) ARCH=arm64 ;; x86_64) ARCH=x64 ;; *) fail "Unsupported Mac architecture." ;; esac

mkdir -p "$ROOT/logs" "$ROOT/tools" "$APP_DIR"
[ -w "$APP_DIR" ] || fail "Cannot write to $APP_DIR. Copy Elysium to ~/Applications or choose a writable --app-dir."
LOCK="$ROOT/install.lock"
mkdir "$LOCK" 2>/dev/null || fail "Another installation is active. If it stopped unexpectedly, remove $LOCK and retry."
echo "$$" > "$LOCK/pid"
WORK=$(mktemp -d "$ROOT/install.XXXXXX")
STAGED=""
cleanup() {
  [ -z "$STAGED" ] || rm -rf "$STAGED"
  rm -rf "$WORK" "$LOCK"
}
trap cleanup EXIT
LOG="$ROOT/logs/install-$(date +%Y%m%d-%H%M%S).log"
exec > >(tee -a "$LOG") 2>&1
trap 'echo "Installation failed at line $LINENO. Your installed app is kept until a replacement is ready. See: $LOG"' ERR
echo "Elysium installer · log: $LOG"

download() { curl --fail --location --retry 3 --connect-timeout 20 --max-time 600 --proto '=https' --tlsv1.2 "$1" -o "$2"; }
if ! xcode-select -p >/dev/null 2>&1 || ! xcrun --find clang >/dev/null 2>&1; then
  echo "Accept the Apple Command Line Tools installation window. Waiting up to 30 minutes…"
  xcode-select --install || true
  for ((attempt=0; attempt<360; attempt++)); do
    if xcode-select -p >/dev/null 2>&1 && xcrun --find clang >/dev/null 2>&1; then break; fi
    sleep 5
  done
  xcrun --find clang >/dev/null 2>&1 || fail "Finish installing Apple's Command Line Tools, then run this script again."
fi
export PATH="$ROOT/tools/node/bin:$HOME/.cargo/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
if ! command -v node >/dev/null 2>&1 || ! node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 24 ? 0 : 1)' >/dev/null 2>&1; then
  echo "Installing a private Node.js 24 toolchain…"
  download https://nodejs.org/dist/latest-v24.x/SHASUMS256.txt "$WORK/SHASUMS256.txt"
  NODE_FILE=$(awk -v arch="$ARCH" '$2 ~ "^node-v24\\.[0-9]+\\.[0-9]+-darwin-" arch "\\.tar\\.gz$" {print $2}' "$WORK/SHASUMS256.txt")
  [[ "$NODE_FILE" =~ ^node-v24\.[0-9]+\.[0-9]+-darwin-(arm64|x64)\.tar\.gz$ ]] || fail "Could not resolve the Node.js 24 download."
  download "https://nodejs.org/dist/latest-v24.x/$NODE_FILE" "$WORK/$NODE_FILE"
  (cd "$WORK"; awk -v file="$NODE_FILE" '$2 == file' SHASUMS256.txt | shasum -a 256 -c -)
  mkdir "$WORK/node"
  tar -xzf "$WORK/$NODE_FILE" --strip-components=1 -C "$WORK/node"
  rm -rf "$ROOT/tools/node"
  mv "$WORK/node" "$ROOT/tools/node"
fi
if ! command -v rustup >/dev/null 2>&1; then
  download https://sh.rustup.rs "$WORK/rustup.sh"
  sh "$WORK/rustup.sh" -y --profile minimal --default-toolchain stable --no-modify-path
fi
rustup toolchain install stable --profile minimal
export RUSTUP_TOOLCHAIN=stable
command -v git >/dev/null 2>&1 || fail "Git is missing from the Apple Command Line Tools."

SOURCE="$ROOT/source"
if [ -d "$SOURCE" ]; then
  [ -d "$SOURCE/.git" ] || fail "$SOURCE already exists but is not a Git checkout. Choose another --root."
  [ "$(git -C "$SOURCE" remote get-url origin)" = "$REPOSITORY" ] || fail "The managed source folder has a different origin; it will not be changed."
  CHANGES=$(git -C "$SOURCE" status --porcelain)
  [ -z "$CHANGES" ] || fail "The managed checkout contains local edits. Save them elsewhere before updating."
else
  git clone --branch main "$REPOSITORY" "$SOURCE" || fail "Cannot clone GitHub. For a private repo, sign in with gh auth login and gh auth setup-git, then retry."
fi
git -C "$SOURCE" fetch --prune origin +refs/heads/main:refs/remotes/origin/main
TARGET=${COMMIT:-$(git -C "$SOURCE" rev-parse refs/remotes/origin/main)}
git -C "$SOURCE" cat-file -e "$TARGET^{commit}"
git -C "$SOURCE" merge-base --is-ancestor "$TARGET" refs/remotes/origin/main || fail "The requested commit is not part of the official main branch."
git -C "$SOURCE" -c advice.detachedHead=false checkout --detach "$TARGET"
[ "$(git -C "$SOURCE" rev-parse HEAD)" = "$TARGET" ] || fail "Git did not check out the requested commit."
echo "Building Elysium · commit $TARGET (the first build can take several minutes)…"
(
  cd "$SOURCE"
  npm ci --no-audit --no-fund
  npm run prepare:media
  npm run tauri -- build --locked --bundles app
)
BUILT="$SOURCE/src-tauri/target/release/bundle/macos/Elysium.app"
[ -x "$BUILT/Contents/MacOS/elysium" ] || fail "The app bundle is missing after building."
codesign --verify --deep --strict "$BUILT"
# Copy and verify beside the destination before touching an existing installation.
STAGED=$(mktemp -d "$APP_DIR/.elysium-stage.XXXXXX")
ditto "$BUILT" "$STAGED/Elysium.app"
codesign --verify --deep --strict "$STAGED/Elysium.app"
if [ -n "$WAIT_PID" ]; then
  echo "Build ready. Quit Elysium to finish installing; it will reopen automatically."
  while kill -0 "$WAIT_PID" 2>/dev/null; do sleep 2; done
elif pgrep -x elysium >/dev/null 2>&1; then
  echo "Build ready. Quit Elysium to finish installing."
  while pgrep -x elysium >/dev/null 2>&1; do sleep 2; done
fi
DESTINATION="$APP_DIR/Elysium.app"
BACKUP="$APP_DIR/.Elysium.previous.app"
[ ! -e "$BACKUP" ] || fail "A previous app backup exists at $BACKUP. Move it before retrying."
if [ -e "$DESTINATION" ]; then
  mv "$DESTINATION" "$BACKUP"
fi
if ! mv "$STAGED/Elysium.app" "$DESTINATION"; then
  [ ! -e "$BACKUP" ] || mv "$BACKUP" "$DESTINATION"
  fail "Could not move the new app into place; the previous app was restored."
fi
rm -rf "$BACKUP"
echo "$TARGET" > "$ROOT/installed-commit.txt"
node -e 'require("node:fs").writeFileSync(process.argv[1], JSON.stringify({root: process.argv[2], repository: process.argv[3]}))' "$APP_DIR/.elysium-install.json" "$ROOT" "$REPOSITORY"
echo "Installed Elysium · ${TARGET:0:12} at $DESTINATION"
if [ "$LAUNCH" = 1 ]; then open "$DESTINATION"; fi
