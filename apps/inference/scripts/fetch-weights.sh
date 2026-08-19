#!/bin/sh
# Fetch the GGUF weights for one MODEL_PROFILE into MODELS_DIR.
#
# This runs on every container start and is the reason no weights live in an
# image layer. It is written to survive the failure that actually happens on a
# clean machine: a 1–6 GB download dying halfway with `docker run` showing
# nothing useful.
#
#   * RESUMABLE. `curl -C -` / `wget -c` continue a partial file. Killing the
#     container at 80 % and restarting it does not start over.
#   * CHECKSUM-VERIFIED, and a mismatch prints the exact command to recover
#     rather than a hex diff nobody can act on.
#   * IDEMPOTENT / PRE-SEEDABLE. A file that is already present and hashes
#     correctly is skipped without a single byte of network — which is also the
#     supported way to install offline: copy the GGUFs into the volume yourself
#     and this script just verifies them.
#
# Usage:
#   MODEL_PROFILE=lite MODELS_DIR=/models ./scripts/fetch-weights.sh
#   MODEL_PROFILE=lite ./scripts/fetch-weights.sh --print model    # path only
#   MODEL_PROFILE=lite ./scripts/fetch-weights.sh --print mmproj   # path only
#   MODEL_PROFILE=lite ./scripts/fetch-weights.sh --check          # verify, never download
#
# Environment:
#   MODEL_PROFILE        lite | lite-apache | quality       (default: lite)
#   MODELS_DIR           where the GGUFs live               (default: /models)
#   WEIGHTS_MIRROR_BASE  optional base URL to pull from instead of Hugging
#                        Face. Empty by default — upstream Hugging Face IS the
#                        source of truth. If set, files are fetched from
#                        "$WEIGHTS_MIRROR_BASE/<filename>" and Hugging Face is
#                        used as the fallback. Checksums are enforced either
#                        way, so a mirror cannot serve you different weights.
#
# POSIX sh on purpose: this has to run under whatever shell the base image
# happens to ship.
set -eu

MODEL_PROFILE="${MODEL_PROFILE:-lite}"
MODELS_DIR="${MODELS_DIR:-/models}"
WEIGHTS_MIRROR_BASE="${WEIGHTS_MIRROR_BASE:-}"

HF_BASE="https://huggingface.co"

# ---------------------------------------------------------------------------
# The weight manifest.
#
# Fields, pipe-separated: role|filename|hf_repo|bytes|sha256
#
# PROVENANCE OF THE CHECKSUMS (2026-08-13). Every sha256 below is the `lfs.oid`
# Hugging Face reports for that file via
#   https://huggingface.co/api/models/<repo>/tree/main?recursive=true
# and, for the four files this project has on disk (both LFM files, the Qwen3-VL
# 8B Q4_K_M and its F16 mmproj), it was independently confirmed by running
# `sha256sum` over the local copy used to produce every measurement in
# eval/BASELINE.md. Local hash and Hugging Face LFS oid matched byte for byte.
# ---------------------------------------------------------------------------
manifest() {
  case "$1" in
    lite)
      # LiquidAI LFM2.5-VL-1.6B — the constrained-self-hoster floor. ~2.0 GiB.
      # NOTE: LFM Open License v1.0, revenue-capped. See README "Licensing".
      echo 'model|LFM2.5-VL-1.6B-Q8_0.gguf|LiquidAI/LFM2.5-VL-1.6B-GGUF|1246254880|a34bd1506a298d7ff07902e69baeac48c7c20bb85162e61218b743dc10be7c67'
      echo 'mmproj|mmproj-LFM2.5-VL-1.6b-F16.gguf|LiquidAI/LFM2.5-VL-1.6B-GGUF|853993856|2cddba98b98390c011c606c416de2e63dcfdd3b21452bf71ad6aab59fa52d2ee'
      ;;
    lite-apache)
      # Qwen3-VL-2B-Instruct — the Apache-2.0 drop-in for the lite slot, for
      # anyone the LFM revenue cap binds. ~1.8 GiB. Unmeasured by us; see README.
      echo 'model|Qwen3VL-2B-Instruct-Q4_K_M.gguf|Qwen/Qwen3-VL-2B-Instruct-GGUF|1107409952|089d75c52f4b7ffc56ba998ffc50aae89fcafc755f9e7208aacca281dca6c2ae'
      echo 'mmproj|mmproj-Qwen3VL-2B-Instruct-F16.gguf|Qwen/Qwen3-VL-2B-Instruct-GGUF|819394848|c3d5afbef5287953acd57b4043d2269456e5761a4eaccb3b71b062996970aea5'
      ;;
    quality)
      # Qwen3-VL-8B-Instruct — the flagship self-host path. ~5.8 GiB. Apache-2.0.
      echo 'model|Qwen3VL-8B-Instruct-Q4_K_M.gguf|Qwen/Qwen3-VL-8B-Instruct-GGUF|5027784800|67d1659bfe71b89d50b45a4ad1a9e5b997e5bb16ce5da66a6a6167abd569e9e2'
      echo 'mmproj|mmproj-Qwen3VL-8B-Instruct-F16.gguf|Qwen/Qwen3-VL-8B-Instruct-GGUF|1159029824|ca524100ebf825c9a870db1c580d03879e0da0ab2541697e2458e64891cf9d38'
      ;;
    *)
      echo "✖ Unknown MODEL_PROFILE: '$1' (expected: lite | lite-apache | quality)" >&2
      exit 2
      ;;
  esac
}

