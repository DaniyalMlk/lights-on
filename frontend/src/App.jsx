import { lazy, Suspense, useRef, useEffect, useMemo, useState } from "react";
import FootprintAtlas from "./FootprintAtlas.jsx";
const CityMap = lazy(() => import("./CityMap.jsx"));
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
  const inspector = useRef(null);
  const [resetKey, setResetKey] = useState(0);
  const [buildings, setBuildings] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [incentive, setIncentive] = useState(0);
  const [vacancyGate, setVacancyGate] = useState(35);
  const [tab, setTab] = useState("Building");

  const [mapMode, setMapMode] = useState("Atlas");
  const [loadError, setLoadError] = useState(false);
  function restoreView(collection) {
    const query = new URLSearchParams(window.location.search);
    const id = query.get("demo");
    setSelectedId(collection?.features.some(f => f.properties.id === id) ? id : null);
    setTab(TABS.includes(query.get("tab")) ? query.get("tab") : "Building");
    setMapMode("Atlas");
    setIncentive(0);
    setVacancyGate(35);
    setResetKey(n => n + 1);
  }
  function selectBuilding(id) {
    setSelectedId(id);
    setTab("Building");
    requestAnimationFrame(() => inspector.current?.focus());
  }
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
        <strong className="brand"><i aria-hidden="true"><b/><b/><b/></i>Lights On</strong>
        <span className="location">Houston, TX</span>
      </header>
      <main>
        <header className="masthead"><div><p className="eyebrow">Office-to-housing atlas</p>
          <h1>Houston <em>after dark.</em></h1></div>
          <div className="total"><b>{mapData ? litHomes.toLocaleString() : "—"}</b><span>potential homes passing<br/>the financial screen</span></div>
        </header>
        <div className="layout">
        <section className="map-workspace" aria-label="Conversion atlas">
          <div className="map-head"><h2>Conversion atlas</h2>
            <div className="switch">{["Atlas","Street map"].map(mode=><button key={mode} aria-pressed={mode===mapMode} onClick={()=>setMapMode(mode)}>{mode}</button>)}</div></div>
          <div className="map-wrap">
            {mapData && (mapMode==="Atlas" ? <FootprintAtlas features={mapData.features} selectedId={selectedId} onSelect={selectBuilding}/> :
              <Suspense fallback={<p className="map-message">Loading street map…</p>}><CityMap key={resetKey} data={mapData} selectedId={selectedId} onSelect={selectBuilding} onUnavailable={()=>setMapMode("Atlas")}/></Suspense>)}
            {!mapData && <p className="map-message" role="status">{loadError ? "Connect the building API to load the atlas." : "Loading building footprints…"}</p>}
            {mapMode==="Atlas" && <span className="map-caption">Axonometric · schematic ground grid</span>}
          </div>
          <div className="map-key"><span>Covers basis</span><span>Below basis / unavailable</span><span>Filtered / indicative</span></div>
          <section className="controls"><div className="control-heading"><h2>Scenario settings</h2>
            <button className="reset" onClick={() => restoreView(buildings)}>Reset view</button></div>
            <div className="sliders"><label>Incentive <b>${incentive}/SF</b>
              <input type="range" min="0" max="250" step="5" value={incentive} onChange={e=>setIncentive(Number(e.target.value))}/>
            </label>
            <label>Minimum vacancy <b>{vacancyGate}%</b>
              <input type="range" min="0" max="90" step="5" value={vacancyGate} onChange={e=>setVacancyGate(Number(e.target.value))}/>
            </label></div>
          </section>
        </section>

        <aside className="side" ref={inspector} tabIndex={-1} aria-label="Building inspector" key={resetKey}>
          {selected ? <div className="back-row"><button onClick={()=>{setSelectedId(null);setTab("Building");}}>← All candidates</button></div> :
            <BuildingList features={mapData?.features} onSelect={selectBuilding} error={loadError} />}
          <nav className="tabs" aria-label="Study sections">
            {TABS.filter(t=>selected || t==="Proof").map(t=><button key={t} aria-pressed={t===tab} onClick={()=>setTab(t===tab && !selected ? "Building" : t)}>{t==="Proof" ? "Validation" : t}</button>)}
          </nav>
          {selected?.map_only && tab !== "Proof" ? (
            <div className="panel"><h2>{selected.name}</h2><p>Indicative location. Analysis requires a footprint.</p></div>
          ) : (
            <>
              {selected && tab === "Building" && <BuildingPanel key={selectedId} buildingId={selectedId} selected={selected} incentive={incentive} />}
              {tab === "Agent" && <AgentPanel key={selectedId} buildingId={selectedId} />}
            </>
          )}
          {tab === "Proof" && <ProofPanel />}
        </aside>
      </div>
      </main>
    </div>
  );
}
