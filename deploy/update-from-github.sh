#!/usr/bin/env bash
set -euo pipefail

APP_DIR=/home/tankist256/csn-test-solver
cd "$APP_DIR"

# A second timer run must not interrupt an ongoing build or rollback.
exec 9>/tmp/csn-solver-update.lock
flock -n 9 || exit 0

if [[ ! -s solver/questions.json || ! -d solver/media ]]; then
  echo "Trūkst jautājumu datubāzes vai multivides mapes; atjaunināšana ir pārtraukta." >&2
  exit 1
fi

if [[ -n "$(git status --porcelain --untracked-files=no)" ]]; then
  echo "VM ir mainīti Git izsekojamie faili; tie netiks pārrakstīti." >&2
  exit 1
fi

# Do not leave the two-minute update timer blocked indefinitely by a stalled network.
timeout --signal=TERM --kill-after=10s 90s \
  git -c http.lowSpeedLimit=1024 -c http.lowSpeedTime=30 fetch --quiet origin main
previous=$(git rev-parse HEAD)
target=$(git rev-parse FETCH_HEAD)
[[ "$previous" == "$target" ]] && exit 0

if ! git merge-base --is-ancestor "$previous" "$target"; then
  echo "VM repozitoriju nevar ātri pārvietot uz GitHub main atzaru." >&2
  exit 1
fi

rollback() {
  echo "Atjaunināšana neizdevās; atjauno iepriekšējo versiju $previous." >&2
  git reset --hard "$previous"
  docker compose up -d --build solver || true
  exit 1
}

git merge --ff-only "$target"
docker compose config --quiet || rollback
docker compose up -d --build solver || rollback

for _ in {1..60}; do
  if curl --fail --silent --max-time 3 http://127.0.0.1:8080/index.html >/dev/null; then
    echo "Versija $target ir uzstādīta."
    exit 0
  fi
  sleep 2
done

echo "Pēc atjaunināšanas vietne nekļuva pieejama." >&2
rollback
