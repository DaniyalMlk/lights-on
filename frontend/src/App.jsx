import { useEffect, useMemo, useRef, useState } from "react";
import AnimatedNumber from "./AnimatedNumber.jsx";
import CityMap from "./CityMap.jsx";
import BuildingPanel from "./BuildingPanel.jsx";
import AgentPanel from "./AgentPanel.jsx";
import ProofPanel from "./ProofPanel.jsx";
import BuildingList from "./BuildingList.jsx";

// Does the residual cover the price at this incentive? gap is $/SF still missing (for sorting); null = no price
function evaluate(p, incentive) {
  if (p.residual_base == null || p.residual_worst == null || !p.assessed_value || !p.gfa_sf)
    return { label: "No price to compare with", short: "No price to compare", covers: false, gap: null };
  const credit = incentive * p.gfa_sf;
  if (p.residual_worst + credit >= p.assessed_value)
    return { label: "Pencils at today's basis", short: "Pencils at today's basis", covers: true, gap: -Infinity };
  const gap = (p.assessed_value - p.residual_base - credit) / p.gfa_sf;
  if (gap <= 0) return { label: "Pencils at a distressed basis", short: "Pencils at a distressed basis", covers: true, gap };
  return { label: `Needs $${Math.ceil(gap)}/SF of basis or incentives`, short: `Needs $${Math.ceil(gap)}/SF more`, covers: false, gap };
}

// A tower with a few windows lit: the brand mark (the favicon is the same drawing)
function WindowMark() {
  const lit = new Set([1, 3, 4, 8, 10]);
  return <svg className="window-mark" viewBox="0 0 16 20" aria-hidden="true">
    <rect x="0.5" y="0.5" width="15" height="19" rx="2" />
    {Array.from({ length: 12 }, (_, i) =>
      <rect key={i} x={3 + (i % 3) * 3.6} y={3 + Math.floor(i / 3) * 3.8} width="2.2" height="2.4" rx="0.4"
            className={lit.has(i) ? "on" : ""} />)}
  </svg>;
}

