import { useState } from "react";

function Draft({ title, initial }) {
  const [text, setText] = useState(initial);
  const [approved, approve] = useState(false);
  return <section><label>{title}<textarea value={text} onChange={e => {
    setText(e.target.value); approve(false);
  }}/></label><label><input type="checkbox" checked={approved} disabled={!text.trim()}
    onChange={e => approve(e.target.checked)}/> Reviewed and approved for this session</label></section>;
}

export default function StudyDetails({data, depth}) {
  const {building:b, geometry:g, score} = data;
  const base = g.by_depth["36"];
  const ratio = g.floor_check.ratio;
  const height = g.floor_to_floor;
  const dark = base.dark_sf / g.plate_sf;
  const net = g.by_depth[depth].home_nsf_per_floor / g.plate_sf;
  const why = {
    geometry: Math.round(base.daylight_share*100) + "% of the floor is in the 36 ft daylight band.",
    economics: data.econ && b.assessed_value ? "Base residual is compared with the reference value per gross SF." : "Reference or rent unavailable; the model uses a neutral score.",
    market: b.office_rent_psf_year && b.mf_rent_psf_month ? "Annualized residential rent is compared with office rent." : "Missing rent comparison; the model uses a neutral score.",
    context: "Context uses a neutral assumption until surroundings are measured."
  };
  return <>
    <h3>Building checks</h3><ul>
      <li>Podium · {ratio == null ? "floor area unavailable" : ratio.toFixed(2) + (ratio < .8 ? " · flagged below 0.80" : " · above threshold or at 0.80")}</li>
      <li>Dark area · {(100*dark).toFixed(1)}% at 36 ft{dark > .25 && " · deep plate"}</li>
      <li className={height.flag}>Floor-to-floor · {height.f2f_ft == null ? "unavailable" : height.f2f_ft + " ft · " + height.flag}</li>
      <li>Net-to-gross · {(net*100).toFixed(1)}% at {depth} ft · reference band 72–82%</li>
    </ul>
    <details><summary>Score · {score.total}/100</summary>{Object.entries({geometry:45,economics:30,market:15,context:10}).map(([name,max]) =>
      <p key={name}><strong>{name} · {score.parts[name]}/{max}</strong><br/>{why[name]}</p>)}
      <p>Gensler benchmark weights: form 30, plate 30, servicing 20, envelope 10, context 10.</p></details>
    <details><summary>Review memo and owner email</summary>
      <Draft title="Study memo" initial={`${b.name} · indicative screening estimate: ${base.homes} homes at 36 ft. Confirm the floor geometry, core and basis before commissioning a study. This property may be eligible, verify with the program.`}/>
      <Draft title="Owner email" initial={`Hello,\n\nWe screened ${b.name} for residential conversion. The indicative 36 ft layout yields ${base.homes} homes. Could we review a typical floor plan and the current building information with you?`}/>
    </details>
  </>;
}
