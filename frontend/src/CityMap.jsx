import { useEffect, useRef, useState } from "react";
import { AttributionControl, LngLatBounds, Map as MapLibreMap, Marker, setWorkerUrl } from "maplibre-gl";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import { bestTurn, planDuration, planFeatures, planOutline } from "./plan3d.js";

// Let Vite bundle MapLibre's web worker so it works in dev and in the production build
setWorkerUrl(workerUrl);

// OpenFreeMap needs no API key (CARTO's free tiles now answer "API KEY REQUIRED"). We drop its text labels,
// because the towers carry our own. Without wifi: a plain background, and our towers still draw.
const BASEMAP_URL = "https://tiles.openfreemap.org/styles/dark";
const NIGHT = "#141c2b";
const OFFLINE_STYLE = {
  version: 8,
  sources: {},
  layers: [{ id: "background", type: "background", paint: { "background-color": NIGHT } }],
};

// Basemap colors by layer id: downtown at blue hour, the moment the lights come on. Deep blue rather than
// black keeps the screen from feeling heavy, and the warm towers are still the brightest thing on it.
const DIM = {
  background: { "background-color": NIGHT },
  water: { "fill-color": "#0f1724" },
  waterway: { "line-color": "#0f1724" },
  landuse_residential: { "fill-color": "#151e2e" },
  landcover_wood: { "fill-color": "#152131" },
  landuse_park: { "fill-color": "#152131" },
  building: { "fill-color": "#1a2436" },
  highway_minor: { "line-color": "#1c2739" },
  highway_major_casing: { "line-color": "#232f47" },
  highway_major_inner: { "line-color": "#1f2c43" },
  highway_major_subtle: { "line-color": "#1f2c43" },
  highway_motorway_casing: { "line-color": "#293752" },
  highway_motorway_inner: { "line-color": "#314265" },
  highway_motorway_subtle: { "line-color": "#212d46" },
  railway: { "line-color": "#1e283a" },
  railway_transit: { "line-color": "#1e283a" },
  railway_minor: { "line-color": "#1e283a" },
  railway_dashline: { "line-color": "#273246" },
  railway_transit_dashline: { "line-color": "#273246" },
  railway_minor_dashline: { "line-color": "#273246" },
  road_pier: { "line-color": NIGHT },
  road_area_pier: { "fill-color": NIGHT },
  "aeroway-area": { "fill-color": "#172030" },
  "aeroway-runway": { "line-color": "#172030" },
};

async function loadNightStyle() {
  try {
    const res = await fetch(BASEMAP_URL, { signal: AbortSignal.timeout(4000) });
    if (res.ok) {
      const style = await res.json();
      style.layers = style.layers.filter((layer) => layer.type !== "symbol");
      for (const layer of style.layers) {
        if (DIM[layer.id]) layer.paint = { ...layer.paint, ...DIM[layer.id] };
      }
      return style;
    }
  } catch {
    // offline or blocked: use the plain background
  }
  return OFFLINE_STYLE;
}

const FEET_TO_M = 0.3048;
const LAMP = "#f4bf5f";
const RISE_MS = 900;          // the lights climb a tower in under a second
const FALL_MS = 350;          // and go out faster
const ORBIT_DEG_PER_S = 9;    // one full turn in 40 seconds
const CAMERA = { pitch: 60, bearing: -24 };
const MAX_PITCH = 78;
const ROOF_M = 1;              // thickness of the plain roof slab on each tower; the floor plan stands on it
const TILT_ZOOM = 0.7;         // the fit is worked out for a flat map; tilted, the towers take less height, so we go closer
const HOUSTON = [[-95.75, 29.5], [-95.0, 30.0]];   // the view never leaves the city

// Window textures for the towers. One 16 x 16 tile holds four windows; a lit tower has most of them on,
// a dark tower has one faint one, so the city reads as "offices at night" rather than grey boxes.
const WINDOWS = {
  "win-lit":     { wall: "#4a3616", panes: ["#f6c461", "#ffd98c", "#6b5124", "#eaa944"] },
  "win-lit-hi":  { wall: "#5c441c", panes: ["#ffd27a", "#ffe4ad", "#94733a", "#ffc458"] },
  "win-dark":    { wall: "#34425e", panes: ["#4b5d80", "#4b5d80", "#7c6943", "#4b5d80"] },
  "win-dark-hi": { wall: "#4a5c82", panes: ["#7388b0", "#7388b0", "#a38d5d", "#7388b0"] },
  "win-off":     { wall: "#222c3e", panes: ["#2a3549", "#2a3549", "#2a3549", "#2a3549"] },
};

