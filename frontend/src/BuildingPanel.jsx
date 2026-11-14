import { useEffect, useRef, useState } from "react";

import AnimatedNumber from "./AnimatedNumber.jsx";
import ScanPanel from "./ScanPanel.jsx";
import StudyDetails from "./StudyDetails.jsx";
import { money, perSf, tonnes } from "./format.js";
import { readPlate } from "./plan3d.js";

const LABELS = { rent_mult: "Rent ±10%", free_weeks: "Free weeks", cap: "Cap rate ±0.5 pt", opex: "Opex ±5 pt", cost_mult: "Conversion cost" };
const LEGEND = [["apartments", "Apartments"], ["corridor", "Corridor"], ["dark", "Dark zone"], ["core", "Core"], ["storage", "Storage"]];

// Worst, base and high residual on one line, with zero marked: left of it the project loses money
function ResidualRange({ worst, base, high }) {
  const lo = Math.min(worst, 0), hi = Math.max(high, 0);
  const at = (x) => `${((x - lo) / (hi - lo || 1)) * 100}%`;
  return <div className="range" aria-label={`Residual from ${money(worst)} to ${money(high)}, base ${money(base)}`}>
    <div className="range-track">
      <span className="range-span" style={{ left: at(worst), width: `calc(${at(high)} - ${at(worst)})` }} />
      <span className="range-zero" style={{ left: at(0) }}><i>$0</i></span>
      <span className="range-base" style={{ left: at(base) }} />
    </div>
    <dl className="range-values">
      <div><dt>Worst</dt><dd>{money(worst)}</dd></div>
      <div className="base"><dt>Base</dt><dd>{money(base)}</dd></div>
      <div><dt>High</dt><dd>{money(high)}</dd></div>
    </dl>
  </div>;
}

// Apartment fills in the plate drawing (backend/tools/layout.py): 2BR, 1BR, studio
const UNIT_FILLS = 'path[fill="#FFC857"], path[fill="#FFD98A"], path[fill="#FFE8B5"]';

