const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "../solver/app.js"), "utf8");
const previousRun = {
  running: false, worker_online: false, returncode: 0, rounds: 50,
  completed_rounds: 50, started_at: "2026-10-16T21:02:43Z",
  finished_at: "2026-10-16T21:15:13Z", message: "Datubāze vietnē ir atjaunināta.",
  log: ["Iepriekšējais žurnāls: 542 jautājumi"],
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
  assert.equal(element("collector-status-title").textContent, "Nav savienojuma ar palīgprogrammu");
  assert.match(element("collector-status-text").textContent, /Jaunu jautājumu ievākšana pašlaik nav pieejama/);
  assert.equal(element("collector-start-btn").disabled, true);
  assert.equal(element("collector-progress").style.width, "0%");
  assert.equal(element("collector-log-details").open, false);
  assert.match(element("collector-log-summary").textContent, /Iepriekšējās ievākšanas žurnāls.*2026/);
  assert.equal(element("collector-log").textContent, previousRun.log[0]);
  // Polling must not collapse a history section the user opened themselves.
  element("collector-log-details").open = true;
  context.updateCollectorUI(previousRun);
  assert.equal(element("collector-log-details").open, true);
});

test("reconnecting enables a new run without presenting old success as new", () => {
  const { context, element } = app();
  context.updateCollectorUI({ ...previousRun, worker_online: true });
  assert.equal(element("collector-status-title").textContent, "Gatavs darbam");
  assert.equal(element("collector-start-btn").disabled, false);
  assert.equal(element("collector-log-details").open, false);
});

test("a run observed in this page shows its live log and completion", () => {
  const { context, element, run } = app();
  run("collectorWasRunning = true");
  context.updateCollectorUI({ ...previousRun, worker_online: true, running: true, returncode: null });
  assert.equal(element("collector-log-summary").textContent, "Pašreizējās ievākšanas žurnāls");
  assert.equal(element("collector-log-details").open, true);
  context.updateCollectorUI({ ...previousRun, worker_online: true });
  assert.equal(element("collector-status-title").textContent, "Datubāze veiksmīgi atjaunināta");
  assert.equal(element("collector-progress").style.width, "100%");
});

test("collector connection errors stay in Latvian and one test uses singular wording", async () => {
  const { context, element } = app();
  element("collector-rounds").value = "1";
  let pendingMessage = "";
  context.setCollectorPending = (message) => { pendingMessage = message; };
  context.fetch = async () => { throw new TypeError("Failed to fetch"); };

  await context.startCollector();
  assert.equal(pendingMessage, "Sāku ievākt 1 testu…");
  assert.equal(element("collector-status-text").textContent, "Neizdevās izveidot savienojumu ar jautājumu ievācēju.");
  assert.doesNotMatch(element("collector-status-text").textContent, /Failed to fetch/);
});

test("a wrong practice answer reveals the verified correct option", () => {
  const { context, run } = app();
  const classes = () => {
    const values = new Set();
    return {
      values,
      add: (...names) => names.forEach((name) => values.add(name)),
      remove: (...names) => names.forEach((name) => values.delete(name)),
    };
  };
  const correct = {
    disabled: false,
    dataset: { isCorrect: "true" },
    classList: classes(),
    closest: () => card,
  };
  const wrong = {
    disabled: false,
    dataset: { isCorrect: "false" },
    classList: classes(),
    closest: () => card,
  };
  const card = {
    querySelectorAll: () => [wrong, correct],
    querySelector: () => correct,
  };

  run("currentMode = 'quiz'");
  context.handleOptionClick(wrong);

  assert.ok(wrong.classList.values.has("selected-wrong"));
  assert.ok(correct.classList.values.has("revealed-correct"));

  context.handleOptionClick(correct);
  assert.ok(correct.classList.values.has("selected-correct"));
  assert.ok(!wrong.classList.values.has("selected-wrong"));
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
        message: "Uzdevums nosūtīts palīgprogrammai.",
      }) });
    const pendingStatus = context.refreshCollectorStatus();
    await context.startCollector();
    if (lateError) finishOldStatus(new Error("Old request failed"));
    else finishOldStatus({ ok: true, json: async () => previousRun });
    await pendingStatus;
    assert.equal(element("collector-status-title").textContent, "Gaida palīgprogrammas savienojumu");
    assert.equal(element("collector-log").textContent, "");
    assert.equal(element("collector-start-btn").disabled, true);
  });
}
