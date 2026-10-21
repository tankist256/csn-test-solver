#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
PYTHON="$ROOT_DIR/.venv/bin/python"
SSH_KEY=${CSN_AZURE_SSH_KEY:-/home/tankist256/Downloads/csn-solver_key.pem}
REMOTE=${CSN_AZURE_REMOTE:-tankist256@20.91.139.58}
REMOTE_DIR=/home/tankist256/csn-test-solver

usage() {
  echo "Lietojums: $0 [1..50 | --sync-only]" >&2
  exit 2
}

mode=${1:-5}
if [[ "$mode" != --sync-only ]]; then
  [[ "$mode" =~ ^[0-9]+$ ]] || usage
  (( mode >= 1 && mode <= 50 )) || usage
fi

[[ -x "$PYTHON" ]] || { echo "Python vide nav atrasta: $PYTHON" >&2; exit 1; }
[[ -r "$SSH_KEY" ]] || { echo "Azure SSH atslēga nav atrasta: $SSH_KEY" >&2; exit 1; }

ssh_args=(ssh -F /dev/null -i "$SSH_KEY" -o BatchMode=yes
  -o StrictHostKeyChecking=yes
  -o UserKnownHostsFile=/home/tankist256/.ssh/known_hosts
  -o ConnectTimeout=10)
printf -v rsync_ssh '%q ' "${ssh_args[@]}"

cd "$ROOT_DIR"
exec 9>"$ROOT_DIR/.collector-sync.lock"
if ! flock -n 9; then
  echo "Datorā jau notiek ievākšana vai sinhronizācija." >&2
  exit 1
fi
"${ssh_args[@]}" "$REMOTE" "test -d '$REMOTE_DIR/solver/media' && test -f '$REMOTE_DIR/deploy/apply-data-sync.py'"

if [[ "$mode" != --sync-only ]]; then
  "$PYTHON" -u solver/collector.py --rounds "$mode"
fi

"$PYTHON" - <<'PY'
import json
from pathlib import Path
questions = json.loads(Path("solver/questions.json").read_text(encoding="utf-8"))
if not isinstance(questions, list) or not questions:
    raise SystemExit("Vietējā jautājumu datubāze trūkst vai ir tukša")
print(f"Vietējā datubāze ir gatava sinhronizācijai: {len(questions)} jautājumi")
PY

# Send media first so every reference in the new database resolves.
rsync -a --size-only --exclude='/thumbs/' -e "$rsync_ssh" \
  solver/media/ "$REMOTE:$REMOTE_DIR/solver/media/"

stage=$("${ssh_args[@]}" "$REMOTE" 'mktemp -d /home/tankist256/csn-data-upload.XXXXXXXX')
rsync -a -e "$rsync_ssh" solver/questions.json solver/questions.js "$REMOTE:$stage/"
"${ssh_args[@]}" "$REMOTE" "python3 '$REMOTE_DIR/deploy/apply-data-sync.py' '$stage' && docker exec csn-solver python solver/thumbnails.py"

local_hash=$(sha256sum solver/questions.json | cut -d ' ' -f1)
remote_hash=$("${ssh_args[@]}" "$REMOTE" "sha256sum '$REMOTE_DIR/solver/questions.json'" | cut -d ' ' -f1)
[[ "$local_hash" == "$remote_hash" ]] || { echo "Azure jautājumu datubāzes kontrolsumma atšķiras" >&2; exit 1; }
echo "Azure datubāze atbilst vietējai kopijai. Atjauniniet lapu, lai redzētu izmaiņas."
