import React, { useCallback, useEffect, useRef, useState } from "react";
import { QuestionMedia } from "./QuestionMedia.jsx";
import ImageLightbox from "./ImageLightbox.jsx";

function messageFor(error) {
  const code = error?.message || error?.error || "";
  const known = {
    unauthorized: "Sesija ir beigusies. Pierakstieties vēlreiz.",
    forbidden: "Jums nav piekļuves šai sadaļai.",
    question_expired: "Laiks ir beidzies. Tiek atvērts nākamais jautājums.",
    attempt_changed: "Tests tika atjaunināts citā cilnē.",
    not_enough_questions: "Šobrīd nav pietiekami daudz pārbaudītu jautājumu.",
  };
  return known[code] || "Neizdevās izpildīt pieprasījumu. Mēģiniet vēlreiz.";
}

export default function AccountPanel() {
  const [config, setConfig] = useState(null);
  const [client, setClient] = useState(null);
  const [account, setAccount] = useState(null);
  const [profile, setProfile] = useState(null);
  const [overview, setOverview] = useState(null);
  const [board, setBoard] = useState([]);
  const [attempts, setAttempts] = useState([]);
  const [attempt, setAttempt] = useState(null);
  const [users, setUsers] = useState([]);
  const [selectedUser, setSelectedUser] = useState(null);
  const [seconds, setSeconds] = useState(60);
  const [image, setImage] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [visible, setVisible] = useState(false);
  const clockOffset = useRef(0);

  useEffect(() => {
    if (location.protocol === "file:") return;
    let active = true;
    fetch("/api/config", { cache: "no-store" })
      .then((response) => response.json())
      .then(async (settings) => {
        if (!active) return;
        setConfig(settings);
        if (!settings.auth_enabled) return;
        const { PublicClientApplication } = await import("@azure/msal-browser");
        const msal = new PublicClientApplication({
          auth: {
            clientId: settings.client_id,
            authority: settings.authority,
            knownAuthorities: [new URL(settings.authority).host],
            redirectUri: window.location.origin + "/",
          },
          cache: { cacheLocation: "sessionStorage" },
        });
        await msal.initialize();
        if (!active) return;
        setClient(msal);
        setAccount(msal.getAllAccounts()[0] || null);
      })
      .catch(() => {});
    return () => { active = false; };
  }, []);

  const request = useCallback(async (path, options = {}) => {
    if (!client || !account) throw new Error("unauthorized");
    const token = await client.acquireTokenSilent({ account, scopes: config.scopes });
    const response = await fetch(path, {
      ...options,
      headers: { Authorization: `Bearer ${token.accessToken}`,
        ...(options.body ? { "Content-Type": "application/json" } : {}) },
      cache: "no-store",
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "server_error");
    return body;
  }, [client, account, config]);

  const loadDashboard = useCallback(async () => {
    try {
      const [me, progress, leaders, history] = await Promise.all([
        request("/api/me"), request("/api/quests"),
        request("/api/leaderboard"), request("/api/attempts"),
      ]);
      setProfile(me);
      setOverview(progress);
      setBoard(leaders.items);
      setAttempts(history.items);
      const latest = history.items.find((item) => !item.finished);
      if (latest) {
        const state = await request(`/api/attempts/${latest.attempt_id}`);
        setAttempt(state);
        if (state.status === "finished") {
          const [updatedProgress, updatedLeaders, updatedHistory] = await Promise.all([
            request("/api/quests"), request("/api/leaderboard"), request("/api/attempts"),
          ]);
          setOverview(updatedProgress);
          setBoard(updatedLeaders.items);
          setAttempts(updatedHistory.items);
        }
      }
    } catch (failure) { setError(messageFor(failure)); }
  }, [request]);

  useEffect(() => {
    if (account) loadDashboard();
  }, [account]); // Reload when the identity changes.

  useEffect(() => {
    if (!attempt || attempt.status !== "active") return;
    clockOffset.current = Date.parse(attempt.server_time) - Date.now();
    const tick = () => setSeconds(Math.max(0, Math.ceil((Date.parse(attempt.deadline) - Date.now() - clockOffset.current) / 1000)));
    tick();
    const timer = setInterval(tick, 250);
    return () => clearInterval(timer);
  }, [attempt?.deadline, attempt?.question?.id]);

  useEffect(() => {
    if (seconds !== 0 || attempt?.status !== "active") return;
    const timer = setTimeout(async () => {
      try { setAttempt(await request(`/api/attempts/${attempt.attempt_id}`)); }
      catch (failure) { setError(messageFor(failure)); }
    }, 300);
    return () => clearTimeout(timer);
  }, [seconds, attempt, request]);

  async function signIn() {
    setError("");
    try {
      const result = await client.loginPopup({ scopes: config.scopes });
      setAccount(result.account);
      setVisible(true);
    } catch (failure) { setError(messageFor(failure)); }
  }

  async function signOut() {
    await client.logoutPopup({ account });
    setAccount(null);
    setProfile(null);
    setOverview(null);
    setAttempt(null);
    setVisible(false);
  }

  async function start(size) {
    setBusy(true);
    setError("");
    try {
      setAttempt(await request("/api/attempts", {
        method: "POST", body: JSON.stringify({ size }),
      }));
      setVisible(true);
    } catch (failure) { setError(messageFor(failure)); }
    finally { setBusy(false); }
  }

  async function answer(option) {
    setBusy(true);
    setError("");
    try {
      const next = await request(`/api/attempts/${attempt.attempt_id}/answer`, {
        method: "POST", body: JSON.stringify({ question_id: attempt.question.id, option }),
      });
      setAttempt(next);
      if (next.status === "finished") await loadDashboard();
    } catch (failure) {
      setError(messageFor(failure));
      try { setAttempt(await request(`/api/attempts/${attempt.attempt_id}`)); }
      catch { /* Keep the last state visible. */ }
    } finally { setBusy(false); }
  }

  async function openUser(oid) {
    setBusy(true);
    try { setSelectedUser(await request(`/api/admin/users/${oid}/progress`)); }
    catch (failure) { setError(messageFor(failure)); }
    finally { setBusy(false); }
  }

  async function showAdmin() {
    setVisible(true);
    setBusy(true);
    try { setUsers((await request("/api/admin/users")).users); }
    catch (failure) { setError(messageFor(failure)); }
    finally { setBusy(false); }
  }

  if (!config) return null;
  if (!config.auth_enabled) return (
    <section className="account-area" aria-label="Personīgie testi un progress">
      <div className="account-card">
        <h2>Personīgie testi un progress</h2>
        <p>Pierakstīšanās vēl tiek pieslēgta. Kad tā būs gatava, šeit varēsiet saglabāt testu rezultātus, pildīt kvestus un skatīt līderu sarakstu.</p>
      </div>
    </section>
  );
  return (
    <section className="account-area" aria-label="Personīgais progress">
      <div className="account-toolbar">
        <button className="btn" type="button" onClick={() => setVisible((value) => !value)}
          aria-expanded={visible}>🏆 {visible ? "Slēpt manus testus" : "Mani testi un progress"}</button>
        {account ? <button className="btn" type="button" onClick={signOut}>Izrakstīties</button>
          : <button className="btn btn-primary" type="button" onClick={signIn}>Pierakstīties</button>}
      </div>
      {error && <p className="account-error" role="alert">{error}</p>}
      {visible && !account && <div className="account-card"><h2>Personīgie testi</h2>
        <p>Pierakstieties ar Microsoft kontu, lai saglabātu rezultātus un izpildītu kvestus.</p>
        <button className="btn btn-primary" type="button" onClick={signIn}>Pierakstīties</button></div>}
      {visible && account && <div className="account-content">
        <div className="account-card">
          <h2>{profile?.name || account.name || "Mans progress"}</h2>
          <p>Kvestu punkti: <strong>{overview?.total_points ?? 0}</strong></p>
          <p>Unikāli pareizi atbildēti jautājumi: <strong>{overview?.correct_unique ?? 0}</strong></p>
          <div className="account-actions">
            {[30, 60, 120].map((size) => <button key={size} className="btn btn-primary"
              type="button" disabled={busy || attempt?.status === "active"} onClick={() => start(size)}>
              Sākt {size} jautājumu testu</button>)}
            <button className="btn" type="button" onClick={loadDashboard}>Atjaunot progresu</button>
          </div>
        </div>
        {attempt?.status === "active" && <div className="account-card test-card">
          <div className="test-meta"><strong>Jautājums {attempt.number} / {attempt.size}</strong>
            <strong aria-live="polite">Atlikušas {seconds} s</strong></div>
          <QuestionMedia question={attempt.question} onOpenImage={(src, trigger) => setImage({ src, trigger })} />
          <h3>{attempt.question.question}</h3>
          <div className="test-options">{attempt.question.options.map((option) =>
            <button key={option.id} className="option-item" type="button" disabled={busy || seconds === 0}
              onClick={() => answer(option.id)}>{option.text}</button>)}</div>
          <p>Atbilde jāiesniedz 60 sekundēs. Laiku un rezultātu pārbauda serveris.</p>
        </div>}
        {attempt?.status === "finished" && <div className="account-card">
          <h3>Tests pabeigts: {attempt.result.correct} / {attempt.result.total}</h3>
          <button className="btn" type="button" onClick={() => setAttempt(null)}>Apskatīt progresu</button>
        </div>}
        <div className="account-grid">
          <div className="account-card"><h3>Kvesti</h3>
            {overview?.quests.map((quest) => <div className="account-row" key={quest.id}>
              <strong>{quest.title} {quest.completed ? "✓" : ""}</strong>
              <span>{quest.description}</span>
              <small>{quest.current} / {quest.target} · +{quest.reward} punkti</small>
            </div>)}</div>
          <div className="account-card"><h3>Mani rezultāti</h3>
            {overview?.attempts.length ? overview.attempts.slice().reverse().map((item) =>
              <div className="account-row" key={item.attempt_id}>
                <strong>{item.correct} / {item.total}</strong>
                <span>{new Date(item.finished_at).toLocaleString("lv-LV")}</span>
              </div>) : <p>Vēl nav pabeigtu testu.</p>}
            {attempts.some((item) => !item.finished) && <p>Nepabeigts tests ir atjaunojams pēc pierakstīšanās.</p>}
          </div>
          <div className="account-card"><h3>Līderu saraksts</h3>
            <p>Pēc kvestu punktiem, pēc tam pēc pabeigto kvestu skaita.</p>
            {board.map((item) => <div className="account-row" key={item.oid}>
              <strong>{item.rank}. {item.name || "Dalībnieks"}</strong>
              <span>{item.score} punkti · {item.completed} kvesti</span>
            </div>)}</div>
        </div>
        {profile?.is_admin && <div className="account-card"><h3>Administrācija</h3>
          <button className="btn" type="button" disabled={busy} onClick={showAdmin}>Apskatīt lietotājus</button>
          {users.map((user) => <div className="account-row" key={user.oid}>
            <button className="btn" type="button" onClick={() => openUser(user.oid)}>{user.name || user.email || user.oid}</button>
            <span>{user.total_points} punkti · {user.completed} kvesti</span></div>)}
          {selectedUser && <div className="account-detail"><h4>{selectedUser.user.name || selectedUser.user.email}</h4>
            <p>{selectedUser.user.email} · {selectedUser.user.oid}</p>
            <p>{selectedUser.user.total_points} punkti</p>
            <p>Unikāli pareizi atbildēti jautājumi: {selectedUser.correct_unique}</p>
            <h4>Rezultāti</h4>
            {selectedUser.attempts.map((item) => <p key={item.attempt_id}>
              {item.correct} / {item.total} · {new Date(item.finished_at).toLocaleString("lv-LV")}</p>)}
            <h4>Kvesti</h4>
            {selectedUser.quests.map((quest) => <p key={quest.id}>{quest.title}: {quest.completed ? "pabeigts" : `${quest.current}/${quest.target}`}</p>)}
          </div>}
        </div>}
      </div>}
      {image && <ImageLightbox image={image.src} returnFocus={image.trigger} onClose={() => setImage(null)} />}
    </section>
  );
}
