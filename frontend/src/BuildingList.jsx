const priority = ["1801 smith", "1021 main", "one city centre", "1415 louisiana", "708 main"];
function rank(p) {
  const location = [p.name, p.address].join(" ").toLowerCase();
  const index = priority.findIndex(text => location.includes(text));
  return index < 0 ? priority.length : index;
}
export default function BuildingList({ features, onSelect, error }) {
  return <section className="catalog">
    <div className="catalog-heading"><p className="eyebrow">Building index</p><h2>Conversion candidates</h2></div>
    {error ? <p>Building data unavailable.</p> : !features ? <p>Loading candidates…</p> : !features.length ? <p>No buildings available.</p> :
      features.map(({properties:p},index)=>({p,index})).sort((a,b)=>rank(a.p)-rank(b.p)).map(({p,index})=>
        <button className="candidate" key={p.id} onClick={()=>onSelect(p.id)}>
          <span className="index">{String(index+1).padStart(2,"0")}</span>
          <span><strong>{p.name}</strong><small>{p.homes == null ? "Indicative location" : p.homes.toLocaleString()+" potential homes · 36 ft"}</small></span>
          <span className="arrow" aria-hidden="true">↗</span>
        </button>)}
  </section>;
}
