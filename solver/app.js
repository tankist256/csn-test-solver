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
let bookmarks = new Set(JSON.parse(localStorage.getItem("csdd_bookmarks") || "[]"));
let currentFilter = "all";
let currentMode = localStorage.getItem("csdd_mode") || "solver"; // "solver" or "quiz"
let currentTheme = localStorage.getItem("csdd_theme") || "dark";
let collectorPollTimer = null;
let collectorWasRunning = false;
let lazyVideoObserver = null;
let lazyImageObserver = null;

document.addEventListener("DOMContentLoaded", () => {
  // Применяем тему и режим
  document.documentElement.setAttribute("data-theme", currentTheme);
  document.body.className = `mode-${currentMode}`;
  updateModeBtnUI();
  updateThemeBtnUI();

  // Загружаем данные: либо из window.CSDD_QUESTIONS (из questions.js), либо fetch(questions.json)
  if (window.CSDD_QUESTIONS && Array.isArray(window.CSDD_QUESTIONS)) {
    allQuestions = window.CSDD_QUESTIONS;
    initApp();
  } else {
    fetch("questions.json")
      .then((res) => res.json())
      .then((data) => {
        allQuestions = data;
        initApp();
      })
      .catch((err) => {
        console.error("Не удалось загрузить questions.json:", err);
        document.getElementById("questions-container").innerHTML = `
          <div class="empty-state">
            <div class="empty-icon">⚠️</div>
            <h3>База вопросов не найдена</h3>
            <p>Запустите <code>python solver/collector.py</code> для сбора вопросов.</p>
          </div>
        `;
      });
  }
});

function initApp() {
  migrateBookmarks();
  setupEventListeners();
  setupCollectorControls();
  renderQuestions();
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
    renderQuestions();
  });

  clearBtn.addEventListener("click", () => {
    searchInput.value = "";
    clearBtn.style.display = "none";
    searchInput.focus();
    renderQuestions();
  });

  // Переключение режима: Шпаргалка / Тренажер
  document.getElementById("mode-toggle-btn").addEventListener("click", () => {
    currentMode = currentMode === "solver" ? "quiz" : "solver";
    localStorage.setItem("csdd_mode", currentMode);
    document.body.className = `mode-${currentMode}`;
    updateModeBtnUI();
    renderQuestions();
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
    btn.addEventListener("click", (e) => {
      document.querySelectorAll(".filter-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      currentFilter = btn.dataset.filter;
      renderQuestions();
    });
  });

  // Lightbox закрытие
  const lightbox = document.getElementById("lightbox-modal");
  document.getElementById("lightbox-close").addEventListener("click", () => {
    lightbox.classList.remove("active");
  });
  lightbox.addEventListener("click", (e) => {
    if (e.target === lightbox) lightbox.classList.remove("active");
  });
}

