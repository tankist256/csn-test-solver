# CSDD Theory Test Solver

A local question bank and study tool for CSDD / CredoAutoprieks category B theory tests in Latvia. Search questions, practise without seeing answers, and collect questions from the official CSDD site. The website interface is in Latvian, and the source questions and answers are kept in Latvian.

> This is not an official CSDD service. Before your exam, check important rules against current official materials.

## Features

- Search question and answer text, including searches without Latvian diacritics. For example, `atrums` finds `ātrums`.
- View road diagrams, images, and videos.
- Use two modes: the answer mode shows verified answers, while practice mode hides them until you choose an option.
- Save favourite questions in the browser.
- On phones, view six questions per page in a 2 × 3 grid. Verified answers are visible in answer mode. On computers, questions appear as full-size cards.
- View small WebP image previews. Videos load only after you press play.
- Add questions from the site. On Azure, a helper computer collects them while it is online.

An answer is marked as correct only after it is checked against the official CSDD review page. An answer that has not been checked is not shown as correct.

## Quick start

You need Python 3.10 or later and Node.js 20 or later. Internet access is needed to collect questions.

```bash
git clone git@github.com:tankist256/csn-test-solver.git
cd csn-test-solver
# Install JavaScript dependencies, then build the website.
npm ci
npm run build

# Create the Python environment and install server/collector dependencies.
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt

# Start the server from the project root.
.venv/bin/python solver/serve.py
```

Open [http://localhost:8080](http://localhost:8080) in a browser. The answer bank is at `/answers`; personal tests and the admin panel are at `/tests`.

To open the site on a phone on the same Wi-Fi network, use `http://<computer-IP>:8080`. The server prints the computer's address in the terminal.

You can also open `solver/index.html` directly after building the website. This lets you view the question bank already on your computer, but the site cannot start the Python collector without the server.

## Collect questions

Sign in with an administrator account, open `/tests`, then use the collection button in the administration panel:

1. Choose how many tests to collect. One test contains 30 questions.
2. Start the collection and wait for the completion message.
3. Open `/answers` after collection finishes to load the updated question bank.

For a first run, 1–5 tests are usually enough. More runs may collect more road situations.

The server checks the administrator role on every collection request, including status and logs. A collector token does not grant access. With authentication disabled, collection remains available from the command line only.

Use HTTPS for a public site.

The server creates WebP previews in `solver/media/thumbs/`. On startup, it prepares previews for questions already collected. The full-size image opens when selected. Pillow from `requirements.txt` is needed to create previews.

| Tests | Questions processed | Approximate time |
| ---: | ---: | --- |
| 1 | 30 | 15–25 seconds |
| 5 | 150 | 2–3 minutes |
| 10 | 300 | 3–5 minutes |
| 20 | 600 | 6–9 minutes |
| 50 | 1,500 | 15–23 minutes |

The time depends on the CSDD site and on whether new images or videos need to be downloaded.

You can also run the collector from a terminal:

```bash
# Collect 20 tests, with 30 questions in each test.
.venv/bin/python solver/collector.py --rounds 20

# Keep collecting until you press Ctrl+C.
.venv/bin/python solver/collector.py --loop
```

The collector checks answers against the official CSDD review page and links them to the question, answer options, and related media. Different road situations can have the same question and answers, so the media is part of the match. If the review page cannot be read or the full error list cannot be checked, that test is discarded. On a later run, existing answers are checked again and updated when needed. When a corrected collector first runs, older answers are marked as unverified until CSDD checks them again.

A successful run updates `solver/questions.json` and `solver/questions.js`.

## Why the question bank is not included

The files `solver/questions.json`, `solver/questions.js`, `solver/media/`, and `csn_materials*/` are created on your computer and excluded from Git. They contain large, changing data. Run collection from the site to create them locally.

These paths are listed in `.gitignore` to help prevent generated data from being added to a commit by mistake.

## Project files

| Path | Purpose |
| --- | --- |
| `solver/index.html` | Website page |
| `solver/src/` and `solver/style.css` | React website and appearance |
| `package.json` | Frontend tools and build command |
| `solver/serve.py` | Local web server and collection API |
| `solver/collector.py` | Collects questions, answers, and media from CSDD |
| `solver/questions.json` | Local question bank created by the collector |
| `solver/media/` | Local images and videos created by the collector |
| `parser.py` | Separate collector for written CSN materials |
| `docker-compose.yml` | Runs project services with Docker |

See [solver/README.md](solver/README.md) for details about the question collector. See [deploy/README.md](deploy/README.md) for Azure setup and checks.

For temporary personal accounts backed by PostgreSQL, see
[docs/postgres-local-auth.md](docs/postgres-local-auth.md). The Entra External ID
setup remains documented in [docs/entra-progress-setup.md](docs/entra-progress-setup.md).

## Docker

If Docker is installed, run:

```bash
docker compose up --build solver
```

Then open [http://localhost:8080](http://localhost:8080). Press `Ctrl+C` to stop the server.

Docker Compose binds port 8080 to this computer only. To let a phone on your
local network connect to the Docker version, run
`CSN_BIND_ADDRESS=0.0.0.0 docker compose up --build solver` on a trusted network.

## Azure deployment

After the one-time setup, the VM checks GitHub for updates to `main` and applies them to the website container. The question bank and media stay on the VM. See [deploy/README.md](deploy/README.md) for setup and verification steps.

When the Azure VM cannot reach the CSDD test site, the public site can send collection jobs to a helper computer. The computer must be online and connected to the internet. The site shows the job status and result, and the question bank is synced to Azure after collection. If the computer is offline, the site reports this before a job starts. You can also run `./deploy/collect-and-sync.sh 5` by hand. A normal `git push` updates code, but it does not update the question bank.

## License and credit

The original project author is [tankist256](LICENSE). Forks and changes are allowed when author credit and a note about changes are kept. See [LICENSE](LICENSE) for the full terms.
