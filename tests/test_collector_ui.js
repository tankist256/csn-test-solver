const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "../solver/app.js"), "utf8");
const previousRun = {
  running: false, worker_online: false, returncode: 0, rounds: 50,
  completed_rounds: 50, started_at: "2026-10-16T21:02:43Z",
  finished_at: "2026-10-16T21:15:13Z", message: "База на сайте обновлена.",
  log: ["Старый журнал: 542 вопроса"],
};

function app() {
  const elements = new Map();
  const element = (id) => {
    if (!elements.has(id)) elements.set(id, {
      textContent: "", className: "", style: {}, dataset: {}, disabled: false,
      hidden: false, open: false, value: "1", focus() {},
    });
    return elements.get(id);
  };
  const context = vm.createContext({
    localStorage: { getItem: () => null },
    document: { addEventListener() {}, getElementById: element },
    location: { protocol: "http:" }, clearTimeout() {}, setTimeout() {}, console,
  });
  vm.runInContext(source + "\ncollectorWorkerMode = true;", context);
  return { context, element, run: (code) => vm.runInContext(code, context) };
}

test("an offline worker is visible even after a successful previous run", () => {
  const { context, element } = app();
  context.updateCollectorUI(previousRun);
  assert.equal(element("collector-status-title").textContent, "Нет связи с компьютером");
  assert.match(element("collector-status-text").textContent, /Новый сбор пока недоступен/);
  assert.equal(element("collector-start-btn").disabled, true);
  assert.equal(element("collector-progress").style.width, "0%");
  assert.equal(element("collector-log-details").open, false);
  assert.match(element("collector-log-summary").textContent, /Предыдущий сбор.*2026/);
  assert.equal(element("collector-log").textContent, previousRun.log[0]);
  // Polling must not collapse a history section the user opened themselves.
  element("collector-log-details").open = true;
  context.updateCollectorUI(previousRun);
  assert.equal(element("collector-log-details").open, true);
});

test("reconnecting enables a new run without presenting old success as new", () => {
  const { context, element } = app();
  context.updateCollectorUI({ ...previousRun, worker_online: true });
  assert.equal(element("collector-status-title").textContent, "Готово к запуску");
  assert.equal(element("collector-start-btn").disabled, false);
  assert.equal(element("collector-log-details").open, false);
});

test("a run observed in this page shows its live log and completion", () => {
  const { context, element, run } = app();
  run("collectorWasRunning = true");
  context.updateCollectorUI({ ...previousRun, worker_online: true, running: true, returncode: null });
  assert.equal(element("collector-log-summary").textContent, "Журнал текущего сбора");
  assert.equal(element("collector-log-details").open, true);
  context.updateCollectorUI({ ...previousRun, worker_online: true });
  assert.equal(element("collector-status-title").textContent, "База успешно обновлена");
  assert.equal(element("collector-progress").style.width, "100%");
});

for (const lateError of [false, true]) {
  test(`a stale status ${lateError ? "error" : "response"} cannot overwrite a new start`, async () => {
    const { context, element } = app();
    let finishOldStatus;
    context.fetch = (url) => url.endsWith("/status")
      ? new Promise((resolve, reject) => { finishOldStatus = lateError ? reject : resolve; })
      : Promise.resolve({ ok: true, json: async () => ({
        running: true, worker_online: true, phase: "queued", rounds: 1,
        completed_rounds: 0, returncode: null, log: [], started_at: "2026-10-19T10:00:00Z",
        message: "Задание отправлено компьютеру.",
      }) });
    const pendingStatus = context.refreshCollectorStatus();
    await context.startCollector();
    if (lateError) finishOldStatus(new Error("Old request failed"));
    else finishOldStatus({ ok: true, json: async () => previousRun });
    await pendingStatus;
    assert.equal(element("collector-status-title").textContent, "Ожидаю компьютер");
    assert.equal(element("collector-log").textContent, "");
    assert.equal(element("collector-start-btn").disabled, true);
  });
}
