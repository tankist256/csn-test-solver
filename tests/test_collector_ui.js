import assert from "node:assert/strict";
import test from "node:test";
import { collectorPresentation, clampRounds } from "../solver/src/utils/collector.js";
import { isCorrectOption, verifiedCorrectOption } from "../solver/src/utils/answers.js";

const previousRun = {
  running: false,
  worker_online: false,
  returncode: 0,
  rounds: 50,
  completed_rounds: 50,
  finished_at: "2026-10-16T21:15:13Z",
  message: "Datubāze vietnē ir atjaunināta.",
  log: ["Iepriekšējais žurnāls: 542 jautājumi"],
};

test("an offline worker disables collection and keeps the earlier result", () => {
  const result = collectorPresentation(previousRun, true, false);
  assert.equal(result.title, "Nav savienojuma ar palīgprogrammu");
  assert.match(result.text, /Jaunu jautājumu ievākšana pašlaik nav pieejama/);
  assert.equal(result.statusClass, "error");
  assert.equal(result.progress, 0);
  assert.equal(result.previousRun, true);
});

test("a queued job has the running status and progress", () => {
  const result = collectorPresentation({ running: true, phase: "queued", rounds: 1, completed_rounds: 0 }, true, true);
  assert.equal(result.title, "Gaida palīgprogrammas savienojumu");
  assert.equal(result.statusClass, "running");
  assert.equal(result.progress, 3);
});

test("reconnecting shows the last successful completion as a new ready state", () => {
  const result = collectorPresentation({ ...previousRun, worker_online: true }, true, true);
  assert.equal(result.title, "Datubāze veiksmīgi atjaunināta");
  assert.equal(result.progress, 100);
  assert.equal(result.previousRun, false);
});

test("collector requests limit test counts", () => {
  assert.equal(clampRounds("0"), 1);
  assert.equal(clampRounds("12"), 12);
  assert.equal(clampRounds("90"), 50);
});

test("only verified records can expose a correct option", () => {
  const unverified = { verified: false, correct_id: "a", correct_text: "Pareizi", options: [{ id: "a", text: "Pareizi" }] };
  const verified = { ...unverified, verified: true };
  assert.equal(verifiedCorrectOption(unverified), null);
  assert.equal(isCorrectOption(unverified, unverified.options[0]), false);
  assert.equal(verifiedCorrectOption(verified), verified.options[0]);
  assert.equal(isCorrectOption(verified, verified.options[0]), true);
});
