import React from "react";
import { QuestionMedia } from "./QuestionMedia.jsx";
import { highlightedParts } from "../utils/search.js";
import { isCorrectOption } from "../utils/answers.js";

export function HighlightedText({ text, query }) {
  return highlightedParts(text, query).map((part, index) => (
    part.match
      ? <mark className="highlight" key={index}>{part.text}</mark>
      : <span key={index}>{part.text}</span>
  ));
}

export function QuestionCard({ question, number, query, mode, bookmarked, selection, onToggleBookmark, onSelectOption, onOpenImage, fullImage = false }) {
  const verified = question.verified === true;
  return (
    <article className="question-card" id={`q-${question.id}`}>
      <QuestionMedia question={question} full={fullImage} onOpenImage={onOpenImage} />
      <div className="card-body">
        <div className="card-header-line">
          <span className="question-number">Jautājums {number}</span>
          <button
            type="button"
            className={`btn-bookmark ${bookmarked ? "bookmarked" : ""}`}
            aria-pressed={bookmarked}
            aria-label={bookmarked ? "Noņemt no izlases" : "Pievienot izlasei"}
            title={bookmarked ? "Noņemt no izlases" : "Pievienot izlasei"}
            onClick={() => onToggleBookmark(question.id)}
          >{bookmarked ? "★" : "☆"}</button>
        </div>
        <div className="question-text"><HighlightedText text={question.question} query={query} /></div>
        {!verified && <div className="answer-status">Atbilde CSDD vēl nav pārbaudīta.</div>}
        <div className="options-list">
          {question.options.map((option, index) => {
            const correct = isCorrectOption(question, option);
            const answerState = selection?.correctId === option.id
              ? selection.correct ? "selected-correct" : "revealed-correct"
              : selection?.selectedId === option.id && !selection.correct ? "selected-wrong" : "";
            return (
              <button
                key={option.id}
                type="button"
                className={`option-item ${mode === "solver" && correct ? "correct" : ""} ${answerState}`}
                disabled={mode !== "quiz" || !verified}
                onClick={() => onSelectOption(question, option)}
              >
                <span className="option-marker">{mode === "solver" && correct ? "✓" : String.fromCharCode(65 + index)}</span>
                <span className="option-text"><HighlightedText text={option.text} query={query} /></span>
              </button>
            );
          })}
        </div>
      </div>
    </article>
  );
}
