#!/usr/bin/env bash
# ============================================================
# AIDA Evaluation Framework — Shared Helpers
# ============================================================
# Sourced by aida-eval.sh and individual test scripts.
# Provides: logging, assertions, API helpers, JSON parsing.
# ============================================================

# -- Colors --
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; DIM='\033[2m'; NC='\033[0m'

# -- Counters (initialize if not set) --
PASS=${PASS:-0}; FAIL=${FAIL:-0}; WARNS=${WARNS:-0}; TOTAL=${TOTAL:-0}

# -- Logging --
log()     { echo -e "${CYAN}[$(date +%H:%M:%S)]${NC} $*"; }
section() { echo -e "\n${BOLD}${YELLOW}══════════════════════════════════════════════${NC}"; \
            echo -e "${BOLD}  $*${NC}"; \
            echo -e "${BOLD}${YELLOW}══════════════════════════════════════════════${NC}\n"; }

# -- Assertions --
pass()    { echo -e "  ${GREEN}PASS${NC} $*"; PASS=$((PASS+1)); TOTAL=$((TOTAL+1)); }
fail()    { echo -e "  ${RED}FAIL${NC} $*"; FAIL=$((FAIL+1)); TOTAL=$((TOTAL+1)); }
warn_()   { echo -e "  ${YELLOW}WARN${NC} $*"; WARNS=$((WARNS+1)); TOTAL=$((TOTAL+1)); }

check() { local desc="$1"; shift; if eval "$@" >/dev/null 2>&1; then pass "$desc"; else fail "$desc"; fi; }
soft()  { local desc="$1"; shift; if eval "$@" >/dev/null 2>&1; then pass "$desc"; else warn_ "$desc (non-critical)"; fi; }

# -- API helpers --
api_get()  { curl -sf "${DASHBOARD_URL:-http://localhost:3456}$1" 2>/dev/null; }
api_post() { curl -sf -X POST -H "Content-Type: application/json" -d "$2" "${DASHBOARD_URL:-http://localhost:3456}$1" 2>/dev/null; }

# -- JSON helpers (node-based, cross-platform) --
jlen()   { node -e "try{const d=JSON.parse(require('fs').readFileSync(0,'utf8'));console.log(Array.isArray(d)?d.length:0)}catch{console.log(0)}"; }
jfield() { node -e "try{const d=JSON.parse(require('fs').readFileSync(0,'utf8'));console.log(d[$1]??'')}catch{console.log('')}"; }

# -- Agent communication --
aida_say() {
  local turn="$1"; shift; local msg="$1"
  local timeout="${AGENT_TIMEOUT:-300}"
  local log_dir="${LOG_DIR:-/tmp/aida-eval}"
  local out="$log_dir/turn-$turn.log"

  log "Turn $turn: sending to Aida..."
  timeout "$timeout" openclaw agent --agent main --message "$msg" > "$out" 2>&1 || true
  echo -e "${CYAN}--- Aida response (turn $turn, first 20 lines) ---${NC}"
  head -20 "$out"
  echo -e "${CYAN}--- (full log: $out, $(wc -l < "$out") lines total) ---${NC}\n"
}

# -- Scheme loader --
load_scheme() {
  local scheme_file="$1"
  if [ ! -f "$scheme_file" ]; then
    echo "Error: scheme file not found: $scheme_file" >&2
    return 1
  fi
  # Source the .conf file (it sets shell variables)
  # shellcheck disable=SC1090
  source "$scheme_file"
}
