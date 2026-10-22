import React from 'react';

export default function Header({ page, mode, theme, onModeChange, onThemeChange,
  query, onQueryChange, filter, onFilterChange, countText }) {
  const offline = location.protocol === "file:";
  const filters = [
    ["all", "Visi jautājumi"], ["images", "Ar attēliem"],
    ["videos", "Video"], ["bookmarks", "★ Izlase"],
  ];
  const modeLabel = mode === "solver" ? "Atbilžu lapa" : "Treniņrežīms";
  const modeIcon = mode === "solver" ? "🎯" : "✍️";
  const modeDescription = mode === "solver"
    ? "Atbilžu lapa. Pārslēgt uz treniņrežīmu"
    : "Treniņrežīms. Pārslēgt uz atbilžu lapu";
  const themeLabel = theme === "dark" ? "Ieslēgt gaišo režīmu" : "Ieslēgt tumšo režīmu";
  const themeIcon = theme === "dark" ? "☀️" : "🌙";

  return <header className="app-header">
    <div className="header-top">
      <a className="logo-area" href={offline ? "./index.html" : "/"} aria-label="CSDD teorija — sākums">
        <span className="badge-csdd">CSDD B</span><span className="app-title">CSDD teorija</span>
      </a>
      {!offline && <nav className="site-nav" aria-label="Galvenā navigācija">
        <a className={page === "answers" ? "active" : ""} aria-current={page === "answers" ? "page" : undefined} href="/answers">Gatavās atbildes</a>
        <a className={page === "tests" ? "active" : ""} aria-current={page === "tests" ? "page" : undefined} href="/tests">Mani testi</a>
      </nav>}
      <div className="header-controls">
        {page === "answers" && <button id="mode-toggle-btn" className="btn mode-toggle-btn"
          title="Pārslēgt režīmu" aria-label={`Režīms: ${modeDescription}`}
          onClick={onModeChange}><span aria-hidden="true">{modeIcon}</span>
          <strong>{modeLabel}</strong></button>}
        <button id="theme-toggle-btn" className="btn icon-btn" title="Mainīt krāsu režīmu"
          aria-label={themeLabel}
          onClick={onThemeChange}>{themeIcon}</button>
      </div>
    </div>
    {page === "answers" && <>
      <div className="search-box-container"><div className="search-input-wrapper">
        <span className="search-icon" aria-hidden="true">⌕</span>
        <input type="search" id="search-input" className="search-input"
          placeholder="Meklēt jautājumu vai atbildi…" autoComplete="off"
          aria-label="Meklēt jautājumus un atbildes" value={query}
          onChange={(event) => onQueryChange(event.target.value)} />
        {query && <button type="button" id="clear-search-btn" className="clear-search-btn"
          style={{ display: "block" }} title="Notīrīt meklēšanu" aria-label="Notīrīt meklēšanu"
          onClick={() => onQueryChange("")}>✕</button>}
      </div></div>
      <div className="filters-bar"><div className="filter-tags">
        {filters.map(([value, label]) => <button key={value} type="button"
          className={`filter-btn ${filter === value ? "active" : ""}`}
          data-filter={value} aria-pressed={filter === value}
          onClick={() => onFilterChange(value)}>{label}</button>)}
      </div><div id="stats-counter" className="stats-counter">{countText}</div></div>
    </>}
  </header>;
}
