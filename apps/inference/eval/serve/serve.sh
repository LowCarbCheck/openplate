#!/usr/bin/env bash
# Start/stop a local OpenAI-compatible llama-server for one of the eval models.
#
#   ./serve.sh <model-key> [port]     start (idempotent — no-op if already up)
#   ./serve.sh stop [model-key|all]   stop
#   ./serve.sh status                 show what is running
#
# Model keys: lfm-vl, lfm-judge, qwen-vl, qwen-vl-q8, qwen-judge, lfm-judge-think
#             (moondream is unsupported — see SERVING.md)
# Registry of files/ports lives in models.json; this script keeps the same values.
set -euo pipefail

SERVE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SERVE_DIR/../.." && pwd)"
MODELS_DIR="$REPO_ROOT/eval/models"
LOG_DIR="$SERVE_DIR/logs"
RUN_DIR="$SERVE_DIR/logs"
THREADS="${THREADS:-14}"
CTX="${CTX:-8192}"
HOST_ADDR="${HOST_ADDR:-127.0.0.1}"

export PATH="/home/linuxbrew/.linuxbrew/bin:$PATH"

mkdir -p "$LOG_DIR"

die() { echo "error: $*" >&2; exit 1; }

ALL_KEYS="lfm-vl lfm-judge qwen-vl qwen-vl-q8 qwen-judge lfm-judge-think"

default_port() {
  case "$1" in
    lfm-vl)          echo 8081 ;;
    lfm-judge)       echo 8082 ;;
    moondream)       echo 8083 ;;
    qwen-vl)         echo 8084 ;;
    qwen-judge)      echo 8085 ;;
    lfm-judge-think) echo 8086 ;;
    qwen-vl-q8)      echo 8087 ;;
    *) die "unknown model key: $1 (known: $ALL_KEYS moondream)" ;;
  esac
}

pidfile()  { echo "$RUN_DIR/$1.pid"; }
portfile() { echo "$RUN_DIR/$1.port"; }
logfile()  { echo "$LOG_DIR/$1.log"; }

# pid currently LISTENing on a TCP port, or empty. llama-server sets SO_REUSEPORT, so a second
# server can bind a port that is already in use and the two then silently split requests —
# which mis-attributes one model's flags to another. Port ownership must be checked explicitly;
# a successful /health probe proves only that *someone* is there.
# Empty output (free port) must still exit 0 — the grep below fails when nothing is listening,
# and under `set -e` that would abort the whole script.
port_listener_pid() {
  ss -ltnHp "sport = :$1" 2>/dev/null | grep -o 'pid=[0-9]*' | head -1 | cut -d= -f2 || true
}