field() { echo "$1" | cut -d'|' -f"$2"; }

# Bytes -> "1.16 GiB", so a log line and `ls -l` are comparable at a glance.
human() {
  awk -v b="$1" 'BEGIN {
    if (b >= 1073741824) printf "%.2f GiB", b / 1073741824;
    else printf "%.0f MiB", b / 1048576;
  }'
}

sha_of() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | cut -d' ' -f1
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | cut -d' ' -f1
  else
    echo "✖ No sha256sum or shasum available — cannot verify weights." >&2
    exit 3
  fi
}

# One resumable attempt against one URL. Returns non-zero on any failure so the
# caller can fall through to the next URL.
download_from() {
  url="$1"
  dest="$2"
  if command -v curl >/dev/null 2>&1; then
    curl --fail --location --continue-at - --retry 5 --retry-delay 5 \
      --retry-connrefused --connect-timeout 30 --progress-bar \
      --output "$dest" "$url"
  elif command -v wget >/dev/null 2>&1; then
    wget --continue --tries=5 --waitretry=5 --timeout=30 \
      --output-document="$dest" "$url"
  else
    echo "✖ Neither curl nor wget is available — cannot fetch weights." >&2
    exit 3
  fi
}

# Named recovery. This text is the whole point of checksumming: an operator who
# hits a corrupt download should not have to reason about anything.
recovery_hint() {
  cat >&2 <<EOF

  ── HOW TO RECOVER ────────────────────────────────────────────────────────
  The partial or corrupt file is still on disk so you can inspect it. To
  discard it and download again, run:

      docker run --rm -v openplate-models:/models --entrypoint rm \\
          ghcr.io/lowcarbcheck/openplate-inference:latest -f "$1"

  ...then start the container again. If it fails a second time at the same
  file, your download is being altered in transit (a captive portal or a
  filtering proxy will do this) — try a different network, or pre-seed the
  volume by copying the file in by hand. See README "Is it working or stuck".
  ──────────────────────────────────────────────────────────────────────────
EOF
}