function windowImage({ wall, panes }) {
  const scale = 2, size = 16 * scale;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = wall;
  ctx.fillRect(0, 0, size, size);
  panes.forEach((color, i) => {
    ctx.fillStyle = color;
    ctx.fillRect((2 + (i % 2) * 8) * scale, (2 + Math.floor(i / 2) * 8) * scale, 5 * scale, 5 * scale);
  });
  return { image: ctx.getImageData(0, 0, size, size), pixelRatio: scale };
}

const easeOut = (t) => 1 - (1 - t) ** 3;

function frame(data, progress, activeIds, shaped) {
  return {
    type: "FeatureCollection",
    features: data.features.map((f) => {
      const p = f.properties;
      const h = (p.height_ft ?? 0) * FEET_TO_M;
      const active = activeIds.includes(p.id);
      return {
        type: "Feature",
        geometry: shaped?.id === p.id ? shaped.geometry : f.geometry,   // the selected tower stands under its own floor
        properties: {
          id: p.id,
          h,
          lit_h: h * easeOut(progress.get(p.id) ?? 0),
          dark: p.gated_out || p.map_only ? (active ? "win-dark" : "win-off") : active ? "win-dark-hi" : "win-dark",
          lit: active ? "win-lit-hi" : "win-lit",
        },
      };
    }),
  };
}

function center(feature) {
  const box = new LngLatBounds();
  for (const point of feature.geometry.coordinates[0]) box.extend(point);
  return box.getCenter();
}

// One point per tower with its lights on: a pool of light on the street that grows with the lights
function glowPoints(data, progress) {
  return {
    type: "FeatureCollection",
    features: data.features.filter(f => (progress.get(f.properties.id) ?? 0) > 0).map(f => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: center(f).toArray() },
      properties: { p: easeOut(progress.get(f.properties.id)) },
    })),
  };
}

// --- Camera ---------------------------------------------------------------------------------------------
// MapLibre aims its camera at a point on the street. A tower's typical floor is drawn on its roof, so we often
// want to look at a point up in the air. The trick: aim at the street point that lies behind the roof on the
// same line of sight, and stand further back by the extra distance. A "view" below is what we look at:
// { focus: {lng, lat}, height (metres above the street), metersPerPixel (at the focus), pitch, bearing }.
const RAD = Math.PI / 180;
const metersPerPixelAt = (zoom, lat) => (40075016 * Math.cos(lat * RAD)) / (512 * 2 ** zoom);

// How far behind the focus the street point lies (metres east and north), and how many extra metres per pixel
// the longer distance costs. The camera sits 1.5 screen heights from what it aims at (MapLibre's field of view).
function sightLine(map, height, pitch, bearing) {
  const back = height * Math.tan(pitch * RAD);
  return { east: back * Math.sin(bearing * RAD), north: back * Math.cos(bearing * RAD),
           extra: height / Math.cos(pitch * RAD) / (1.5 * map.getContainer().clientHeight) };
}

function aimAt(map, { focus, height, metersPerPixel, pitch, bearing }) {
  const line = sightLine(map, height, pitch, bearing);
  const perLon = 111320 * Math.cos(focus.lat * RAD);
  map.jumpTo({ center: [focus.lng + line.east / perLon, focus.lat + line.north / 110540], pitch, bearing,
               zoom: Math.log2(metersPerPixelAt(0, focus.lat) / (metersPerPixel + line.extra)) });
}

// The reverse: what the camera is looking at right now, at this height
function viewAt(map, height) {
  const center = map.getCenter(), pitch = map.getPitch(), bearing = map.getBearing();
  const line = sightLine(map, height, pitch, bearing);
  const perLon = 111320 * Math.cos(center.lat * RAD);
  return { focus: { lng: center.lng - line.east / perLon, lat: center.lat - line.north / 110540 }, height, pitch, bearing,
           metersPerPixel: Math.max(0.03, metersPerPixelAt(map.getZoom(), center.lat) - line.extra) };
}

