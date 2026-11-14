import { useEffect, useRef, useState } from "react";
import { verifiedConversion } from "./calibration.js";

const colors = {measured:[1,.78,.25], checked:[.35,.85,.55], assumed:[.65,.68,.72], estimate:[1,1,1]};
let sdkLoad;
function loadSdk(key) {
  if (!sdkLoad) sdkLoad = new Promise((resolve,reject) => {
    const script = document.createElement("script");
    script.src = "https://static.matterport.com/showcase-sdk/bootstrap/3.1.0-0-g1cd7e0997a/sdk.js?applicationKey=" + encodeURIComponent(key);
    script.onload = () => resolve(window.MP_SDK);
    script.onerror = () => { sdkLoad = null; script.remove(); reject(new Error()); };
    document.head.append(script);
  });
  return sdkLoad;
}
function Tour({scan, sdkKey}) {
  const frame = useRef(null);
  const [status,setStatus] = useState("Opening tour…");
  useEffect(() => {
    let active = true;
    const fallback = () => { if(active) setStatus("3D placement unavailable. See the floor labels below."); };
    const timeout = setTimeout(fallback,15000);
    async function connect() {
      try {
        const api = await loadSdk(sdkKey);
        if (!active) return;
        const sdk = await api.connect(frame.current,sdkKey);
        const model = await sdk.Model.getData();
        const sweeps = new Map(model.sweeps.map(s => [s.uuid ?? s.id,s.position]));
        const ids = await sdk.Sweep.Conversion.createIdMap();
        for (const [current, legacy] of Object.entries(ids)) {
          const position = sweeps.get(current) ?? sweeps.get(legacy);
          if (position) { sweeps.set(current,position); sweeps.set(legacy,position); }
        }
        const place = verifiedConversion(scan.panos ?? [], sweeps,
          p => sdk.Conversion.basisChange(p, sdk.Conversion.TransformType.Coordinates.TO_SDK));
        if (!active) return;
        if (!place) { fallback(); return; }
        await sdk.Mattertag.add(scan.labels.map(label => {
          const [r,g,b] = colors[label.kind];
          return {label: label.kind + " · " + label.title, description: label.detail,
            anchorPosition:place(label.position),stemVector:{x:0,y:0.15,z:0},color:{r,g,b}};
        }));
        if (active) setStatus("Floor labels placed using matched scan positions.");
      } catch { fallback(); } finally { clearTimeout(timeout); }
    }
    const node = frame.current;
    node.addEventListener("load",connect);
    return () => { active=false; clearTimeout(timeout); node.removeEventListener("load",connect); };
  }, [scan,sdkKey]);
  const query = new URLSearchParams({m:scan.model_id,play:"1",applicationKey:sdkKey});
  return <><iframe ref={frame} title="Matterport floor tour" allowFullScreen src={"https://my.matterport.com/show/?"+query}/><p role="status">{status}</p></>;
}
export default function ScanPanel({building}) {
  const [scan,setScan] = useState(null);
  const [key,setKey] = useState("");
  const [open,setOpen] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    async function read() {
      try {
        const response = await fetch("/api/buildings/"+encodeURIComponent(building.id)+"/labels",{signal:controller.signal});
        if (!response.ok) throw new Error();
        const record = await response.json();
        setScan(record);
        if (record.model_id) {
          const config = await fetch("/api/config",{signal:controller.signal});
          if (config.ok) setKey((await config.json()).matterport_sdk_key || "");
        }
      } catch { if (!controller.signal.aborted) setScan(current => current || {labels:[],reason:"Scan data unavailable."}); }
    }
    read();
    return () => controller.abort();
  },[building.id]);
  const sources = [
    ["CoStar", building.synthetic ? "sample data" : building.rba || building.typical_floor_sf ? "property record" : "unconfirmed", !building.synthetic],
    ["Vexcel", building.footprint_origin === "vexcel" ? "outline used" : building.vexcel_ratio ? "outline is the building's base, not used" : "no outline", building.footprint_origin === "vexcel"],
    ["Matterport", scan?.model_id ? "floor scan" : scan ? "no usable floor labels" : "checking", Boolean(scan?.model_id)],
  ];
  return <section className="block sources">
    <h3>Data sources</h3>
    <ul className="source-list">{sources.map(([name, state, used]) =>
      <li key={name} data-used={used}><b>{name}</b><span>{state}</span></li>)}</ul>
    {!scan?.labels?.length ? <p className="fine">{scan?.reason || "Checking for a scanned floor…"}</p> :
      <>
        {key ? <button className="secondary" onClick={() => setOpen(!open)}>{open ? "Close" : "Open"} the 3D tour</button>
             : <p className="fine">Tour unavailable. The saved floor labels are below.</p>}
        {open && <Tour scan={scan} sdkKey={key}/>}
        <h4>Labels on the scanned floor</h4>
        <ul className="scan-labels">{scan.labels.map((l,i) => <li className={"scan-label "+l.kind} key={i}>
          <span className="kind">{l.kind}</span><strong>{l.title}</strong><small>{l.detail}</small></li>)}</ul>
      </>}
  </section>;
}
