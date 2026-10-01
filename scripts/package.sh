#!/bin/sh
# Builds the release tarball <out dir>/rocket-explainer-<version>.tar.gz and prints its path.
# What ships is what it takes to run the app; tests, docs and prototypes stay out.
# Files come from the working tree (tracked plus untracked, minus .gitignore'd ones), so the
# release workflow and the install test package exactly the same thing.
set -eu
cd "$(dirname "$0")/.."
OUT=${1:-dist}
VERSION=$(node -p 'require("./package.json").version')
NAME="rocket-explainer-$VERSION"
STAGE=$(mktemp -d)
trap 'rm -rf "$STAGE"' EXIT

git ls-files -co --exclude-standard -- \
  bin src web seed templates skill package.json package-lock.json LICENSE README.md > "$STAGE/listed"
# Drop deleted-but-tracked paths.
while IFS= read -r f; do [ -f "$f" ] && printf '%s\n' "$f"; done < "$STAGE/listed" > "$STAGE/files"

mkdir "$STAGE/$NAME"
COPYFILE_DISABLE=1 tar -cf - -T "$STAGE/files" | tar -xf - -C "$STAGE/$NAME"
mkdir -p "$OUT"
OUT=$(cd "$OUT" && pwd)
COPYFILE_DISABLE=1 tar -czf "$OUT/$NAME.tar.gz" -C "$STAGE" "$NAME"
echo "$OUT/$NAME.tar.gz"
