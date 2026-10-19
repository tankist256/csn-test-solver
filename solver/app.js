// CSDD Exam Test Solver & Question Bank

// Функция нормализации текста (убирает гарумзимес и диакритику для удобного быстрого поиска)
function normalizeText(str) {
  if (!str) return "";
  return str
    .toLowerCase()
    .replace(/[āáàâäã]/g, "a")
    .replace(/[čç]/g, "c")
    .replace(/[ēéèêë]/g, "e")
    .replace(/[ģ]/g, "g")
    .replace(/[īíìîï]/g, "i")
    .replace(/[ķ]/g, "k")
    .replace(/[ļ]/g, "l")
    .replace(/[ņñ]/g, "n")
    .replace(/[šś]/g, "s")
    .replace(/[ūúùûü]/g, "u")
    .replace(/[žźż]/g, "z")
    .trim();
}

let allQuestions = [];
let bookmarks;
try {
  bookmarks = new Set(JSON.parse(localStorage.getItem("csdd_bookmarks") || "[]"));
} catch {
  bookmarks = new Set();
}
let currentFilter = "all";
let currentMode = localStorage.getItem("csdd_mode") || "solver"; // "solver" or "quiz"
let currentTheme = localStorage.getItem("csdd_theme") || "dark";
let collectorPollTimer = null;
let collectorWasRunning = false;
let collectorRequestVersion = 0;
let collectorStartPending = false;
let lazyImageObserver = null;
let filteredQuestions = [];
let currentPage = 0;
let renderedCount = 0;
let searchTimer = null;
let collectorRequiresToken = false;
let collectorWorkerMode = false;
let lightboxTrigger = null;
let questionTrigger = null;
let openQuestionIndex = -1;
const PAGE_SIZE = 6;
const DESKTOP_PAGE_SIZE = 12;

function isMobileLayout() {
  return window.matchMedia("(max-width: 640px)").matches;
}

document.addEventListener("DOMContentLoaded", () => {
  document.documentElement.setAttribute("data-theme", currentTheme);
  document.body.classList.add(`mode-${currentMode}`);
  updateModeBtnUI();
  updateThemeBtnUI();
  setupEventListeners();
  setupCollectorControls();

  if (window.CSDD_QUESTIONS && Array.isArray(window.CSDD_QUESTIONS)) {
    allQuestions = window.CSDD_QUESTIONS;
    initApp();
  } else {
    fetch("questions.json")
      .then((res) => {
        if (!res.ok) throw new Error("База вопросов не найдена");
        return res.json();
      })
      .then((data) => {
        allQuestions = data;
        initApp();
      })
      .catch((err) => {
        console.error("Не удалось загрузить questions.json:", err);
        document.getElementById("questions-container").innerHTML =
          '<div class="empty-state"><div class="empty-icon">⚠️</div><h3>База вопросов пока пуста</h3><p>Пополните базу или обратитесь к администратору сайта.</p></div>';
      });
  }
});

function initApp() {
  migrateBookmarks();
  prepareQuestions();
  renderQuestions();
}

function prepareQuestions() {
  allQuestions.forEach((q) => {
    q.searchText = normalizeText([q.question, ...q.options.map((option) => option.text)].join(" "));
  });
}

function migrateBookmarks() {
  // Preserve saved questions across the media-aware ID migration.
  let bookmarksChanged = false;
  allQuestions.forEach((q) => {
    if (q.legacy_id && bookmarks.has(q.legacy_id)) {
      bookmarks.delete(q.legacy_id);
      bookmarks.add(q.id);
      bookmarksChanged = true;
    }
  });
  if (bookmarksChanged) {
    localStorage.setItem("csdd_bookmarks", JSON.stringify(Array.from(bookmarks)));
  }
}

