import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Header from "./components/Header.jsx";
import QuestionTile from "./components/QuestionTile.jsx";
import { QuestionCard } from "./components/QuestionCard.jsx";
import QuestionDialog from "./components/QuestionDialog.jsx";
import CollectorDialog from "./components/CollectorDialog.jsx";
import ImageLightbox from "./components/ImageLightbox.jsx";
import AccountPanel from "./components/AccountPanel.jsx";
import { migrateBookmarks, readBookmarks, saveBookmarks } from "./utils/bookmarks.js";
import { filterQuestions, prepareQuestion } from "./utils/search.js";
import { clampRounds, collectorHeaders } from "./utils/collector.js";

const PAGE_SIZE = 6;
const DESKTOP_PAGE_SIZE = 12;

function readPreference(key, fallback) {
  try { return localStorage.getItem(key) || fallback; } catch { return fallback; }
}

export default function App() {
  const [questions, setQuestions] = useState([]);
  const [loadState, setLoadState] = useState("loading");
  const [mode, setMode] = useState(() => readPreference("csdd_mode", "solver"));
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
  const [collectorOpen, setCollectorOpen] = useState(false);
  const [collector, setCollector] = useState({ available: false, requiresToken: false, workerMode: false, state: null, wasRunning: false });
  const [collectorToken, setCollectorToken] = useState("");
  const [collectorRounds, setCollectorRounds] = useState("1");
  const [collectorPending, setCollectorPending] = useState(false);
  const [collectorError, setCollectorError] = useState("");
  const [countText, setCountText] = useState("Ielādē…");
  const questionTrigger = useRef(null);
  const collectorTrigger = useRef(null);
  const requestVersion = useRef(0);

  const filteredQuestions = useMemo(
    () => filterQuestions(questions, query, filter, bookmarks),
    [questions, query, filter, bookmarks],
  );

  useEffect(() => {
    let cancelled = false;
    async function loadQuestions() {
      try {
        const data = Array.isArray(window.CSDD_QUESTIONS)
          ? window.CSDD_QUESTIONS
          : await fetch("questions.json").then((response) => {
            if (!response.ok) throw new Error("Jautājumu datubāze nav atrasta.");
            return response.json();
          });
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
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    document.body.classList.remove("mode-solver", "mode-quiz");
    document.body.classList.add(`mode-${mode}`);
    try {
      localStorage.setItem("csdd_theme", theme);
      localStorage.setItem("csdd_mode", mode);
    } catch { /* Preferences are optional when browser storage is unavailable. */ }
  }, [mode, theme]);

  useEffect(() => {
    document.body.classList.toggle("question-open", Boolean(activeQuestion));
    return () => document.body.classList.remove("question-open");
  }, [activeQuestion]);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 640px)");
    const updateLayout = () => setIsMobile(media.matches);
    media.addEventListener("change", updateLayout);
    return () => media.removeEventListener("change", updateLayout);
  }, []);

  useEffect(() => {
    if (loadState !== "ready") return;
    setPage(0);
    setShownCount(DESKTOP_PAGE_SIZE);
    setActiveQuestion(null);
    setSelectedAnswers({});
  }, [query, filter, isMobile, loadState]);

  const refreshCollectorStatus = useCallback(async () => {
    if (!collector.available || (collector.requiresToken && !collectorToken.trim())) return;
    const version = ++requestVersion.current;
    try {
      const headers = collectorHeaders(collector.requiresToken, collectorToken);
      const response = await fetch("/api/collector/status", { cache: "no-store", headers });
      if (version !== requestVersion.current) return;
      if (response.status === 401) {
        setCollectorError("Piekļuves atslēga nav derīga.");
        return;
      }
      if (!response.ok) throw new Error("Jautājumu ievācējs nav pieejams.");
      const state = await response.json();
      if (version !== requestVersion.current) return;
      setCollector((current) => ({ ...current, state, wasRunning: current.wasRunning || state.running }));
      if (!state.running && collector.wasRunning) {
        setCollector((current) => ({ ...current, wasRunning: false }));
        await reloadQuestionBank();
      }
    } catch {
      if (version === requestVersion.current) setCollectorError("Neizdevās izveidot savienojumu ar jautājumu ievācēju.");
    }
  }, [collector.available, collector.requiresToken, collectorToken, collector.wasRunning]);

  useEffect(() => {
    if (location.protocol === "file:") return undefined;
    let active = true;
    fetch("/api/collector/access", { cache: "no-store" })
      .then((response) => response.ok ? response.json() : null)
      .then((access) => {
        if (!active || !access?.available) return;
        setCollector((current) => ({ ...current, available: true, requiresToken: Boolean(access.requires_token), workerMode: Boolean(access.worker_mode) }));
      })
      .catch(() => {});
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!collector.available || (collector.requiresToken && !collectorToken.trim())) return undefined;
    refreshCollectorStatus();
    const timer = window.setInterval(refreshCollectorStatus, collector.state?.running ? 1000 : collector.workerMode ? 5000 : 5000);
    return () => window.clearInterval(timer);
  }, [collector.available, collector.requiresToken, collectorToken, collector.workerMode, collector.state?.running, refreshCollectorStatus]);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key !== "Escape") return;
      if (image) return;
      if (collectorOpen) closeCollector();
      else if (activeQuestion) closeQuestion();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [collectorOpen, activeQuestion, image]);

  useEffect(() => {
    if (loadState !== "ready") return;
    const total = filteredQuestions.length;
    if (total === 0) setCountText(`Atrasti 0 no ${questions.length} jautājumiem`);
    else if (isMobile) {
      const first = page * PAGE_SIZE + 1;
      const last = Math.min(first + PAGE_SIZE - 1, total);
      setCountText(`Jautājumi ${first}–${last} no ${total}${total !== questions.length ? ` · Kopā ${questions.length}` : ""}`);
    } else {
      const shown = Math.min(shownCount, total);
      setCountText(`Rādīti ${shown} no ${total}${total !== questions.length ? ` · Kopā ${questions.length}` : ""}`);
    }
  }, [loadState, filteredQuestions.length, questions.length, isMobile, page, shownCount]);

  async function reloadQuestionBank() {
    try {
      const response = await fetch(`questions.json?t=${Date.now()}`, { cache: "no-store" });
      if (!response.ok) throw new Error("Neizdevās ielādēt atjaunināto datubāzi.");
      const data = await response.json();
      const prepared = data.map(prepareQuestion);
      setQuestions(prepared);
      window.CSDD_QUESTIONS = data;
      const migrated = migrateBookmarks(prepared, readBookmarks(localStorage));
      setBookmarks(migrated);
      saveBookmarks(localStorage, migrated);
    } catch {
      setCollectorError("Neizdevās ielādēt atjaunināto datubāzi. Atjauniniet lapu manuāli.");
    }
  }

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

  function openCollector(event) {
    collectorTrigger.current = event.currentTarget;
    setCollectorOpen(true);
    setCollectorError("");
  }

  function closeCollector() {
    setCollectorOpen(false);
    if (collectorTrigger.current?.isConnected) collectorTrigger.current.focus();
    collectorTrigger.current = null;
  }

  async function startCollector() {
    if (collectorPending) return;
    if (collector.requiresToken && !collectorToken.trim()) {
      setCollectorError("Ievadiet jautājumu ievācēja piekļuves atslēgu.");
      document.getElementById("collector-token")?.focus();
      return;
    }
    const rounds = clampRounds(collectorRounds);
    setCollectorRounds(String(rounds));
    setCollectorPending(true);
    setCollectorError("");
    requestVersion.current += 1;
    const headers = collectorHeaders(collector.requiresToken, collectorToken, true);
    const testForm = rounds % 10 === 1 && rounds % 100 !== 11 ? "testu" : "testus";
    setCollector((current) => ({ ...current, wasRunning: true, state: { running: true, phase: "queued", rounds, completed_rounds: 0, log: [], message: `Sāku ievākt ${rounds.toLocaleString("lv-LV")} ${testForm}…` } }));
    try {
      const response = await fetch("/api/collector/start", { method: "POST", headers, body: JSON.stringify({ rounds }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Neizdevās sākt jautājumu ievākšanu.");
      setCollector((current) => ({ ...current, wasRunning: true, state: data }));
    } catch (error) {
      const message = error.message?.startsWith("Neizdevās") || error.message?.startsWith("Ievadiet")
        ? error.message : "Neizdevās izveidot savienojumu ar jautājumu ievācēju.";
      setCollectorError(message);
      setCollector((current) => ({ ...current, wasRunning: false, state: { ...current.state, running: false } }));
    } finally {
      setCollectorPending(false);
    }
  }

  const mobilePageCount = Math.ceil(filteredQuestions.length / PAGE_SIZE);
  const visibleQuestions = isMobile
    ? filteredQuestions.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE)
    : filteredQuestions.slice(0, shownCount);
  const activeNumber = activeQuestion ? filteredQuestions.findIndex((question) => question.id === activeQuestion.id) + 1 : 0;
  const selectionFor = (question) => selectedAnswers[question.id];

  return (
    <>
      <Header
        mode={mode} theme={theme} onModeChange={() => { setMode((value) => value === "solver" ? "quiz" : "solver"); setSelectedAnswers({}); }}
        onThemeChange={() => setTheme((value) => value === "dark" ? "light" : "dark")}
        collectorAvailable={collector.available} onCollectorOpen={openCollector}
        query={query} onQueryChange={setQuery} filter={filter} onFilterChange={setFilter} countText={countText}
      />
      <AccountPanel />
      <main className="main-content">
        <div id="questions-container" className="questions-grid">
          {loadState === "loading" && <div className="empty-state"><h3>Ielādē jautājumus…</h3></div>}
          {loadState === "error" && <div className="empty-state"><div className="empty-icon">⚠️</div><h3>Jautājumu datubāze vēl ir tukša</h3><p>Papildiniet datubāzi vai sazinieties ar vietnes administratoru.</p></div>}
          {loadState === "ready" && filteredQuestions.length === 0 && <div className="empty-state"><div className="empty-icon">🔍</div><h3>Nekas nav atrasts</h3><p>Mainiet meklēšanas vaicājumu vai izvēlieties citu filtru.</p></div>}
          {loadState === "ready" && isMobile && visibleQuestions.map((question, index) => {
            const absoluteIndex = page * PAGE_SIZE + index;
            return <QuestionTile key={question.id} question={question} number={absoluteIndex + 1} query={query} mode={mode} bookmarked={bookmarks.has(question.id)} onOpen={(event) => openQuestion(question, event.currentTarget)} />;
          })}
          {loadState === "ready" && !isMobile && visibleQuestions.map((question, index) => (
            <QuestionCard key={question.id} question={question} number={index + 1} query={query} mode={mode} bookmarked={bookmarks.has(question.id)} selection={selectionFor(question)} onToggleBookmark={toggleBookmark} onSelectOption={selectOption} onOpenImage={(src, trigger) => setImage({ src, trigger })} />
          ))}
          {loadState === "ready" && isMobile && visibleQuestions.length > 0 && Array.from({ length: Math.max(0, PAGE_SIZE - visibleQuestions.length) }, (_, index) => <div key={`placeholder-${index}`} className="question-tile tile-placeholder" aria-hidden="true" />)}
        </div>
        {!isMobile && loadState === "ready" && <button id="load-more-btn" className="btn load-more-btn" type="button" hidden={shownCount >= filteredQuestions.length} onClick={() => setShownCount((count) => count + DESKTOP_PAGE_SIZE)}>Parādīt vēl jautājumus</button>}
        {isMobile && loadState === "ready" && filteredQuestions.length > 0 && <nav id="questions-pagination" className="questions-pagination" aria-label="Jautājumu lapas"><button id="previous-page-btn" className="btn page-btn" type="button" disabled={page === 0} onClick={() => { closeQuestion(); setPage((current) => Math.max(0, current - 1)); window.scrollTo({ top: 0, behavior: "smooth" }); }}>← Iepriekšējā</button><span id="page-indicator" className="page-indicator" aria-live="polite">{page + 1} / {mobilePageCount}</span><button id="next-page-btn" className="btn page-btn" type="button" disabled={page >= mobilePageCount - 1} onClick={() => { closeQuestion(); setPage((current) => Math.min(mobilePageCount - 1, current + 1)); window.scrollTo({ top: 0, behavior: "smooth" }); }}>Nākamā →</button></nav>}
      </main>
      <QuestionDialog question={activeQuestion} number={activeNumber} query={query} mode={mode} bookmarked={activeQuestion ? bookmarks.has(activeQuestion.id) : false} selection={activeQuestion ? selectionFor(activeQuestion) : undefined} onClose={closeQuestion} onToggleBookmark={toggleBookmark} onSelectOption={selectOption} onOpenImage={(src, trigger) => setImage({ src, trigger })} />
      {image && <ImageLightbox image={image.src} returnFocus={image.trigger} onClose={closeImage} />}
      {collectorOpen && <CollectorDialog open onClose={closeCollector} collector={collector} token={collectorToken} setToken={(value) => { setCollectorToken(value); setCollectorError(""); }} rounds={collectorRounds} setRounds={setCollectorRounds} onStart={startCollector} error={collectorError} />}
      {collectorPending && collectorOpen && <div className="collector-toast" role="status">Veido savienojumu ar palīgprogrammu…</div>}
    </>
  );
}
