export const BOOKMARKS_KEY = "csdd_bookmarks";

export function readBookmarks(storage) {
  try {
    return new Set(JSON.parse(storage.getItem(BOOKMARKS_KEY) || "[]"));
  } catch {
    return new Set();
  }
}

export function migrateBookmarks(questions, saved) {
  const next = new Set(saved);
  questions.forEach((question) => {
    if (question.legacy_id && next.has(question.legacy_id)) {
      next.delete(question.legacy_id);
      next.add(question.id);
    }
  });
  return next;
}

export function saveBookmarks(storage, bookmarks) {
  storage.setItem(BOOKMARKS_KEY, JSON.stringify([...bookmarks]));
}
