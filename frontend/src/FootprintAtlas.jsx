import { useId } from "react";

// Oblique local projection in metres. All towers share one scale and ground plane.
function project([lng, lat], origin) {
  const east = (lng - origin[0]) * 111320 * Math.cos(origin[1] * Math.PI / 180);
  const north = (lat - origin[1]) * 110540;
  return [(east * 0.87 + north * 0.5), (east * 0.5 - north * 0.87) * 0.55];
}
const points = ring => ring.map(p => p.join(",")).join(" ");

export default function FootprintAtlas({ features, selectedId, onSelect }) {
  const pattern = useId();
  if (!features.length) return null;
  const origin = features[0].geometry.coordinates[0][0];
  const towers = features.map(({ properties: p, geometry }, index) => {
    const base = geometry.coordinates[0].slice(0, -1).map(point => project(point, origin));
    const height = (p.height_ft || 0) * 0.3048 * 0.84;
    const roof = base.map(([x,y]) => [x,y-height]);
    const center = roof.reduce(([x,y], [a,b]) => [x+a/roof.length,y+b/roof.length], [0,0]);
    return {p, index, base, roof, center};
  }).sort((a,b) => Math.max(...a.base.map(p=>p[1])) - Math.max(...b.base.map(p=>p[1])));
  const vertices = towers.flatMap(t => [...t.base,...t.roof]);
  const xs = vertices.map(p=>p[0]), ys = vertices.map(p=>p[1]);
  const left = Math.min(...xs), top = Math.min(...ys);
  const w = Math.max(140, Math.max(...xs)-left), h = Math.max(120, Math.max(...ys)-top);
  return <svg className="atlas-drawing" viewBox={[left-w*.12,top-h*.25,w*1.24,h*1.55].join(" ")} aria-label="Oblique view of candidate footprints and heights">
    <defs><pattern id={pattern} width="54" height="54" patternUnits="userSpaceOnUse" patternTransform="matrix(.87 .275 .5 -.478 0 0)">
      <rect width="54" height="54" fill="#131c23"/><rect x="3" y="3" width="48" height="48" rx="2" fill="#19252c" stroke="#304048"/>
      <path d="M26 4v46M4 29h46" stroke="#23323a" fill="none"/>
    </pattern></defs>
    <rect x={left-w*4} y={top-h*4} width={w*9} height={h*9} fill={'url(#'+pattern+')'}/>
    {towers.map(({p,index,base,roof,center}) => {
      const faces = base.map((a,i) => {
        const j = (i+1)%base.length;
        return {ring:[a,base[j],roof[j],roof[i]], y:(a[1]+base[j][1])/2, light:a[0]<base[j][0]};
      }).sort((a,b)=>a.y-b.y);
      return <g key={p.id} className={'tower '+(p.map_only || p.gated_out ? 'filtered' : p.lit ? 'lit' : '')}
        role="button" tabIndex="0" aria-label={p.name} aria-pressed={p.id===selectedId}
        onClick={()=>onSelect(p.id)} onKeyDown={e=>{if (e.key==='Enter'||e.key===' ') {e.preventDefault();onSelect(p.id);}}}>
        <title>{p.name}</title>
        {faces.map((face,i)=><polygon key={i} className={face.light?'light-face':'dark-face'} points={points(face.ring)}/>)}
        <polygon className="roof" points={points(roof)}/>
        <g transform={'translate('+center.join(' ')+')'}><circle r={w*.023}/><text dy=".35em" textAnchor="middle" fontSize={w*.026}>{index+1}</text></g>
      </g>;
    })}
  </svg>;
}
