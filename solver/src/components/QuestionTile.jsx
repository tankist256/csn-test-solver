import React from 'react';

import { verifiedCorrectOption } from '../utils/answers.js';
import { HighlightedText } from './QuestionCard.jsx';
import { LazyQuestionImage } from './QuestionMedia.jsx';

export default function QuestionTile({ question, number, query, mode, bookmarked, onOpen }) {
  const correct = verifiedCorrectOption(question);
  const showAnswer = mode === "solver" && correct;
  let media;

  if (question.video) {
    media = <span className="tile-media tile-video" aria-hidden="true">▶</span>;
  } else if (question.img) {
    media = <span className="tile-media"><LazyQuestionImage src={question.img} /></span>;
  } else {
    media = <span className="tile-media tile-video" aria-hidden="true">?</span>;
  }

  let answerLabel = "";
  if (mode === "solver") {
    answerLabel = showAnswer ? "✓ Pareizā atbilde" : "Atbilde vēl nav pārbaudīta";
  }

  return (
    <button
      type="button"
      className="question-tile"
      aria-label={`Atvērt jautājumu ${number}: ${question.question}${showAnswer ? `. Pareizā atbilde: ${correct.text}` : ""}`}
      onClick={onOpen}
    >
      <span className="tile-number">№ {number}</span>
      {bookmarked && <span className="tile-bookmark" aria-hidden="true">★</span>}
      {media}
      <span className="tile-preview"><HighlightedText text={question.question} query={query} /></span>
      {mode === "solver" && (
        <span className={`tile-answer ${showAnswer ? "" : "tile-answer-unverified"}`}>
          <span className="tile-answer-label">{answerLabel}</span>
          {showAnswer && <span className="tile-answer-text"><HighlightedText text={correct.text} query={query} /></span>}
        </span>
      )}
    </button>
  );
}