function setupCollectorControls() {
  const modal = document.getElementById("collector-modal");
  const openBtn = document.getElementById("collector-open-btn");
  const closeBtn = document.getElementById("collector-close-btn");
  const startBtn = document.getElementById("collector-start-btn");

  const openModal = () => {
    modal.classList.add("active");
    modal.setAttribute("aria-hidden", "false");
    refreshCollectorStatus();
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

  refreshCollectorStatus();
}

async function startCollector() {
  const input = document.getElementById("collector-rounds");
  const rounds = Math.max(1, Math.min(50, Number.parseInt(input.value, 10) || 1));
  input.value = rounds;
  setCollectorPending(`Запускаю ${rounds} тест(ов)…`);

  try {
    const response = await fetch("/api/collector/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rounds }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Не удалось запустить сбор.");
    collectorWasRunning = true;
    updateCollectorUI(data);
    scheduleCollectorPoll();
  } catch (error) {
    showCollectorConnectionError(error.message);
  }
}

async function refreshCollectorStatus() {
  if (location.protocol === "file:") {
    showCollectorConnectionError("Запустите программу через serve.py и откройте http://localhost:8080.");
    return;
  }
  try {
    const response = await fetch("/api/collector/status", { cache: "no-store" });
    if (!response.ok) throw new Error("API сборщика недоступен.");
    const state = await response.json();
    updateCollectorUI(state);
    if (state.running) {
      collectorWasRunning = true;
      scheduleCollectorPoll();
    } else if (collectorWasRunning) {
      collectorWasRunning = false;
      await reloadQuestionDatabase();
    }
  } catch (error) {
    showCollectorConnectionError(error.message);
  }
}

function scheduleCollectorPoll() {
  clearTimeout(collectorPollTimer);
  collectorPollTimer = setTimeout(refreshCollectorStatus, 1000);
}

function updateCollectorUI(state) {
  const statusBox = document.getElementById("collector-status");
  const title = document.getElementById("collector-status-title");
  const text = document.getElementById("collector-status-text");
  const progress = document.getElementById("collector-progress");
  const log = document.getElementById("collector-log");
  const startBtn = document.getElementById("collector-start-btn");
  const roundsInput = document.getElementById("collector-rounds");
  const completed = Number(state.completed_rounds) || 0;
  const rounds = Number(state.rounds) || 0;
  const percent = rounds ? Math.round((completed / rounds) * 100) : 0;

  statusBox.className = `collector-status ${state.running ? "running" : state.returncode === 0 ? "success" : state.returncode ? "error" : "idle"}`;
  title.textContent = state.running
    ? `Сбор вопросов: тест ${Math.min(completed + 1, rounds)} из ${rounds}`
    : state.returncode === 0
      ? "База успешно обновлена"
      : state.returncode
        ? "Сбор завершился с ошибкой"
        : "Готово к запуску";
  text.textContent = state.message || "Сборщик готов к запуску.";
  progress.style.width = `${state.running ? Math.max(percent, 3) : state.returncode === 0 ? 100 : percent}%`;
  log.textContent = Array.isArray(state.log) ? state.log.join("\n") : "";
  log.scrollTop = log.scrollHeight;
  startBtn.disabled = Boolean(state.running);
  roundsInput.disabled = Boolean(state.running);
}

function setCollectorPending(message) {
  const statusBox = document.getElementById("collector-status");
  statusBox.className = "collector-status running";
  document.getElementById("collector-status-title").textContent = "Подключение к сборщику";
  document.getElementById("collector-status-text").textContent = message;
  document.getElementById("collector-start-btn").disabled = true;
}

function showCollectorConnectionError(message) {
  const statusBox = document.getElementById("collector-status");
  statusBox.className = "collector-status error";
  document.getElementById("collector-status-title").textContent = "Сборщик недоступен";
  document.getElementById("collector-status-text").textContent = message;
  document.getElementById("collector-start-btn").disabled = location.protocol === "file:";
  document.getElementById("collector-progress").style.width = "0";
}

async function reloadQuestionDatabase() {
  try {
    const response = await fetch(`questions.json?t=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) throw new Error("Не удалось загрузить обновлённую базу.");
    allQuestions = await response.json();
    window.CSDD_QUESTIONS = allQuestions;
    migrateBookmarks();
    renderQuestions();
  } catch (error) {
    document.getElementById("collector-status-text").textContent = `${error.message} Обновите страницу вручную.`;
  }
}

function updateModeBtnUI() {
  const btn = document.getElementById("mode-toggle-btn");
  if (currentMode === "solver") {
    btn.innerHTML = `<span>🎯</span> <strong>Шпаргалка (Ответы сразу)</strong>`;
  } else {
    btn.innerHTML = `<span>✍️</span> <strong>Тренажёр (Скрыть ответы)</strong>`;
  }
}

function updateThemeBtnUI() {
  const btn = document.getElementById("theme-toggle-btn");
  btn.innerHTML = currentTheme === "dark" ? "☀️" : "🌙";
}

function renderQuestions() {
  const query = document.getElementById("search-input").value;
  const normQuery = normalizeText(query);
  const container = document.getElementById("questions-container");
  const statsElem = document.getElementById("stats-counter");

  let filtered = allQuestions.filter((q) => {
    // Фильтр по типам
    if (currentFilter === "images" && !q.img) return false;
    if (currentFilter === "videos" && !q.video) return false;
    if (currentFilter === "bookmarks" && !bookmarks.has(q.id)) return false;

    // Поиск по тексту вопроса и вариантам ответов
    if (normQuery) {
      const qNorm = normalizeText(q.question);
      const optsNorm = q.options.map((o) => normalizeText(o.text)).join(" ");
      if (!qNorm.includes(normQuery) && !optsNorm.includes(normQuery)) {
        return false;
      }
    }
    return true;
  });

  statsElem.textContent = `Показано: ${filtered.length} из ${allQuestions.length}`;

  if (filtered.length === 0) {
    if (lazyVideoObserver) lazyVideoObserver.disconnect();
    if (lazyImageObserver) lazyImageObserver.disconnect();
    container.innerHTML = `
      <div class="empty-state" style="grid-column: 1 / -1;">
        <div class="empty-icon">🔍</div>
        <h3>Ничего не найдено</h3>
        <p>Попробуйте изменить поисковый запрос или выбрать другой фильтр.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = filtered
    .map((q, idx) => {
      const isBookmarked = bookmarks.has(q.id);

      // Медиа-блок
      let mediaHtml = "";
      if (q.video) {
        mediaHtml = `
          <div class="card-media">
            <span class="media-badge">🎥 Видео</span>
            <video class="lazy-video" controls preload="none" muted data-src="${q.video}"></video>
          </div>
        `;
      } else if (q.img) {
        mediaHtml = `
          <div class="card-media" onclick="openLightbox('${q.img}')">
            <span class="media-badge">3D Ситуация</span>
            <img class="lazy-image" data-src="${q.img}" alt="Situācija">
          </div>
        `;
      }

      // Список вариантов ответов
      const answerVerified = q.verified === true;
      const optionsHtml = q.options
        .map((opt, oIdx) => {
          const isCorrect = answerVerified && opt.id === q.correct_id;
          const marker = String.fromCharCode(65 + oIdx); // A, B, C, D
          const highlightedText = highlightMatch(opt.text, query);

          return `
            <div class="option-item ${isCorrect ? "correct" : ""}" 
                 data-opt-id="${opt.id}" 
                 data-is-correct="${answerVerified ? isCorrect : "unknown"}"
                 onclick="handleOptionClick(this, '${q.id}')">
              <span class="option-marker">${isCorrect ? "✓" : marker}</span>
              <span class="option-text">${highlightedText}</span>
            </div>
          `;
        })
        .join("");

      return `
        <div class="question-card" id="q-${q.id}">
          ${mediaHtml}
          <div class="card-body">
            <div class="card-header-line">
              <span class="question-number">Jautājums #${idx + 1}</span>
              <button class="btn-bookmark ${isBookmarked ? "bookmarked" : ""}" 
                      onclick="toggleBookmark('${q.id}', this)" 
                      title="Сохранить в избранное">
                ${isBookmarked ? "★" : "☆"}
              </button>
            </div>
            <div class="question-text">${highlightMatch(q.question, query)}</div>
            ${answerVerified ? "" : '<div class="answer-status">⚠ Ответ не перепроверен в CSDD — правильный вариант пока не показывается.</div>'}
            <div class="options-list">
              ${optionsHtml}
            </div>
          </div>
        </div>
      `;
    })
    .join("");

  setupLazyVideos();
  setupLazyImages();
}

function setupLazyVideos() {
  if (lazyVideoObserver) lazyVideoObserver.disconnect();

  const videos = document.querySelectorAll("video.lazy-video[data-src]");
  if (!videos.length) return;

  const loadVideo = (video) => {
    const src = video.dataset.src;
    if (!src) return;

    const source = document.createElement("source");
    source.src = src;
    source.type = "video/mp4";
    video.append(source);
    delete video.dataset.src;
    video.load();
  };

  // The browser used to request metadata for every rendered video card at once.
  // Load only videos close to the viewport; tapping one also starts it immediately.
  videos.forEach((video) => {
    video.addEventListener("pointerdown", () => loadVideo(video), { once: true });
  });

  if (!("IntersectionObserver" in window)) {
    videos.forEach(loadVideo);
    return;
  }

  lazyVideoObserver = new IntersectionObserver(
    (entries, observer) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        loadVideo(entry.target);
        observer.unobserve(entry.target);
      });
    },
    { rootMargin: "300px 0px" },
  );

  videos.forEach((video) => lazyVideoObserver.observe(video));
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
  if (!query || !text) return text;
  const normQuery = normalizeText(query);
  if (!normQuery) return text;

  // Простое выделение подстроки без учета регистра
  const words = query.trim().split(/\s+/).filter(Boolean);
  let result = text;
  words.forEach((w) => {
    try {
      const regex = new RegExp(`(${w})`, "gi");
      result = result.replace(regex, "<mark class='highlight'>$1</mark>");
    } catch (e) {}
  });
  return result;
}

