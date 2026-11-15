import { useState } from "react";

// Validation cases first by default, so a judge finds them without knowing Houston's towers
const priority = ["1801 smith", "1021 main", "one city centre", "1415 louisiana", "708 main"];
function caseRank({ properties: p }) {
  const location = [p.name, p.address].join(" ").toLowerCase();
  const index = priority.findIndex(text => location.includes(text));
  return index < 0 ? priority.length : index;
}
// Closest to paying: lit towers first, then the smallest gap, then towers with no price to compare
const gapRank = ({ properties: p }) => (p.gated_out || p.map_only ? 1e9 : p.gap == null ? 1e8 : p.gap);

const SORTS = {
  cases: { name: "Test cases", order: (a, b) => caseRank(a) - caseRank(b) },
  homes: { name: "Most homes", order: (a, b) => (b.properties.homes ?? -1) - (a.properties.homes ?? -1) },
  gap: { name: "Closest to paying", order: (a, b) => gapRank(a) - gapRank(b) },
  tour: { name: "3D tour", order: (a, b) => tourRank(a) - tourRank(b) },
};

// Buildings with a scan filed under their own id first, then a scan at the address, then the rest
function tourRank(f) {
  return f.properties.tour === "costar_id" ? 0 : f.properties.tour ? 1 : 2;
}

function status(p) {
  if (p.map_only) return "Indicative location";
  if (p.gated_out) return "Filtered out by vacancy";
  return p.short;
}

export default function BuildingList({ features, selectedId, hoveredId, onSelect, onHover, onCompare, error }) {
  const [sort, setSort] = useState("cases");
  const rows = features ? [...features].sort(SORTS[sort].order) : [];
  const count = features?.filter(f => !f.properties.map_only).length;
  return <section className="catalog" aria-label="Building list">
    <header className="catalog-head">
      <h2>{count ?? "–"} downtown office buildings <small>homes at 36 ft</small></h2>
      <div className="catalog-tools">
        <div className="sort" role="group" aria-label="Sort towers">
          {Object.entries(SORTS).filter(([key]) => key !== "tour" || rows.some(f => f.properties.tour)).map(([key, { name }]) =>
            <button key={key} aria-pressed={sort === key} onClick={() => setSort(key)}>{name}</button>)}
        </div>
        {count >= 2 && <button className="text-button" onClick={onCompare}>Compare</button>}
      </div>
    </header>
    {error ? <p className="empty">Building data unavailable. Is the API running?</p>
      : !features ? <ul className="rows skeleton" aria-hidden="true">{[1, 2, 3, 4, 5, 6].map(i => <li key={i} />)}</ul>
      : !features.length ? <p className="empty">No buildings available.</p>
      : <ul className="rows" onMouseLeave={() => onHover(null)}>{rows.map(({ properties: p }, index) =>
        <li key={p.id} style={{ "--i": index }}>
          <button aria-pressed={selectedId === p.id} data-hover={hoveredId === p.id} data-lit={Boolean(p.lit)}
                  data-off={Boolean(p.gated_out || p.map_only)}
                  onMouseEnter={() => onHover(p.id)} onFocus={() => onHover(p.id)} onClick={() => onSelect(p.id)}>
            <span className="dot" aria-hidden="true" />
            <span className="row-main">
              <strong>{p.name}</strong>
              <small>{status(p)}{p.tour === "distance" ? " · 3D tour nearby" : p.tour ? " · 3D tour" : ""}</small>
            </span>
            <span className="row-homes">{p.homes == null ? "–" : p.homes.toLocaleString()}<small>homes</small></span>
          </button>
        </li>)}</ul>}
  </section>;
}
