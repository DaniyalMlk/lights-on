import { useEffect, useRef, useState } from "react";
import { AttributionControl, LngLatBounds, Map as MapLibreMap, Marker, setWorkerUrl } from "maplibre-gl";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";

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

// What the map draws this frame. Each tower is two stacked pieces: a lit part from the ground up to lit_h,
// and a dark part above it. progress (0..1 per tower) is how far up the lights have climbed.
function frame(data, progress, activeIds) {
  return {
    type: "FeatureCollection",
    features: data.features.map((f) => {
      const p = f.properties;
      const h = (p.height_ft ?? 0) * FEET_TO_M;
      const active = activeIds.includes(p.id);
      return {
        type: "Feature",
        geometry: f.geometry,
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

export default function CityMap({ data, selectedId, hoveredId, rightInset, bottomInset, onSelect, onHover }) {
  const container = useRef(null);
  const map = useRef(null);
  const pins = useRef(new Map());
  const progress = useRef(new Map());
  const [ready, setReady] = useState(false);
  const [orbiting, setOrbiting] = useState(false);
  const flying = useRef(false);
  const latest = useRef({});
  latest.current = { data, onSelect, onHover, bottomInset, active: [selectedId, hoveredId].filter(Boolean) };

  function paint() {
    const instance = map.current;
    if (!instance) return;
    const { data, active } = latest.current;
    instance.getSource("buildings")?.setData(frame(data, progress.current, active));
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
        center: [-95.366, 29.757],
        zoom: 15,
        maxPitch: 78,
        ...CAMERA,
        attributionControl: false,
      });
      instance.addControl(new AttributionControl({ compact: true }), "top-right");   // the dock owns the bottom edge
      map.current = instance;
      instance.once("load", () => {
        try {
          instance.setSky({ "sky-color": "#1b2947", "horizon-color": "#4a4670", "fog-color": "#182236",
                            "sky-horizon-blend": 0.7, "horizon-fog-blend": 0.6, "fog-ground-blend": 0.6 });
        } catch { /* older renderer: no sky, same map */ }
        addLayers(instance, latest, pins.current);
        // Grabbing the map takes over from the automatic orbit
        for (const event of ["mousedown", "touchstart", "wheel"]) instance.on(event, () => setOrbiting(false));
        setReady(true);
      });
    });
    return () => {
      cancelled = true;
      instance?.remove();
      map.current = null;
      pins.current.clear();
    };
  }, []);

  // The side panel floats over the map, so the camera aims at the middle of what is left visible
  useEffect(() => {
    const instance = map.current;
    if (!ready || !instance) return;
    instance.setPadding({ top: 0, bottom: 0, left: 0, right: rightInset });
    if (!latest.current.active.length) fitAll(instance, latest.current, 0);
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
    for (const [id, pin] of pins.current) {
      const active = id === selectedId || id === hoveredId;
      pin.dataset.active = String(active);
      pin.setAttribute("aria-pressed", String(id === selectedId));
      pin.style.zIndex = active ? "3" : pin.dataset.lit === "true" ? "2" : "1";
    }
  }, [selectedId, hoveredId, ready]);

  // Fly to the selected tower in a slow arc, or back out to all of downtown
  useEffect(() => {
    const instance = map.current;
    if (!ready || !instance) return;
    flying.current = true;
    instance.once("moveend", () => { flying.current = false; });
    if (!selectedId) {
      setOrbiting(false);
      fitAll(instance, latest.current, 900);
      return;
    }
    const feature = latest.current.data.features.find(f => f.properties.id === selectedId);
    if (!feature) return;
    instance.flyTo({ center: center(feature), zoom: 16.4, pitch: 64, bearing: instance.getBearing() + 35,
                     duration: 1800, essential: true });
  }, [selectedId, ready]);

  // Orbit: turn slowly around the middle of the view until someone grabs the map or presses the button again
  useEffect(() => {
    const instance = map.current;
    if (!ready || !instance || !orbiting) return;
    let request = 0;
    let last = performance.now();
    function turn(now) {
      if (!flying.current) instance.setBearing(instance.getBearing() + ((now - last) / 1000) * ORBIT_DEG_PER_S);
      last = now;
      request = requestAnimationFrame(turn);
    }
    request = requestAnimationFrame(turn);
    return () => cancelAnimationFrame(request);
  }, [orbiting, ready]);

  function resetCamera() {
    const instance = map.current;
    if (!instance) return;
    setOrbiting(false);
    const feature = latest.current.data.features.find(f => f.properties.id === selectedId);
    if (feature) instance.flyTo({ center: center(feature), zoom: 16.4, pitch: 64, bearing: CAMERA.bearing, duration: 900 });
    else fitAll(instance, latest.current, 900);
  }

  return <>
    <div ref={container} className="map" />
    {!ready && <p className="map-loading" role="status">Loading downtown Houston…</p>}
    {ready && <div className="map-tools" role="group" aria-label="Map view">
      <button className="orbit" aria-pressed={orbiting} onClick={() => setOrbiting(!orbiting)}
              title="Turn slowly around the view. Ctrl + drag (or right-drag) to look around yourself.">
        <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3.5 10a6.5 6.5 0 1 1 2.2 4.9" /><path d="M3 15.5v-3.4h3.4" /></svg>
        {orbiting ? "Stop" : "360°"}
      </button>
      <button onClick={() => map.current?.zoomIn()} aria-label="Zoom in" title="Zoom in">
        <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 4.5v11M4.5 10h11" /></svg></button>
      <button onClick={() => map.current?.zoomOut()} aria-label="Zoom out" title="Zoom out">
        <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4.5 10h11" /></svg></button>
      <button onClick={resetCamera} aria-label="Reset the view" title="Reset the view">
        <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 3.5l3 8-3-1.6-3 1.6z" /><path d="M10 12.5v4" /></svg></button>
    </div>}
  </>;
}

// All our towers in view, clear of the scenario card at the bottom (the panel on the right is map padding)
function fitAll(map, { data, bottomInset }, duration) {
  const bounds = new LngLatBounds();
  for (const feature of data.features)
    if (!feature.properties.map_only)
      for (const point of feature.geometry.coordinates[0]) bounds.extend(point);
  if (!bounds.isEmpty())
    map.fitBounds(bounds, { padding: { top: 70, bottom: bottomInset || 150, left: 24, right: 24 }, maxZoom: 16.4, ...CAMERA, duration });
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
  for (const layer of ["towers-dark", "towers-lit"]) {
    map.on("click", layer, (e) => latest.current.onSelect(e.features[0].properties.id));
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
    pin.onclick = () => latest.current.onSelect(p.id);
    pin.onmouseenter = () => latest.current.onHover(p.id);
    pin.onmouseleave = () => latest.current.onHover(null);
    new Marker({ element: pin, anchor: "top", offset: [0, 8] }).setLngLat(center(feature)).addTo(map);
    pins.set(p.id, pin);
  }
}
