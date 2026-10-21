export function verifiedCorrectOption(question) {
  if (question?.verified !== true) return null;
  return question.options.find((option) => option.id === question.correct_id) || null;
}

export function isCorrectOption(question, option) {
  return question?.verified === true && option?.id === question.correct_id;
}
