import { useEffect, useMemo, useState } from "react";
import AnimatedNumber from "./AnimatedNumber.jsx";
import CityMap from "./CityMap.jsx";
import BuildingPanel from "./BuildingPanel.jsx";
import AgentPanel from "./AgentPanel.jsx";
import ProofPanel from "./ProofPanel.jsx";
import BuildingList from "./BuildingList.jsx";

function evaluate(p, incentive) {
  if (p.residual_base == null || p.residual_worst == null || !p.assessed_value || !p.gfa_sf)
    return { label: "No price to compare with", covers: false };
  const credit = incentive * p.gfa_sf;
  if (p.residual_worst + credit >= p.assessed_value)
    return { label: "Pencils at today's basis", covers: true };
  const gap = (p.assessed_value - p.residual_base - credit) / p.gfa_sf;
  if (gap <= 0) return { label: "Pencils at a distressed basis", covers: true };
  return { label: `Needs $${Math.ceil(gap)}/SF of basis or incentives`, covers: false };
}

// A tower with a few windows lit: the brand mark (the favicon in index.html is the same drawing)
function WindowMark() {
  const lit = new Set([1, 3, 4, 8, 10]);
  return <svg className="window-mark" viewBox="0 0 16 20" aria-hidden="true">
    <rect x="0.5" y="0.5" width="15" height="19" rx="2" />
    {Array.from({ length: 12 }, (_, i) =>
      <rect key={i} x={3 + (i % 3) * 3.6} y={3 + Math.floor(i / 3) * 3.8} width="2.2" height="2.4" rx="0.4"
            className={lit.has(i) ? "on" : ""} />)}
  </svg>;
}

const TABS = ["Building", "Agent", "Proof"];
const TAB_NAMES = { Building: "Building", Agent: "Agent", Proof: "Validation" };

export default function App() {
  const [resetKey, setResetKey] = useState(0);
  const [buildings, setBuildings] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [incentive, setIncentive] = useState(0);
  const [vacancyGate, setVacancyGate] = useState(35);
  const [tab, setTab] = useState("Building");
  const [loadError, setLoadError] = useState(false);

  function restoreView(collection) {
    const query = new URLSearchParams(window.location.search);
    const id = query.get("demo");
    setSelectedId(collection?.features.some(f => f.properties.id === id) ? id : null);
    setTab(TABS.includes(query.get("tab")) ? query.get("tab") : "Building");
    setIncentive(0);
    setVacancyGate(35);
    setResetKey(n => n + 1);
  }
  function selectBuilding(id) { setSelectedId(id); setTab("Building"); }
  useEffect(() => {
    fetch("/api/buildings").then((r) => {
      if (!r.ok) throw new Error();
      return r.json();
    }).then(collection => { setBuildings(collection); restoreView(collection); }).catch(() => setLoadError(true));
  }, []);

  // Recompute colors for the current slider values
  const mapData = useMemo(() => {
    if (!buildings) return null;
    const features = buildings.features.map((f) => {
      const p = f.properties;
      const gated = (p.vacancy ?? 0) * 100 < vacancyGate;
      const verdict = evaluate(p, incentive);
      return { ...f, properties: { ...p, label: verdict.label, gated_out: gated, lit: !gated && verdict.covers } };
    });
    return { ...buildings, features };
  }, [buildings, incentive, vacancyGate]);

  const towers = mapData?.features.filter(f => !f.properties.map_only) ?? [];
  const litTowers = towers.filter(f => f.properties.lit);
  const litHomes = litTowers.reduce((sum, f) => sum + f.properties.homes, 0);
  const allHomes = towers.reduce((sum, f) => sum + (f.properties.homes ?? 0), 0);
  const names = useMemo(() => (buildings?.features ?? []).map(f => [f.properties.id, f.properties.name]), [buildings]);
  const selected = mapData?.features.find((f) => f.properties.id === selectedId)?.properties;
  const showList = !selectedId && tab !== "Proof";

  return (
    <div className="app">
      <header className="topbar">
        <a className="brand" href="/" aria-label="Lights On, start over"><WindowMark />Lights On</a>
        <p className="tagline">Which empty offices can become homes</p>
        <div className="headline-total" aria-live="polite">
          <b>{mapData ? <AnimatedNumber value={litHomes} /> : "–"}</b>
          <span>of {allHomes.toLocaleString()} potential homes clear the financial screen
            <small>at ${incentive}/SF incentive · downtown Houston</small></span>
        </div>
      </header>

      <main className="layout">
        <section className="map-wrap" aria-label="Map of downtown Houston">
          {mapData && <CityMap key={resetKey} data={mapData} selectedId={selectedId} onSelect={selectBuilding} />}
          <div className="map-caption">
            <p className="eyebrow">Downtown Houston · {towers.length || "–"} office towers</p>
            <p>A tower lights up when it can become homes and still pay for itself at the incentive you set.</p>
          </div>

          <div className="scenario">
            <div className="scenario-row">
              <label htmlFor="incentive">Incentive</label>
              <output htmlFor="incentive">${incentive}<small>/SF</small></output>
            </div>
            <input id="incentive" type="range" min="0" max="250" step="5" value={incentive} style={{ "--p": `${incentive / 2.5}%` }}
                   onChange={(e) => setIncentive(Number(e.target.value))} />
            <p className="hint">{litTowers.length
              ? `${litTowers.length} of ${towers.length} towers lit`
              : "Drag to add an incentive and watch for lights"}</p>
            <div className="scenario-row minor">
              <label htmlFor="vacancy">Only towers at least <b>{vacancyGate}%</b> vacant</label>
            </div>
            <input id="vacancy" className="quiet" type="range" min="0" max="90" step="5" value={vacancyGate} style={{ "--p": `${vacancyGate / 0.9}%` }}
                   onChange={(e) => setVacancyGate(Number(e.target.value))} />
            <div className="scenario-foot">
              <ul className="legend">
                <li className="lit">Clears the screen</li>
                <li className="dark">Not yet</li>
                <li className="off">Filtered out</li>
              </ul>
              <button className="text-button" onClick={() => restoreView(buildings)}>Reset</button>
            </div>
          </div>
        </section>

        <aside className="side" key={resetKey}>
          {showList ? <BuildingList features={mapData?.features} selectedId={selectedId} onSelect={selectBuilding}
                                    onValidation={() => setTab("Proof")} error={loadError} /> : <>
          <div className="side-head">
            <button className="back" onClick={() => selectBuilding(null)}><span aria-hidden="true">←</span> All towers</button>
            <nav className="tabs" aria-label="Building views">
              {TABS.map((t) => (
                <button key={t} aria-pressed={t === tab} disabled={!selectedId && t !== "Proof"}
                        onClick={() => setTab(t)}>{TAB_NAMES[t]}</button>
              ))}
            </nav>
          </div>
          <div className="sheet" key={selectedId + tab}>
          {selected?.map_only && tab !== "Proof" ? (
            <div className="panel"><h2>{selected.name}</h2><p>Indicative location. Analysis requires a footprint.</p></div>
          ) : (
            <>
              {tab === "Building" && <BuildingPanel key={selectedId} buildingId={selectedId} selected={selected} incentive={incentive} />}
              {tab === "Agent" && <AgentPanel key={selectedId} buildingId={selectedId} names={names} />}
            </>
          )}
          {tab === "Proof" && <ProofPanel />}
          </div></>}
        </aside>
      </main>
    </div>
  );
}