// The floor plate, drawn into the page so its apartments can switch on one after another around the floor.
// The same drawing is handed to the map (onPlate), which builds it in 3D on top of the tower.
function Plate({ buildingId, depth, onPlate }) {
  const box = useRef(null);
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/buildings/${encodeURIComponent(buildingId)}/plate.svg?depth=${depth}`, { signal: controller.signal })
      .then(r => { if (!r.ok) throw new Error(); return r.text(); })
      .then(text => {
        const svg = new DOMParser().parseFromString(text, "image/svg+xml").documentElement;
        if (svg.nodeName !== "svg") throw new Error();
        svg.setAttribute("aria-label", `Indicative floor plate at ${depth} ft unit depth`);
        svg.querySelectorAll(UNIT_FILLS).forEach((unit, i) => {
          unit.classList.add("unit");
          unit.style.setProperty("--i", i);
        });
        box.current?.replaceChildren(document.importNode(svg, true));
        onPlate({ id: buildingId, key: `${buildingId}:${depth}`, ...readPlate(svg) });
      })
      .catch(() => { if (!controller.signal.aborted && box.current) box.current.textContent = "Floor plate unavailable."; });
    return () => controller.abort();
  }, [buildingId, depth]);
  return <div ref={box} className="plate" />;
}

export default function BuildingPanel({ buildingId, selected, incentive, focus, onFocus, onPlate, onMarks }) {
  const [data, setData] = useState(null);
  const [depth, setDepth] = useState(36);
  const [error, setError] = useState(false);
  useEffect(() => {
    if (!buildingId) return;
    setData(null);
    const controller = new AbortController();
    fetch(`/api/buildings/${encodeURIComponent(buildingId)}`, {signal: controller.signal}).then(r => {
      if (!r.ok) throw new Error();
      return r.json();
    }).then(setData).catch(() => { if (!controller.signal.aborted) setError(true); });
    return () => controller.abort();
  }, [buildingId]);

  if (!buildingId) return <div className="panel empty">Pick a tower on the map or in the list.</div>;
  if (error) return <div className="panel empty">Building analysis unavailable. Is the API running?</div>;
  if (!data) return <div className="panel"><div className="skeleton-block" /><div className="skeleton-block tall" /></div>;

  const { building, geometry, econ, carbon } = data;
  const depths = geometry.by_depth;
  const counts = Object.values(depths).map(row => row.homes);
  const lo = Math.min(...counts), hi = Math.max(...counts);
  const daylight = depths["36"].daylight_share;
  const credit = incentive * (selected?.gfa_sf ?? 0);
  const swing = Math.max(1, ...(econ?.tornado ?? []).flatMap(t => [Math.abs(t.low_per_gsf), Math.abs(t.high_per_gsf)]));
  const layers = [
    ["CoStar", building.synthetic ? "sample data" : "record", !building.synthetic],
    ["Vexcel", building.footprint_origin === "vexcel" ? "outline" : "not used", building.footprint_origin === "vexcel"],
    ["Matterport", geometry.plate_source === "matterport_scan" ? "floor scan" : "no scan", geometry.plate_source === "matterport_scan"],
  ];
  const verdict = selected?.gated_out ? "Filtered out by vacancy" : selected?.short ?? "–";

  return (
    <article className="panel building">
      <header>
        <p className="eyebrow">{[building.address, `${building.stories} stories`].filter(Boolean).join(" · ")}</p>
        <h2>{building.name}</h2>
        {building.synthetic && <p className="tag">Sample data, not a real building</p>}
        <p className="layers">{layers.map(([name, state, used]) =>
          <span key={name} data-used={used}>{name} <i>{state}</i></span>)}</p>
      </header>

      <dl className="stats" aria-label="Key facts">
        <div><dt>Potential homes</dt><dd className="accent">{lo === hi ? lo.toLocaleString() : `${lo.toLocaleString()}–${hi.toLocaleString()}`}</dd>
          <small>30–42 ft layouts</small></div>
        <div><dt>Near a window</dt><dd>{Math.round(daylight * 100)}%</dd><small>of the floor outside the core, within 36 ft</small></div>
        <div className={selected?.lit ? "lit" : ""}><dt>Pays for itself?</dt><dd className="words">{verdict}</dd>
          <small>at ${incentive}/SF hypothetical incentive</small></div>
      </dl>

      <section className="plate-card">
        <header>
          <h3>Floor plate <span className="muted">· indicative layout</span></h3>
          <div className="segmented" role="group" aria-label="Unit depth">{[30, 36, 42].map(d =>
            <button key={d} aria-pressed={d === depth} onClick={() => setDepth(d)}>{d} ft</button>)}</div>
        </header>
        <div className="plate-frame">
          <Plate buildingId={buildingId} depth={depth} onPlate={onPlate} />
          <ul className="plate-legend">{LEGEND.map(([key, name]) => <li key={key} className={key}>{name}</li>)}</ul>
        </div>
        <p className="plate-count"><b><AnimatedNumber value={depths[depth].homes_per_floor} /></b> homes a floor ·{" "}
          <b><AnimatedNumber value={depths[depth].homes} /></b> in the building</p>
        <p className="fine">Bedrooms need windows. Deeper than {depth} ft stays dark. The same floor stands on the tower in the map.</p>
      </section>

      <ScanPanel building={building} focus={focus} onFocus={onFocus} onMarks={onMarks} />

      {econ ? (
        <section className={`block pays ${selected?.lit ? "lit" : ""}`}>
          <h3>Does it pay?</h3>
          <p className="verdict">{selected?.label}{selected?.gated_out && " · filtered out by vacancy"}</p>
          <ResidualRange worst={econ.cases.downside.residual + credit} base={econ.cases.base.residual + credit}
                         high={econ.cases.upside.residual + credit} />
          <p className="fine">Indicative residual at the 36 ft layout, not an offer price.</p>
          <details className="explain">
            <summary>How this is worked out</summary>
            <p>Value as housing minus conversion cost and developer margin{incentive ? `, plus a hypothetical $${incentive}/SF incentive` : ""},
              compared with the {econ.inputs.reference_label || "assessed value"} ({building.synthetic ? "a sample figure" : "a CoStar figure, so not shown here"}).
              Not included: {econ.excluded.join(", ")}. Incentives: a building may be eligible; verify with the program.</p>
          </details>

          <h4>What moves it most</h4>
          {econ.tornado.map((t) => (
            <div key={t.input} className="tornado">
              <span>{LABELS[t.input] ?? t.input}</span>
              <span className="bar loss" style={{"--width": Math.abs(t.low_per_gsf) / swing * 100 + "%"}}>{perSf(t.low_per_gsf)}</span>
              <span className="bar gain" style={{"--width": Math.abs(t.high_per_gsf) / swing * 100 + "%"}}>{perSf(t.high_per_gsf)}</span>
            </div>
          ))}
        </section>
      ) : (
        <section className="block"><h3>Does it pay?</h3><p className="muted">No rent data for this building yet.</p></section>
      )}

      <section className="block">
        <h3>Carbon <span className="muted">· illustrative</span></h3>
        <p>Reusing the structure would avoid roughly <b>{tonnes(carbon.avoided_t_low)} to {tonnes(carbon.avoided_t_high)}</b> CO₂e
          of upfront embodied carbon compared with building new.</p>
        <p className="fine">Literature range (50–75% of new-build embodied carbon), not a measured saving for this building.</p>
        <details className="explain"><summary>Compare the scenarios</summary>
        <table className="compact">
          <thead><tr><th>Scenario</th><th>Homes</th><th>Upfront CO₂e</th></tr></thead>
          <tbody>
            <tr><td>Leave empty</td><td>{carbon.leave_empty.homes}</td><td>{tonnes(carbon.leave_empty.new_embodied_t)}</td></tr>
            {[["Convert", carbon.convert], ["Demolish & rebuild", carbon.demolish_rebuild]].map(([name, scenario]) =>
              <tr key={name}><td>{name}</td><td>{lo.toLocaleString()}–{hi.toLocaleString()}</td>
                <td>{tonnes(scenario.new_embodied_t_low)}–{tonnes(scenario.new_embodied_t_high)}</td></tr>)}
          </tbody>
        </table>
        </details>
      </section>

      <StudyDetails data={data} depth={depth} />
    </article>
  );
}
