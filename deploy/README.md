# Azure VM Deployment

The project is installed on the VM at `/home/tankist256/csn-test-solver`. A systemd timer checks GitHub `main` every two minutes and updates the `solver` container. The question bank and media stay on the VM and are not sent through Git.

Docker Compose publishes the solver only on `127.0.0.1:8080`. Nginx serves the
public HTTPS endpoint and proxies to that local port. Keep `CSN_BIND_ADDRESS`
unset (or set it to `127.0.0.1`) on the VM.

## One-time setup

1. Back up the existing project directory and connect it to GitHub:

   ```bash
   cd /home/tankist256
   cp -a csn-test-solver "csn-test-solver.backup.$(date +%Y%m%d-%H%M%S)"
   cd csn-test-solver
   git init -b main
   git remote add origin https://github.com/tankist256/csn-test-solver.git
   git fetch origin main
   git reset --hard origin/main
   test -s solver/questions.json && test -d solver/media
   ```

   The code comes from GitHub. The question bank and media stay on the VM because Git ignores those paths. Keep the backup until the first update succeeds.

2. Install and enable the update service and timer:

   ```bash
   chmod +x /home/tankist256/csn-test-solver/deploy/update-from-github.sh
   sudo install -m 644 /home/tankist256/csn-test-solver/deploy/csn-solver-update.service /etc/systemd/system/
   sudo install -m 644 /home/tankist256/csn-test-solver/deploy/csn-solver-update.timer /etc/systemd/system/
   sudo systemctl daemon-reload
   sudo systemctl enable --now csn-solver-update.timer
   ```

## Verify an update

```bash
sudo systemctl start csn-solver-update.service
sudo journalctl -u csn-solver-update.service -n 80 --no-pager
curl -fsS http://127.0.0.1:8080/index.html >/dev/null
```

The update script accepts only fast-forward changes to `main`. It builds the container, checks that the site responds, and restores the previous code if an update fails. It stops if tracked files on the VM have local changes.

## Collect questions through a helper computer

When the Azure VM cannot reach the CSDD test site, a helper computer can collect questions and send the updated bank to Azure. Set `CSN_REMOTE_WORKER=1` in the Azure `.env` file. The site will place collection requests in a queue. The helper computer checks the queue over SSH, runs the collector, and syncs the result. The site's administrator token remains the same.

On the helper computer, enable the user service once:

```bash
XDG_RUNTIME_DIR=/run/user/$(id -u) DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/$(id -u)/bus \
  systemctl --user link /home/tankist256/Documents/CSN/deploy/csn-collector-worker.service
XDG_RUNTIME_DIR=/run/user/$(id -u) DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/$(id -u)/bus \
  systemctl --user enable --now csn-collector-worker.service
```

The helper computer must be on and connected to the internet. If it is offline, the site reports this and does not start collection. If the connection is lost during collection, the site shows an error and keeps the saved question bank.

The helper computer is configured with `loginctl enable-linger tankist256`, so its user service can run after logout. Check the service with:

```bash
systemctl --user status csn-collector-worker.service
```

## Run a manual collection and sync

On the helper computer, run:

```bash
cd /home/tankist256/Documents/CSN
./deploy/collect-and-sync.sh 5
```

The number of tests must be from 1 to 50. The script collects questions locally, sends only missing media to the VM, then checks and replaces `questions.json` and `questions.js`. It saves a backup of the previous question bank in `/home/tankist256/csn-data-backups/`.

To sync the question bank already on the helper computer without collecting more questions, run:

```bash
./deploy/collect-and-sync.sh --sync-only
```

After the sync finishes, refresh the site. Keep the helper computer online during collection and sync. The Azure site can continue to run while the helper is offline.
