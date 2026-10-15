#!/usr/bin/env bash
set -euo pipefail

APP_DIR=/home/tankist256/csn-test-solver
cd "$APP_DIR"

# A second timer run must not interrupt an ongoing build or rollback.
exec 9>/tmp/csn-solver-update.lock
flock -n 9 || exit 0

if [[ ! -s solver/questions.json || ! -d solver/media ]]; then
  echo "Question database or media directory is missing; refusing to deploy." >&2
  exit 1
fi

if [[ -n "$(git status --porcelain --untracked-files=no)" ]]; then
  echo "Tracked files on the VM have local changes; refusing to overwrite them." >&2
  exit 1
fi

git fetch --quiet origin main
previous=$(git rev-parse HEAD)
target=$(git rev-parse FETCH_HEAD)
[[ "$previous" == "$target" ]] && exit 0

if ! git merge-base --is-ancestor "$previous" "$target"; then
  echo "The VM checkout cannot fast-forward to GitHub main." >&2
  exit 1
fi

rollback() {
  echo "Deploy failed; restoring the previous revision $previous." >&2
  git reset --hard "$previous"
  docker compose up -d --build solver || true
  exit 1
}

git merge --ff-only "$target"
docker compose config --quiet || rollback
docker compose up -d --build solver || rollback

for _ in {1..60}; do
  if curl --fail --silent --max-time 3 http://127.0.0.1:8080/index.html >/dev/null; then
    echo "Deployed $target"
    exit 0
  fi
  sleep 2
done

echo "The site did not become available after the update." >&2
rollback
