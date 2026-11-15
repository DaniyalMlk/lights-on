import {lazy,Suspense,useEffect,useRef,useState} from "react";
import CityDrawing from "./CityDrawing";
import {money} from "./format";
import {breakEven as requiredIncentive,firstStep as sliderThreshold} from "./incentive";
const perFoot=n=>`$${n.toLocaleString("en-US",{maximumFractionDigits:2})}/SF`;
const supportStatus=(required,current)=>required===null?"Unavailable":current>=required?"Meets assessed value":"Below assessed value";
import "./landing.css";

import {screenBuildings} from "./screenBuildings";
const PreviewMap = lazy(() => import("./CityMap.jsx"));
const mapUrl="/?view=map";
const buildingUrl=id=>mapUrl+"&demo="+encodeURIComponent(id);
const plate=id=>"/api/buildings/"+encodeURIComponent(id)+"/plate.svg?depth=36";
function Link({href,children,quiet=false}){
  return <a className={quiet?"lp-link":"lp-button"} href={href}>{children} <span aria-hidden="true">↗</span></a>;
}
export default function Landing(){
  const [pair,setPair]=useState([]),[detail,setDetail]=useState(null);
  const [previewData,setPreviewData]=useState(null);
  const [previewActive, setPreviewActive] = useState(true);
  useEffect(() => {
    const hide = () => setPreviewActive(false);
    const show = () => setPreviewActive(true);
    window.addEventListener("pagehide", hide);
    window.addEventListener("pageshow", show);
    return () => {
      window.removeEventListener("pagehide", hide);
      window.removeEventListener("pageshow", show);
    };
  }, []);
  const page=useRef(null);
  useEffect(()=>{
    const controller=new AbortController();
    const get=async url=>{const r=await fetch(url,{signal:controller.signal});if(!r.ok)throw Error();return r.json();};
    (async()=>{
      const collection=await get("/api/buildings");
      setPreviewData(screenBuildings(collection, 165, 35));
      const towers=collection.features.map(f=>f.properties).filter(p=>!p.map_only);
      const valid=towers.filter(p=>requiredIncentive(p)!==null).sort((a,b)=>requiredIncentive(a)-requiredIncentive(b));
      const first=valid.find(p=>p.name==="800 Bell")??valid[0]??towers[0];
      if(!first)return;
      const second=valid.find(p=>requiredIncentive(p)>sliderThreshold(requiredIncentive(first)) && p.id!==first.id)??towers.find(p=>p.id!==first.id);
      setPair([first,second].filter(Boolean));setDetail(await get("/api/buildings/"+encodeURIComponent(first.id)));
    })().catch(()=>{});
    const observer=new IntersectionObserver(entries=>entries.forEach(e=>{if(e.isIntersecting){e.target.classList.add("shown");observer.unobserve(e.target);}}),{threshold:.13});
    page.current.querySelectorAll(".lp-step, .lp-study").forEach(el=>observer.observe(el));
    return ()=>{observer.disconnect();controller.abort();};
  },[]);
  const [a,b]=pair, example=a?buildingUrl(a.id):"#study";
  const current=a?sliderThreshold(requiredIncentive(a)):null;
  const amount=n=>n==null?"Unavailable":perFoot(n);
  return <main className="landing" ref={page}>
    <header className="lp-nav"><a className="brand" href="/"><img src="/favicon.svg" width="23" alt=""/>Lights On</a></header>
    <section className="lp-hero">
      <div className="lp-intro"><p className="lp-kicker">Office-to-housing atlas</p>
        <h1>Find the next homes in <em>your city.</em></h1>
        <p>Explore vacant offices, estimate housing potential, and see what it takes to make conversion financially viable.</p>
        <Link href={mapUrl}>Explore Houston</Link>
      </div>
      <div className="hero-map" role="img" aria-label="Downtown Houston office conversions at $165 per square foot of support and a 35% vacancy threshold">
        <div aria-hidden="true" className="hero-map-scene"><Suspense fallback={null}>
          {previewActive && previewData && <PreviewMap preview data={previewData}/>}
        </Suspense></div>
        <small className="hero-credit">OpenFreeMap · © OpenMapTiles · © OpenStreetMap contributors</small>
      </div>
    </section>
    <section id="method" className="lp-section"><p className="lp-kicker">How Lights On works</p><h2>From empty offices to potential homes.</h2><p className="lp-desc">For city teams and developers, vacancy is only the starting point. Screen the floor plate and the finances together to decide which building deserves a closer study.</p>
    <div className="lp-steps">{["Find a building","Explore housing potential","Compare financial feasibility"].map((title,i)=><article key={title} className="lp-step"><div className="lp-mini">{i===0?<CityDrawing/>:i===1&&a?<img src={plate(a.id)} alt="Indicative apartment layout"/>:i===2?<div className="lp-bars">{pair.map(p=><div key={p.id}>{p.name}<b>{amount(requiredIncentive(p))}</b><i style={{width:Math.min(100,(requiredIncentive(p)??0)/2.5)+"%"}}/></div>)}</div>:null}</div><small>0{i+1}</small><h3>{title}</h3><p>{["Choose an office on the Houston map and check its vacancy.","Trace the apartments that fit near the windows at three unit depths.","Compare purchase capacity and support needs under common assumptions."][i]}</p></article>)}</div></section>
    <section className="lp-section" id="study">
      <div className="lp-study">
        <figure>{a&&<img src={plate(a.id)} alt="Estimated apartment layout at 36 ft"/>}<figcaption>Typical floor · 36 ft unit depth</figcaption></figure>
        <div>
          <p className="lp-kicker">Building Study · Houston</p>
          <h2>{a?.name??"Building overview"}</h2><p className="lp-desc">{a?.address} {detail?.building?.synthetic?"· Sample building":""}</p><dl>{[["Potential homes",a?.homes?.toLocaleString()],["Conversion cost",money(detail?.econ?.cases?.base?.cost)],["Required incentive",amount(requiredIncentive(a))]].map(([k,v])=><div key={k}><dt>{k}</dt><dd>{v??"Unavailable"}</dd></div>)}</dl>{a&&<Link href={example}>Explore this building</Link>}
        </div>
      </div>
    </section>
    <section className="lp-section"><p className="lp-kicker">Compare buildings</p><h2>Where could support make the difference?</h2>{b&&current!==null?<><p className="lp-desc">At {perFoot(current)} of hypothetical support, here’s how two offices compare in the base case.</p><div className="lp-pair">{pair.map(p=><article key={p.id}><h3>{p.name}</h3><p>Required incentive</p><strong>{amount(requiredIncentive(p))}</strong><small data-lit={current>=requiredIncentive(p)&&requiredIncentive(p)!==null}>{supportStatus(requiredIncentive(p),current)}</small></article>)}</div></>:<p>Comparison data unavailable.</p>}</section>
    <section className="lp-section"><p className="lp-kicker">Data & Assumptions</p><h2>What goes into a study?</h2>
      <div className="lp-assumptions">{[["Building data","CoStar records supply building and market inputs when available. Footprints can be estimated, and matched floor scans refine the geometry where available."],["Floor depth","The 30, 36 and 42 ft layouts test how much floor area can accommodate apartments near the facade. Home counts are indicative."],["Financial feasibility","The base case uses the 36 ft layout. Housing value minus conversion cost and developer margin gives purchase capacity. Required incentive closes the gap to the reference price per gross square foot."]].map(([title,description], index) => (
        <article key={title}>
          <span className="lp-card-number" aria-hidden="true">0{index + 1}</span>
          <h3>{title}</h3>
          <p>{description}</p>
        </article>
      ))}</div>
    </section>
    <footer className="lp-section"><h2>Explore Houston’s conversion potential.</h2><p className="lp-desc">Choose an office on the map to see how many homes could fit and what support conversion would take.</p><Link href={mapUrl}>Open the map</Link></footer>
  </main>;
}
