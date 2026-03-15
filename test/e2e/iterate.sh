#!/usr/bin/env bash
# ============================================================
# AIDA Iteration Runner (Local → Remote → Score)
# ============================================================
# One command to: push → deploy → test → score → download results.
# Run from your local machine. Executes tests on the remote server.
#
# Usage:
#   bash test/e2e/iterate.sh --scheme <name> [flags...]
#
# Examples:
#   iterate.sh --scheme quick                         # Fast engine regression (~30s total)
#   iterate.sh --scheme structural-v2                 # Full validation (~17 min)
#   iterate.sh --scheme structural-v2 --skip-install  # Reuse deployment (~15 min)
#   iterate.sh --scheme aef-v1                        # AEF 11-dimension (~22 min)
#   iterate.sh --scheme structural-v2 --notes "fix cron"
#
# Prerequisites:
#   - SSH key at .dev/oc-alicloud.pem
#   - Remote server has aida repo cloned
#   - benchmark/config.json has server config
# ============================================================

set -euo pipefail

# -- Resolve paths --
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
CONFIG_JSON="$SCRIPT_DIR/benchmark/config.json"

# -- Read server config from benchmark/config.json --
_cfg() {
  node -e "const c=JSON.parse(require('fs').readFileSync(process.argv[1],'utf-8')); console.log(eval('c.'+process.argv[2]))" "$CONFIG_JSON" "$1" 2>/dev/null
}

SSH_KEY="$ROOT_DIR/$(_cfg 'server.sshKey')"
SSH_HOST="$(_cfg 'server.host')"
REMOTE_REPO="$(_cfg 'server.repo')"

if [ ! -f "$SSH_KEY" ]; then
  echo "Error: SSH key not found at $SSH_KEY"
  exit 1
fi

SSH_OPTS="-i $SSH_KEY -o StrictHostKeyChecking=no -o ConnectTimeout=10 -o ServerAliveInterval=30"

ssh_cmd() { ssh $SSH_OPTS "$SSH_HOST" "$@"; }
ssh_long() { ssh $SSH_OPTS -o ServerAliveCountMax=20 "$SSH_HOST" "$@"; }

# -- Colors --
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; DIM='\033[2m'; NC='\033[0m'
log() { echo -e "${CYAN}[$(date +%H:%M:%S)]${NC} $*"; }

# -- Parse arguments --
SCHEME=""
PASSTHROUGH_ARGS=()
NOTES=""
SKIP_PUSH=false

while [[ $# -gt 0 ]]; do
  case $1 in
    --scheme)     SCHEME="$2"; shift 2 ;;
    --notes)      NOTES="$2"; shift 2 ;;
    --skip-push)  SKIP_PUSH=true; shift ;;
    --help|-h)
      head -22 "${BASH_SOURCE[0]}" | grep '^#' | sed 's/^# \?//'
      exit 0 ;;
    *)            PASSTHROUGH_ARGS+=("$1"); shift ;;
  esac
done

if [ -z "$SCHEME" ]; then
  echo "Error: --scheme is required"
  echo "Available: quick, structural-v2, aef-v1, benchmark"
  exit 1
fi

STARTED_AT=$(date +%s)

# ════════════════════════════════════════════════════════════
# Step 1: Push local changes to remote
# ════════════════════════════════════════════════════════════

if [ "$SKIP_PUSH" = false ]; then
  log "${BOLD}Step 1: Pushing to remote...${NC}"

  # Ensure local changes are committed
  if ! git -C "$ROOT_DIR" diff --quiet 2>/dev/null || ! git -C "$ROOT_DIR" diff --cached --quiet 2>/dev/null; then
    echo -e "${YELLOW}Warning: You have uncommitted changes. Push anyway? [y/N]${NC}"
    read -r -n 1 answer
    echo
    if [[ ! "$answer" =~ ^[Yy]$ ]]; then
      echo "Aborted. Commit your changes first."
      exit 1
    fi
  fi

  # Push to origin
  git -C "$ROOT_DIR" push 2>&1 | tail -3 || true
  LOCAL_COMMIT=$(git -C "$ROOT_DIR" rev-parse --short HEAD)
  log "  Pushed commit: $LOCAL_COMMIT"

  # Pull on remote
  ssh_cmd "cd $REMOTE_REPO && git pull --no-recurse-submodules" 2>&1 | tail -3
  REMOTE_COMMIT=$(ssh_cmd "cd $REMOTE_REPO && git rev-parse --short HEAD" 2>/dev/null)
  log "  Remote commit: $REMOTE_COMMIT"

  if [ "$LOCAL_COMMIT" != "$REMOTE_COMMIT" ]; then
    echo -e "${YELLOW}Warning: local ($LOCAL_COMMIT) != remote ($REMOTE_COMMIT)${NC}"
  fi
