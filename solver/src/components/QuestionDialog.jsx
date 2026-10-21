import React, { useEffect, useRef } from "react";
import { QuestionCard } from "./QuestionCard.jsx";

export default function QuestionDialog({ question, number, query, mode, bookmarked, selection, onClose, onToggleBookmark, onSelectOption, onOpenImage }) {
  const closeRef = useRef(null);
  useEffect(() => { if (question) closeRef.current?.focus(); }, [question]);
  if (!question) return null;
  return (
    <div className="dialog-backdrop question-backdrop active" aria-hidden="false" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="question-dialog" role="dialog" aria-modal="true" aria-label="Jautājums un atbilžu varianti">
        <button ref={closeRef} id="question-close-btn" className="dialog-close question-close" type="button" aria-label="Aizvērt jautājumu" onClick={onClose}>✕</button>
        <div id="question-detail">
          <QuestionCard question={question} number={number} query={query} mode={mode} bookmarked={bookmarked} selection={selection} onToggleBookmark={onToggleBookmark} onSelectOption={onSelectOption} onOpenImage={onOpenImage} fullImage />
        </div>
      </section>
    </div>
  );
}
