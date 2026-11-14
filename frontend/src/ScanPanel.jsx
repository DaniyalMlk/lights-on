import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { verifiedConversion } from "./calibration.js";

// Tag colors in the tour, by how we know the fact
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

// The Matterport tour, opened large over the map, with our labels placed inside it as tags.
// focus = {index, n}: fly the tour to that label (n changes on every click, so the same label can be clicked twice).
function Tour({scan, sdkKey, focus, onPlaced, onClose}) {
  const frame = useRef(null);
  const tags = useRef(null);                       // {sdk, ids} once the labels are in the tour
  const [status,setStatus] = useState("Opening the 3D tour…");
  useEffect(() => {
    let active = true;
    // The tour can take a while to load on conference wifi: say so, but keep waiting
    const slow = setTimeout(() => { if (active && !tags.current) setStatus("Still loading the tour. The floor labels are in the panel meanwhile."); }, 20000);
    async function connect() {
      try {
        const api = await loadSdk(sdkKey);
        if (!active) return;
        const sdk = await api.connect(frame.current,sdkKey);
        // Tags can only be added once the tour is playing
        await sdk.App.state.waitUntil(state => state.phase === sdk.App.Phase.PLAYING);
        const model = await sdk.Model.getData();
        const sweeps = new Map(model.sweeps.map(s => [s.uuid ?? s.id,s.position]));
        const ids = await sdk.Sweep.Conversion.createIdMap();
        for (const [current, legacy] of Object.entries(ids)) {
          const position = sweeps.get(current) ?? sweeps.get(legacy);
          if (position) { sweeps.set(current,position); sweeps.set(legacy,position); }
        }
        // Our positions are in the Model API frame; the tour uses the SDK frame. We only place labels if the
        // conversion puts every saved scan position on top of the tour's own (within 10 cm).
        const place = verifiedConversion(scan.panos ?? [], sweeps,
          p => sdk.Conversion.basisChange(p, sdk.Conversion.TransformType.Coordinates.TO_SDK));
        if (!active) return;
        if (!place) { setStatus("3D placement unavailable: scan positions did not match. The floor labels are in the panel."); return; }
        const placed = await sdk.Mattertag.add(scan.labels.map(label => {
          const [r,g,b] = colors[label.kind];
          return {label: label.kind + " · " + label.title, description: label.detail,
            anchorPosition:place(label.position),stemVector:{x:0,y:0.15,z:0},color:{r,g,b}};
        }));
        if (!active) return;
        tags.current = {sdk, ids: placed};
        setStatus(`${placed.length} labels placed by matching ${scan.panos?.length ?? 0} scan positions. Click a label in the panel to fly to it.`);
        onPlaced(true);
      } catch {
        if (active) setStatus("3D placement unavailable. The floor labels are in the panel.");
      } finally { clearTimeout(slow); }
    }
    const node = frame.current;
    node.addEventListener("load",connect);
    return () => { active=false; clearTimeout(slow); node.removeEventListener("load",connect); onPlaced(false); };
  }, [scan,sdkKey]);

  useEffect(() => {
    if (!focus || !tags.current) return;
    const {sdk, ids} = tags.current;
    try { sdk.Mattertag.navigateToTag(ids[focus.index], sdk.Mattertag.Transition.FLY).catch(() => {}); } catch { /* tour closed */ }
  }, [focus]);

  // title=0 keeps Matterport's own caption (which names the floor area) off the screen
  const query = new URLSearchParams({m:scan.model_id,play:"1",title:"0",qs:"1",applicationKey:sdkKey});
  const root = document.getElementById("tour-root");
  if (!root) return null;
  return createPortal(<div className="tour">
    <iframe ref={frame} title="Matterport floor tour" allowFullScreen src={"https://my.matterport.com/show/?"+query}/>
    <div className="tour-bar">
      <button className="pill" onClick={onClose}>Close tour<span className="pill-icon" aria-hidden="true">×</span></button>
      <p role="status">{status}</p>
    </div>
  </div>, root);
}

export default function ScanPanel({building}) {
  const [scan,setScan] = useState(null);
  const [key,setKey] = useState("");
  const [open,setOpen] = useState(false);
  const [placed,setPlaced] = useState(false);
  const [focus,setFocus] = useState(null);
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
  if (!scan?.labels?.length) return null;          // no full-floor scan: the geometry line above already says so
  const canFly = open && placed;
  return <section className="block scan">
    <header className="scan-head">
      <div>
        <h3>Labeled in 3D, automatically</h3>
        <p className="fine">Lights On measured this scanned floor and put {scan.labels.length} labels inside the 3D tour.
          Each one says how we know it.</p>
      </div>
      {key && <button className="pill" onClick={() => { setOpen(!open); setFocus(null); }}>
        {open ? "Close tour" : "Open 3D tour"}<span className="pill-icon" aria-hidden="true">{open ? "×" : "↗"}</span></button>}
    </header>
    {!key && <p className="fine">Tour unavailable. The saved floor labels are below.</p>}
    {open && <Tour scan={scan} sdkKey={key} focus={focus} onPlaced={setPlaced} onClose={() => setOpen(false)}/>}
    <ul className="scan-labels">{scan.labels.map((l,i) => <li key={i}>
      <button className={"scan-label "+l.kind} disabled={!canFly} aria-pressed={canFly && focus?.index === i}
              title={canFly ? "Fly to this label in the tour" : undefined}
              onClick={() => setFocus({index:i, n:(focus?.n ?? 0)+1})}>
        <span className="kind">{l.kind}</span><strong>{l.title}</strong><small>{l.detail}</small></button></li>)}</ul>
  </section>;
}
