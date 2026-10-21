const LETTERS = {
  ā: "a", č: "c", ē: "e", ģ: "g", ī: "i", ķ: "k", ļ: "l", ņ: "n", š: "s", ū: "u", ž: "z",
};

export function normalizeText(value) {
  return String(value ?? "")
    .toLocaleLowerCase("lv-LV")
    .replace(/[āčēģīķļņšūž]/g, (letter) => LETTERS[letter])
    .trim();
}

export function prepareQuestion(question) {
  return {
    ...question,
    searchText: normalizeText([question.question, ...(question.options || []).map((option) => option.text)].join(" ")),
  };
}

export function filterQuestions(questions, query, filter, bookmarks) {
  const normalizedQuery = normalizeText(query);
  return questions.filter((question) => {
    if (filter === "images" && !question.img) return false;
    if (filter === "videos" && !question.video) return false;
    if (filter === "bookmarks" && !bookmarks.has(question.id)) return false;
    return !normalizedQuery || question.searchText.includes(normalizedQuery);
  });
}

// Map normalized match positions back to the original Latvian text.
export function highlightedParts(value, query) {
  const text = String(value ?? "");
  const needle = normalizeText(query);
  if (!needle) return [{ text, match: false }];

  const normalized = normalizeText(text);
  const parts = [];
  let offset = 0;
  while (offset < text.length) {
    const index = normalized.indexOf(needle, offset);
    if (index < 0) break;
    if (index > offset) parts.push({ text: text.slice(offset, index), match: false });
    parts.push({ text: text.slice(index, index + needle.length), match: true });
    offset = index + needle.length;
  }
  if (offset < text.length) parts.push({ text: text.slice(offset), match: false });
  return parts.length ? parts : [{ text, match: false }];
}