// Dragging and scrolling are ours, so they can work at roof height (height() is how high the camera is aiming).
// Drag: in "move" mode it slides the map, like any map; in "turn" mode it turns the view around its middle,
// like a 3D model in your hand (left-right spins, up-down tilts). Shift + drag or right-drag does the other
// one; a finger always moves. Scroll: on the street MapLibre zooms towards the pointer; up at a roof we zoom
// towards the middle of the view, because MapLibre can only zoom towards the street behind it.
function takeOverGestures(map, mode, height, onGrab) {
  const surface = map.getCanvasContainer();
  let drag = null;
  surface.addEventListener("contextmenu", (e) => e.preventDefault());
  surface.addEventListener("pointerdown", (e) => {
    if (!e.isPrimary || e.target.closest(".pin")) return;
    const other = e.button === 2 || e.shiftKey;
    drag = { x: e.clientX, y: e.clientY, move: e.pointerType !== "mouse" || (mode() === "move") !== other };
    try { surface.setPointerCapture(e.pointerId); } catch { /* the drag still works inside the map */ }
    onGrab();
  });
  surface.addEventListener("pointermove", (e) => {
    if (!drag || !e.isPrimary) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    drag.x = e.clientX;
    drag.y = e.clientY;
    const view = viewAt(map, height());
    if (!drag.move) {
      aimAt(map, { ...view, bearing: view.bearing + dx * 0.5, pitch: Math.max(0, Math.min(MAX_PITCH, view.pitch - dy * 0.35)) });
      return;
    }
    // One pixel sideways is metersPerPixel; one pixel up the screen reaches further, the flatter we look
    const b = view.bearing * RAD, side = dx * view.metersPerPixel;
    const ahead = (dy * view.metersPerPixel) / Math.max(0.25, Math.cos(view.pitch * RAD));
    const perLon = 111320 * Math.cos(view.focus.lat * RAD);
    aimAt(map, { ...view, focus: { lng: view.focus.lng + (ahead * Math.sin(b) - side * Math.cos(b)) / perLon,
                                   lat: view.focus.lat + (ahead * Math.cos(b) + side * Math.sin(b)) / 110540 } });
  });
  const release = (e) => { if (e.isPrimary) drag = null; };
  surface.addEventListener("pointerup", release);
  surface.addEventListener("pointercancel", release);
  // Listening on the way down (capture) lets us keep the scroll from MapLibre's own zoom when we handle it
  map.getContainer().addEventListener("wheel", (e) => {
    if (!height() || !surface.contains(e.target)) return;
    e.preventDefault();
    e.stopPropagation();
    onGrab();
    // A mouse wheel notch, a two-finger scroll and a pinch report very different numbers
    const levels = -e.deltaY * (e.deltaMode === 1 ? 0.06 : e.ctrlKey ? 0.012 : 0.0035);
    const view = viewAt(map, height());
    aimAt(map, { ...view, metersPerPixel: Math.max(0.04, Math.min(30, view.metersPerPixel / 2 ** Math.max(-0.6, Math.min(0.6, levels)))) });
  }, { capture: true, passive: false });
}

// The view for one tower: it looks at the roof, where the typical floor is drawn, from close enough that the
// floor fills a little under half of the map that the side panel leaves visible.
function towerView(map, feature, rightInset) {
  const box = new LngLatBounds();
  for (const point of feature.geometry.coordinates[0]) box.extend(point);
  const at = box.getCenter();
  const span = Math.max((box.getEast() - box.getWest()) * 111320 * Math.cos(at.lat * RAD), (box.getNorth() - box.getSouth()) * 110540);
  const metersPerPixel = span / (0.46 * (map.getContainer().clientWidth - rightInset));
  return { focus: { lng: at.lng, lat: at.lat }, height: (feature.properties.height_ft ?? 0) * FEET_TO_M, pitch: 52,
           metersPerPixel: Math.max(metersPerPixelAt(19.4, at.lat), Math.min(metersPerPixelAt(16.8, at.lat), metersPerPixel)) };
}

