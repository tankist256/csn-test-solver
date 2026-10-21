# CSDD Theory Test Solver and Question Bank

A local question bank and study tool for CSDD / CredoAutoprieks category B theory tests. The website interface and saved questions are in Latvian.

---

## Quick start

Build the React website once before using either option:

```bash
npm install
npm run build
```

### Option 1: Open the page directly

Open [`index.html`](index.html) in a browser such as Chrome, Firefox, or Safari. This works with a question bank that is already saved on your computer.

### Option 2: Start the local server

Use the server to collect questions and to open the site on a phone or tablet on the same Wi-Fi network:

```bash
.venv/bin/python solver/serve.py
```

After the server starts, open:

- On this computer: `http://localhost:8080`
- On a phone or tablet: `http://<computer-IP>:8080`

The terminal shows the computer's network address.

## Features

1. **Live search**
   - Search question and answer text.
   - Search ignores case and Latvian diacritics (`ā, č, ē, ģ, ī, ķ, ļ, ņ, š, ū, ž` become their basic letters).
   - For example, `atrums` finds questions that contain `ātrums`.
2. **Answer mode**
   - A correct answer is marked in green only after CSDD has verified it.
   - Answers that need a new check are hidden until they are verified again.
   - Incorrect options appear dimmed.
3. **Practice mode**
   - Answers stay hidden until you choose an option.
   - A correct choice turns green. An incorrect choice turns red and reveals the correct option.
4. **Road images and videos**
   - Road diagrams and images are stored in `media/`. Cards use small WebP previews that keep the full image visible.
   - Select an image to open the original at full size.
   - Videos load only after you select the play button.
5. **Filters and favourites**
   - Filter by images or videos, or save difficult questions with the star button. Favourites are saved in browser storage.
   - On phones, six questions appear in a 2 × 3 grid. In answer mode, a verified answer is visible. Select a tile to open the question with all options. Use the buttons below the grid to change pages.
   - On computers, questions appear as full-size cards.

## Collect questions

When the site runs through the local server, use the question collection button at the top of the page. Choose the number of tests and start collection. The dialog shows the current test and a log. The question list updates when collection finishes.

When `serve.py` runs directly on the local computer, the button is available without a token. For a public site or Docker, set `CSN_COLLECTOR_TOKEN` and enter the same token in the dialog. Without a token, public users cannot start collection or view its log. Opening `index.html` directly cannot start the Python collector.

| Tests | Questions processed | Approximate time | When to use |
| ---: | ---: | --- | --- |
| 1 | 30 | 15–25 seconds | Add a few questions or check that collection works |
| 5 | 150 | 2–3 minutes | Regularly add to the question bank |
| 10 | 300 | 3–5 minutes | Collect more road situations |
| 20 | 600 | 6–9 minutes | Run a larger update |
| 30 | 900 | 9–14 minutes | Collect a large sample |
| 40 | 1,200 | 12–18 minutes | Collect an even larger sample |
| 50 | 1,500 | 15–23 minutes | Process the maximum number of tests in one run |

Collection can take longer when CSDD responds slowly or when new images and videos need to be downloaded.

To run the collector directly:

```bash
# Collect 20 tests, with 30 questions in each test.
.venv/bin/python solver/collector.py --rounds 20

# Keep collecting until you press Ctrl+C.
.venv/bin/python solver/collector.py --loop
```

The collector checks correct answers against the official CSDD review page. It links each answer to the question, options, and related image or video. Different situations can have the same question and answers. If the review page cannot be read or the full error list cannot be checked, that test is discarded. On later runs, answers are checked again and updated when needed. After an update to the collector, older answers are marked as unverified until CSDD checks them again.

A successful collection updates `questions.json` and `questions.js`.

---

The original project author is [tankist256](../LICENSE). Forks and changes are allowed when author credit and a note about changes are kept. See [LICENSE](../LICENSE) for the full terms.
