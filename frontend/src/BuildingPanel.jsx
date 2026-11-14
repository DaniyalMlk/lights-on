import { useEffect, useState } from "react";

const money = (x) => (x == null ? "n/a" : `${x < 0 ? "−" : ""}$${Math.abs(x / 1e6).toFixed(1)}M`);
const tonnes = (x) => `${Math.round(x).toLocaleString()} t`;
const perSf = (x) => `${x >= 0 ? "+" : "−"}$${Math.abs(x).toFixed(0)}/SF`;
const LABELS = { rent_mult: "Rent ±10%", free_weeks: "Free weeks", cap: "Cap rate ±0.5 pt", opex: "Opex ±5 pt", cost_mult: "Conversion cost" };

export default function BuildingPanel({ buildingId, selected, incentive }) {
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

  if (!buildingId) return <div className="panel empty">Click a tower to see how many homes fit.</div>;
  if (error) return <div className="panel">Building analysis unavailable.</div>;
  if (!data) return <div className="panel">Loading…</div>;

  const { building, geometry, econ, carbon } = data;
  const depths = geometry.by_depth;

  const counts = Object.values(depths).map(row => row.homes);
  const swing = Math.max(1, ...(econ?.tornado ?? []).flatMap(t => [Math.abs(t.low_per_gsf), Math.abs(t.high_per_gsf)]));
  return (
    <div className="panel">
      <h2>{building.name}</h2>
      <p className="muted">{building.stories} stories{building.synthetic ? " · sample data, not a real building" : ""}</p>

      <h3>Indicative layout</h3>
      <div className="depths" aria-label="Unit depth">{[30,36,42].map(d =>
        <button key={d} aria-pressed={d === depth} onClick={() => setDepth(d)}>{d} ft</button>)}</div>
      <p>Bedrooms need windows. Anything deeper than the band stays dark.</p>
      <img className="plate" src={`/api/buildings/${encodeURIComponent(buildingId)}/plate.svg?depth=${depth}`} alt={`Indicative floor plate at ${depth} ft`} />
      <p className="muted small">Gold · apartments / gray · corridor / black · dark zone / charcoal · core / slate · storage</p>
      <p className="muted small">Geometry: {building.footprint_source || "building footprint"}. Assumption: centered core occupies 18% of the floor plate.</p>
      <h3>Homes (estimate)</h3>
      <table>
        <thead><tr><th>Unit depth</th><th>Per floor</th><th>Total</th></tr></thead>
        <tbody>
          {Object.entries(depths).map(([d, v]) => (
            <tr key={d} className={Number(d) === depth ? "chosen" : ""}><td>{d} ft</td><td>{v.homes_per_floor}</td><td>{v.homes}</td></tr>
          ))}
        </tbody>
      </table>

      {econ ? (
        <>
          <h3>Indicative residual · 36 ft base layout</h3>
          <p>
            Value as housing minus conversion cost and developer margin, including ${incentive}/SF incentive: {money(econ.cases.downside.residual + incentive * selected.gfa_sf)} (worst) ·{" "}
            <b>{money(econ.cases.base.residual + incentive * selected.gfa_sf)}</b> (base) · {money(econ.cases.upside.residual + incentive * selected.gfa_sf)} (high)
          </p>
          <p className="muted small">Compared with the {econ.inputs.reference_label || "assessed value"} ({money(econ.inputs.reference_value_assessed)}), not an offer price. Not included: {econ.excluded.join(", ")}.</p>
          <p className="verdict">{selected.label}{selected.gated_out && " · Below vacancy filter"}</p>
          <h3>What moves it most</h3>
          {econ.tornado.map((t) => (
            <div key={t.input} className="tornado">
              <span>{LABELS[t.input] ?? t.input}</span>
              <span className="bar loss" style={{"--width": Math.abs(t.low_per_gsf) / swing * 100 + "%"}}>{perSf(t.low_per_gsf)}</span>
              <span className="bar gain" style={{"--width": Math.abs(t.high_per_gsf) / swing * 100 + "%"}}>{perSf(t.high_per_gsf)}</span>
            </div>
          ))}
        </>
      ) : (
        <p className="muted">No rent data for this building yet.</p>
      )}

      <h3>Scenarios · illustrative</h3>
      <table><thead><tr><th>Scenario</th><th>Homes</th><th>Upfront CO₂e</th></tr></thead><tbody>
        <tr><td>Leave empty</td><td>{carbon.leave_empty.homes}–{carbon.leave_empty.homes}</td><td>{carbon.leave_empty.new_embodied_t}–{carbon.leave_empty.new_embodied_t} t</td></tr>
        {[["Convert", carbon.convert], ["Demolish & rebuild", carbon.demolish_rebuild]].map(([name, scenario]) =>
          <tr key={name}><td>{name}</td><td>{Math.min(...counts)}–{Math.max(...counts)}</td>
          <td>{tonnes(scenario.new_embodied_t_low)}–{tonnes(scenario.new_embodied_t_high)}</td></tr>)}
      </tbody></table>
      <p className="muted small">Homes span the three modeled depths. Rebuild assumes the same housing program.</p>
      <p>
        Reusing the structure would avoid roughly {tonnes(carbon.avoided_t_low)} to {tonnes(carbon.avoided_t_high)} CO₂e
        of upfront embodied carbon compared with building new.
      </p>
      <p className="muted small">Literature range (50–75% of new-build embodied carbon), not a measured saving for this building.</p>
    </div>
  );
}