else
  log "${BOLD}Step 1: Push skipped (--skip-push)${NC}"
  REMOTE_COMMIT=$(ssh_cmd "cd $REMOTE_REPO && git rev-parse --short HEAD" 2>/dev/null || echo "?")
fi

# ════════════════════════════════════════════════════════════
# Step 2: Run test on remote
# ════════════════════════════════════════════════════════════

log "${BOLD}Step 2: Running test on remote (scheme=$SCHEME)...${NC}"

# Build the remote command
REMOTE_CMD="cd $REMOTE_REPO && bash test/e2e/aida-eval.sh --scheme $SCHEME"
if [ -n "$NOTES" ]; then
  REMOTE_CMD="$REMOTE_CMD --notes '$NOTES'"
fi
for arg in "${PASSTHROUGH_ARGS[@]}"; do
  REMOTE_CMD="$REMOTE_CMD $arg"
done

log "  Remote command: $REMOTE_CMD"
echo ""

# Run with long timeout (tests can take 20+ minutes)
set +e
ssh_long "$REMOTE_CMD" 2>&1
TEST_EXIT=$?
set -e

# ════════════════════════════════════════════════════════════
# Step 3: Download results
# ════════════════════════════════════════════════════════════

log "${BOLD}Step 3: Downloading results...${NC}"

# Read log_dir from scheme config
SCHEME_FILE="$SCRIPT_DIR/schemes/${SCHEME}.conf"
if [ -f "$SCHEME_FILE" ]; then
  # shellcheck disable=SC1090
  source "$SCHEME_FILE"
  REMOTE_LOG_DIR="${log_dir}"
else
  REMOTE_LOG_DIR="/tmp/structural-capability"
fi

# Download metrics.json and score.json
mkdir -p "$SCRIPT_DIR/results-local"
LOCAL_RESULT_DIR="$SCRIPT_DIR/results-local/$(date +%Y%m%d-%H%M%S)-${SCHEME}"
mkdir -p "$LOCAL_RESULT_DIR"

scp $SSH_OPTS "$SSH_HOST:$REMOTE_LOG_DIR/metrics.json" "$LOCAL_RESULT_DIR/" 2>/dev/null || true
scp $SSH_OPTS "$SSH_HOST:$REMOTE_LOG_DIR/score.json" "$LOCAL_RESULT_DIR/" 2>/dev/null || true
scp $SSH_OPTS "$SSH_HOST:$REMOTE_LOG_DIR/report.txt" "$LOCAL_RESULT_DIR/" 2>/dev/null || true

# Download and merge remote results.tsv into local
REMOTE_RESULTS="$REMOTE_REPO/test/e2e/results.tsv"
scp $SSH_OPTS "$SSH_HOST:$REMOTE_RESULTS" "$LOCAL_RESULT_DIR/results-remote.tsv" 2>/dev/null || true

# Append any new lines from remote to local results.tsv
if [ -f "$LOCAL_RESULT_DIR/results-remote.tsv" ]; then
  # Get the last line from remote (newest entry)
  REMOTE_LAST=$(tail -1 "$LOCAL_RESULT_DIR/results-remote.tsv")
  if [ -n "$REMOTE_LAST" ] && ! grep -qF "$REMOTE_LAST" "$SCRIPT_DIR/results.tsv" 2>/dev/null; then
    echo "$REMOTE_LAST" >> "$SCRIPT_DIR/results.tsv"
    log "  Merged new result into local results.tsv"
  fi
fi

# ════════════════════════════════════════════════════════════
# Summary
# ════════════════════════════════════════════════════════════

ENDED_AT=$(date +%s)
TOTAL_TIME=$((ENDED_AT - STARTED_AT))

echo ""
log "${BOLD}Iteration complete${NC} (${TOTAL_TIME}s total)"
log "  Scheme:  $SCHEME"
log "  Commit:  $REMOTE_COMMIT"
log "  Results: $LOCAL_RESULT_DIR/"

# Show score summary if available
if [ -f "$LOCAL_RESULT_DIR/score.json" ]; then
  node -e "
    const s=JSON.parse(require('fs').readFileSync('$LOCAL_RESULT_DIR/score.json','utf8'));
    const d=s.delta!==null ? ' (Δ: '+(s.delta>=0?'+':'')+s.delta.toFixed(2)+')' : '';
    console.log('  Score:   '+s.composite.toFixed(2)+' / '+s.target.toFixed(2)+d);
  " 2>/dev/null || true
fi

# Show results trend
echo ""
log "Recent results:"
tail -5 "$SCRIPT_DIR/results.tsv" 2>/dev/null | column -t -s$'\t' || true

exit "$TEST_EXIT"
