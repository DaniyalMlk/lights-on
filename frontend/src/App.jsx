import { useEffect, useMemo, useState } from "react";
import AnimatedNumber from "./AnimatedNumber.jsx";
import CityMap from "./CityMap.jsx";
import BuildingPanel from "./BuildingPanel.jsx";
import AgentPanel from "./AgentPanel.jsx";
import ProofPanel from "./ProofPanel.jsx";

import BuildingList from "./BuildingList.jsx";

function evaluate(p, incentive) {
  if (p.residual_base == null || p.residual_worst == null || !p.assessed_value || !p.gfa_sf)
    return { label: "Basis unavailable", covers: false };
  const credit = incentive * p.gfa_sf;
  if (p.residual_worst + credit >= p.assessed_value)
    return { label: "Pencils at today's basis", covers: true };
  const gap = (p.assessed_value - p.residual_base - credit) / p.gfa_sf;
  if (gap <= 0) return { label: "Pencils at a distressed basis", covers: true };
  return { label: `Needs $${Math.ceil(gap)}/SF of basis or incentives`, covers: false };
}

const TABS = ["Building", "Agent", "Proof"];

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

  const litHomes = mapData
    ? mapData.features.filter((f) => f.properties.lit).reduce((sum, f) => sum + f.properties.homes, 0)
    : 0;

  const selected = mapData?.features.find((f) => f.properties.id === selectedId)?.properties;

  return (
    <div className="app">
      <header className="topbar">
        <h1><i aria-hidden="true" className="window-mark" /> Lights <em>On</em></h1>
        <p>Office-to-housing screening</p>
      <div className="headline-total"><b>{mapData ? <AnimatedNumber value={litHomes} /> : "—"}</b><span>Homes passing<br/>the financial screen</span></div><small>Houston, TX</small></header>

      <div className="layout">
        <div className="map-wrap">
          {mapData && <CityMap key={resetKey} data={mapData} selectedId={selectedId} onSelect={selectBuilding} />}
          <div className="map-title"><small>Conversion atlas</small><h2>Houston after dark</h2></div>
          <div className="controls"><h3>Scenario</h3>
            <button className="reset" onClick={() => restoreView(buildings)}>Reset</button>
            <div className="map-key"><span>Covers basis</span><span title="Below basis or unavailable">Below basis / N/A</span><span>Filtered / indicative</span></div>
            <label>
              <span>Incentive <b>${incentive}/SF</b></span>
              <input type="range" min="0" max="250" step="5" value={incentive}
                     onChange={(e) => setIncentive(Number(e.target.value))} />
            </label>
            <label>
              <span>Min. vacancy <b>{vacancyGate}%</b></span>
              <input type="range" min="0" max="90" step="5" value={vacancyGate}
                     onChange={(e) => setVacancyGate(Number(e.target.value))} />
            </label>

          </div>
        </div>

        <aside className="side" key={resetKey}>
          {!selectedId && tab !== "Proof" ? <BuildingList features={mapData?.features} selectedId={selectedId} onSelect={selectBuilding} error={loadError} /> : <>
          <div className="side-head"><button className="reset" onClick={() => selectBuilding(null)}>← All candidates</button></div>
          <nav className="tabs">
            {TABS.map((t) => (
              <button key={t} aria-pressed={t === tab} className={t === tab ? "active" : ""} onClick={() => setTab(t)}>{t === "Proof" ? "Validation" : t}</button>
            ))}
          </nav>
          <div className="sheet" key={selectedId + tab}>
          {selected?.map_only && tab !== "Proof" ? (
            <div className="panel"><h2>{selected.name}</h2><p>Indicative location. Analysis requires a footprint.</p></div>
          ) : (
            <>
              {tab === "Building" && <BuildingPanel key={selectedId} buildingId={selectedId} selected={selected} incentive={incentive} />}
              {tab === "Agent" && <AgentPanel key={selectedId} buildingId={selectedId} />}
            </>
          )}
          {tab === "Proof" && <ProofPanel />}
          </div></>}
        </aside>
      </div>
    </div>
  );
}
