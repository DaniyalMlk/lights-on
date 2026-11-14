import { useEffect, useState } from "react";

const money = (x) => (x == null ? "n/a" : `${x < 0 ? "−" : ""}$${Math.abs(x / 1e6).toFixed(1)}M`);
const tonnes = (x) => `${Math.round(x).toLocaleString()} t`;
const perSf = (x) => `${x >= 0 ? "+" : "−"}$${Math.abs(x).toFixed(0)}/SF`;
const LABELS = { rent_mult: "Rent ±10%", free_weeks: "Free weeks", cap: "Cap rate ±0.5 pt", opex: "Opex ±5 pt", cost_mult: "Conversion cost" };

export default function BuildingPanel({ buildingId }) {
  const [data, setData] = useState(null);

  useEffect(() => {
    if (!buildingId) return;
    setData(null);
    fetch(`/api/buildings/${buildingId}`).then((r) => r.json()).then(setData);
  }, [buildingId]);

  if (!buildingId) return <div className="panel empty">Click a tower to see how many homes fit.</div>;
  if (!data) return <div className="panel">Loading…</div>;

  const { building, geometry, econ, carbon } = data;
  const depths = geometry.by_depth;

  return (
    <div className="panel">
      <h2>{building.name}</h2>
      <p className="muted">{building.stories} stories{building.synthetic ? " · sample data, not a real building" : ""}</p>

      <img className="plate" src={`/api/buildings/${buildingId}/plate.svg`} alt="Floor plate with apartments" />
      <p className="muted small">Indicative layout from the footprint: a screening estimate, not a design.</p>

      <h3>Homes (estimate)</h3>
      <table>
        <thead><tr><th>Unit depth</th><th>Per floor</th><th>Total</th></tr></thead>
        <tbody>
          {Object.entries(depths).map(([d, v]) => (
            <tr key={d}><td>{d} ft</td><td>{v.homes_per_floor}</td><td>{v.homes}</td></tr>
          ))}
        </tbody>
      </table>

      {econ ? (
        <>
          <h3>Indicative residual</h3>
          <p>
            Value as housing minus conversion cost and developer margin: {money(econ.cases.downside.residual)} (downside) ·{" "}
            <b>{money(econ.cases.base.residual)}</b> (base) · {money(econ.cases.upside.residual)} (upside)
          </p>
          <p className="muted small">Compared with the assessed value ({money(econ.inputs.reference_value_assessed)}), not an offer price. Not included: {econ.excluded.join(", ")}.</p>
          <p className="verdict">{econ.verdict.text}</p>
          <h3>What moves it most</h3>
          {econ.tornado.map((t) => (
            <div key={t.input} className="tornado">
              <span>{LABELS[t.input] ?? t.input}</span>
              <span className="bad">{perSf(t.low_per_gsf)}</span>
              <span className="good">{perSf(t.high_per_gsf)}</span>
            </div>
          ))}
        </>
      ) : (
        <p className="muted">No rent data for this building yet.</p>
      )}

      <h3>Convert vs demolish (illustrative)</h3>
      <p>
        Reusing the structure would avoid roughly {tonnes(carbon.avoided_t_low)} to {tonnes(carbon.avoided_t_high)} CO₂e
        of upfront embodied carbon compared with building new.
      </p>
      <p className="muted small">Literature range (50–75% of new-build embodied carbon), not a measured saving for this building.</p>
    </div>
  );
}
