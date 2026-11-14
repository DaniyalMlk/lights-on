import { useEffect, useMemo, useState } from "react";
import CityMap from "./CityMap.jsx";
import BuildingPanel from "./BuildingPanel.jsx";
import AgentPanel from "./AgentPanel.jsx";
import ProofPanel from "./ProofPanel.jsx";

// A building "lights up" when its base-case residual, plus the incentive, covers its assessed value.
function pencils(props, incentivePerSf) {
  if (props.residual_base == null || !props.assessed_value) return false;
  return props.residual_base + incentivePerSf * props.gfa_sf >= props.assessed_value;
}

const TABS = ["Building", "Agent", "Proof"];

export default function App() {
  const [buildings, setBuildings] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [incentive, setIncentive] = useState(0);
  const [vacancyGate, setVacancyGate] = useState(35);
  const [tab, setTab] = useState("Building");

  useEffect(() => {
    fetch("/api/buildings").then((r) => r.json()).then(setBuildings);
  }, []);

  // Recompute colors for the current slider values
  const mapData = useMemo(() => {
    if (!buildings) return null;
    const features = buildings.features.map((f) => {
      const p = f.properties;
      const gated = (p.vacancy ?? 0) * 100 < vacancyGate;
      return { ...f, properties: { ...p, gated_out: gated, lit: !gated && pencils(p, incentive) } };
    });
    return { ...buildings, features };
  }, [buildings, incentive, vacancyGate]);

  const litHomes = mapData
    ? mapData.features.filter((f) => f.properties.lit).reduce((sum, f) => sum + f.properties.homes, 0)
    : 0;

  return (
    <div className="app">
      <header className="topbar">
        <h1>Lights On</h1>
        <p>Which empty Houston office towers deserve a conversion study?</p>
      </header>

      <div className="layout">
        <div className="map-wrap">
          {mapData && <CityMap data={mapData} onSelect={(id) => { setSelectedId(id); setTab("Building"); }} />}
          <div className="controls">
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
          <nav className="tabs">
            {TABS.map((t) => (
              <button key={t} className={t === tab ? "active" : ""} onClick={() => setTab(t)}>{t}</button>
            ))}
          </nav>
          {tab === "Building" && <BuildingPanel buildingId={selectedId} />}
          {tab === "Agent" && <AgentPanel buildingId={selectedId} />}
          {tab === "Proof" && <ProofPanel />}
        </aside>
      </div>
    </div>
  );
}