export default function CityMap({ data, preview = false, pair, selectedId, hoveredId, rightInset, bottomInset, mode, plate, marks, focus,
                                  onSelect, onHover, onGrab, onMode, onMark }) {
  const container = useRef(null);
  const map = useRef(null);
  const pins = useRef(new Map());
  const progress = useRef(new Map());
  const [previewFailed, setPreviewFailed] = useState(false);
  const [ready, setReady] = useState(false);
  const [orbiting, setOrbiting] = useState(false);
  const flying = useRef(false);
  const gliding = useRef(0);                       // the running camera move, see glide
  const shaped = useRef(null);                     // {id, geometry}: the selected tower redrawn to its floor's outline
  const aim = useRef(0);                           // how high above the street the camera is aiming, metres
  const latest = useRef({});
  const planClock = useRef({ plate: null, plateAt: 0, marks: null, marksAt: 0 });
  latest.current = { data, preview, mode, onSelect, onHover, onGrab, onMark, rightInset, bottomInset,
                     active: [selectedId, hoveredId].filter(Boolean) };

  // Move the camera to a new view, step by step (MapLibre's own flyTo only knows views at street level)
  function glide(to, ms) {
    const instance = map.current;
    if (!instance || !to) return;
    halt();
    instance.stop();
    const from = viewAt(instance, aim.current);
    const turn = ((to.bearing - from.bearing + 540) % 360) - 180;          // the short way round
    const start = performance.now();
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) ms = 0;
    flying.current = true;
    function step(now) {
      const t = ms ? Math.min(1, (now - start) / ms) : 1;
      const k = t * t * (3 - 2 * t);                                       // ease in and out
      const mix = (a, b) => a + (b - a) * k;
      aim.current = mix(from.height, to.height);
      aimAt(instance, { focus: { lng: mix(from.focus.lng, to.focus.lng), lat: mix(from.focus.lat, to.focus.lat) }, height: aim.current,
                        metersPerPixel: from.metersPerPixel * (to.metersPerPixel / from.metersPerPixel) ** k,
                        pitch: mix(from.pitch, to.pitch), bearing: from.bearing + turn * k });
      if (t < 1) gliding.current = requestAnimationFrame(step);
      else flying.current = false;
    }
    gliding.current = requestAnimationFrame(step);
  }
  // Someone grabbed the map: whatever camera move was running stops where it is
  function halt() {
    cancelAnimationFrame(gliding.current);
    flying.current = false;
  }

  function paint() {
    const instance = map.current;
    if (!instance) return;
    const { data, active } = latest.current;
    instance.getSource("buildings")?.setData(frame(data, progress.current, active, shaped.current));
    instance.getSource("glow")?.setData(glowPoints(data, progress.current));
  }

  // Create the map once, after we know which basemap style we can load
  useEffect(() => {
    let instance = null;
    let cancelled = false;
    loadNightStyle().then((style) => {
      if (cancelled) return;
      instance = new MapLibreMap({
        container: container.current,
        style,
        center: preview ? [-95.3665, 29.7585] : [-95.366, 29.757],
        interactive: !preview,
        zoom: preview ? 15.25 : 15,
        maxPitch: MAX_PITCH,
        minZoom: 11.5,
        maxBounds: HOUSTON,
        dragRotate: false,
        ...CAMERA,
        attributionControl: false,
      });
      instance.dragPan.disable();                        // dragging is ours: see takeOverGestures
      instance.scrollZoom.setWheelZoomRate(1 / 160);     // mouse wheel: about three times the default speed
      instance.scrollZoom.setZoomRate(1 / 40);           // trackpad: about twice the default speed
      // MapLibre folds its credit line to the "i" button on the first drag; our drags are our own, so we do it
      const foldCredit = () => {
        const credit = instance.getContainer().querySelector(".maplibregl-ctrl-attrib");
        credit?.removeAttribute("open");
        credit?.classList.remove("maplibregl-compact-show");
      };
      if (!preview) takeOverGestures(instance, () => latest.current.mode, () => aim.current,
                       () => { halt(); setOrbiting(false); foldCredit(); latest.current.onGrab?.(); });
      if (!preview) instance.addControl(new AttributionControl({ compact: true }), "top-right");   // the dock owns the bottom edge
      map.current = instance;
      instance.once("load", () => {
        try {
          instance.setSky({ "sky-color": "#1b2947", "horizon-color": "#4a4670", "fog-color": "#182236",
                            "sky-horizon-blend": 0.7, "horizon-fog-blend": 0.6, "fog-ground-blend": 0.6 });
        } catch { /* older renderer: no sky, same map */ }
        if (preview) instance.on("webglcontextlost", () => setPreviewFailed(true));
        addLayers(instance, latest, pins.current);
        // Grabbing the map takes over from the automatic orbit
        for (const event of ["mousedown", "touchstart", "wheel"]) instance.on(event, () => { halt(); setOrbiting(false); });
        setReady(true);
      });
    }).catch(error => {
      if (preview && !cancelled) setPreviewFailed(true);
      else if (!cancelled) console.error(error);
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(gliding.current);
      instance?.remove();
      map.current = null;
      pins.current.clear();
    };
  }, []);

  // The side panel floats over the map, so the camera aims at the middle of what is left visible
  useEffect(() => {
    const instance = map.current;
    if (!ready || !instance) return;
    if (preview) return;
    instance.setPadding({ top: 0, bottom: 0, left: 0, right: rightInset });
    if (!latest.current.active.length) glide(overview(instance, latest.current), 0);
  }, [rightInset, bottomInset, ready]);

  // Lights climb a tower when it starts to pay, and go out when it stops. Pins follow at once:
  // lit towers get a full pin with their home count, the rest a small dot (Airbnb's two tiers).
  useEffect(() => {
    const instance = map.current;
    if (!ready || !instance) return;
    for (const { properties: p } of data.features) {
      const pin = pins.current.get(p.id);
      if (!pin) continue;
      pin.dataset.lit = String(Boolean(p.lit));
      pin.dataset.off = String(Boolean(p.gated_out || p.map_only));
    }
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let request = 0;
    let last = performance.now();
    function tick(now) {
      const dt = Math.min(50, now - last);
      last = now;
      let moving = false;
      for (const { properties: p } of latest.current.data.features) {
        const target = p.lit ? 1 : 0;
        const at = progress.current.get(p.id) ?? 0;
        if (at === target) continue;
        const next = still ? target : target ? Math.min(1, at + dt / RISE_MS) : Math.max(0, at - dt / FALL_MS);
        progress.current.set(p.id, next);
        if (next !== target) moving = true;
      }
      paint();
      if (moving) request = requestAnimationFrame(tick);
    }
    request = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(request);
  }, [data, ready]);

  // Hover and selection: brighter windows, and a pin that shows the name
  useEffect(() => {
    if (!ready) return;
    paint();
    map.current.setFilter("compare-cap", ["in", ["get", "id"], ["literal", (pair ?? []).filter(Boolean)]]);
    for (const [id, pin] of pins.current) {
      const active = id === selectedId || id === hoveredId;
      pin.dataset.active = String(active);
      const index = pair?.indexOf(id) ?? -1;
      if (index >= 0) pin.dataset.slot = index === 0 ? "A" : "B";
      else delete pin.dataset.slot;
      pin.setAttribute("aria-pressed", String(id === selectedId || index >= 0));
      pin.style.zIndex = index >= 0 ? "4" : active ? "3" : pin.dataset.lit === "true" ? "2" : "1";
    }
  }, [selectedId, hoveredId, pair, ready]);

  // Fly to the selected tower in a slow arc, or back out to all of downtown
  useEffect(() => {
    const instance = map.current;
    if (!ready || !instance) return;
    if (preview) return;
    if (!selectedId) {
      setOrbiting(false);
      glide(overview(instance, latest.current), 1000);
      return;
    }
    const feature = latest.current.data.features.find(f => f.properties.id === selectedId);
    if (feature) glide({ ...towerView(instance, feature, latest.current.rightInset), bearing: instance.getBearing() + 35 }, 1700);
  }, [selectedId, ready]);

  // With a tower selected, the city around it fades back so nothing stands in front of it
  useEffect(() => {
    const instance = map.current;
    if (ready && instance?.getLayer("context-3d"))
      instance.setPaintProperty("context-3d", "fill-extrusion-opacity", selectedId ? 0.25 : 0.92);
  }, [selectedId, ready]);

  // The selected tower's typical floor on its roof: apartments rise one by one, then a beacon for each label
  useEffect(() => {
    const instance = map.current;
    if (!ready || !instance) return;
    const feature = plate?.id === selectedId ? data.features.find(f => f.properties.id === selectedId) : null;
    if (!feature) {
      planClock.current = { plate: null, plateAt: 0, marks: null, marksAt: 0 };
      instance.getSource("plan")?.setData({ type: "FeatureCollection", features: [] });
      shaped.current = null;
      paint();
      return;
    }
    // Each thing rises once: the floor when it (or its unit depth) changes, the beacons when the labels arrive
    const clock = planClock.current;
    const now = performance.now();
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (clock.plate !== plate.key) { clock.plate = plate.key; clock.plateAt = now; }
    const labelled = marks.length ? plate.id : null;
    if (clock.marks !== labelled) { clock.marks = labelled; clock.marksAt = now; }

    const origin = center(feature);
    const scene = { plate, marks, focus: focus?.index ?? null, origin, turn: bestTurn(plate, feature.geometry.coordinates[0], origin),
                    roof: (feature.properties.height_ft ?? 0) * FEET_TO_M + ROOF_M };
    // A scanned floor can have another shape than the outline the tower was drawn with: redraw the tower under it
    const outline = planOutline(plate, origin, scene.turn);
    shaped.current = outline ? { id: plate.id, geometry: outline } : null;
    paint();
    const lasts = planDuration(plate);
    const source = instance.getSource("plan");
    if (still) { source?.setData(planFeatures(scene, Infinity, Infinity, 0)); return; }
    let request = 0;
    function tick(t) {
      source?.setData(planFeatures(scene, t - clock.plateAt, t - clock.marksAt, t));
      // Beacons keep breathing while they are shown; without labels the loop ends when the floor has risen
      if (marks.length || t < clock.plateAt + lasts.plate) request = requestAnimationFrame(tick);
    }
    request = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(request);
  }, [plate, marks, focus, selectedId, ready]);

  // Orbit: turn slowly around the middle of the view until someone grabs the map or presses the button again
  useEffect(() => {
    const instance = map.current;
    if (!ready || !instance || !orbiting) return;
    let request = 0;
    let last = performance.now();
    function turn(now) {
      if (!flying.current) {
        const view = viewAt(instance, aim.current);
        aimAt(instance, { ...view, bearing: view.bearing + ((now - last) / 1000) * ORBIT_DEG_PER_S });
      }
      last = now;
      request = requestAnimationFrame(turn);
    }
    request = requestAnimationFrame(turn);
    return () => cancelAnimationFrame(request);
  }, [orbiting, ready]);

  function zoomBy(step) {
    const instance = map.current;
    if (!instance) return;
    const view = viewAt(instance, aim.current);
    glide({ ...view, metersPerPixel: view.metersPerPixel / 2 ** step }, 220);
  }

  function resetCamera() {
    const instance = map.current;
    if (!instance) return;
    setOrbiting(false);
    const feature = latest.current.data.features.find(f => f.properties.id === selectedId);
    glide(feature ? { ...towerView(instance, feature, latest.current.rightInset), bearing: CAMERA.bearing }
                  : overview(instance, latest.current), 900);
  }

  if (preview) return <div ref={container} className="map hero-live-map" style={{opacity: ready && !previewFailed ? 1 : 0}} />;
  return <>
    <div ref={container} className="map" />
    {!ready && <p className="map-loading" role="status">Loading downtown Houston…</p>}
    {ready && <div className="map-tools" role="group" aria-label="Map view">
      <div className="drag-mode" role="group" aria-label="What dragging does">
        <button aria-pressed={mode === "move"} onClick={() => onMode("move")} title="Dragging moves the map. Shift + drag turns it.">Move</button>
        <button aria-pressed={mode === "turn"} onClick={() => onMode("turn")} title="Dragging turns the view, like a 3D model. Shift + drag moves it.">Turn</button>
      </div>
      <button className="orbit" aria-pressed={orbiting} onClick={() => setOrbiting(!orbiting)}
              title="Turn slowly around the view by itself. Or just drag the map to turn it yourself.">
        <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3.5 10a6.5 6.5 0 1 1 2.2 4.9" /><path d="M3 15.5v-3.4h3.4" /></svg>
        {orbiting ? "Stop" : "360°"}
      </button>
      <button onClick={() => zoomBy(1)} aria-label="Zoom in" title="Zoom in">
        <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 4.5v11M4.5 10h11" /></svg></button>
      <button onClick={() => zoomBy(-1)} aria-label="Zoom out" title="Zoom out">
        <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4.5 10h11" /></svg></button>
      <button onClick={resetCamera} aria-label="Reset the view" title="Reset the view">
        <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 3.5l3 8-3-1.6-3 1.6z" /><path d="M10 12.5v4" /></svg></button>
    </div>}
  </>;
}

