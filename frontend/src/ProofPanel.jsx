import { verdictWords, when } from "./format.js";

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

const STATUS = { pass: "Pass", miss: "Miss", "no data": "Dropped", "compare by hand": "Described" };

function CaseRow({ c, index }) {
  const actual = c.truth ?? (c.status === "compare by hand" ? "AECOM's ranking" : "–");
  return <li className="case" data-status={c.status} style={{ "--i": index }}>
    <header>
      <h3>{c.case}</h3>
      <span className="chip">{STATUS[c.status] ?? c.status}{c.error_pct != null ? ` · ${c.error_pct > 0 ? "+" : ""}${c.error_pct}%` : ""}</span>
    </header>
    <p className="fine">{c.role}</p>
    <dl className="vs">
      <div><dt>Ours</dt><dd>{c.predicted != null ? <>{c.predicted.toLocaleString()} <small>homes{c.floors_used ? ` · ${c.floors_used} floors` : ""}</small></> : "–"}</dd></div>
      <div><dt>Actual</dt><dd>{typeof actual === "number" ? actual.toLocaleString() : actual}</dd></div>
    </dl>
    <ul className="facts">
      {c.error_pct != null && <li>Allowed: within ±15%</li>}
      {c.deep_plate != null && <li>Deep-plate flag {c.deep_plate ? "fires" : "does not fire"}</li>}
      {c.our_verdict && <li>Our verdict: {verdictWords(c.our_verdict).toLowerCase()}</li>}
      {c.missed?.length > 0 && <li className="miss">Missed: {c.missed.join(", ")}</li>}
      {c.inputs && c.inputs !== "our data" && <li>Inputs: {c.inputs}</li>}
    </ul>
    <p className="fine">Source: {c.source}</p>
  </li>;
}

// proof comes from App (one fetch of /api/proof), so the header and this panel always agree
export default function ProofPanel({ proof }) {
  if (proof === undefined) return <div className="panel"><div className="skeleton-block tall" /></div>;
  if (!proof) return <div className="panel empty">No validation run yet. Run <code>python -m scripts.run_validation</code>.</div>;

  const s = summarize(proof.cases);
  const compared = proof.input_sensitivity.filter(r => r.plate && r.plate !== "square stand-in");
  const squares = proof.input_sensitivity.length - compared.length;
  return <article className="panel proof">
    <header>
      <p className="eyebrow">Validation</p>
      <h2>{s.passed} of {s.scored} scored cases passed</h2>
      <p className="lede">Expected answers were written down before the run, and the miss is shown. Case 1 is a
        development check, not a holdout. {s.dropped} dropped for lack of data; {s.described} described, not scored;
        no negative case found.</p>
      <p className="fine">Not fully blind: a first run on real data (Sat 00:30) showed some results early, and the change
        log in docs/preregistration.md says which. Official run {when(proof.official_ran_at ?? proof.ran_at)}, parameters {proof.params_version}.
        {proof.official_ran_at && proof.official_ran_at !== proof.ran_at &&
          ` Run again ${when(proof.ran_at)} for the input-sensitivity table; the change log says why.`}</p>
    </header>
    <ol className="cases">{proof.cases.map((c, i) => <CaseRow key={c.case} c={c} index={i} />)}</ol>

    <section className="block">
      <h3>Does the real plate change the answer?</h3>
      <p className="fine">Homes at 36 ft on a square of CoStar's typical floor, against the best plate we have: a
        scanned full floor, or a Vexcel outline that matches the typical floor. This shows sensitivity to the data,
        not accuracy.</p>
      {compared.length ? <table className="compact">
        <thead><tr><th>Building</th><th>Plate</th><th>Square</th><th>Real plate</th></tr></thead>
        <tbody>{compared.map(r => <tr key={r.building_id}><td>{r.name}</td><td>{r.plate}</td>
          <td>{r.homes_costar_only.toLocaleString()} <small>#{r.rank_costar_only}</small></td>
          <td>{r.homes_with_footprint.toLocaleString()} <small>#{r.rank_with_footprint}</small></td></tr>)}</tbody>
      </table> : <p className="muted">No building has a scanned floor or a matching Vexcel outline yet.</p>}
      {squares > 0 && <p className="fine">{squares} other buildings use the square stand-in, so there is nothing to compare.
        Numbers after # are the rank among all {proof.input_sensitivity.length} towers.</p>}
    </section>
  </article>;
}
