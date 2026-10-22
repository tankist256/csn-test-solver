import React, {
  useCallback,
  useEffect,
  useState,
} from 'react';

import { clampRounds } from '../utils/collector.js';
import CollectorDialog from './CollectorDialog.jsx';

export default function AdminCollector({ request }) {
  const [open, setOpen] = useState(false);
  const [collector, setCollector] = useState({
    available: false,
    workerMode: false,
    state: null,
    wasRunning: false,
  });
  const [rounds, setRounds] = useState("1");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    try {
      const state = await request("/api/collector/status");
      setCollector((current) => ({ ...current, state, wasRunning: current.wasRunning || state.running }));
    } catch {
      setError("Neizdevās nolasīt jautājumu ievācēja statusu.");
    }
  }, [request]);

  useEffect(() => {
    if (!open || !collector.available) return;
    refresh();
    const timer = window.setInterval(refresh, collector.state?.running ? 2000 : 5000);
    return () => window.clearInterval(timer);
  }, [open, collector.available, collector.state?.running, refresh]);

  async function openDialog() {
    setError("");
    try {
      const access = await request("/api/collector/access");
      setCollector((current) => ({ ...current, available: access.available, workerMode: access.worker_mode }));
      setOpen(true);
    } catch {
      setError("Tikai administratori var papildināt jautājumu datubāzi.");
    }
  }

  async function start() {
    if (pending || collector.state?.running) return;
    const count = clampRounds(rounds);
    setRounds(String(count));
    setPending(true);
    setError("");
    try {
      const state = await request("/api/collector/start", {
        method: "POST", body: JSON.stringify({ rounds: count }),
      });
      setCollector((current) => ({ ...current, state, wasRunning: true }));
    } catch (failure) {
      if (failure?.message === "forbidden") {
        setError("Tikai administratori var papildināt jautājumus.");
      } else {
        setError("Neizdevās sākt jautājumu ievākšanu. Mēģiniet vēlreiz.");
      }
    } finally {
      setPending(false);
    }
  }

  function closeDialog() {
    setOpen(false);
  }

  return (
    <>
      <button className="btn btn-primary" type="button" onClick={openDialog}>
        ↻ Papildināt jautājumus
      </button>
      {error && !open && <p className="account-error" role="alert">{error}</p>}
      {open && (
        <CollectorDialog
          open
          onClose={closeDialog}
          collector={collector}
          rounds={rounds}
          setRounds={setRounds}
          onStart={start}
          error={error}
          pending={pending}
        />
      )}
    </>
  );
}
