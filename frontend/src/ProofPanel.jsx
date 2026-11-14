import { useEffect, useState } from "react";

// Everything here comes from work/proof.json (python -m scripts.run_validation).
// The wording of the headline follows docs/preregistration.md: per building, never an accuracy percentage.
function summarize(cases) {
  const scored = cases.filter(c => c.status === "pass" || c.status === "miss");
  return {
    passed: scored.filter(c => c.status === "pass").length,
    scored: scored.length,
    dropped: cases.filter(c => c.status === "no data").length,
    described: cases.filter(c => c.status === "compare by hand").length,
  };
}

function CaseRow({ c }) {
  const actual = c.truth ?? (c.status === "compare by hand" ? "AECOM's direction, compared by hand" : "–");
  return <section className="proof-case">
    <h3>{c.case}</h3>
    <p className="muted small">{c.role}</p>
    <p>Ours: {c.predicted ?? "–"}{c.predicted != null && " homes"}{c.floors_used ? ` on ${c.floors_used} floors` : ""} · Actual: {actual}</p>
    {c.deep_plate != null && <p className="muted small">Deep-plate flag: {c.deep_plate ? "fires" : "does not fire"}</p>}
    {c.our_verdict && <p className="muted small">Our verdict: {c.our_verdict}</p>}
    {c.inputs && c.inputs !== "our data" && <p className="muted small">Inputs: {c.inputs}</p>}
    <strong className={c.status}>{c.status}{c.error_pct != null ? ` (${c.error_pct}%)` : ""}</strong>
    {c.missed?.length > 0 && <span> · missed: {c.missed.join(", ")}</span>}
    <p className="muted small">Source: {c.source}</p>
  </section>;
}

export default function ProofPanel() {
  const [proof, setProof] = useState(undefined);
  useEffect(() => {
    fetch("/api/proof").then(r => r.ok ? r.json() : null).then(setProof).catch(() => setProof(null));
  }, []);
  if (proof === undefined) return <div className="panel">Loading proof…</div>;
  if (!proof) return <div className="panel muted">No validation run yet. Run <code>python -m scripts.run_validation</code>.</div>;

  const s = summarize(proof.cases);
  const compared = proof.input_sensitivity.filter(r => r.plate && r.plate !== "square stand-in");
  const squares = proof.input_sensitivity.length - compared.length;
  return <div className="panel">
    <h2>{s.passed} of {s.scored} scored cases passed</h2>
    <p className="muted">
      Case 1 is a development check, not a holdout. {s.dropped} dropped for lack of data; {s.described} described, not
      scored; no negative case found.
    </p>
    <p className="muted small">
      Expected answers were written down before the official run. Not fully blind: a first run on real data (Sat 00:30)
      showed some results early, and the change log in docs/preregistration.md says which. Run {proof.ran_at},
      parameters {proof.params_version}.
    </p>
    {proof.cases.map(c => <CaseRow key={c.case} c={c} />)}

    <h3>Does the real plate change the answer?</h3>
    <p className="muted small">
      Homes at 36 ft on a square of CoStar's typical floor vs. the best plate we have: a scanned full floor, or a Vexcel
      outline that matches the typical floor. This shows sensitivity to the data, not accuracy.
    </p>
    {compared.length ? <table>
      <thead><tr><th>Building</th><th>Plate</th><th>Square: homes / rank</th><th>Real plate: homes / rank</th></tr></thead>
      <tbody>{compared.map(r => <tr key={r.building_id}><td>{r.name}</td><td>{r.plate}</td>
        <td>{r.homes_costar_only} / {r.rank_costar_only}</td><td>{r.homes_with_footprint} / {r.rank_with_footprint}</td></tr>)}</tbody>
    </table> : <p className="muted">No building has a scanned floor or a matching Vexcel outline yet.</p>}
    {squares > 0 && <p className="muted small">{squares} other buildings use the square stand-in, so there is nothing to compare.</p>}
  </div>;
}
