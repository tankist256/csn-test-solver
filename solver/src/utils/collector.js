export function clampRounds(value) {
  return Math.max(1, Math.min(50, Number.parseInt(value, 10) || 1));
}

export function collectorHeaders(requiresToken, token, includeContentType = false) {
  const headers = includeContentType ? { "Content-Type": "application/json" } : {};
  if (requiresToken) headers["X-CSN-Collector-Token"] = token.trim();
  return headers;
}

export function collectorPresentation(state, workerMode, wasRunning) {
  const completed = Number(state?.completed_rounds) || 0;
  const rounds = Number(state?.rounds) || 0;
  const percent = rounds ? Math.round((completed / rounds) * 100) : 0;
  const offline = workerMode && !state?.worker_online && !state?.running;
  const previousRun = !state?.running && !wasRunning;
  const title = offline ? "Nav savienojuma ar palīgprogrammu"
    : state?.running ? state.phase === "queued" ? "Gaida palīgprogrammas savienojumu" : `Jautājumu ievākšana: ${Math.min(completed + 1, rounds)}. no ${rounds} ${rounds === 1 ? "testa" : "testiem"}`
      : previousRun ? "Gatavs darbam" : state?.returncode === 0 ? "Datubāze veiksmīgi atjaunināta" : state?.returncode ? "Jautājumu ievākšana neizdevās" : "Gatavs darbam";
  const text = offline
    ? "Vietne nesaņem signālu no datorā palaistās palīgprogrammas. Pārbaudiet, vai tā darbojas un var izveidot savienojumu ar serveri. Jaunu jautājumu ievākšana pašlaik nav pieejama."
    : previousRun ? "Nospiediet “Sākt jautājumu ievākšanu”, lai papildinātu datubāzi. Iepriekšējā mēģinājuma informācija ir pieejama žurnālā zemāk."
      : state?.message || "Jautājumu ievācējs ir gatavs darbam.";
  const statusClass = offline ? "error" : state?.running ? "running" : previousRun ? "idle" : state?.returncode === 0 ? "success" : state?.returncode ? "error" : "idle";
  const progress = offline || previousRun ? 0 : state?.running ? Math.max(percent, 3) : state?.returncode === 0 ? 100 : percent;
  return { title, text, statusClass, progress, offline, previousRun, completed, rounds };
}
