import React from "react";

export default function Header({ mode, theme, onModeChange, onThemeChange, collectorAvailable, onCollectorOpen, query, onQueryChange, filter, onFilterChange, countText }) {
  const filters = [
    ["all", "Visi jautājumi"], ["images", "Ar attēliem"], ["videos", "Video"], ["bookmarks", "★ Izlase"],
  ];
  return (
    <header className="app-header">
      <div className="header-top">
        <div className="logo-area"><span className="badge-csdd">CSDD B</span><h1 className="app-title">CSDD teorija</h1></div>
        <div className={`header-controls ${collectorAvailable ? "collector-available" : ""}`}>
          <button id="mode-toggle-btn" className="btn mode-toggle-btn" title="Pārslēgt režīmu" aria-label={`Režīms: ${mode === "solver" ? "Atbilžu lapa. Pārslēgt uz treniņrežīmu" : "Treniņrežīms. Pārslēgt uz atbilžu lapu"}`} onClick={onModeChange}>
            <span aria-hidden="true">{mode === "solver" ? "🎯" : "✍️"}</span> <strong>{mode === "solver" ? "Atbilžu lapa" : "Treniņrežīms"}</strong>
          </button>
          <button id="theme-toggle-btn" className="btn icon-btn" title="Mainīt krāsu režīmu" aria-label={theme === "dark" ? "Ieslēgt gaišo režīmu" : "Ieslēgt tumšo režīmu"} onClick={onThemeChange}>{theme === "dark" ? "☀️" : "🌙"}</button>
          {collectorAvailable && <button id="collector-open-btn" className="btn btn-primary collector-open-btn" title="Papildināt jautājumu datubāzi" aria-label="Papildināt jautājumu datubāzi" onClick={onCollectorOpen}><span aria-hidden="true">↻</span> <strong>Papildināt jautājumus</strong></button>}
        </div>
      </div>
      <SearchBar value={query} onChange={onQueryChange} />
      <div className="filters-bar">
        <div className="filter-tags">
          {filters.map(([value, label]) => <button key={value} type="button" className={`filter-btn ${filter === value ? "active" : ""}`} data-filter={value} aria-pressed={filter === value} onClick={() => onFilterChange(value)}>{label}</button>)}
        </div>
        <div id="stats-counter" className="stats-counter">{countText}</div>
      </div>
    </header>
  );
}

function SearchBar({ value, onChange }) {
  return (
    <div className="search-box-container">
      <div className="search-input-wrapper">
        <span className="search-icon" aria-hidden="true">🔍</span>
        <input type="text" id="search-input" className="search-input" placeholder="Meklēt jautājumu vai atbildi…" autoComplete="off" aria-label="Meklēt jautājumus un atbildes" value={value} onChange={(event) => onChange(event.target.value)} />
        {value && <button type="button" id="clear-search-btn" className="clear-search-btn" style={{ display: "block" }} title="Notīrīt meklēšanu" aria-label="Notīrīt meklēšanu" onClick={() => onChange("")}>✕</button>}
      </div>
    </div>
  );
}
