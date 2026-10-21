import React from "react";
import { LazyQuestionImage } from "./QuestionMedia.jsx";
import { HighlightedText } from "./QuestionCard.jsx";
import { verifiedCorrectOption } from "../utils/answers.js";

export default function QuestionTile({ question, number, query, mode, bookmarked, onOpen }) {
  const correct = verifiedCorrectOption(question);
  const showAnswer = mode === "solver" && correct;
  return (
    <button
      type="button"
      className="question-tile"
      aria-label={`Atvērt jautājumu ${number}: ${question.question}${showAnswer ? `. Pareizā atbilde: ${correct.text}` : ""}`}
      onClick={onOpen}
    >
      <span className="tile-number">№ {number}</span>
      {bookmarked && <span className="tile-bookmark" aria-hidden="true">★</span>}
      {question.video
        ? <span className="tile-media tile-video" aria-hidden="true">▶</span>
        : question.img
          ? <span className="tile-media"><LazyQuestionImage src={question.img} /></span>
          : <span className="tile-media tile-video" aria-hidden="true">?</span>}
      <span className="tile-preview"><HighlightedText text={question.question} query={query} /></span>
      {mode === "solver" && (
        <span className={`tile-answer ${showAnswer ? "" : "tile-answer-unverified"}`}>
          <span className="tile-answer-label">{showAnswer ? "✓ Pareizā atbilde" : "Atbilde vēl nav pārbaudīta"}</span>
          {showAnswer && <span className="tile-answer-text"><HighlightedText text={correct.text} query={query} /></span>}
        </span>
      )}
    </button>
  );
}
