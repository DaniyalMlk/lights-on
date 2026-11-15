import { useEffect, useRef, useState } from "react";
import { tonnes } from "./format.js";
import { breakEven, firstStep, stepWords } from "./incentive.js";

// Two buildings side by side, on what a lender would ask first: how many homes, how much daylight, does it pay.
// Only our own results are shown. Rents, vacancy and prices are CoStar figures, so they stay off the screen.

const LETTERS = ["A", "B"];
const PLATE_FROM = { matterport_scan: "Scanned floor", vexcel: "Vexcel outline" };

// undefined while loading, null if the request failed
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

// One side of the pair: its name, and a small search menu to pick or replace it
function Picker({ index, name, editing, options, onEdit, onChoose }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const button = useRef(null);
  const label = `Building ${LETTERS[index]}`;
  const matches = options.filter(p => p.name.toLowerCase().includes(query.trim().toLowerCase()));
  const show = editing && open;
  return <div className="compare-picker" onBlur={e => {
    if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false);
  }} onKeyDown={e => {
    if (e.key === "Escape" && show) { e.stopPropagation(); setOpen(false); button.current?.focus(); }
  }}>
    <p className="eyebrow">{label}</p>
    {name && <h3>{name}</h3>}
    <button ref={button} className={name ? "text-button" : "secondary"} aria-label={`${name ? "Replace" : "Choose"} ${label}`}
      aria-expanded={show} onClick={() => { onEdit(index); setQuery(""); setOpen(!show); }}>
      {name ? "Replace" : "Choose a building"}
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

// One row: a label, then the two buildings' values. better ("higher" or "lower") marks the winner and says by how much
function Row({ label, note, values, show = v => v, none = "–", better, gap, lit }) {
  const text = values.map(v => v === undefined ? "…" : v == null ? none : show(v));
  let winner = -1;
  if (better && values.every(Number.isFinite) && text[0] !== text[1])
    winner = (values[0] > values[1]) === (better === "higher") ? 0 : 1;
  return <div className="compare-row">
    <dt>{label}{note && <small>{note}</small>}</dt>
    {text.map((words, i) => <dd key={i} data-better={winner === i} data-lit={Boolean(lit?.[i])}>
      {words}
      {winner === i && <small>{gap(Math.abs(values[0] - values[1]))}</small>}
    </dd>)}
  </div>;
}

export default function ComparePanel({ towers, pair, slot, onSlot, onChoose, incentive }) {
  const [depth, setDepth] = useState(36);
  const records = [useBuilding(pair[0]), useBuilding(pair[1])];
  const options = towers.map(f => f.properties);
  const chosen = pair.map(id => options.find(p => p.id === id));
  const both = pair.every(Boolean);

  // undefined (still loading) and null (failed) pass straight through to the row
  const from = (pick) => records.map(r => r ? pick(r) : r);
  const layouts = from(r => r.geometry.by_depth[depth]);
  const steps = chosen.map(p => firstStep(breakEven(p)));

  return <article className="panel compare">
    <header>
      <p className="eyebrow">Compare</p>
      <h2>Which one deserves the study?</h2>
    </header>
    <div className="compare-pair">{pair.map((id, i) => <Picker key={i + ":" + (id ?? "")} index={i}
      name={chosen[i]?.name} editing={slot === i}
      options={options.filter(p => !pair.includes(p.id))} onEdit={onSlot} onChoose={onChoose} />)}</div>
    {slot != null && <p className="fine" role="status">Click a building on the map to make it building {LETTERS[slot]}.</p>}

    {both && <>
      <div className="compare-head">
        <h3>Homes and daylight</h3>
        <div className="segmented" role="group" aria-label="Unit depth">{[30, 36, 42].map(d =>
          <button key={d} aria-pressed={depth === d} onClick={() => setDepth(d)}>{d} ft</button>)}</div>
      </div>
      <dl>
        <Row label="Potential homes" values={layouts.map(l => l && l.homes)} show={v => v.toLocaleString()}
             better="higher" gap={d => `${d.toLocaleString()} more`} />
        <Row label="Near a window" note={`${depth} ft, outside the core`} values={layouts.map(l => l && Math.round(l.daylight_share * 100))}
             show={v => `${v}%`} better="higher" gap={d => `${d} ${d === 1 ? "point" : "points"} more`} />
        <Row label="Floor plate from" values={from(r => PLATE_FROM[r.geometry.plate_source] ?? PLATE_FROM[r.building.footprint_origin] ?? "Square stand-in")} />
      </dl>

      <div className="compare-head"><h3>Does it pay?</h3></div>
      <dl>
        <Row label="At this setting" note={incentive ? `hypothetical $${incentive}/SF` : "no incentive"}
             values={chosen.map(p => p.gated_out ? "Filtered out by vacancy" : p.short)} lit={chosen.map(p => p.lit)} />
        <Row label="Pays for itself from" note="hypothetical incentive, base case" values={steps} show={stepWords}
             none="No price to compare" better="lower" gap={d => `$${d}/SF less`} />
        <Row label="Carbon avoided" note="CO₂e, illustrative" values={from(r => r.carbon)}
             show={c => `${Math.round(c.avoided_t_low).toLocaleString()}–${tonnes(c.avoided_t_high)}`} />
      </dl>
      <p className="fine">Screening figures, not an offer price. The incentive is hypothetical: a building may be eligible,
        verify with the program. Carbon is a literature range, not a measured saving.</p>
    </>}
  </article>;
}
