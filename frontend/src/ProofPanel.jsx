import { useEffect, useState } from "react";

function groupResults(proof) {
  const cases = proof?.cases ?? [];
  const smith = cases.find(c => c.case.startsWith("1801 Smith"));
  const city = cases.find(c => c.case === "One City Centre");
  const measures = proof?.input_sensitivity ?? [];
  const cityRank = measures.find(r => city?.building_id && r.building_id === city.building_id)?.rank_with_footprint;
  const directions = ["708 Main","1415 Louisiana"].map(name => {
    const row = cases.find(c => c.case === name);
    return name + ": " + (row?.our_verdict || "unavailable");
  });
  // Optional sourced observations can accompany the measured cases in proof.json.
  const evidence = proof?.evidence ?? {};
  function assessed(name, partial, failed) {
    const obs = evidence[name];
    if (failed) return {actual: partial, status: "Fail"};
    if (!obs?.source || !obs.actual || typeof obs.passed !== "boolean")
      return {actual: partial, status: "Pending"};
    return {actual: obs.actual + " · " + obs.source, status: obs.passed ? "Pass" : "Fail"};
  }
  return [
    ["1801 Smith · development check", "372 homes at 36 ft, within ±15%, plus an amenity core.",
      smith?.predicted == null ? "No measured result" : smith.predicted + " homes · amenity decision unavailable", smith?.status === "miss"],
    ["One City Centre", "Top three downtown and a mixed program. Planned program: 460 apartments.",
      cityRank == null ? "No measured rank" : "Rank " + cityRank + " · program decision unavailable", cityRank > 3],
    ["AECOM deep dives", "Compare both directions with AECOM and explain disagreements.", directions.join(" / "), false],
    ["Negative case", "Outside-labeled building gated out or in the bottom third, with a reason.", "Building and outside label pending", false],
  ].map(([title,criterion,actual,failed]) => ({title,criterion,...assessed(title, actual, failed)}));
}

export default function ProofPanel() {
  const [proof,setProof] = useState(undefined);
  useEffect(() => {
    fetch("/api/proof").then(r => r.ok ? r.json() : null).then(setProof).catch(() => setProof(null));
  }, []);
  if (proof === undefined) return <div className="panel">Loading proof…</div>;
  const cases = groupResults(proof);
  const measurements = (proof?.input_sensitivity ?? []).filter(row => row.vexcel_verified);
  return <div className="panel"><h2>{cases.filter(c => c.status === "Pass").length} of 4 passed</h2>
    <p className="muted">{proof ? "Validation run " + proof.ran_at : "No cached validation run."} Pending cases need more evidence.</p>
    {cases.map(c => <section className="proof-case" key={c.title}><h3>{c.title}</h3><p>{c.criterion}</p><strong>{c.status}</strong> · {c.actual}</section>)}
    <h3>CoStar only vs + Vexcel</h3>
    {measurements.length ? <table><thead><tr><th>Building</th><th>CoStar homes / rank</th><th>+ Vexcel homes / rank</th></tr></thead>
      <tbody>{measurements.map(r => <tr key={r.building_id}><td>{r.name}</td><td>{r.homes_costar_only} / {r.rank_costar_only}</td>
        <td>{r.homes_with_footprint} / {r.rank_with_footprint}</td></tr>)}</tbody></table> :
      <p className="muted">No paired measurements with verified Vexcel provenance.</p>}
  </div>;
}