function handleOptionClick(elem, questionId) {
  if (currentMode !== "quiz") return;
  if (elem.dataset.isCorrect === "unknown") return;

  const card = elem.closest(".question-card");
  const isCorrect = elem.dataset.isCorrect === "true";

  // Снимаем предыдущие отметки в карточке
  card.querySelectorAll(".option-item").forEach((opt) => {
    opt.classList.remove("selected-correct", "selected-wrong", "revealed-correct");
  });

  if (isCorrect) {
    elem.classList.add("selected-correct");
  } else {
    elem.classList.add("selected-wrong");
    // Показываем какой был правильный
    const correctElem = card.querySelector('.option-item[data-is-correct="true"]');
    if (correctElem) {
      correctElem.classList.add("revealed-correct");
    }
  }
}

function toggleBookmark(qId, btn) {
  if (bookmarks.has(qId)) {
    bookmarks.delete(qId);
    btn.classList.remove("bookmarked");
    btn.innerHTML = "☆";
  } else {
    bookmarks.add(qId);
    btn.classList.add("bookmarked");
    btn.innerHTML = "★";
  }
  localStorage.setItem("csdd_bookmarks", JSON.stringify(Array.from(bookmarks)));
  if (currentFilter === "bookmarks") {
    renderQuestions();
  }
}

function openLightbox(imgSrc) {
  const lightbox = document.getElementById("lightbox-modal");
  const lightboxImg = document.getElementById("lightbox-img");
  lightboxImg.src = imgSrc;
  lightbox.classList.add("active");
}
