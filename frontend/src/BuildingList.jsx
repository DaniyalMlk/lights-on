const priority = ["1801 smith", "1021 main", "one city centre", "1415 louisiana", "708 main"];

function rank({ properties: p }) {
  const location = [p.name, p.address].join(" ").toLowerCase();
  const index = priority.findIndex(text => location.includes(text));
  return index < 0 ? priority.length : index;
}

export default function BuildingList({ features, selectedId, onSelect, error }) {
  return <section className="catalog" aria-label="Building list">
    <h2>Buildings</h2>
    {error ? "Building data unavailable." : !features ? "Loading buildings…" : !features.length ? "No buildings available." :
      [...features].sort((a, b) => rank(a) - rank(b)).map(({properties: p}) =>
        <button key={p.id} aria-pressed={selectedId === p.id} onClick={() => onSelect(p.id)}>
          <strong>{p.name}</strong><span>{p.homes == null ? "Indicative location" : p.homes + " homes at 36 ft"} · {p.label}</span>
        </button>)}
  </section>;
}
