import { useEffect, useRef, useState } from "react";
import { money } from "./format.js";

const dollars = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format;
const percent = value => `${Math.round(value * 100)}%`;
const letter = index => index === 0 ? "A" : "B";

function useBuilding(id) {
  const [result, setResult] = useState(null);
  useEffect(() => {
    if (!id) return;
    const controller = new AbortController();
    fetch(`/api/buildings/${encodeURIComponent(id)}`, { signal: controller.signal })
      .then(response => {
        if (!response.ok) throw new Error();
        return response.json();
      })
      .then(data => setResult({ id, data }))
      .catch(() => { if (!controller.signal.aborted) setResult({ id, data: null }); });
    return () => controller.abort();
  }, [id]);
  return result?.id === id ? result.data : undefined;
}

function Picker({ index, name, editing, options, onEdit, onChoose }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const search = useRef(null);
  const label = `Building ${letter(index)}`;
  const matches = options.filter(p => p.name.toLowerCase().includes(query.trim().toLowerCase()));
  const show = editing && open;
  return <div className="compare-picker" onBlur={e => {
    if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false);
  }} onKeyDown={e => {
    if (e.key === "Escape" && show) { e.stopPropagation(); setOpen(false); search.current?.focus(); }
  }}>
    <p className="eyebrow">{label}</p>
    {name && <h3>{name}</h3>}
    <button ref={search} className={name ? "text-button" : "secondary"} aria-label={`${name ? "Replace" : "Select"} ${label}`}
      aria-expanded={show} onClick={() => { onEdit(index); setQuery(""); setOpen(!show); }}>
      {name ? "Replace" : "Select building ▾"}
    </button>
    {show && <div className="compare-menu">
      <input autoFocus type="search" aria-label={`Search ${label}`} placeholder="Search by name" value={query}
        onChange={e => setQuery(e.target.value)} onKeyDown={e => {
          if (e.key === "Enter" && matches.length === 1) { onChoose(matches[0].id, index); setOpen(false); }
        }} />
      <div>{matches.map(p => <button key={p.id} onClick={() => { onChoose(p.id, index); setOpen(false); }}>{p.name}</button>)}
      {!matches.length && <p className="fine">No matching buildings</p>}</div>
    </div>}
  </div>;
}

function Metric({ label, values, format, notes, advantage }) {
  const comparable = values.every(Number.isFinite) && values[0] !== values[1];
  const lower = values[0] < values[1] ? 0 : 1;
  let winner = -1;
  if (comparable && advantage === "cost") winner = lower;
  if (comparable && advantage === "gap" && values[1 - lower] > 0) winner = 1 - lower;
  const delta = winner >= 0 ? dollars(Math.abs(values[0] - values[1])) : "";
  return <div className="compare-metric">
    <dt>{label}</dt>
    {values.map((value, i) => <dd key={i} aria-label={`Building ${letter(i)}: ${label}`} data-better={winner === i}>
      {Number.isFinite(value) ? format(value) : "Unavailable"}
      {notes?.[i] && <small>{notes[i]}</small>}
      {winner === i && <small>{delta} {advantage === "cost" ? "less per unit" : "more headroom"}</small>}
    </dd>)}
  </div>;
}

export default function ComparePanel({ towers, pair, slot, onSlot, onChoose, incentive }) {
  const [depth, setDepth] = useState(36);
  const a = useBuilding(pair[0]);
  const b = useBuilding(pair[1]);
  const records = [a, b];
  const count = pair.filter(Boolean).length;
  const options = towers.map(f => f.properties);
  const base = records.map(r => r?.econ?.cases?.base);
  const costs = base.map(c => c?.cost);
  const price = base.map((c, i) => {
    const gfa = records[i]?.econ?.inputs?.gfa;
    return Number.isFinite(c?.residual) && Number.isFinite(gfa) ? c.residual + incentive * gfa : null;
  });
  const refs = records.map(r => r?.building?.assessed_value);
  const layouts = records.map(r => r?.geometry?.by_depth?.[depth]);
  return <article className="compare panel">
    <header><p className="eyebrow">Building comparison · {count}/2</p></header>
    <div className="compare-pair">{pair.map((id, i) => <Picker key={i + ":" + (id ?? "")} index={i}
      name={options.find(p => p.id === id)?.name} editing={slot === i}
      options={options.filter(p => !pair.includes(p.id))} onEdit={onSlot} onChoose={onChoose} />)}</div>
    {slot != null && <p className="fine" role="status">Select Building {letter(slot)} on the map or from the list.</p>}
    {count === 2 && <>
      <section className="block"><h3>Financial comparison</h3>
        <p className="fine">Base case · 36 ft layout. Purchase capacity includes the ${incentive}/SF hypothetical incentive.</p>
        {records.includes(undefined) && <p className="fine" role="status">Loading building analysis…</p>}
        <dl>
          <Metric label="Total conversion cost" values={costs} format={money} />
          <Metric label="Conversion cost per potential home" values={costs.map((cost, i) => {
            const g = records[i]?.geometry;
            const homes = g?.by_depth?.[g.base_depth_ft ?? 36]?.homes;
            return Number.isFinite(cost) && homes > 0 ? cost / homes : null;
          })} format={dollars} advantage="cost" />
          <Metric label="Effective apartment rent · per SF / month" values={base.map(c => c?.effective_rent_psf_month)}
            notes={records.map(r => r?.building?.rent_comps > 0 ? `Based on ${r.building.rent_comps} apartment comparables` : null)}
            format={v => `$${v.toFixed(2)}`} />
          <Metric label="Supported purchase price (residual)" values={price} format={money} />
          <Metric label="Reference value" values={refs} notes={records.map(r => r?.building?.reference_source ??
            (r?.building?.assessed_value != null ? "Assessed value" : null))} format={money} />
          <Metric label="Purchase capacity minus reference value" values={price.map((v, i) =>
            Number.isFinite(v) && Number.isFinite(refs[i]) ? v - refs[i] : null)} format={money} advantage="gap" />
        </dl>
      </section>
      <section className="block"><div className="compare-section-head"><h3>Floor layout</h3>
        <div className="segmented" role="group" aria-label="Comparison depth">{[30,36,42].map(d =>
          <button key={d} aria-pressed={depth === d} onClick={() => setDepth(d)}>{d} ft</button>)}</div></div>
        <dl>
          <Metric label="Vacancy share" values={records.map(r => r?.building?.vacancy)} format={percent} />
          <Metric label={`Within ${depth} ft of facade · floor outside core`} values={layouts.map(l => l?.daylight_share)} format={percent} />
          <Metric label="Potential homes" values={layouts.map(l => l?.homes)} format={v => v.toLocaleString()} />
        </dl>
      </section>
    </>}
  </article>;
}
