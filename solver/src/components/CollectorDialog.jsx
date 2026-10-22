import React, { useEffect, useRef } from "react";
import { collectorPresentation } from "../utils/collector.js";

export default function CollectorDialog({ open, onClose, collector, rounds, setRounds, onStart, error, pending }) {
  const dialogRef = useRef(null);
  const firstInputRef = useRef(null);
  useEffect(() => {
    if (open) firstInputRef.current?.focus();
  }, [open]);
  useEffect(() => {
    if (!open) return undefined;
    const closeOnEscape = (event) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [open, onClose]);
  if (!open) return null;
  const state = collector.state;
  const { title, text: statusText, statusClass, progress, offline, previousRun } = collectorPresentation(state, collector.workerMode, collector.wasRunning);
  const logs = Array.isArray(state?.log) ? state.log : [];
  const finished = state?.finished_at ? new Date(state.finished_at) : null;
  const finishedLabel = finished && !Number.isNaN(finished.getTime()) ? ` · ${finished.toLocaleString("lv-LV")}` : "";
  return (
    <div className="dialog-backdrop active" aria-hidden="false" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section ref={dialogRef} className="collector-dialog" role="dialog" aria-modal="true" aria-labelledby="collector-title">
        <div className="dialog-header"><div><div className="dialog-kicker">Oficiālais CSDD tests</div><h2 id="collector-title">Datubāzes papildināšana</h2></div><button id="collector-close-btn" className="dialog-close" title="Aizvērt" aria-label="Aizvērt" onClick={onClose}>✕</button></div>
        <p className="dialog-description">{collector.workerMode ? "Jautājumu ievākšana notiek jūsu datorā un automātiski atjaunina vietni. Datoram jābūt ieslēgtam un savienotam ar internetu." : "Vienā reizē tiek iegūti 30 testa jautājumi, pēc tam CSDD rezultātu lapā tiek nolasītas pareizās atbildes."}</p>
        <div className="collector-form"><label htmlFor="collector-rounds">Testu skaits<small>Parasti pietiek ar 1–5</small></label><div className="rounds-control"><input ref={firstInputRef} id="collector-rounds" type="number" min="1" max="50" value={rounds} disabled={Boolean(state?.running)} inputMode="numeric" onChange={(event) => setRounds(event.target.value)} /><button id="collector-start-btn" className="btn btn-primary collector-start-btn" disabled={Boolean(pending || state?.running || (collector.workerMode && !state?.worker_online))} onClick={onStart}><span>▶</span> Sākt jautājumu ievākšanu</button></div></div>
        <div className={`collector-status ${error ? "error" : statusClass}`}><div className="status-line"><span className="status-dot" /><strong>{error ? "Jautājumu ievācējs nav pieejams" : title}</strong></div><div className="status-text">{error || statusText}</div><div className="progress-track" aria-hidden="true"><div className="progress-bar" style={{ width: `${progress}%` }} /></div>
          {(logs.length > 0 || (!state?.running && state?.returncode != null)) && <details className="collector-log-details" open={Boolean(state?.running || (!previousRun && !offline))}><summary>{state?.running ? "Pašreizējās ievākšanas žurnāls" : `${previousRun || offline ? "Iepriekšējās ievākšanas žurnāls" : "Pabeigtās ievākšanas žurnāls"}${finishedLabel}`}</summary>{!state?.running && state?.returncode != null && <div className="status-text">{state.message}</div>}<pre className="collector-log" aria-live="polite">{logs.join("\n")}</pre></details>}
        </div>
      </section>
    </div>
  );
}