function setupEventListeners() {
  const searchInput = document.getElementById("search-input");
  const clearBtn = document.getElementById("clear-search-btn");

  searchInput.addEventListener("input", () => {
    clearBtn.style.display = searchInput.value ? "block" : "none";
    clearTimeout(searchTimer);
    searchTimer = setTimeout(renderQuestions, 120);
  });

  clearBtn.addEventListener("click", () => {
    clearTimeout(searchTimer);
    searchInput.value = "";
    clearBtn.style.display = "none";
    searchInput.focus();
    renderQuestions();
  });

  // Переключение режима: Шпаргалка / Тренажер
  document.getElementById("mode-toggle-btn").addEventListener("click", () => {
    currentMode = currentMode === "solver" ? "quiz" : "solver";
    localStorage.setItem("csdd_mode", currentMode);
    document.body.classList.remove("mode-solver", "mode-quiz");
    document.body.classList.add(`mode-${currentMode}`);
    updateModeBtnUI();
    if (isMobileLayout()) renderPage();
    else renderDesktopQuestions();
    refreshQuestionDetail();
  });

  // Переключение темы
  document.getElementById("theme-toggle-btn").addEventListener("click", () => {
    currentTheme = currentTheme === "dark" ? "light" : "dark";
    localStorage.setItem("csdd_theme", currentTheme);
    document.documentElement.setAttribute("data-theme", currentTheme);
    updateThemeBtnUI();
  });

  // Фильтры (Все, С картинками, Видео, Избранное)
  document.querySelectorAll(".filter-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".filter-btn").forEach((b) => {
        b.classList.remove("active");
        b.setAttribute("aria-pressed", "false");
      });
      btn.classList.add("active");
      btn.setAttribute("aria-pressed", "true");
      currentFilter = btn.dataset.filter;
      renderQuestions();
    });
  });

  document.getElementById("previous-page-btn").addEventListener("click", () => changePage(-1));
  document.getElementById("next-page-btn").addEventListener("click", () => changePage(1));
  document.getElementById("load-more-btn").addEventListener("click", appendDesktopQuestions);
  document.getElementById("questions-container").addEventListener("click", (event) => {
    const tile = event.target.closest(".question-tile[data-index]");
    if (tile) return openQuestion(Number(tile.dataset.index), tile);
    const bookmark = event.target.closest(".btn-bookmark");
    if (bookmark) return toggleBookmark(bookmark.dataset.questionId, bookmark);
    const option = event.target.closest(".option-item");
    if (option) return handleOptionClick(option);
    const image = event.target.closest(".media-open-btn");
    if (image) return openLightbox(image.dataset.fullSrc, image);
    const video = event.target.closest(".video-play-btn");
    if (video) return playCardVideo(video);
  });
  document.getElementById("question-detail").addEventListener("click", (event) => {
    const bookmark = event.target.closest(".btn-bookmark");
    if (bookmark) return toggleBookmark(bookmark.dataset.questionId, bookmark);
    const option = event.target.closest(".option-item");
    if (option) return handleOptionClick(option);
    const image = event.target.closest(".media-open-btn");
    if (image) return openLightbox(image.dataset.fullSrc, image);
    const video = event.target.closest(".video-play-btn");
    if (video) return playCardVideo(video);
  });
  document.getElementById("questions-container").addEventListener("error", (event) => {
    const image = event.target;
    if (image.classList?.contains("lazy-image") && image.dataset.fullSrc) {
      const fullSrc = image.dataset.fullSrc;
      delete image.dataset.fullSrc;
      image.src = fullSrc;
    }
  }, true);

  const questionModal = document.getElementById("question-modal");
  document.getElementById("question-close-btn").addEventListener("click", closeQuestion);
  questionModal.addEventListener("click", (event) => {
    if (event.target === questionModal) closeQuestion();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && questionModal.classList.contains("active") &&
        !document.getElementById("lightbox-modal").classList.contains("active")) closeQuestion();
  });

  // Lightbox закрытие
  const lightbox = document.getElementById("lightbox-modal");
  document.getElementById("lightbox-close").addEventListener("click", closeLightbox);
  document.getElementById("lightbox-zoom").addEventListener("click", toggleLightboxZoom);
  lightbox.addEventListener("click", (e) => {
    if (e.target === lightbox) closeLightbox();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && lightbox.classList.contains("active")) closeLightbox();
  });

  window.matchMedia("(max-width: 640px)").addEventListener("change", renderQuestions);
}