is_running() {
  local pf; pf="$(pidfile "$1")"
  [[ -f "$pf" ]] || return 1
  local pid; pid="$(cat "$pf")"
  [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null
}

# Build the llama-server argv for a key into the global CMD array.
build_cmd() {
  local key="$1" port="$2"
  local model mmproj
  case "$key" in
    lfm-vl)
      model="$MODELS_DIR/LFM2.5-VL-1.6B-Q8_0.gguf"
      mmproj="$MODELS_DIR/mmproj-LFM2.5-VL-1.6b-F16.gguf"
      [[ -f "$model" ]]  || die "missing model file: $model"
      [[ -f "$mmproj" ]] || die "missing mmproj file: $mmproj"
      CMD=(llama-server -m "$model" --mmproj "$mmproj")
      ;;
    lfm-judge)
      model="$MODELS_DIR/LFM2.5-2.6B-Q8_0.gguf"
      [[ -f "$model" ]] || die "missing model file: $model"
      CMD=(llama-server -m "$model")
      # LFM2.5-2.6B is a hybrid reasoning model: left unbounded it spends 200-950 tokens
      # of chain-of-thought before emitting any `content`, i.e. 60-90s per judge call on
      # CPU. Budget 0 force-closes the think block for a 27x speedup (2.5s) with identical
      # answers on the smoke prompt. Set REASONING_BUDGET=-1 to restore full CoT.
      CMD+=(--reasoning-budget "${REASONING_BUDGET:-0}")
      ;;
    qwen-vl)
      model="$MODELS_DIR/Qwen3VL-8B-Instruct-Q4_K_M.gguf"
      mmproj="$MODELS_DIR/mmproj-Qwen3VL-8B-Instruct-F16.gguf"
      [[ -f "$model" ]]  || die "missing model file: $model"
      [[ -f "$mmproj" ]] || die "missing mmproj file: $mmproj"
      CMD=(llama-server -m "$model" --mmproj "$mmproj")
      ;;
    qwen-vl-q8)
      # Same model/vision tower as qwen-vl, LM weights at Q8_0 instead of Q4_K_M. The mmproj
      # is byte-identical to the one qwen-vl uses (mmproj-*-F16, the highest precision the
      # official repo publishes), so this pair isolates LM-weight quantization on its own:
      # any accuracy delta between qwen-vl and qwen-vl-q8 is the LM quant, never the vision
      # tower. ~9.3 GB resident — do not co-run with anything else.
      model="$MODELS_DIR/Qwen3VL-8B-Instruct-Q8_0.gguf"
      mmproj="$MODELS_DIR/mmproj-Qwen3VL-8B-Instruct-F16.gguf"
      [[ -f "$model" ]]  || die "missing model file: $model"
      [[ -f "$mmproj" ]] || die "missing mmproj file: $mmproj"
      CMD=(llama-server -m "$model" --mmproj "$mmproj")
      ;;
    qwen-judge)
      model="$MODELS_DIR/Qwen3-4B-Instruct-2507-Q4_K_M.gguf"
      [[ -f "$model" ]] || die "missing model file: $model"
      # Qwen3-4B-Instruct-2507 is the NON-thinking refresh (unlike plain Qwen3-4B, which is
      # hybrid-reasoning). It emits `content` directly, so no reasoning flags are needed.
      CMD=(llama-server -m "$model")
      ;;
    lfm-judge-think)
      # Same GGUF as lfm-judge, served WITH bounded chain-of-thought. Contrary to the
      # earlier note in SERVING.md, --reasoning-budget N for N>0 IS honoured: the think
      # block is force-closed after N reasoning tokens and `content` is then emitted
      # normally. 256 gives ~22s/call vs ~79s unbounded. See SERVING.md for the curve.
      # The budget-message is injected at the cut point so the handoff to the answer is
      # explicit rather than a mid-sentence truncation.
      model="$MODELS_DIR/LFM2.5-2.6B-Q8_0.gguf"
      [[ -f "$model" ]] || die "missing model file: $model"
      CMD=(llama-server -m "$model" --reasoning-budget "${REASONING_BUDGET:-256}"
           --reasoning-budget-message "Answer now.")
      ;;
    moondream)
      die "moondream is NOT servable on this host: no GGUF exists for moondream3 and neither llama.cpp nor ollama implements the architecture. See eval/SERVING.md."
      ;;
    *) die "unknown model key: $key" ;;
  esac
  CMD+=(-t "$THREADS" -c "$CTX" -ngl 0 --host "$HOST_ADDR" --port "$port" --jinja --metrics)
}

