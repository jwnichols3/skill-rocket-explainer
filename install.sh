#!/bin/sh
# Rocket Explainer installer.
#
#   curl -fsSL https://github.com/jwnichols3/skill-rocket-explainer/releases/latest/download/install.sh | sh
#
# Environment:
#   EXPLAINER_VERSION=vX.Y.Z  install that release instead of the latest
#   EXPLAINER_TARBALL=/path   install from a local release tarball (offline installs, tests)
#   EXPLAINER_HOME            data dir (default ~/.rocket-explainer); the app goes in <data dir>/app/
#   EXPLAINER_BIN_DIR         where the `explainer` command goes (default ~/.local/bin)
#   CLAUDE_CONFIG_DIR         Claude Code config dir (default ~/.claude); the skill goes in skills/explainer/
#
# Safe to re-run: an installed version is only re-linked; a newer one installs alongside and
# becomes current. Your settings, styles and explainers are never touched.
set -eu

REPO=${EXPLAINER_REPO:-jwnichols3/skill-rocket-explainer}
DATA=${EXPLAINER_HOME:-$HOME/.rocket-explainer}
BIN_DIR=${EXPLAINER_BIN_DIR:-$HOME/.local/bin}
CLAUDE_DIR=${CLAUDE_CONFIG_DIR:-$HOME/.claude}
APP=$DATA/app

say() { printf '%s\n' "$*"; }
die() { printf 'install.sh: %s\n' "$*" >&2; exit 1; }
# Single-quotes a value for the generated shim.
q() { printf "'%s'" "$(printf '%s' "$1" | sed "s/'/'\\\\''/g")"; }

# Prerequisites.
command -v node >/dev/null 2>&1 || die "Node.js 24+ is required. Install it from https://nodejs.org (or \`brew install node\`), then re-run."
NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]')
[ "$NODE_MAJOR" -ge 24 ] || die "Node.js 24+ is required; found $(node --version). Upgrade from https://nodejs.org (or \`brew upgrade node\`), then re-run."
command -v npm >/dev/null 2>&1 || die "npm is required (it ships with Node.js). Reinstall Node.js from https://nodejs.org, then re-run."
FFMPEG_MISSING=
command -v ffmpeg >/dev/null 2>&1 || FFMPEG_MISSING=1

TMP=$(mktemp -d)
STAGE=
trap 'rm -rf "$TMP" ${STAGE:+"$STAGE"}' EXIT
trap 'exit 130' INT TERM

# Work out the version and, unless it is already installed, get the tarball.
VERSION=
TARBALL=
WANT=${EXPLAINER_VERSION:-}
WANT=${WANT#v}
if [ -n "${EXPLAINER_TARBALL:-}" ]; then
  [ -f "$EXPLAINER_TARBALL" ] || die "no such tarball: $EXPLAINER_TARBALL"
  TARBALL=$EXPLAINER_TARBALL
else
  command -v curl >/dev/null 2>&1 || die "curl is required to download a release. Install curl, or set EXPLAINER_TARBALL to a downloaded release tarball."
  VERSION=$WANT
  if [ -z "$VERSION" ]; then
    # The latest release's page redirects to its tag; a private repo (or one with no release) answers 404.
    LATEST=$(curl -fsLI -o /dev/null -w '%{url_effective}' "https://github.com/$REPO/releases/latest" || true)
    case ${LATEST##*/} in
      v[0-9]*) VERSION=${LATEST##*/v} ;;
      *) die "can't see releases of $REPO (private repo, no release yet, or offline?). Download a release tarball and set EXPLAINER_TARBALL=/path/to/it." ;;
    esac
  fi
  if [ ! -d "$APP/$VERSION" ]; then
    URL="https://github.com/$REPO/releases/download/v$VERSION/rocket-explainer-$VERSION.tar.gz"
    say "Downloading Rocket Explainer v$VERSION..."
    curl -fsSL "$URL" -o "$TMP/release.tar.gz" || die "download failed: $URL"
    TARBALL=$TMP/release.tar.gz
  fi
fi

mkdir -p "$APP"
if [ -n "$TARBALL" ]; then
  STAGE=$APP/.staging-$$
  mkdir "$STAGE"
  tar -xzf "$TARBALL" -C "$STAGE" --strip-components=1 || die "couldn't unpack $TARBALL"
  [ -f "$STAGE/package.json" ] && [ -f "$STAGE/bin/explainer.ts" ] || die "$TARBALL is not a Rocket Explainer release tarball"
  VERSION=$(cd "$STAGE" && node -p 'require("./package.json").version')
  [ -z "$WANT" ] || [ "$WANT" = "$VERSION" ] || die "asked for v$WANT but the tarball holds v$VERSION"
fi

DEST=$APP/$VERSION
if [ -d "$DEST" ]; then
  say "v$VERSION is already installed."
  INSTALLED=
else
  say "Installing v$VERSION into $DEST (npm ci --omit=dev)..."
  (cd "$STAGE" && npm_config_update_notifier=false npm ci --omit=dev --no-audit --no-fund --loglevel=error) || die "npm ci failed; nothing was changed"
  mv "$STAGE" "$DEST"
  INSTALLED=1
fi
[ -z "$STAGE" ] || rm -rf "$STAGE"

PREV=$(readlink "$APP/current" 2>/dev/null || true)
ln -sfn "$VERSION" "$APP/current"

# The `explainer` command.
mkdir -p "$BIN_DIR"
SHIM=$BIN_DIR/explainer
cat > "$SHIM.tmp" <<EOF
#!/bin/sh
# Rocket Explainer command, written by install.sh. Re-run install.sh to update.
EXPLAINER_HOME=\${EXPLAINER_HOME:-$(q "$DATA")}
export EXPLAINER_HOME
exec node $(q "$APP/current/bin/explainer.ts") "\$@"
EOF
chmod 755 "$SHIM.tmp"
mv -f "$SHIM.tmp" "$SHIM"

# The /explainer skill for Claude Code.
SKILL=$CLAUDE_DIR/skills/explainer/SKILL.md
mkdir -p "$(dirname "$SKILL")"
cp "$DEST/skill/explainer/SKILL.md" "$SKILL"

say ""
if [ -n "$INSTALLED" ]; then say "Rocket Explainer v$VERSION installed."; else say "Rocket Explainer v$VERSION is current."; fi
say "  app      $DEST"
say "  current  $APP/current -> $VERSION"
say "  command  $SHIM"
say "  skill    $SKILL"
say "  data     $DATA (settings, styles and explainers are left as they are)"
if [ -n "$PREV" ] && [ "$PREV" != "$VERSION" ]; then
  say ""
  say "Switched from v$PREV. If the app is running, restart it: explainer restart"
fi
case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *) say ""; say "Warning: $BIN_DIR is not on your PATH. Add this to your shell profile:"
     say "  export PATH=\"$BIN_DIR:\$PATH\"" ;;
esac
if [ -n "$FFMPEG_MISSING" ]; then
  say ""
  say "Warning: ffmpeg is missing; videos need it. Install it (\`brew install ffmpeg\` on macOS, \`apt install ffmpeg\` on Debian/Ubuntu)."
fi
say ""
say "Next: run \`explainer setup\`"
