import { useEffect, useMemo, useState } from "react";
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
  const [buildings, setBuildings] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [incentive, setIncentive] = useState(0);
  const [vacancyGate, setVacancyGate] = useState(35);
  const [tab, setTab] = useState("Building");

  const [loadError, setLoadError] = useState(false);
  function selectBuilding(id) { setSelectedId(id); setTab("Building"); }
  useEffect(() => {
    fetch("/api/buildings").then((r) => {
      if (!r.ok) throw new Error();
      return r.json();
    }).then(setBuildings).catch(() => setLoadError(true));
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
        <h1>Lights On</h1>
        <p>Which empty Houston office towers deserve a conversion study?</p>
      </header>

      <div className="layout">
        <div className="map-wrap">
          {mapData && <CityMap data={mapData} selectedId={selectedId} onSelect={selectBuilding} />}
          <div className="controls">
            <div className="map-key"><span>Gold: covers basis</span> · Navy: below basis or unavailable · Gray: filtered or indicative location</div>
            <label>
              Incentive: ${incentive}/SF
              <input type="range" min="0" max="250" step="5" value={incentive}
                     onChange={(e) => setIncentive(Number(e.target.value))} />
            </label>
            <label>
              Vacancy at least {vacancyGate}%
              <input type="range" min="0" max="90" step="5" value={vacancyGate}
                     onChange={(e) => setVacancyGate(Number(e.target.value))} />
            </label>
            <span>{litHomes.toLocaleString()} homes in towers that pencil (screening estimate)</span>
          </div>
        </div>

        <aside className="side">
          <BuildingList features={mapData?.features} selectedId={selectedId} onSelect={selectBuilding} error={loadError} />
          <nav className="tabs">
            {TABS.map((t) => (
              <button key={t} className={t === tab ? "active" : ""} onClick={() => setTab(t)}>{t}</button>
            ))}
          </nav>
          {selected?.map_only && tab !== "Proof" ? (
            <div className="panel"><h2>{selected.name}</h2><p>Indicative location. Analysis requires a footprint.</p></div>
          ) : (
            <>
              {tab === "Building" && <BuildingPanel key={selectedId} buildingId={selectedId} selected={selected} incentive={incentive} />}
              {tab === "Agent" && <AgentPanel key={selectedId} buildingId={selectedId} />}
            </>
          )}
          {tab === "Proof" && <ProofPanel />}
        </aside>
      </div>
    </div>
  );
}
