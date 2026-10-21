# Latvian-Only Interface Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the CSDD solver interface Latvian-only while preserving current behavior.

**Architecture:** Keep direct Latvian text in the existing static HTML and vanilla JavaScript. Translate collector status and diagnostic messages in the existing Python server, worker queue, and collector without changing their API shape or control flow.

**Tech Stack:** Existing HTML, CSS, vanilla JavaScript, Python, Node built-in test runner, Python unittest.

**Spec:** `docs/superpowers/specs/2026-10-21-website-localization-design.md`

## Global Constraints

- No commits or pushes.
- Do not add a language switcher, translation catalogs, locale preference, or localization framework.
- Keep questions, answer options, and all user-facing interface text in Latvian.
- Write code comments in clear English at B1–B2 level.
- Preserve search, question rendering, filters, pagination, bookmarks, themes, media, collector APIs, and responsive behavior.

## Review Focus

- Static page fallback: direct file opening remains Latvian and functional; test the script list and static document metadata.
- Dynamic collector state: offline, queued, running, success, and error messages remain Latvian while button/progress behavior stays the same; assert labels and behavior in Node tests.
- Server-generated messages: worker queue and local server responses remain Latvian without changing JSON field names; exercise current Python tests and check representative messages.
- Collector output: CLI and browser log lines remain Latvian; assert representative output strings and preserve round parsing.
- Comments: touched code has no Russian comments or unclear non-English comments; scan comment lines after edits.

---

### Task 1: Set Latvian page metadata and static labels

**Files:**
- Modify: `solver/index.html`
- Create: `tests/test_latvian_ui.js`

**Interfaces:**
- `<html lang="lv">` and the title describe the CSDD category B theory solver in Latvian.
- The header contains no language selector and loads no localization script.

- [x] **Step 1: Write failing tests** named `uses Latvian page metadata`, `keeps every static page control in Latvian`, and `does not load a language switcher or localization system`. Read `solver/index.html` and assert `lang="lv"`, a Latvian title and labels, no selector, and only the existing `questions.js` and `app.js` scripts.
- [x] **Step 2: Run `node --test tests/test_latvian_ui.js` and confirm failures** on the current Russian page text and `lang="ru"`.
- [x] **Step 3: Translate all text and accessibility attributes in `solver/index.html` into natural Latvian**. Keep the existing element IDs, controls, layout, and script order.
- [x] **Step 4: Rerun the focused test and confirm all static page checks pass.**

### Task 2: Translate dynamic browser interface text

**Files:**
- Modify: `solver/app.js`
- Modify: `tests/test_collector_ui.js`
- Test: `tests/test_latvian_ui.js`

**Interfaces:**
- Keep existing global functions, DOM IDs, API requests, and state behavior.
- Render all card, filter, search, count, pagination, bookmark, media, lightbox, and empty-state text in Latvian.

- [x] **Step 1: Update/add failing tests** named `renders Latvian offline and running collector states` and `keeps collector behavior while showing Latvian labels`; assert Latvian strings plus the existing disabled/progress/log outcomes.
- [x] **Step 2: Run `node --test tests/test_collector_ui.js tests/test_latvian_ui.js` and confirm failures** on Russian UI output.
- [x] **Step 3: Translate user-facing strings in `solver/app.js` to natural Latvian** and rewrite Russian code comments as clear, simple English. Preserve event handling and business logic.
- [x] **Step 4: Rerun the focused Node tests and confirm labels and interaction behavior pass.**

### Task 3: Translate server, worker, and collector messages

**Files:**
- Modify: `solver/serve.py`
- Modify: `solver/job_queue.py`
- Modify: `solver/collector.py`
- Modify: `solver/thumbnails.py`
- Modify: `deploy/collect-and-sync.sh`
- Modify: `deploy/apply-data-sync.py`
- Modify: `parser.py` (comments only)
- Modify: `tests/test_job_queue.py`
- Create: `tests/test_serve.py`

**Interfaces:**
- Preserve API routes, JSON fields, exception types, state transitions, and log parsing behavior.
- User-facing API messages, collector progress and errors, and server startup/shutdown output use Latvian.

- [x] **Step 1: Add or update tests** named `reports Latvian worker status messages` and `keeps collector round progress parsing with Latvian output`; assert queue messages are Latvian and the existing progress event still updates the completed round count. Add malformed-JSON and remote sync status checks.
- [x] **Step 2: Run the relevant Python tests and confirm they fail** on Russian text or are missing representative language assertions.
- [x] **Step 3: Translate user-facing strings in the server, queue, and collector**; rewrite Russian code comments in these files as clear, simple English. Keep internal identifiers and API fields unchanged.
- [x] **Step 4: Run `.venv/bin/python -m unittest tests.test_job_queue` and confirm the tests pass.**

### Task 4: Full verification and language audit

**Files:**
- Modify only files where verification finds a Latvian copy or comment gap.
- Test: all Node tests under `tests/`
- Test: all Python tests under `tests/`

**Interfaces:**
- Consumes the unchanged app structure and the Latvian-only interface from Tasks 1–3.

- [x] **Step 1: Run all Node tests** with `node --test tests/*.js`; fix any regression.
- [x] **Step 2: Run all Python tests** with `.venv/bin/python -m unittest discover -s tests`; fix any regression.
- [x] **Step 3: Audit visible strings and comments** in `solver/index.html`, `solver/app.js`, `solver/serve.py`, `solver/job_queue.py`, `solver/collector.py`, `solver/thumbnails.py`, and `parser.py`; confirm all solver UI/status messages are Latvian and all code comments are clear English.
- [ ] **Step 4: Inspect the app at desktop and mobile widths** if a browser is available, and record only checks actually performed. Desktop page loaded directly from `solver/index.html`; mobile viewport was not inspected.