cmd_start() {
  local key="$1" port="${2:-}"
  [[ -n "$port" ]] || port="$(default_port "$key")"

  if is_running "$key"; then
    echo "$key already running (pid $(cat "$(pidfile "$key")"), port $(cat "$(portfile "$key")" 2>/dev/null || echo '?'))"
    return 0
  fi
  rm -f "$(pidfile "$key")"

  command -v llama-server >/dev/null || die "llama-server not on PATH (brew install llama.cpp)"

  # Pre-flight: refuse to start on an occupied port. Without this, SO_REUSEPORT lets the new
  # server bind anyway and share the port with a stale one, so measurements get silently
  # attributed to the wrong flags. See SERVING.md.
  local squatter; squatter="$(port_listener_pid "$port")"
  if [[ -n "$squatter" ]]; then
    die "port $port is already held by pid $squatter ($(ps -o comm= -p "$squatter" 2>/dev/null || echo unknown)). Refusing to start $key — llama-server would bind anyway (SO_REUSEPORT) and the two would split requests. Stop it first: 'eval/serve/serve.sh stop all' or 'kill $squatter'."
  fi

  local CMD; build_cmd "$key" "$port"
  echo "starting $key: ${CMD[*]}"
  nohup "${CMD[@]}" >"$(logfile "$key")" 2>&1 &
  local pid=$!
  echo "$pid"  >"$(pidfile "$key")"
  echo "$port" >"$(portfile "$key")"

  # Sacrificial under memory pressure: if the box runs out of RAM the kernel should kill
  # this server first, not wedge the desktop (2026-08-12 hard-freeze). A process may raise
  # its own children's oom_score_adj without privilege.
  echo 500 > "/proc/$pid/oom_score_adj" 2>/dev/null \
    || echo "warn: could not set oom_score_adj for $key (pid $pid)" >&2

  # Wait for the health endpoint (model load is the slow part, cold page-cache ~30s).
  local i
  for i in $(seq 1 180); do
    if grep -qi "couldn't bind" "$(logfile "$key")" 2>/dev/null; then
      rm -f "$(pidfile "$key")"
      die "$key could not bind port $port — something else is already listening there. Check 'pgrep -a llama-server' and stop it before retrying."
    fi
    if ! kill -0 "$pid" 2>/dev/null; then
      rm -f "$(pidfile "$key")"
      echo "--- last 30 log lines ---" >&2; tail -30 "$(logfile "$key")" >&2
      die "$key exited during startup"
    fi
    if curl -sf --noproxy '*' "http://$HOST_ADDR:$port/health" >/dev/null 2>&1; then
      # /health only proves *someone* answers. Confirm the listener is actually our process,
      # so a stale server on this port can never be mistaken for the model we just asked for.
      local owner; owner="$(port_listener_pid "$port")"
      if [[ -n "$owner" && "$owner" != "$pid" ]]; then
        kill "$pid" 2>/dev/null || true
        rm -f "$(pidfile "$key")"
        die "$key: port $port is served by pid $owner, not our pid $pid — a stale server is impersonating this key. Stop it and retry."
      fi
      echo "$key ready on http://$HOST_ADDR:$port (pid $pid) after ${i}s"
      return 0
    fi
    sleep 1
  done
  die "$key did not become healthy within 180s — see $(logfile "$key")"
}

cmd_stop() {
  local target="${1:-all}"
  local keys
  if [[ "$target" == "all" ]]; then keys="$ALL_KEYS moondream"; else keys="$target"; fi
  for key in $keys; do
    if is_running "$key"; then
      local pid; pid="$(cat "$(pidfile "$key")")"
      kill "$pid" 2>/dev/null || true
      for _ in $(seq 1 20); do kill -0 "$pid" 2>/dev/null || break; sleep 0.5; done
      kill -9 "$pid" 2>/dev/null || true
      echo "stopped $key (pid $pid)"
    else
      [[ "$target" == "all" ]] || echo "$key not running"
    fi
    rm -f "$(pidfile "$key")" "$(portfile "$key")"
  done
}

cmd_status() {
  for key in $ALL_KEYS moondream; do
    if is_running "$key"; then
      local pid rss; pid="$(cat "$(pidfile "$key")")"
      rss="$(ps -o rss= -p "$pid" 2>/dev/null | tr -d ' ')"
      printf '%-16s UP    pid=%-7s port=%-5s rss=%.2fGB\n' "$key" "$pid" \
        "$(cat "$(portfile "$key")" 2>/dev/null || echo '?')" \
        "$(awk -v r="${rss:-0}" 'BEGIN{print r/1048576}')"
    else
      printf '%-16s down\n' "$key"
    fi
  done
}

case "${1:-}" in
  ""|-h|--help) sed -n '2,10p' "${BASH_SOURCE[0]}"; exit 0 ;;
  stop)   shift; cmd_stop "${1:-all}" ;;
  status) cmd_status ;;
  *)      cmd_start "$1" "${2:-}" ;;
esac