function setupCollectorControls() {
  const modal = document.getElementById("collector-modal");
  const openBtn = document.getElementById("collector-open-btn");
  const closeBtn = document.getElementById("collector-close-btn");
  const startBtn = document.getElementById("collector-start-btn");

  const openModal = () => {
    modal.classList.add("active");
    modal.setAttribute("aria-hidden", "false");
    (collectorRequiresToken ? document.getElementById("collector-token") : document.getElementById("collector-rounds")).focus();
    if (collectorRequiresToken && !document.getElementById("collector-token").value.trim()) {
      document.getElementById("collector-status-text").textContent = "Введите ключ доступа, чтобы управлять сбором.";
    } else {
      refreshCollectorStatus();
    }
  };
  const closeModal = () => {
    modal.classList.remove("active");
    modal.setAttribute("aria-hidden", "true");
  };

  openBtn.addEventListener("click", openModal);
  closeBtn.addEventListener("click", closeModal);
  modal.addEventListener("click", (event) => {
    if (event.target === modal) closeModal();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && modal.classList.contains("active")) closeModal();
  });
  startBtn.addEventListener("click", startCollector);
  document.getElementById("collector-token").addEventListener("change", refreshCollectorStatus);

  detectCollectorAccess();
}

async function detectCollectorAccess() {
  if (location.protocol === "file:") return;
  try {
    const response = await fetch("/api/collector/access", { cache: "no-store" });
    if (!response.ok) return;
    const access = await response.json();
    if (!access.available) return;
    collectorRequiresToken = Boolean(access.requires_token);
    collectorWorkerMode = Boolean(access.worker_mode);
    document.getElementById("collector-open-btn").hidden = false;
    document.querySelector(".header-controls").classList.add("collector-available");
    document.getElementById("collector-token-field").hidden = !collectorRequiresToken;
    if (collectorWorkerMode) {
      document.getElementById("collector-description").textContent =
        "Сбор выполняется на вашем компьютере и автоматически обновляет сайт. Компьютер должен быть включён и подключён к интернету.";
    }
    if (!collectorRequiresToken) refreshCollectorStatus();
  } catch (error) {
    console.warn("Сборщик недоступен:", error);
  }
}

function collectorHeaders(includeContentType = false) {
  const headers = {};
  if (includeContentType) headers["Content-Type"] = "application/json";
  if (collectorRequiresToken) {
    headers["X-CSN-Collector-Token"] = document.getElementById("collector-token").value.trim();
  }
  return headers;
}

