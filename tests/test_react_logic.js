import assert from "node:assert/strict";
import test from "node:test";
import { filterQuestions, highlightedParts, normalizeText, prepareQuestion } from "../solver/src/utils/search.js";
import { migrateBookmarks, readBookmarks, saveBookmarks } from "../solver/src/utils/bookmarks.js";

test("normalizes Latvian diacritics for question and answer search", () => {
  const question = prepareQuestion({
    id: "one", question: "Kāds ir atļautais ātrums?", options: [{ id: "a", text: "Pieļaujamais ātrums" }],
  });
  assert.equal(normalizeText("ĀČĒĢĪĶĻŅŠŪŽ"), "acegiklnsuz");
  assert.equal(filterQuestions([question], "atlaut", "all", new Set()).length, 1);
  assert.equal(filterQuestions([question], "atrums", "all", new Set()).length, 1);
});

test("highlights the original Latvian spelling of a normalized match", () => {
  assert.deepEqual(highlightedParts("Atļautais ātrums", "atlaut"), [
    { text: "Atļaut", match: true },
    { text: "ais ātrums", match: false },
  ]);
});

test("migrates saved legacy question IDs and keeps the existing storage key", () => {
  const storage = {
    value: JSON.stringify(["old-id"]),
    getItem(key) { assert.equal(key, "csdd_bookmarks"); return this.value; },
    setItem(key, value) { assert.equal(key, "csdd_bookmarks"); this.value = value; },
  };
  const migrated = migrateBookmarks([{ id: "new-id", legacy_id: "old-id" }], readBookmarks(storage));
  saveBookmarks(storage, migrated);
  assert.deepEqual([...readBookmarks(storage)], ["new-id"]);
});
