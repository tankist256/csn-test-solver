# Latvian-Only Interface Design

## Goal

Keep the CSDD solver in Latvian only. Its current question bank and answer options are already Latvian; translate the Russian interface and collector messages into Latvian without changing application behavior.

## Scope

- Keep all 85 questions and 248 answer options in their existing Latvian form.
- Translate the page title, all visible interface text, placeholders, accessible labels, tooltips, modal text, dynamic states, errors, and collector messages into Latvian.
- Do not add a language switcher, translation catalogs, locale preference, or other localization framework.
- Keep `<html lang="lv">` and a Latvian document title.
- Write code comments in clear English at B1–B2 level. Update existing Russian comments in files touched by this work.
- Preserve search, question rendering, filtering, pagination, bookmarks, themes, media, collector APIs, and responsive behavior.

## Architecture

Use Latvian literals directly in the existing HTML and JavaScript. Translate collector messages at their current source in the Python server, worker queue, and collector so the browser and command-line output stay Latvian. Keep the collector's API shape, state fields, and control flow unchanged.

## Verification

- Add checks for Latvian document metadata, Latvian-only page labels, and the absence of a language control or localization script.
- Update collector UI assertions to expect Latvian statuses and keep existing behavioral expectations.
- Run all Node and Python tests.
- Audit user-facing strings and code comments in files changed; inspect desktop and mobile layouts if a browser is available.

## Constraints

- No commits or pushes.
- Do not translate programming identifiers, API fields, or internal logic.
- Do not add dependencies or remove existing features.
