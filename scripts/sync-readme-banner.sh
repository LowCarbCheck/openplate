#!/usr/bin/env bash
# Copy the README title image out of openplate-brand and record where it came from.
# The picture is drawn and rendered in openplate-brand (social/), never here. Run this
# from a clone that sits next to openplate-brand, after the brand banner changes:
#   scripts/sync-readme-banner.sh [path-to-openplate-brand]
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
brand="${1:-$root/../openplate-brand}"
src="$brand/social/ShareCardEn.png"
dest="$root/.github/brand/readme-banner.png"

[ -f "$src" ] || { echo "missing $src, pass the openplate-brand path as the first argument" >&2; exit 1; }

cp "$src" "$dest"
sha="$(sha256sum "$dest" | cut -d' ' -f1)"
commit="$(git -C "$brand" rev-parse --short HEAD 2>/dev/null || echo unknown)"
printf '{\n  "file": "readme-banner.png",\n  "from": "openplate-brand/social/ShareCardEn.png",\n  "brandCommit": "%s",\n  "sha256": "%s"\n}\n' "$commit" "$sha" > "$root/.github/brand/SOURCE.json"
echo "synced $dest ($sha)"
