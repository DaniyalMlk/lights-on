import { useEffect, useMemo, useRef, useState } from "react";
import AnimatedNumber from "./AnimatedNumber.jsx";
import CityMap from "./CityMap.jsx";
import BuildingPanel from "./BuildingPanel.jsx";
import AgentPanel from "./AgentPanel.jsx";
import ProofPanel from "./ProofPanel.jsx";
import ComparePanel from "./ComparePanel.jsx";
import BuildingList from "./BuildingList.jsx";

import { incentiveMax, incentiveStep, perFoot, requiredIncentive, sliderThreshold, supportStatus, thresholdNote } from "./incentive.js";

// Does the residual cover the price at this incentive? gap is $/SF still missing (for sorting); null = no price
function evaluate(p, incentive) {
  const required = requiredIncentive(p);
  if (required === null)
    return { label: "No price to compare with", short: "No price to compare", covers: false, gap: null };
  const credit = incentive * p.gfa_sf;
  if (incentive >= required && p.residual_worst + credit >= p.assessed_value)
    return { label: "Pencils at today's basis", short: "Pencils at today's basis", covers: true, gap: -Infinity };
  const gap = required - incentive;
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
  const [pair, setPair] = useState([null, null]);
  const [slot, setSlot] = useState(0);
  const comparing = view === "building" && tab === "Compare";
  const complete = pair.every(Boolean);

  function openTab(next) {
    if (next === "Compare" && !comparing) {
      const first = selected?.map_only ? null : selectedId;
      setView("building");
      setPair([first, null]);
      setSlot(first ? 1 : 0);
      setMode("move");
    } else if (next !== "Compare") {
      if (!selectedId) {
        const id = pair.find(Boolean);
        if (!id) { selectBuilding(null); return; }
        selectBuilding(id);
      }
      setMode("turn");
    }
    setTab(next);
  }

  function choose(id, index) {
    if (!towers.some(f => f.properties.id === id)) return;
    const existing = pair.indexOf(id);
    if (complete && existing >= 0 && existing !== slot) return;
    const target = index ?? (existing >= 0 ? existing : slot);
    if (target == null || (existing >= 0 && existing !== target)) return;
    const next = [...pair];
    next[target] = existing === target ? null : id;
    setPair(next);
    const empty = next.indexOf(null);
    setSlot(empty < 0 ? null : empty);
  }
  const [incentive, setIncentive] = useState(0);
  const [vacancyGate, setVacancyGate] = useState(35);
  const [touched, setTouched] = useState(false);          // the slider thumb pulses until first use
  const [explored, setExplored] = useState(false);        // the drag hint fades after the first drag
  const [mode, setMode] = useState("move");               // what a drag on the map does: move it or turn it
  const [plate, setPlate] = useState(null);               // the selected tower's floor plate, for the 3D model
  const [marks, setMarks] = useState([]);                 // where its floor labels sit on that plate
  const [focus, setFocus] = useState(null);               // the label picked last: {index, n}
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
    setMode(known ? "turn" : "move");
    setView(wanted === "Proof" || wanted === "Validation" ? "validation" : known ? "building" : "list");
    setTab(wanted === "Agent" ? "Agent" : "Overview");
    setIncentive(0);
    setVacancyGate(35);
    setTouched(false);
  }
  // Reset puts the two sliders back; it leaves the building you are looking at alone
  function resetScenario() {
    setIncentive(0);
    setVacancyGate(35);
    setTouched(false);
  }
  // One tower is something you turn around; the whole city is something you move across
  function selectBuilding(id) {
    setSelectedId(id);
    if (id !== selectedId) { setPlate(null); setMarks([]); setFocus(null); setExplored(false); }
    setMode(id ? "turn" : "move");
    setView(id ? "building" : "list");
    setTab("Overview");
  }
  // A floor label picked in the panel or on the tower: n changes every time, so the same one can be picked twice
  function pickLabel(index) {
    setTab("Overview");
    setFocus(current => ({ index, n: (current?.n ?? 0) + 1 }));
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
    const observer = new ResizeObserver(measure);
    observer.observe(side.current);
    observer.observe(card.current);
    measure();
    window.addEventListener("resize", measure);
    return () => { observer.disconnect(); window.removeEventListener("resize", measure); };
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
  const tracked = comparing
    ? pair.map(id => towers.find(f => f.properties.id === id)?.properties)
    : view === "building" && tab === "Overview" ? [selected] : [];
  const passed = proof ? proof.cases.filter(c => c.status === "pass").length : 0;
  const scored = proof ? proof.cases.filter(c => c.status === "pass" || c.status === "miss").length : 0;

  return (
    <main className="stage" data-comparing={comparing} data-compare-wide={comparing && complete}>
      <section className="map-wrap" aria-label="Map of downtown Houston">
        {mapData && <CityMap data={mapData} pair={comparing ? pair : null} selectedId={comparing ? null : selectedId} hoveredId={hoveredId} rightInset={inset.right} bottomInset={inset.bottom}
                             mode={mode} plate={plate} marks={marks} focus={focus}
                             onSelect={comparing ? choose : selectBuilding} onHover={setHoveredId} onGrab={() => setExplored(true)}
                             onMode={(next) => { setMode(next); setExplored(false); }} onMark={pickLabel} />}

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
              <li className="lit">Homes that pay for themselves</li>
              <li className="dark">Not yet</li>
              <li className="off">Filtered out</li>
            </ul>
            <p className="hint" data-seen={explored}>{mode === "move"
              ? "Drag to move · Shift + drag to turn"
              : "Drag to turn · Shift + drag to move"}</p>
          </div>
          <div className="scenario">
            <div className="control">
              <div className="scenario-row">
                <label htmlFor="incentive">Hypothetical incentive</label>
                <output htmlFor="incentive">${incentive}<small>/SF</small></output>
              </div>
              <input id="incentive" type="range" min="0" max={incentiveMax} step={incentiveStep} value={incentive}
                     className={touched ? "" : "beckon"} style={{ "--p": `${100 * incentive / incentiveMax}%` }}
                     onChange={(e) => { setTouched(true); setIncentive(Number(e.target.value)); }} />
              {tracked.some(Boolean) && <>
                <div className="incentive-marks">{tracked.map((building, i) => {
                  const required = requiredIncentive(building);
                  const tick = sliderThreshold(required);
                  if (tick === null || tick > incentiveMax) return null;
                  const label = comparing ? ["A", "B"][i] : "▴";
                  return <span key={i} style={{ left: `${100 * tick / incentiveMax}%`, top: i * 13 }}
                    title={`${building.name} · Required ${perFoot(required)} · Reached at ${perFoot(tick)}`}>{label}</span>;
                })}</div>
                {tracked.map((building, i) => {
                  if (!building) return null;
                  const required = requiredIncentive(building);
                  return <div className="support-summary" key={i}>
                    <b>{comparing ? ["A · ", "B · "][i] : ""}Required incentive</b> {required === null ? "Unavailable" : perFoot(required)}
                    {thresholdNote(required) && <small>{thresholdNote(required)}</small>}
                    {!comparing && <small>Additional support needed · {required === null ? "Unavailable" : perFoot(Math.max(0, required - incentive))}</small>}
                    {required !== null && <small data-met={incentive >= required}>{supportStatus(required, incentive)}</small>}
                    {building.gated_out && <small>Filtered out by vacancy</small>}
                  </div>;
                })}
                <p className="fine">Support needed to reach the map’s reference value in the base case. Marks show the first eligible slider step.</p>
              </>}
            </div>
            <div className={`result ${litTowers.length ? "lit" : ""}`} aria-live="polite">
              <b>{mapData ? <AnimatedNumber value={litHomes} /> : "–"}</b>
              <span>of {allHomes.toLocaleString()} homes
                <small>{litTowers.length ? `${litTowers.length} of ${towers.length} buildings lit` : "Drag the slider"}</small></span>
            </div>
            <div className="control minor">
              <div className="scenario-row">
                <label htmlFor="vacancy">At least <b>{vacancyGate}%</b> vacant</label>
                <button className="text-button" onClick={resetScenario}>Reset</button>
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
                                          onSelect={selectBuilding} onHover={setHoveredId} onCompare={() => openTab("Compare")} error={loadError} />}
        {view !== "list" && <>
          <div className="side-head">
            <button className="back" onClick={closeSheet}><span aria-hidden="true">←</span>
              {view === "validation" && backTo.current === "building" && selected ? selected.name : "All buildings"}</button>
            {view === "building" && <nav className="tabs" aria-label="Building views">
              {["Overview", "Agent", "Compare"].map((t) => (
                <button key={t} aria-pressed={t === tab} onClick={() => openTab(t)}>{t === "Agent" ? "Agent run" : t}</button>
              ))}
            </nav>}
          </div>
          <div className="sheet" key={view + selectedId + tab}>
            {view === "validation" && <ProofPanel proof={proof} />}
            {comparing && <ComparePanel towers={towers} pair={pair} slot={slot} onSlot={setSlot} onChoose={choose} incentive={incentive} />}
            {view === "building" && !comparing && (selected?.map_only
              ? <div className="panel"><h2>{selected.name}</h2><p>Indicative location. Analysis requires a footprint.</p></div>
              : tab === "Agent"
                ? <AgentPanel key={selectedId} buildingId={selectedId} names={names}
                              onOpen={(id) => { selectBuilding(id); setTab("Agent"); }} />
                : <BuildingPanel key={selectedId} buildingId={selectedId} selected={selected} incentive={incentive}
                                 focus={focus} onFocus={pickLabel} onPlate={setPlate} onMarks={setMarks} />)}
          </div>
        </>}
      </aside>
    </main>
  );
}
