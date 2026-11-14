import { useEffect, useState } from "react";

export default function ProofPanel() {
  const [proof, setProof] = useState(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    fetch("/api/proof").then((r) => {
      if (!r.ok) return setMissing(true);
      return r.json().then(setProof);
    });
  }, []);

  if (missing) return <div className="panel muted">No validation run yet. Run <code>python -m scripts.run_validation</code>.</div>;
  if (!proof) return <div className="panel">Loading…</div>;

  return (
    <div className="panel">
      <h3>Checked against real Houston conversions</h3>
      <p className="muted small">Expected answers were written down before the official run. Not fully blind: a first run on real data (Sat 00:30) showed some results early, and the change log in docs/preregistration.md says which. Run {proof.ran_at}, parameters {proof.params_version}.</p>
      <table>
        <thead><tr><th>Building</th><th>Ours</th><th>Actual</th><th>Result</th></tr></thead>
        <tbody>
          {proof.cases.map((c) => (
            <tr key={c.case}>
              <td>{c.case}<div className="muted small">{c.role}</div></td>
              <td>{c.predicted ?? "–"}</td>
              <td>{c.truth ?? "by hand"}</td>
              <td className={c.status}>{c.status}{c.error_pct != null ? ` (${c.error_pct}%)` : ""}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3>Does the footprint change the answer?</h3>
      <p className="muted small">Homes at 36 ft using only CoStar's floor area vs. the real footprint. This shows sensitivity to the data, not accuracy.</p>
      <table>
        <thead><tr><th>Building</th><th>CoStar only</th><th>+ footprint</th><th>Rank</th></tr></thead>
        <tbody>
          {proof.input_sensitivity.map((r) => (
            <tr key={r.building_id}>
              <td>{r.name}</td>
              <td>{r.homes_costar_only}</td>
              <td>{r.homes_with_footprint}</td>
              <td>{r.rank_costar_only} → {r.rank_with_footprint}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
