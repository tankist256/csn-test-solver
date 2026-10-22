import React, { useCallback, useEffect, useRef, useState } from "react";
import { QuestionMedia } from "./QuestionMedia.jsx";
import ImageLightbox from "./ImageLightbox.jsx";
import AdminCollector from "./AdminCollector.jsx";

function messageFor(error) {
  const code = error?.message || error?.error || "";
  const known = {
    unauthorized: "Sesija ir beigusies. Pierakstieties vēlreiz.",
    forbidden: "Jums nav piekļuves šai sadaļai.",
    question_expired: "Laiks ir beidzies. Tiek atvērts nākamais jautājums.",
    attempt_changed: "Tests tika atjaunināts citā cilnē.",
    not_enough_questions: "Šobrīd nav pietiekami daudz pārbaudītu jautājumu.",
    invalid_credentials: "Nepareizs e-pasts vai parole.",
    account_exists: "Konts ar šo e-pastu jau ir izveidots.",
    bad_account: "Ievadiet vārdu, derīgu e-pastu un paroli ar vismaz 12 rakstzīmēm.",
    too_many_attempts: "Pārāk daudz mēģinājumu. Mēģiniet vēlāk.",
    self_demote: "Savas administratora tiesības nevar noņemt. To var izdarīt cits administrators.",
    last_admin: "Sistēmā jāpaliek vismaz vienam administratoram.",
    role_management_unavailable: "Šī konta tiesības jāpārvalda Microsoft Entra vidē.",
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
  const [roleBusy, setRoleBusy] = useState(false);
  const [roleMessage, setRoleMessage] = useState("");
  const [seconds, setSeconds] = useState(60);
  const [image, setImage] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [registering, setRegistering] = useState(false);
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
        if (settings.auth_mode === "local") {
          const response = await fetch("/api/auth/session", { cache: "no-store", credentials: "same-origin" });
          if (response.ok && active) setAccount(await response.json());
          return;
        }
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
    if (!account) throw new Error("unauthorized");
    const local = config.auth_mode === "local";
    if (!local && !client) throw new Error("unauthorized");
    const token = local ? null : await client.acquireTokenSilent({ account, scopes: config.scopes });
    const response = await fetch(path, {
      ...options,
      credentials: "same-origin",
      headers: { ...(local ? { "X-CSN-Request": "1" } : { Authorization: `Bearer ${token.accessToken}` }),
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
    } catch (failure) { setError(messageFor(failure)); }
  }

  async function submitLocal(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch(registering ? "/api/auth/register" : "/api/auth/login", {
        method: "POST", credentials: "same-origin", cache: "no-store",
        headers: { "Content-Type": "application/json", "X-CSN-Request": "1" },
        body: JSON.stringify({ email, password, ...(registering ? { name } : {}) }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "server_error");
      setAccount(body);
      setPassword("");
    } catch (failure) { setError(messageFor(failure)); }
    finally { setBusy(false); }
  }

  async function signOut() {
    if (config.auth_mode === "local") {
      try {
        const response = await fetch("/api/auth/logout", {
          method: "POST", credentials: "same-origin", headers: { "X-CSN-Request": "1" },
        });
        if (!response.ok) throw new Error("server_error");
      } catch (failure) { setError(messageFor(failure)); return; }
    } else {
      await client.logoutPopup({ account });
    }
    setAccount(null);
    setProfile(null);
    setOverview(null);
    setAttempt(null);
  }

  async function start(size) {
    setBusy(true);
    setError("");
    try {
      setAttempt(await request("/api/attempts", {
        method: "POST", body: JSON.stringify({ size }),
      }));
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
    setRoleMessage("");
    try { setSelectedUser(await request(`/api/admin/users/${oid}/progress`)); }
    catch (failure) { setError(messageFor(failure)); }
    finally { setBusy(false); }
  }

  async function showAdmin() {
    setBusy(true);
    try { setUsers((await request("/api/admin/users")).users); }
    catch (failure) { setError(messageFor(failure)); }
    finally { setBusy(false); }
  }

  async function changeRole(user) {
    if (config.auth_mode !== "local" || typeof user.is_admin !== "boolean") return;
    const nextAdmin = !user.is_admin;
    const action = nextAdmin ? "piešķirt" : "noņemt";
    if (!window.confirm(`Vai tiešām ${action} administratora tiesības kontam ${user.email || user.oid}\nID: ${user.oid}?\n\nE-pasta adrese nav verificēta. Pirms tiesību piešķiršanas pārbaudiet konta īpašnieku.`)) return;
    setRoleBusy(true);
    setRoleMessage("");
    setError("");
    try {
      const updated = await request(`/api/admin/users/${user.oid}/role`, {
        method: "POST", body: JSON.stringify({ is_admin: nextAdmin }),
      });
      setUsers((current) => current.map((item) => item.oid === user.oid
        ? { ...item, is_admin: updated.is_admin } : item));
      setSelectedUser((current) => current?.user.oid === user.oid
        ? { ...current, user: { ...current.user, is_admin: updated.is_admin } } : current);
      setRoleMessage(nextAdmin ? "Administratora tiesības piešķirtas." : "Administratora tiesības noņemtas.");
    } catch (failure) { setError(messageFor(failure)); }
    finally { setRoleBusy(false); }
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
        {account ? <button className="btn" type="button" onClick={signOut}>Izrakstīties</button>
          : config.auth_mode !== "local" && <button className="btn btn-primary" type="button" onClick={signIn}>Pierakstīties</button>}
      </div>
      {error && <p className="account-error" role="alert">{error}</p>}
      {!account && <div className="account-card"><h2>Personīgie testi</h2>
        {config.auth_mode === "local" ? <>
          <p>{registering ? "Izveidojiet kontu, lai saglabātu rezultātus." : "Pierakstieties, lai turpinātu savus testus."}</p>
          <form className="account-form" onSubmit={submitLocal}>
            {registering && <label>Vārds<input required maxLength={80} autoComplete="name" value={name}
              onChange={(event) => setName(event.target.value)} /></label>}
            <label>E-pasts<input required type="email" maxLength={254} autoComplete="email" value={email}
              onChange={(event) => setEmail(event.target.value)} /></label>
            <label>Parole<input required type="password" minLength={registering ? 12 : undefined}
              autoComplete={registering ? "new-password" : "current-password"} value={password}
              onChange={(event) => setPassword(event.target.value)} /></label>
            <button className="btn btn-primary" disabled={busy} type="submit">
              {registering ? "Izveidot kontu" : "Pierakstīties"}</button>
          </form>
          {registering && <p>Paroles atjaunošana vēl nav pieejama. Saglabājiet paroli drošā vietā.</p>}
          <button className="btn" type="button" onClick={() => { setRegistering(!registering); setError(""); }}>
            {registering ? "Man jau ir konts" : "Izveidot kontu"}</button>
        </> : <><p>Pierakstieties ar Microsoft kontu, lai saglabātu rezultātus un izpildītu kvestus.</p>
          <button className="btn btn-primary" type="button" onClick={signIn}>Pierakstīties</button></>}
      </div>}
      {account && <div className="account-content">
        <div className="account-card">
          <h2>{profile?.name || account.name || "Mans progress"}</h2>
          <p>Kvestu punkti: <strong>{overview?.total_points ?? 0}</strong></p>
          <p>Unikāli pareizi atbildēti jautājumi: <strong>{overview?.correct_unique ?? 0}</strong></p>
          <div className="account-actions">
            {[30, 60, 120].map((size) => <button key={size} className="btn btn-primary"
              type="button" disabled={busy || attempt?.status === "active"} onClick={() => start(size)}>
              Sākt {size} jautājumu testu</button>)}
            <button className="btn" type="button" onClick={loadDashboard}>Atjaunot progresu</button>
            {profile?.is_admin && <a className="btn" href="#administracija">Administrācija ↓</a>}
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
        {profile?.is_admin && <div className="account-card" id="administracija"><h3>Administrācija</h3>
          <p>Jautājumu datubāzes papildināšana, lietotāju rezultāti un piekļuves tiesības.</p>
          <AdminCollector request={request} />
          <button className="btn" type="button" disabled={busy} onClick={showAdmin}>Apskatīt lietotājus</button>
          {users.map((user) => <div className="account-row" key={user.oid}>
            <button className="btn" type="button" onClick={() => openUser(user.oid)}>{user.name || user.email || user.oid}</button>
            <span>{typeof user.is_admin === "boolean" ? `${user.is_admin ? "Administrators" : "Lietotājs"} · ` : ""}{user.total_points} punkti · {user.completed} kvesti</span></div>)}
          {selectedUser && <div className="account-detail"><h4>{selectedUser.user.name || selectedUser.user.email}</h4>
            <p>{selectedUser.user.email} · {selectedUser.user.oid}</p>
            {config.auth_mode === "local" && typeof selectedUser.user.is_admin === "boolean" && <div className="account-role-control">
              <p>Pieeja: <strong>{selectedUser.user.is_admin ? "Administrators" : "Lietotājs"}</strong></p>
              <p>E-pasts nav verificēts. Pirms administratora tiesību piešķiršanas pārbaudiet, kam konts pieder.</p>
              <button className="btn" type="button" disabled={roleBusy || (selectedUser.user.is_admin && selectedUser.user.oid === profile?.oid)}
                onClick={() => changeRole(selectedUser.user)}>
                {selectedUser.user.is_admin ? "Noņemt administratora tiesības" : "Piešķirt administratora tiesības"}
              </button>
              {selectedUser.user.is_admin && selectedUser.user.oid === profile?.oid && <small>Savas tiesības nevar noņemt.</small>}
              {roleMessage && <p role="status">{roleMessage}</p>}
            </div>}
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