ensure_file() {
  entry="$1"
  role=$(field "$entry" 1)
  filename=$(field "$entry" 2)
  repo=$(field "$entry" 3)
  bytes=$(field "$entry" 4)
  want=$(field "$entry" 5)
  dest="$MODELS_DIR/$filename"
  pretty=$(human "$bytes")

  if [ -f "$dest" ]; then
    printf '▶ [%s] %s — already present, verifying sha256 (%s)...\n' "$role" "$filename" "$pretty"
    got=$(sha_of "$dest")
    if [ "$got" = "$want" ]; then
      echo "✅ [$role] $filename verified, skipping download."
      return 0
    fi
    actual_bytes=$(wc -c < "$dest" | tr -d ' ')
    # A short file is a resumable download. A full-length file with the wrong
    # hash is corruption, and saying so precisely matters: "wrong size" on a
    # file that is exactly the right size sends people down the wrong path.
    if [ "$actual_bytes" -lt "$bytes" ]; then
      if [ "$CHECK_ONLY" = "1" ]; then
        echo "✖ [$role] $filename is INCOMPLETE ($actual_bytes of $bytes B)." >&2
        recovery_hint "$dest"
        exit 4
      fi
      echo "…  [$role] incomplete ($actual_bytes / $bytes B) — resuming."
    else
      echo "✖ [$role] $filename is CORRUPT — right length, wrong contents." >&2
      echo "    size:     $actual_bytes B (expected $bytes B)" >&2
      echo "    expected: $want" >&2
      echo "    actual:   $got" >&2
      recovery_hint "$dest"
      exit 4
    fi
  fi

  if [ "$CHECK_ONLY" = "1" ]; then
    echo "✖ [$role] $filename is missing from $MODELS_DIR." >&2
    exit 4
  fi

  # Mirror first when one is configured, upstream Hugging Face as the fallback.
  # Empty by default: Hugging Face is the source of truth.
  hf_url="$HF_BASE/$repo/resolve/main/$filename?download=true"
  if [ -n "$WEIGHTS_MIRROR_BASE" ]; then
    urls="${WEIGHTS_MIRROR_BASE%/}/$filename $hf_url"
  else
    urls="$hf_url"
  fi

  ok=0
  for url in $urls; do
    printf '▶ [%s] downloading %s (%s) from %s\n' \
      "$role" "$filename" "$pretty" "$(echo "$url" | cut -d'?' -f1)"
    echo "   This is a one-time download into $MODELS_DIR. It is resumable —"
    echo "   restarting the container continues where it stopped."
    if download_from "$url" "$dest"; then
      ok=1
      break
    fi
    echo "⚠  [$role] fetch from that URL failed." >&2
  done
  if [ "$ok" != "1" ]; then
    echo "✖ [$role] could not download $filename from any source." >&2
    recovery_hint "$dest"
    exit 5
  fi

  printf '▶ [%s] verifying sha256 of %s...\n' "$role" "$filename"
  got=$(sha_of "$dest")
  if [ "$got" != "$want" ]; then
    echo "✖ [$role] CHECKSUM MISMATCH on $filename" >&2
    echo "    expected: $want" >&2
    echo "    actual:   $got" >&2
    recovery_hint "$dest"
    exit 4
  fi
  echo "✅ [$role] $filename downloaded and verified."
}

# ---------------------------------------------------------------------------
# Entry
# ---------------------------------------------------------------------------
CHECK_ONLY=0
PRINT_ROLE=""
while [ $# -gt 0 ]; do
  case "$1" in
    --check) CHECK_ONLY=1 ;;
    --print) shift; PRINT_ROLE="${1:-}" ;;
    -h|--help) sed -n '2,40p' "$0"; exit 0 ;;
    *) echo "✖ Unknown argument: $1" >&2; exit 2 ;;
  esac
  shift
done

entries=$(manifest "$MODEL_PROFILE")

# Every profile is exactly one model + one mmproj, so the two entries are named
# rather than iterated. A `while read` over a pipeline would run in a subshell,
# where `ensure_file`'s `exit 4` could not stop the script.
entry_model=$(echo "$entries" | grep '^model|')
entry_mmproj=$(echo "$entries" | grep '^mmproj|')

# `--print <role>`: resolve a path for the entrypoint without side effects.
if [ -n "$PRINT_ROLE" ]; then
  case "$PRINT_ROLE" in
    model) echo "$MODELS_DIR/$(field "$entry_model" 2)" ;;
    mmproj) echo "$MODELS_DIR/$(field "$entry_mmproj" 2)" ;;
    *) echo "✖ --print takes 'model' or 'mmproj', got '$PRINT_ROLE'" >&2; exit 2 ;;
  esac
  exit 0
fi

mkdir -p "$MODELS_DIR"

total=0
for b in $(echo "$entries" | cut -d'|' -f4); do
  total=$((total + b))
done

echo "═══════════════════════════════════════════════════════════════════════"
echo "  openplate-inference — weights for MODEL_PROFILE=$MODEL_PROFILE"
echo "  destination: $MODELS_DIR   total: $(human "$total")"
if [ -n "$WEIGHTS_MIRROR_BASE" ]; then
  echo "  mirror:      $WEIGHTS_MIRROR_BASE (Hugging Face as fallback)"
fi
echo "═══════════════════════════════════════════════════════════════════════"

ensure_file "$entry_model"
ensure_file "$entry_mmproj"

echo "✅ All weights for profile '$MODEL_PROFILE' are present and verified."
