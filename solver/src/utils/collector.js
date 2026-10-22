export function clampRounds(value) {
  return Math.max(1, Math.min(50, Number.parseInt(value, 10) || 1));
}

export function collectorPresentation(state, workerMode, wasRunning) {
  const completed = Number(state?.completed_rounds) || 0;
  const rounds = Number(state?.rounds) || 0;
  const percent = rounds ? Math.round((completed / rounds) * 100) : 0;
  const offline = workerMode && !state?.worker_online && !state?.running;
  const previousRun = !state?.running && !wasRunning;
  let title = "Gatavs darbam";
  if (offline) {
    title = "Nav savienojuma ar palīgprogrammu";
  } else if (state?.running && state.phase === "queued") {
    title = "Gaida palīgprogrammas savienojumu";
  } else if (state?.running) {
    const currentRound = Math.min(completed + 1, rounds);
    const roundLabel = rounds === 1 ? "testa" : "testiem";
    title = `Jautājumu ievākšana: ${currentRound}. no ${rounds} ${roundLabel}`;
  } else if (!previousRun && state?.returncode === 0) {
    title = "Datubāze veiksmīgi atjaunināta";
  } else if (!previousRun && state?.returncode) {
    title = "Jautājumu ievākšana neizdevās";
  }

  let text = state?.message || "Jautājumu ievācējs ir gatavs darbam.";
  if (offline) {
    text = "Vietne nesaņem signālu no datorā palaistās palīgprogrammas. Pārbaudiet, vai tā darbojas un var izveidot savienojumu ar serveri. Jaunu jautājumu ievākšana pašlaik nav pieejama.";
  } else if (previousRun) {
    text = "Nospiediet “Sākt jautājumu ievākšanu”, lai papildinātu datubāzi. Iepriekšējā mēģinājuma informācija ir pieejama žurnālā zemāk.";
  }

  let statusClass = "idle";
  if (offline) {
    statusClass = "error";
  } else if (state?.running) {
    statusClass = "running";
  } else if (previousRun) {
    statusClass = "idle";
  } else if (!previousRun && state?.returncode === 0) {
    statusClass = "success";
  } else if (state?.returncode) {
    statusClass = "error";
  }

  let progress = percent;
  if (offline || previousRun) {
    progress = 0;
  } else if (state?.running) {
    progress = Math.max(percent, 3);
  } else if (state?.returncode === 0) {
    progress = 100;
  }

  return { title, text, statusClass, progress, offline, previousRun, completed, rounds };
}
