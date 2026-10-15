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
  setupEventListeners();
  renderQuestions();
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
            <video controls preload="metadata" muted>
              <source src="${q.video}" type="video/mp4">
            </video>
          </div>
        `;
      } else if (q.img) {
        mediaHtml = `
          <div class="card-media" onclick="openLightbox('${q.img}')">
            <span class="media-badge">3D Ситуация</span>
            <img src="${q.img}" alt="Situācija" loading="lazy">
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