export default function App() {
  const [buildings, setBuildings] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [hoveredId, setHoveredId] = useState(null);
  const [view, setView] = useState("list");               // list | building | validation
  const [tab, setTab] = useState("Overview");             // inside a building: Overview | Agent
  const [incentive, setIncentive] = useState(0);
  const [vacancyGate, setVacancyGate] = useState(35);
  const [touched, setTouched] = useState(false);          // the slider thumb pulses until first use
  const [explored, setExplored] = useState(false);        // the "drag to turn" hint fades after the first drag
  const [loadError, setLoadError] = useState(false);
  const [proof, setProof] = useState(undefined);
  const [inset, setInset] = useState({ right: 0, bottom: 0 });   // how much of the map the floating panels cover
  const backTo = useRef("list");
  const side = useRef(null);
  const card = useRef(null);

  function restoreView(collection) {
    const query = new URLSearchParams(window.location.search);
    const id = query.get("demo");
    const known = collection?.features.some(f => f.properties.id === id);
    const wanted = query.get("tab");
    setSelectedId(known ? id : null);
    setView(wanted === "Proof" || wanted === "Validation" ? "validation" : known ? "building" : "list");
    setTab(wanted === "Agent" ? "Agent" : "Overview");
    setIncentive(0);
    setVacancyGate(35);
    setTouched(false);
  }
  function selectBuilding(id) {
    setSelectedId(id);
    setView(id ? "building" : "list");
    setTab("Overview");
  }
  function openValidation() {
    if (view !== "validation") backTo.current = selectedId ? "building" : "list";
    setView("validation");
  }
  function closeSheet() {
    if (view === "validation") setView(backTo.current === "building" && selectedId ? "building" : "list");
    else selectBuilding(null);
  }

  useEffect(() => {
    fetch("/api/buildings").then((r) => {
      if (!r.ok) throw new Error();
      return r.json();
    }).then(collection => { setBuildings(collection); restoreView(collection); }).catch(() => setLoadError(true));
    fetch("/api/proof").then(r => r.ok ? r.json() : null).then(setProof).catch(() => setProof(null));
  }, []);

  // Esc closes the open sheet, like a map app's place card
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape" && view !== "list") closeSheet(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // On a wide screen the panel floats over the map; tell the map so it centers on what stays visible
  useEffect(() => {
    const measure = () => setInset({
      right: window.innerWidth > 860 && side.current ? side.current.offsetWidth + 24 : 0,
      bottom: card.current ? card.current.offsetHeight + 40 : 0,
    });
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  // Recompute verdicts for the current slider values
  const mapData = useMemo(() => {
    if (!buildings) return null;
    const features = buildings.features.map((f) => {
      const p = f.properties;
      const gated = (p.vacancy ?? 0) * 100 < vacancyGate;
      const verdict = evaluate(p, incentive);
      return { ...f, properties: { ...p, label: verdict.label, short: verdict.short, gap: verdict.gap,
                                   gated_out: gated, lit: !gated && verdict.covers } };
    });
    return { ...buildings, features };
  }, [buildings, incentive, vacancyGate]);

  const towers = mapData?.features.filter(f => !f.properties.map_only) ?? [];
  const litTowers = towers.filter(f => f.properties.lit);
  const litHomes = litTowers.reduce((sum, f) => sum + f.properties.homes, 0);
  const allHomes = towers.reduce((sum, f) => sum + (f.properties.homes ?? 0), 0);
  const names = useMemo(() => (buildings?.features ?? []).map(f => [f.properties.id, f.properties.name]), [buildings]);
  const selected = mapData?.features.find((f) => f.properties.id === selectedId)?.properties;
  const passed = proof ? proof.cases.filter(c => c.status === "pass").length : 0;
  const scored = proof ? proof.cases.filter(c => c.status === "pass" || c.status === "miss").length : 0;

  return (
    <main className="stage">
      <section className="map-wrap" aria-label="Map of downtown Houston">
        {mapData && <CityMap data={mapData} selectedId={selectedId} hoveredId={hoveredId} rightInset={inset.right} bottomInset={inset.bottom}
                             onSelect={selectBuilding} onHover={setHoveredId} onGrab={() => setExplored(true)} />}

        <header className="island">
          <a className="brand" href="/" aria-label="Lights On, start over"><WindowMark />Lights On</a>
          <nav className="topnav" aria-label="Sections">
            <button aria-pressed={view !== "validation"} onClick={() => setView(selectedId ? "building" : "list")}>Map</button>
            <button aria-pressed={view === "validation"} onClick={openValidation}>
              Validation{proof && <span className="count">{passed} of {scored} passed</span>}
            </button>
          </nav>
        </header>

        {/* One dock under the map: the incentive, what it lights up, and the vacancy filter */}
        <div className="dock" ref={card}>
          <div className="dock-note">
            <ul className="legend">
              <li className="lit">Could become homes and pay for itself</li>
              <li className="dark">Not yet</li>
              <li className="off">Filtered out</li>
            </ul>
            <p className="hint" data-seen={explored}>Drag to turn the city · Shift + drag to move · Scroll to zoom</p>
          </div>
          <div className="scenario">
            <div className="control">
              <div className="scenario-row">
                <label htmlFor="incentive">Hypothetical incentive</label>
                <output htmlFor="incentive">${incentive}<small>/SF</small></output>
              </div>
              <input id="incentive" type="range" min="0" max="250" step="5" value={incentive}
                     className={touched ? "" : "beckon"} style={{ "--p": `${incentive / 2.5}%` }}
                     onChange={(e) => { setTouched(true); setIncentive(Number(e.target.value)); }} />
            </div>
            <div className={`result ${litTowers.length ? "lit" : ""}`} aria-live="polite">
              <b>{mapData ? <AnimatedNumber value={litHomes} /> : "–"}</b>
              <span>of {allHomes.toLocaleString()} homes
                <small>{litTowers.length ? `${litTowers.length} of ${towers.length} towers lit` : "Drag the slider"}</small></span>
            </div>
            <div className="control minor">
              <div className="scenario-row">
                <label htmlFor="vacancy">At least <b>{vacancyGate}%</b> vacant</label>
                <button className="text-button" onClick={() => restoreView(buildings)}>Reset</button>
              </div>
              <input id="vacancy" className="quiet" type="range" min="0" max="90" step="5" value={vacancyGate}
                     style={{ "--p": `${vacancyGate / 0.9}%` }} onChange={(e) => setVacancyGate(Number(e.target.value))} />
            </div>
          </div>
        </div>

        {/* The 3D tour of a scanned floor opens here, over the map (see ScanPanel) */}
        <div id="tour-root" />
      </section>

      <aside className="side" ref={side}>
        {view === "list" && <BuildingList features={mapData?.features} selectedId={selectedId} hoveredId={hoveredId}
                                          onSelect={selectBuilding} onHover={setHoveredId} error={loadError} />}
        {view !== "list" && <>
          <div className="side-head">
            <button className="back" onClick={closeSheet}><span aria-hidden="true">←</span>
              {view === "validation" && backTo.current === "building" && selected ? selected.name : "All towers"}</button>
            {view === "building" && <nav className="tabs" aria-label="Building views">
              {["Overview", "Agent"].map((t) => (
                <button key={t} aria-pressed={t === tab} onClick={() => setTab(t)}>{t === "Agent" ? "Agent run" : t}</button>
              ))}
            </nav>}
          </div>
          <div className="sheet" key={view + selectedId + tab}>
            {view === "validation" && <ProofPanel proof={proof} />}
            {view === "building" && (selected?.map_only
              ? <div className="panel"><h2>{selected.name}</h2><p>Indicative location. Analysis requires a footprint.</p></div>
              : tab === "Agent"
                ? <AgentPanel key={selectedId} buildingId={selectedId} names={names} />
                : <BuildingPanel key={selectedId} buildingId={selectedId} selected={selected} incentive={incentive} />)}
          </div>
        </>}
      </aside>
    </main>
  );
}