// The view that shows all our towers, clear of the scenario card at the bottom (the panel on the right is map padding)
function overview(map, { data, bottomInset }) {
  const bounds = new LngLatBounds();
  for (const feature of data.features)
    if (!feature.properties.map_only)
      for (const point of feature.geometry.coordinates[0]) bounds.extend(point);
  const fit = bounds.isEmpty() ? null
    : map.cameraForBounds(bounds, { padding: { top: 70, bottom: bottomInset || 150, left: 24, right: 24 }, maxZoom: 16.4, bearing: CAMERA.bearing });
  return fit ? { focus: { lng: fit.center.lng, lat: fit.center.lat }, height: 0,
                 metersPerPixel: metersPerPixelAt(fit.zoom + TILT_ZOOM, fit.center.lat), ...CAMERA } : null;
}

// Everything we draw on top of the basemap: the rest of downtown in 3D, then our towers and their pins
function addLayers(map, latest, pins) {
  const { data } = latest.current;
  for (const [name, spec] of Object.entries(WINDOWS)) {
    const { image, pixelRatio } = windowImage(spec);
    if (!map.hasImage(name)) map.addImage(name, image, { pixelRatio });
  }

  // The city around our towers, from OpenStreetMap heights (public data, not CoStar). Buildings that sit on
  // one of our footprints are left out, because our own tower is drawn there.
  const tiles = Object.entries(map.getStyle().sources).find(([, source]) => source.type === "vector")?.[0];
  if (tiles) {
    const context = {
      id: "context-3d", type: "fill-extrusion", source: tiles, "source-layer": "building", minzoom: 12.5,
      paint: {
        "fill-extrusion-color": "#1f2a40",
        "fill-extrusion-height": ["coalesce", ["get", "render_height"], 6],
        "fill-extrusion-base": ["coalesce", ["get", "render_min_height"], 0],
        "fill-extrusion-opacity": 0.92,
        "fill-extrusion-vertical-gradient": true,
      },
    };
    const ours = { type: "FeatureCollection", features: data.features.map(f => ({ type: "Feature", geometry: f.geometry, properties: {} })) };
    try {
      map.addLayer({ ...context, filter: [">", ["distance", ours], 10] });
    } catch {
      if (!map.getLayer("context-3d")) map.addLayer(context);
    }
  }

  map.addSource("glow", { type: "geojson", data: glowPoints(data, new Map()) });
  map.addLayer({
    id: "glow", type: "circle", source: "glow",
    paint: {
      "circle-color": LAMP,
      "circle-blur": 1,
      "circle-opacity": ["*", 0.5, ["get", "p"]],
      "circle-pitch-alignment": "map",
      "circle-radius": ["interpolate", ["exponential", 2], ["zoom"], 13, 14, 17, 170],
    },
  });

  map.addSource("buildings", { type: "geojson", data: frame(data, new Map(), []) });
  map.addLayer({
    id: "towers-dark", type: "fill-extrusion", source: "buildings",
    filter: ["<", ["get", "lit_h"], ["get", "h"]],
    paint: {
      "fill-extrusion-height": ["get", "h"],
      "fill-extrusion-base": ["get", "lit_h"],
      "fill-extrusion-pattern": ["get", "dark"],
      "fill-extrusion-opacity": 1,
    },
  });
  map.addLayer({
    id: "towers-lit", type: "fill-extrusion", source: "buildings",
    filter: [">", ["get", "lit_h"], 0],
    paint: {
      "fill-extrusion-height": ["get", "lit_h"],
      "fill-extrusion-pattern": ["get", "lit"],
      "fill-extrusion-opacity": 1,
    },
  });
  // A plain roof: without it the window pattern would run across the top of every tower
  map.addLayer({
    id: "towers-roof", type: "fill-extrusion", source: "buildings",
    paint: {
      "fill-extrusion-base": ["get", "h"],
      "fill-extrusion-height": ["+", ["get", "h"], ROOF_M],
      "fill-extrusion-color": "#1c2740",
      "fill-extrusion-opacity": 1,
      "fill-extrusion-vertical-gradient": false,
    },
  });

  // The two towers being compared get a lamp-colored cap on the roof, so they can be told apart from above
  map.addLayer({
    id: "compare-cap", type: "fill-extrusion", source: "buildings",
    filter: ["in", ["get", "id"], ["literal", []]],
    paint: {
      "fill-extrusion-base": ["+", ["get", "h"], ROOF_M],
      "fill-extrusion-height": ["+", ["get", "h"], ROOF_M + 4],
      "fill-extrusion-color": "#f4bf5f",
      "fill-extrusion-opacity": 1,
      "fill-extrusion-vertical-gradient": false,
    },
  });

  map.addSource("plan", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
  map.addLayer({
    id: "plan-3d", type: "fill-extrusion", source: "plan",
    paint: {
      "fill-extrusion-color": ["get", "color"],
      "fill-extrusion-base": ["get", "base"],
      "fill-extrusion-height": ["get", "top"],
      "fill-extrusion-opacity": 1,
      "fill-extrusion-vertical-gradient": false,
    },
  });
  if (latest.current.preview) return;
  // A label's beacon can be clicked: the panel opens that label, and the 3D tour flies to it if it is open
  const markUnder = (e) => e.features.find(f => f.properties.mark != null)?.properties.mark;
  map.on("click", "plan-3d", (e) => { const mark = markUnder(e); if (mark != null) latest.current.onMark?.(mark); });
  map.on("mousemove", "plan-3d", (e) => { if (markUnder(e) != null) map.getCanvas().style.cursor = "pointer"; });
  map.on("mouseleave", "plan-3d", () => { map.getCanvas().style.cursor = ""; });

  map.on("click", ["towers-dark", "towers-lit"], e => latest.current.onSelect(e.features[0].properties.id));
  for (const layer of ["towers-dark", "towers-lit"]) {
    map.on("mousemove", layer, (e) => {
      map.getCanvas().style.cursor = "pointer";
      latest.current.onHover(e.features[0].properties.id);
    });
    map.on("mouseleave", layer, () => {
      map.getCanvas().style.cursor = "";
      latest.current.onHover(null);
    });
  }

  for (const feature of data.features) {
    const p = feature.properties;
    const pin = document.createElement("button");
    pin.type = "button";
    pin.className = "pin";
    pin.dataset.id = p.id;
    pin.dataset.lit = String(Boolean(p.lit));
    pin.dataset.off = String(Boolean(p.gated_out || p.map_only));
    pin.dataset.active = "false";
    pin.setAttribute("aria-label", `${p.name}${p.homes != null ? `, ${p.homes} homes at 36 ft` : ""}`);
    const name = document.createElement("span");
    name.className = "pin-name";
    name.textContent = p.name;
    const homes = document.createElement("span");
    homes.className = "pin-homes";
    homes.textContent = p.homes == null ? "" : `${p.homes.toLocaleString()} homes`;
    pin.append(name, homes);
    pin.onclick = event => {
      event.stopPropagation();
      latest.current.onSelect(p.id);
    };
    pin.onmouseenter = () => latest.current.onHover(p.id);
    pin.onmouseleave = () => latest.current.onHover(null);
    new Marker({ element: pin, anchor: "top", offset: [0, 8] }).setLngLat(center(feature)).addTo(map);
    pins.set(p.id, pin);
  }
}
