import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import AccountPanel from './components/AccountPanel.jsx';
import Header from './components/Header.jsx';
import ImageLightbox from './components/ImageLightbox.jsx';
import { QuestionCard } from './components/QuestionCard.jsx';
import QuestionDialog from './components/QuestionDialog.jsx';
import QuestionTile from './components/QuestionTile.jsx';
import {
  migrateBookmarks,
  readBookmarks,
  saveBookmarks,
} from './utils/bookmarks.js';
import {
  filterQuestions,
  prepareQuestion,
} from './utils/search.js';

const PAGE_SIZE = 6;
const DESKTOP_PAGE_SIZE = 12;

function readPreference(key, fallback) {
  try {
    return localStorage.getItem(key) || fallback;
  } catch {
    return fallback;
  }
}

function getCurrentSection() {
  if (location.protocol === "file:") return "answers";
  if (location.pathname === "/answers") return "answers";
  if (location.pathname === "/tests") return "tests";
  return "home";
}

export default function App() {
  const section = getCurrentSection();
  const [questions, setQuestions] = useState([]);
  const [loadState, setLoadState] = useState("loading");
  const [mode, setMode] = useState("solver");
  const [theme, setTheme] = useState(() => readPreference("csdd_theme", "dark"));
  const [bookmarks, setBookmarks] = useState(() => readBookmarks(localStorage));
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [isMobile, setIsMobile] = useState(() => window.matchMedia("(max-width: 640px)").matches);
  const [page, setPage] = useState(0);
  const [shownCount, setShownCount] = useState(DESKTOP_PAGE_SIZE);
  const [selectedAnswers, setSelectedAnswers] = useState({});
  const [activeQuestion, setActiveQuestion] = useState(null);
  const [image, setImage] = useState(null);
  const [countText, setCountText] = useState("Ielādē…");
  const questionTrigger = useRef(null);

  const filteredQuestions = useMemo(
    () => filterQuestions(questions, query, filter, bookmarks),
    [questions, query, filter, bookmarks],
  );

  useEffect(() => {
    if (section !== "answers") return;
    let cancelled = false;
    async function loadQuestions() {
      try {
        let data;
        if (Array.isArray(window.CSDD_QUESTIONS)) {
          data = window.CSDD_QUESTIONS;
        } else {
          const response = await fetch("questions.json");
          if (!response.ok) {
            throw new Error("Jautājumu datubāze nav atrasta.");
          }
          data = await response.json();
        }
        if (cancelled) return;
        const prepared = data.map(prepareQuestion);
        const migrated = migrateBookmarks(prepared, readBookmarks(localStorage));
        setQuestions(prepared);
        setBookmarks(migrated);
        saveBookmarks(localStorage, migrated);
        setLoadState("ready");
      } catch (error) {
        console.error("Neizdevās ielādēt jautājumu datubāzi:", error);
        if (!cancelled) setLoadState("error");
      }
    }
    loadQuestions();
    return () => {
      cancelled = true;
    };
  }, [section]);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    document.body.classList.remove("mode-solver", "mode-quiz");
    document.body.classList.add(`mode-${mode}`);
    try {
      localStorage.setItem("csdd_theme", theme);
      localStorage.setItem("csdd_mode", mode);
    } catch {
      // Preferences are optional when browser storage is unavailable.
    }
  }, [mode, theme]);

  useEffect(() => {
    document.body.classList.toggle("question-open", Boolean(activeQuestion));
    return () => document.body.classList.remove("question-open");
  }, [activeQuestion]);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 640px)");
    const updateLayout = () => setIsMobile(media.matches);
    media.addEventListener("change", updateLayout);
    return () => {
      media.removeEventListener("change", updateLayout);
    };
  }, []);

  useEffect(() => {
    if (loadState !== "ready") return;
    setPage(0);
    setShownCount(DESKTOP_PAGE_SIZE);
    setActiveQuestion(null);
    setSelectedAnswers({});
  }, [query, filter, isMobile, loadState]);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key !== "Escape") return;
      if (image) return;
      if (activeQuestion) closeQuestion();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [activeQuestion, image]);

  useEffect(() => {
    if (loadState !== "ready") return;
    const total = filteredQuestions.length;
    if (total === 0) setCountText(`Atrasti 0 no ${questions.length} jautājumiem`);
    else if (isMobile) {
      const first = page * PAGE_SIZE + 1;
      const last = Math.min(first + PAGE_SIZE - 1, total);
      const totalLabel = total === questions.length ? "" : ` · Kopā ${questions.length}`;
      setCountText(`Jautājumi ${first}–${last} no ${total}${totalLabel}`);
    } else {
      const shown = Math.min(shownCount, total);
      const totalLabel = total === questions.length ? "" : ` · Kopā ${questions.length}`;
      setCountText(`Rādīti ${shown} no ${total}${totalLabel}`);
    }
  }, [loadState, filteredQuestions.length, questions.length, isMobile, page, shownCount]);

  const mobilePageCount = Math.ceil(filteredQuestions.length / PAGE_SIZE);
  const visibleQuestions = isMobile
    ? filteredQuestions.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE)
    : filteredQuestions.slice(0, shownCount);
  let activeNumber = 0;
  if (activeQuestion) {
    activeNumber = filteredQuestions.findIndex((question) => question.id === activeQuestion.id) + 1;
  }
  const selectionFor = (question) => selectedAnswers[question.id];

  function toggleBookmark(id) {
    if (filter === "bookmarks") {
      setPage(0);
      setShownCount(DESKTOP_PAGE_SIZE);
    }
    setBookmarks((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      saveBookmarks(localStorage, next);
      return next;
    });
  }

  function selectOption(question, option) {
    if (mode !== "quiz" || question.verified !== true) return;
    setSelectedAnswers((current) => ({
      ...current,
      [question.id]: { selectedId: option.id, correctId: question.correct_id, correct: option.id === question.correct_id },
    }));
  }

  function openQuestion(question, trigger) {
    questionTrigger.current = trigger;
    setActiveQuestion(question);
  }

  function closeQuestion() {
    const questionId = activeQuestion?.id;
    setActiveQuestion(null);
    if (questionId) {
      setSelectedAnswers((current) => {
        const next = { ...current };
        delete next[questionId];
        return next;
      });
    }
    if (questionTrigger.current?.isConnected) questionTrigger.current.focus();
    questionTrigger.current = null;
  }

  function closeImage() {
    setImage(null);
  }

  function changeMode() {
    setMode((currentMode) => currentMode === "solver" ? "quiz" : "solver");
    setSelectedAnswers({});
  }

  function changeTheme() {
    setTheme((currentTheme) => currentTheme === "dark" ? "light" : "dark");
  }

  function showMoreQuestions() {
    setShownCount((currentCount) => currentCount + DESKTOP_PAGE_SIZE);
  }

  function goToPreviousPage() {
    closeQuestion();
    setPage((currentPage) => Math.max(0, currentPage - 1));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function goToNextPage() {
    closeQuestion();
    setPage((currentPage) => Math.min(mobilePageCount - 1, currentPage + 1));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function openImage(src, trigger) {
    setImage({ src, trigger });
  }

  return (
    <>
      <Header
        page={section} mode={mode} theme={theme} onModeChange={changeMode}
        onThemeChange={changeTheme}
        query={query}
        onQueryChange={setQuery}
        filter={filter}
        onFilterChange={setFilter}
        countText={countText}
      />
      {section === "home" && <main className="landing-page">
        <section className="landing-hero">
          <span className="eyebrow">B kategorijas teorija</span>
          <h1>Gatavojies ceļam ar pārliecību.</h1>
          <p>Atrodi pārbaudītas atbildes vai sāc personīgo testu. Rezultāti, progress un kvesti paliks tavā kontā.</p>
          <div className="landing-actions"><a className="btn btn-primary" href="/tests">Sākt testu <span aria-hidden="true">↗</span></a>
            <a className="btn" href="/answers">Skatīt atbildes <span aria-hidden="true">→</span></a></div>
        </section>
        <div className="landing-cards">
          <a className="landing-card" href="/answers"><span className="landing-icon">✓</span><span className="eyebrow">Mācies savā tempā</span>
            <strong>Gatavās atbildes</strong><span>Meklē jautājumus, apskati CSDD pārbaudītās atbildes un saglabā izlasi.</span><b>Atvērt atbildes →</b></a>
          <a className="landing-card" href="/tests"><span className="landing-icon">◎</span><span className="eyebrow">Pārbaudi zināšanas</span>
            <strong>Mani testi</strong><span>Izvēlies 30, 60 vai 120 jautājumus. Katram jautājumam ir 60 sekundes.</span><b>Sākt testu →</b></a>
        </div>
      </main>}
      {section === "tests" && <main className="tests-page">
        <div className="page-intro"><span className="eyebrow">Tavs mācību ceļš</span><h1>Mani testi un progress</h1>
          <p>Testi ar laika ierobežojumu, personīgie rezultāti, kvesti un līderu saraksts.</p></div>
        <AccountPanel />
      </main>}
      {section === "answers" && <>
      <div className="page-intro answers-intro"><span className="eyebrow">Jautājumu bibliotēka</span><h1>Gatavās atbildes</h1>
        <p>Pārbaudītās atbildes vienuviet. Lai pārbaudītu sevi bez atbilžu priekšskatījuma, ieslēdz treniņrežīmu.</p></div>
      <main className="main-content">
        <div id="questions-container" className="questions-grid">
          {loadState === "loading" && <div className="empty-state"><h3>Ielādē jautājumus…</h3></div>}
          {loadState === "error" && <div className="empty-state"><div className="empty-icon">⚠️</div><h3>Jautājumu datubāze vēl ir tukša</h3><p>Papildiniet datubāzi vai sazinieties ar vietnes administratoru.</p></div>}
          {loadState === "ready" && filteredQuestions.length === 0 && <div className="empty-state"><div className="empty-icon">🔍</div><h3>Nekas nav atrasts</h3><p>Mainiet meklēšanas vaicājumu vai izvēlieties citu filtru.</p></div>}
          {loadState === "ready" && isMobile && visibleQuestions.map((question, index) => {
            const absoluteIndex = page * PAGE_SIZE + index;
            return (
              <QuestionTile
                key={question.id}
                question={question}
                number={absoluteIndex + 1}
                query={query}
                mode={mode}
                bookmarked={bookmarks.has(question.id)}
                onOpen={(event) => openQuestion(question, event.currentTarget)}
              />
            );
          })}
          {loadState === "ready" && !isMobile && visibleQuestions.map((question, index) => (
            <QuestionCard
              key={question.id}
              question={question}
              number={index + 1}
              query={query}
              mode={mode}
              bookmarked={bookmarks.has(question.id)}
              selection={selectionFor(question)}
              onToggleBookmark={toggleBookmark}
              onSelectOption={selectOption}
              onOpenImage={openImage}
            />
          ))}
          {loadState === "ready" && isMobile && visibleQuestions.length > 0 && Array.from({ length: Math.max(0, PAGE_SIZE - visibleQuestions.length) }, (_, index) => <div key={`placeholder-${index}`} className="question-tile tile-placeholder" aria-hidden="true" />)}
        </div>
        {!isMobile && loadState === "ready" && (
          <button
            id="load-more-btn"
            className="btn load-more-btn"
            type="button"
            hidden={shownCount >= filteredQuestions.length}
            onClick={showMoreQuestions}
          >
            Parādīt vēl jautājumus
          </button>
        )}
        {isMobile && loadState === "ready" && filteredQuestions.length > 0 && (
          <nav id="questions-pagination" className="questions-pagination" aria-label="Jautājumu lapas">
            <button
              id="previous-page-btn"
              className="btn page-btn"
              type="button"
              disabled={page === 0}
              onClick={goToPreviousPage}
            >
              ← Iepriekšējā
            </button>
            <span id="page-indicator" className="page-indicator" aria-live="polite">
              {page + 1} / {mobilePageCount}
            </span>
            <button
              id="next-page-btn"
              className="btn page-btn"
              type="button"
              disabled={page >= mobilePageCount - 1}
              onClick={goToNextPage}
            >
              Nākamā →
            </button>
          </nav>
        )}
      </main>
      <QuestionDialog
        question={activeQuestion}
        number={activeNumber}
        query={query}
        mode={mode}
        bookmarked={activeQuestion ? bookmarks.has(activeQuestion.id) : false}
        selection={activeQuestion ? selectionFor(activeQuestion) : undefined}
        onClose={closeQuestion}
        onToggleBookmark={toggleBookmark}
        onSelectOption={selectOption}
        onOpenImage={openImage}
      />
      {image && <ImageLightbox image={image.src} returnFocus={image.trigger} onClose={closeImage} />}
      </>}
    </>
  );
}