async function startCollector() {
  if (collectorStartPending) return;
  if (collectorRequiresToken && !document.getElementById("collector-token").value.trim()) {
    showCollectorConnectionError("Введите ключ доступа к сборщику.");
    document.getElementById("collector-token").focus();
    return;
  }
  const input = document.getElementById("collector-rounds");
  const rounds = Math.max(1, Math.min(50, Number.parseInt(input.value, 10) || 1));
  input.value = rounds;
  collectorStartPending = true;
  // Discard status requests started by the token field before this new run.
  ++collectorRequestVersion;
  clearTimeout(collectorPollTimer);
  setCollectorPending(`Запускаю ${rounds} тест(ов)…`);

  try {
    const response = await fetch("/api/collector/start", {
      method: "POST",
      headers: collectorHeaders(true),
      body: JSON.stringify({ rounds }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Не удалось запустить сбор.");
    collectorWasRunning = true;
    updateCollectorUI(data);
    scheduleCollectorPoll();
  } catch (error) {
    showCollectorConnectionError(error.message);
  } finally {
    collectorStartPending = false;
  }
}

async function refreshCollectorStatus() {
  if (collectorStartPending || location.protocol === "file:" || (collectorRequiresToken && !document.getElementById("collector-token").value.trim())) return;
  const requestVersion = ++collectorRequestVersion;
  try {
    const response = await fetch("/api/collector/status", { cache: "no-store", headers: collectorHeaders() });
    if (response.status === 401) throw new Error("Неверный ключ доступа.");
    if (!response.ok) throw new Error("Сборщик недоступен.");
    const state = await response.json();
    if (requestVersion !== collectorRequestVersion) return;
    updateCollectorUI(state);
    if (state.running) {
      collectorWasRunning = true;
      scheduleCollectorPoll();
    } else if (collectorWasRunning) {
      collectorWasRunning = false;
      await reloadQuestionDatabase();
    }
    if (collectorWorkerMode && !state.running) scheduleCollectorPoll(5000);
  } catch (error) {
    if (requestVersion !== collectorRequestVersion) return;
    showCollectorConnectionError(error.message);
  }
}

function scheduleCollectorPoll(delay = 1000) {
  clearTimeout(collectorPollTimer);
  collectorPollTimer = setTimeout(refreshCollectorStatus, delay);
}

function updateCollectorUI(state) {
  const statusBox = document.getElementById("collector-status");
  const title = document.getElementById("collector-status-title");
  const text = document.getElementById("collector-status-text");
  const progress = document.getElementById("collector-progress");
  const log = document.getElementById("collector-log");
  const logDetails = document.getElementById("collector-log-details");
  const logSummary = document.getElementById("collector-log-summary");
  const logResult = document.getElementById("collector-log-result");
  const startBtn = document.getElementById("collector-start-btn");
  const roundsInput = document.getElementById("collector-rounds");
  const completed = Number(state.completed_rounds) || 0;
  const rounds = Number(state.rounds) || 0;
  const percent = rounds ? Math.round((completed / rounds) * 100) : 0;
  const offline = collectorWorkerMode && !state.worker_online && !state.running;
  const previousRun = !state.running && !collectorWasRunning;

  statusBox.className = `collector-status ${offline ? "error" : state.running ? "running" : previousRun ? "idle" : state.returncode === 0 ? "success" : state.returncode ? "error" : "idle"}`;
  title.textContent = offline
    ? "Нет связи с компьютером"
    : state.running
    ? state.phase === "queued"
      ? "Ожидаю компьютер"
      : `Сбор вопросов: тест ${Math.min(completed + 1, rounds)} из ${rounds}`
    : previousRun
      ? "Готово к запуску"
    : state.returncode === 0
      ? "База успешно обновлена"
      : state.returncode
        ? "Сбор завершился с ошибкой"
        : "Готово к запуску";
  text.textContent = offline
    ? "Сайт не получает сигнал от сборщика на компьютере. Проверьте, что помощник запущен и может подключиться к серверу. Новый сбор пока недоступен."
    : previousRun
      ? "Нажмите «Запустить сбор», чтобы пополнить базу. Результат прошлого запуска доступен в журнале ниже."
      : state.message || "Сборщик готов к запуску.";
  progress.style.width = `${offline || previousRun ? 0 : state.running ? Math.max(percent, 3) : state.returncode === 0 ? 100 : percent}%`;
  log.textContent = Array.isArray(state.log) ? state.log.join("\n") : "";
  const finished = state.finished_at ? new Date(state.finished_at) : null;
  const finishedLabel = finished && !Number.isNaN(finished.getTime())
    ? ` · ${finished.toLocaleString("ru-RU")}` : "";
  logSummary.textContent = state.running
    ? "Журнал текущего сбора"
    : `${previousRun || offline ? "Предыдущий сбор" : "Журнал завершённого сбора"}${finishedLabel}`;
  logResult.textContent = !state.running && state.returncode != null ? state.message || "" : "";
  logDetails.hidden = !log.textContent && !logResult.textContent;
  const logView = `${state.started_at || ""}:${state.running ? "running" : previousRun || offline ? "history" : "finished"}`;
  if (logDetails.dataset.view !== logView) {
    logDetails.open = Boolean(state.running || (!previousRun && !offline));
    logDetails.dataset.view = logView;
  }
  log.scrollTop = log.scrollHeight;
  startBtn.disabled = Boolean(state.running || (collectorWorkerMode && !state.worker_online));
  roundsInput.disabled = Boolean(state.running);
}

function setCollectorPending(message) {
  const statusBox = document.getElementById("collector-status");
  statusBox.className = "collector-status running";
  document.getElementById("collector-status-title").textContent = "Подключение к сборщику";
  document.getElementById("collector-status-text").textContent = message;
  document.getElementById("collector-start-btn").disabled = true;
  document.getElementById("collector-rounds").disabled = true;
  document.getElementById("collector-progress").style.width = "0%";
  document.getElementById("collector-log-details").hidden = true;
  document.getElementById("collector-log-details").dataset.view = "";
}

function showCollectorConnectionError(message) {
  const statusBox = document.getElementById("collector-status");
  statusBox.className = "collector-status error";
  document.getElementById("collector-status-title").textContent = "Сборщик недоступен";
  document.getElementById("collector-status-text").textContent = message;
  document.getElementById("collector-start-btn").disabled = location.protocol === "file:";
  document.getElementById("collector-rounds").disabled = false;
  document.getElementById("collector-progress").style.width = "0";
  document.getElementById("collector-log-details").hidden = true;
}

async function reloadQuestionDatabase() {
  try {
    const response = await fetch(`questions.json?t=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) throw new Error("Не удалось загрузить обновлённую базу.");
    allQuestions = await response.json();
    window.CSDD_QUESTIONS = allQuestions;
    migrateBookmarks();
    prepareQuestions();
    renderQuestions();
  } catch (error) {
    document.getElementById("collector-status-text").textContent = `${error.message} Обновите страницу вручную.`;
  }
}

function updateModeBtnUI() {
  const btn = document.getElementById("mode-toggle-btn");
  if (currentMode === "solver") {
    btn.innerHTML = '<span aria-hidden="true">🎯</span> <strong>Шпаргалка</strong>';
    btn.setAttribute("aria-label", "Режим: Шпаргалка. Переключить на тренажёр");
  } else {
    btn.innerHTML = '<span aria-hidden="true">✍️</span> <strong>Тренажёр</strong>';
    btn.setAttribute("aria-label", "Режим: Тренажёр. Переключить на шпаргалку");
  }
}

function updateThemeBtnUI() {
  const btn = document.getElementById("theme-toggle-btn");
  btn.innerHTML = currentTheme === "dark" ? "☀️" : "🌙";
  btn.setAttribute("aria-label", currentTheme === "dark" ? "Включить светлую тему" : "Включить тёмную тему");
}

function renderQuestions() {
  closeQuestion(false);
  const query = normalizeText(document.getElementById("search-input").value);
  filteredQuestions = allQuestions.filter((q) => {
    if (currentFilter === "images" && !q.img) return false;
    if (currentFilter === "videos" && !q.video) return false;
    if (currentFilter === "bookmarks" && !bookmarks.has(q.id)) return false;
    return !query || q.searchText.includes(query);
  });
  currentPage = 0;
  if (isMobileLayout()) renderPage();
  else renderDesktopQuestions();
}

function renderPage() {
  const container = document.getElementById("questions-container");
  const pagination = document.getElementById("questions-pagination");
  document.getElementById("load-more-btn").hidden = true;
  const total = filteredQuestions.length;
  const pageCount = Math.ceil(total / PAGE_SIZE);
  currentPage = Math.min(currentPage, Math.max(0, pageCount - 1));
  if (lazyImageObserver) lazyImageObserver.disconnect();
  container.replaceChildren();

  if (!total) {
    container.innerHTML = '<div class="empty-state"><div class="empty-icon">🔍</div><h3>Ничего не найдено</h3><p>Измените запрос или выберите другой фильтр.</p></div>';
    document.getElementById("stats-counter").textContent = 'Найдено: 0 из ' + allQuestions.length;
    pagination.hidden = true;
    return;
  }

  const first = currentPage * PAGE_SIZE;
  const shown = filteredQuestions.slice(first, first + PAGE_SIZE);
  const query = document.getElementById("search-input").value;
  const template = document.createElement("template");
  template.innerHTML = shown.map((q, index) => renderTile(q, first + index + 1, query)).join("") +
    '<div class="question-tile tile-placeholder" aria-hidden="true"></div>'.repeat(PAGE_SIZE - shown.length);
  container.append(template.content);
  document.getElementById("stats-counter").textContent =
    'Вопросы ' + (first + 1) + '–' + (first + shown.length) + ' из ' + total +
    (total !== allQuestions.length ? ' · Всего ' + allQuestions.length : '');
  pagination.hidden = false;
  document.getElementById("page-indicator").textContent = (currentPage + 1) + ' / ' + pageCount;
  document.getElementById("previous-page-btn").disabled = currentPage === 0;
  document.getElementById("next-page-btn").disabled = currentPage >= pageCount - 1;
  if (openQuestionIndex >= 0) {
    questionTrigger = container.querySelector('[data-index="' + openQuestionIndex + '"]');
  }
  setupLazyImages();
}

function renderDesktopQuestions() {
  const container = document.getElementById("questions-container");
  document.getElementById("questions-pagination").hidden = true;
  if (lazyImageObserver) lazyImageObserver.disconnect();
  container.replaceChildren();
  renderedCount = 0;
  if (!filteredQuestions.length) {
    container.innerHTML = '<div class="empty-state"><div class="empty-icon">🔍</div><h3>Ничего не найдено</h3><p>Измените запрос или выберите другой фильтр.</p></div>';
    document.getElementById("stats-counter").textContent = 'Найдено: 0 из ' + allQuestions.length;
    document.getElementById("load-more-btn").hidden = true;
    return;
  }
  appendDesktopQuestions();
}

function appendDesktopQuestions() {
  if (isMobileLayout()) return;
  const end = Math.min(renderedCount + DESKTOP_PAGE_SIZE, filteredQuestions.length);
  const query = document.getElementById("search-input").value;
  const template = document.createElement("template");
  template.innerHTML = filteredQuestions.slice(renderedCount, end)
    .map((q, index) => renderCard(q, renderedCount + index + 1, query)).join("");
  document.getElementById("questions-container").append(template.content);
  renderedCount = end;
  document.getElementById("stats-counter").textContent =
    'Показано ' + renderedCount + ' из ' + filteredQuestions.length +
    (filteredQuestions.length !== allQuestions.length ? ' · Всего ' + allQuestions.length : '');
  document.getElementById("load-more-btn").hidden = renderedCount >= filteredQuestions.length;
  setupLazyImages();
}

function changePage(delta) {
  const nextPage = currentPage + delta;
  if (nextPage < 0 || nextPage >= Math.ceil(filteredQuestions.length / PAGE_SIZE)) return;
  closeQuestion(false);
  currentPage = nextPage;
  renderPage();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function renderTile(q, number, query) {
  const correctOption = q.verified === true
    ? q.options.find((option) => option.id === q.correct_id)
    : null;
  const showAnswer = currentMode === "solver" && correctOption;
  const media = q.video
    ? '<span class="tile-media tile-video" aria-hidden="true">▶</span>'
    : q.img
      ? '<span class="tile-media"><img class="lazy-image" data-src="' +
        escapeHTML(thumbnailPath(q.img)) + '" data-full-src="' + escapeHTML(q.img) +
        '" alt=""></span>'
      : '<span class="tile-media tile-video" aria-hidden="true">?</span>';
  const answer = currentMode === "solver"
    ? `<span class="tile-answer ${showAnswer ? "" : "tile-answer-unverified"}">
        <span class="tile-answer-label">${showAnswer ? "✓ Правильный ответ" : "Ответ не проверен"}</span>
        ${showAnswer ? `<span class="tile-answer-text">${highlightMatch(correctOption.text, query)}</span>` : ""}
      </span>`
    : "";
  const accessibleLabel = `Открыть вопрос ${number}: ${q.question}` +
    (showAnswer ? `. Правильный ответ: ${correctOption.text}` : "");
  return `<button type="button" class="question-tile" data-index="${number - 1}"
    aria-label="${escapeHTML(accessibleLabel)}">
    <span class="tile-number">№ ${number}</span>
    ${bookmarks.has(q.id) ? '<span class="tile-bookmark" aria-hidden="true">★</span>' : ""}
    ${media}
    <span class="tile-preview">${highlightMatch(q.question, query)}</span>
    ${answer}
  </button>`;
}

function openQuestion(index, trigger) {
  const question = filteredQuestions[index];
  if (!question) return;
  openQuestionIndex = index;
  questionTrigger = trigger;
  refreshQuestionDetail();
  const modal = document.getElementById("question-modal");
  modal.classList.add("active");
  modal.setAttribute("aria-hidden", "false");
  document.body.classList.add("question-open");
  document.getElementById("question-close-btn").focus();
}

function refreshQuestionDetail() {
  if (openQuestionIndex < 0) return;
  const question = filteredQuestions[openQuestionIndex];
  if (!question) return;
  document.getElementById("question-detail").innerHTML =
    renderCard(question, openQuestionIndex + 1, document.getElementById("search-input").value, true);
}

function closeQuestion(restoreFocus = true) {
  const modal = document.getElementById("question-modal");
  if (!modal.classList.contains("active")) return;
  modal.classList.remove("active");
  modal.setAttribute("aria-hidden", "true");
  document.body.classList.remove("question-open");
  document.getElementById("question-detail").replaceChildren();
  if (restoreFocus && questionTrigger?.isConnected) questionTrigger.focus();
  questionTrigger = null;
  openQuestionIndex = -1;
}

function renderCard(q, number, query, fullImage = false) {
  const isBookmarked = bookmarks.has(q.id);
  const answerVerified = q.verified === true;
  let mediaHtml = "";
  if (q.video) {
    mediaHtml = `<div class="card-media">
      <button class="video-play-btn" type="button" data-video-src="${escapeHTML(q.video)}" aria-label="Воспроизвести видео дорожной ситуации">
        <span aria-hidden="true">▶</span>Смотреть видео
      </button>
    </div>`;
  } else if (q.img) {
    mediaHtml = `<div class="card-media">
      <button class="media-open-btn" type="button" data-full-src="${escapeHTML(q.img)}" aria-label="Увеличить дорожную ситуацию">
        ${fullImage
          ? `<img src="${escapeHTML(q.img)}" alt="Дорожная ситуация">`
          : `<img class="lazy-image" data-src="${escapeHTML(thumbnailPath(q.img))}" data-full-src="${escapeHTML(q.img)}" alt="Дорожная ситуация">`}
        <span class="media-badge">Увеличить</span>
      </button>
    </div>`;
  }

  const optionsHtml = q.options.map((opt, index) => {
    const isCorrect = answerVerified && opt.id === q.correct_id;
    const marker = String.fromCharCode(65 + index);
    const disabled = currentMode !== "quiz" || !answerVerified ? "disabled" : "";
    return `<button type="button" class="option-item ${isCorrect ? "correct" : ""}"
      data-is-correct="${isCorrect}" ${disabled}>
      <span class="option-marker">${isCorrect && currentMode === "solver" ? "✓" : marker}</span>
      <span class="option-text">${highlightMatch(opt.text, query)}</span>
    </button>`;
  }).join("");

  return `<article class="question-card" id="q-${escapeHTML(q.id)}">
    ${mediaHtml}
    <div class="card-body">
      <div class="card-header-line">
        <span class="question-number">Вопрос ${number}</span>
        <button type="button" class="btn-bookmark ${isBookmarked ? "bookmarked" : ""}"
          data-question-id="${escapeHTML(q.id)}" aria-pressed="${isBookmarked}"
          aria-label="${isBookmarked ? "Убрать из избранного" : "Добавить в избранное"}"
          title="${isBookmarked ? "Убрать из избранного" : "Добавить в избранное"}">${isBookmarked ? "★" : "☆"}</button>
      </div>
      <div class="question-text">${highlightMatch(q.question, query)}</div>
      ${answerVerified ? "" : '<div class="answer-status">Ответ пока не перепроверен в CSDD.</div>'}
      <div class="options-list">${optionsHtml}</div>
    </div>
  </article>`;
}

function thumbnailPath(path) {
  return path.startsWith("media/") ? "media/thumbs/" + path.slice(6) + ".webp" : path;
}

function playCardVideo(button) {
  const video = document.createElement("video");
  video.controls = true;
  video.playsInline = true;
  video.preload = "metadata";
  video.src = button.dataset.videoSrc;
  button.replaceWith(video);
  video.play().catch(() => {});
}

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char]);
}

function setupLazyImages() {
  if (lazyImageObserver) lazyImageObserver.disconnect();

  const images = document.querySelectorAll("img.lazy-image[data-src]");
  if (!images.length) return;

  const loadImage = (image) => {
    const src = image.dataset.src;
    if (!src) return;
    image.src = src;
    delete image.dataset.src;
  };

  if (!("IntersectionObserver" in window)) {
    images.forEach(loadImage);
    return;
  }

  lazyImageObserver = new IntersectionObserver(
    (entries, observer) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        loadImage(entry.target);
        observer.unobserve(entry.target);
      });
    },
    { rootMargin: "300px 0px" },
  );

  images.forEach((image) => lazyImageObserver.observe(image));
}

function highlightMatch(text, query) {
  const raw = String(text ?? "");
  const needle = normalizeText(query);
  if (!needle) return escapeHTML(raw);
  const normalized = normalizeText(raw);
  let result = "";
  let offset = 0;
  while (true) {
    const index = normalized.indexOf(needle, offset);
    if (index < 0) break;
    result += escapeHTML(raw.slice(offset, index));
    result += '<mark class="highlight">' + escapeHTML(raw.slice(index, index + needle.length)) + '</mark>';
    offset = index + needle.length;
  }
  return result + escapeHTML(raw.slice(offset));
}

function handleOptionClick(elem) {
  if (currentMode !== "quiz" || elem.disabled) return;
  const card = elem.closest(".question-card");
  const isCorrect = elem.dataset.isCorrect === "true";
  card.querySelectorAll(".option-item").forEach((option) => {
    option.classList.remove("selected-correct", "selected-wrong", "revealed-correct");
  });
  if (isCorrect) {
    elem.classList.add("selected-correct");
  } else {
    elem.classList.add("selected-wrong");
    const correct = card.querySelector('.option-item[data-is-correct="true"]');
    if (correct) correct.classList.add("revealed-correct");
  }
}

function toggleBookmark(qId, btn) {
  const wasBookmarked = bookmarks.has(qId);
  if (wasBookmarked) bookmarks.delete(qId);
  else bookmarks.add(qId);
  btn.classList.toggle("bookmarked", !wasBookmarked);
  btn.textContent = wasBookmarked ? "☆" : "★";
  btn.setAttribute("aria-pressed", String(!wasBookmarked));
  const label = wasBookmarked ? "Добавить в избранное" : "Убрать из избранного";
  btn.setAttribute("aria-label", label);
  btn.title = label;
  localStorage.setItem("csdd_bookmarks", JSON.stringify(Array.from(bookmarks)));
  if (currentFilter === "bookmarks") {
    renderQuestions();
  } else if (isMobileLayout()) {
    renderPage();
  }
}

function openLightbox(imgSrc, trigger) {
  const lightbox = document.getElementById("lightbox-modal");
  lightboxTrigger = trigger;
  document.getElementById("lightbox-img").src = imgSrc;
  lightbox.classList.add("active");
  lightbox.setAttribute("aria-hidden", "false");
  document.getElementById("lightbox-close").focus();
}

function closeLightbox() {
  const lightbox = document.getElementById("lightbox-modal");
  lightbox.classList.remove("active");
  lightbox.setAttribute("aria-hidden", "true");
  document.getElementById("lightbox-img").src = "";
  document.getElementById("lightbox-content").classList.remove("zoomed");
  document.getElementById("lightbox-zoom").textContent = "＋";
  document.getElementById("lightbox-zoom").setAttribute("aria-label", "Увеличить изображение");
  if (lightboxTrigger?.isConnected) lightboxTrigger.focus();
  lightboxTrigger = null;
}

function toggleLightboxZoom() {
  const content = document.getElementById("lightbox-content");
  const zoomed = content.classList.toggle("zoomed");
  const button = document.getElementById("lightbox-zoom");
  button.textContent = zoomed ? "－" : "＋";
  button.setAttribute("aria-label", zoomed ? "Уместить изображение" : "Увеличить изображение");
  if (zoomed) content.scrollTo({ left: (content.scrollWidth - content.clientWidth) / 2, top: 0 });
}
