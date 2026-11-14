import { useEffect, useRef, useState } from "react";
import { LngLatBounds, Map as MapLibreMap, Marker, setWorkerUrl } from "maplibre-gl";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";

// Let Vite bundle MapLibre's web worker so it works in dev and in the production build
setWorkerUrl(workerUrl);

// OpenFreeMap needs no API key (CARTO's free tiles now answer "API KEY REQUIRED"). We drop its text labels,
// because the towers carry our own, and dim it so only our towers carry light. Without wifi: a plain background.
const BASEMAP_URL = "https://tiles.openfreemap.org/styles/dark";
const NIGHT = "#172030";
const OFFLINE_STYLE = {
  version: 8,
  sources: {},
  layers: [{ id: "background", type: "background", paint: { "background-color": NIGHT } }],
};

// Basemap colors by layer id: downtown at blue hour, the moment the lights come on. Deep blue rather than
// black keeps the screen light, and the warm towers are still the brightest thing on it.
const DIM = {
  background: { "background-color": NIGHT },
  water: { "fill-color": "#111a29" },
  waterway: { "line-color": "#111a29" },
  landuse_residential: { "fill-color": "#18212f" },
  landcover_wood: { "fill-color": "#182433" },
  landuse_park: { "fill-color": "#182433" },
  building: { "fill-color": "#1e2839" },
  highway_minor: { "line-color": "#1f2a3b" },
  highway_major_casing: { "line-color": "#26324a" },
  highway_major_inner: { "line-color": "#223047" },
  highway_major_subtle: { "line-color": "#223047" },
  highway_motorway_casing: { "line-color": "#2c3a55" },
  highway_motorway_inner: { "line-color": "#34456a" },
  highway_motorway_subtle: { "line-color": "#24304a" },
  railway: { "line-color": "#212b3d" },
  railway_transit: { "line-color": "#212b3d" },
  railway_minor: { "line-color": "#212b3d" },
  railway_dashline: { "line-color": "#2a3549" },
  railway_transit_dashline: { "line-color": "#2a3549" },
  railway_minor_dashline: { "line-color": "#2a3549" },
  road_pier: { "line-color": NIGHT },
  road_area_pier: { "fill-color": NIGHT },
  aeroway_area: { "fill-color": "#1a2332" },
  "aeroway-area": { "fill-color": "#1a2332" },
  "aeroway-runway": { "line-color": "#1a2332" },
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

// Window textures for the towers. One 16 x 16 tile holds four windows; a lit tower has most of them on,
// a dark tower has one faint one, so the city reads as "offices at night" rather than grey boxes.
const WINDOWS = {
  "win-lit":     { wall: "#4a3616", panes: ["#f6c461", "#ffd98c", "#6b5124", "#eaa944"] },
  "win-lit-hi":  { wall: "#5c441c", panes: ["#ffd27a", "#ffe4ad", "#94733a", "#ffc458"] },
  "win-dark":    { wall: "#34425e", panes: ["#4b5d80", "#4b5d80", "#7c6943", "#4b5d80"] },
  "win-dark-hi": { wall: "#45567a", panes: ["#6b7fa6", "#6b7fa6", "#9a8558", "#6b7fa6"] },
  "win-off":     { wall: "#222c3e", panes: ["#2a3549", "#2a3549", "#2a3549", "#2a3549"] },
}

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

// Lit towers clear the financial screen; the hovered or selected one is a shade brighter
function towerPattern(activeIds) {
  const active = ["in", ["get", "id"], ["literal", activeIds.filter(Boolean)]];
  return [
    "case",
    ["boolean", ["get", "map_only"], false], "win-off",
    ["boolean", ["get", "gated_out"], false], ["case", active, "win-dark-hi", "win-off"],
    ["boolean", ["get", "lit"], false], ["case", active, "win-lit-hi", "win-lit"],
    ["case", active, "win-dark-hi", "win-dark"],
  ];
}

// One point per lit tower: a soft pool of light on the street around it
function glowPoints(data) {
  return {
    type: "FeatureCollection",
    features: data.features.filter(f => f.properties.lit).map(f => {
      const box = new LngLatBounds();
      for (const point of f.geometry.coordinates[0]) box.extend(point);
      return { type: "Feature", geometry: { type: "Point", coordinates: box.getCenter().toArray() }, properties: {} };
    }),
  };
}

const CAMERA = { pitch: 58, bearing: -24 };

export default function CityMap({ data, selectedId, hoveredId, onSelect, onHover }) {
  const container = useRef(null);
  const map = useRef(null);
  const pins = useRef(new Map());
  const [ready, setReady] = useState(false);
  const latestData = useRef(data);
  latestData.current = data;
  const handlers = useRef({ onSelect, onHover });
  handlers.current = { onSelect, onHover };

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
        ...CAMERA,
        attributionControl: { compact: true },
      });
      map.current = instance;
      instance.once("load", () => {
        try {
          instance.setSky({ "sky-color": "#1d2b4a", "horizon-color": "#3d3f63", "fog-color": "#1b2537",
                            "sky-horizon-blend": 0.6, "horizon-fog-blend": 0.5, "fog-ground-blend": 0.7 });
        } catch { /* older renderer: no sky, same map */ }
        addBuildings(instance, latestData.current, handlers, pins.current);
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

  // Recolor when a slider changes. Airbnb-style tiers: lit towers get a full pin with their home count,
  // the rest a mini-pin, so attention goes to the towers that work.
  useEffect(() => {
    const instance = map.current;
    if (!ready || !instance) return;
    instance.getSource("buildings")?.setData(data);
    instance.getSource("glow")?.setData(glowPoints(data));
    for (const { properties: p } of data.features) {
      const pin = pins.current.get(p.id);
      if (!pin) continue;
      pin.dataset.lit = String(Boolean(p.lit));
      pin.dataset.off = String(Boolean(p.gated_out || p.map_only));
    }
  }, [data, ready]);

  // Hover and selection: brighter windows, and a pin that shows the name
  useEffect(() => {
    const instance = map.current;
    if (!ready || !instance) return;
    instance.setPaintProperty("buildings-3d", "fill-extrusion-pattern", towerPattern([selectedId, hoveredId]));
    for (const [id, pin] of pins.current) {
      const active = id === selectedId || id === hoveredId;
      pin.dataset.active = String(active);
      pin.setAttribute("aria-pressed", String(id === selectedId));
      pin.style.zIndex = active ? "3" : pin.dataset.lit === "true" ? "2" : "1";
    }
  }, [selectedId, hoveredId, ready]);

  // Fly to the selected building, or back to all of downtown
  useEffect(() => {
    const instance = map.current;
    if (!ready || !instance) return;
    if (!selectedId) {
      fitAll(instance, latestData.current, 700);
      return;
    }
    const feature = latestData.current.features.find(f => f.properties.id === selectedId);
    if (!feature) return;
    const bounds = new LngLatBounds();
    for (const point of feature.geometry.coordinates[0]) bounds.extend(point);
    instance.flyTo({ center: bounds.getCenter(), zoom: 16.3, ...CAMERA, duration: 800, essential: true });
  }, [selectedId, ready]);

  return <div ref={container} className="map" />;
}

function fitAll(map, data, duration) {
  const bounds = new LngLatBounds();
  for (const feature of data.features)
    if (!feature.properties.map_only)
      for (const point of feature.geometry.coordinates[0]) bounds.extend(point);
  if (!bounds.isEmpty())
    map.fitBounds(bounds, { padding: { top: 80, bottom: 200, left: 40, right: 40 }, maxZoom: 16.4, ...CAMERA, duration });
}

// Our towers go on top of the basemap: height from the data, texture from the verdict
function addBuildings(map, data, handlers, pins) {
  for (const [name, spec] of Object.entries(WINDOWS)) {
    const { image, pixelRatio } = windowImage(spec);
    if (!map.hasImage(name)) map.addImage(name, image, { pixelRatio });
  }
  map.addSource("glow", { type: "geojson", data: glowPoints(data) });
  map.addLayer({
    id: "glow",
    type: "circle",
    source: "glow",
    paint: {
      "circle-color": LAMP,
      "circle-blur": 1,
      "circle-opacity": 0.45,
      "circle-pitch-alignment": "map",
      "circle-radius": ["interpolate", ["exponential", 2], ["zoom"], 13, 14, 17, 170],
    },
  });
  map.addSource("buildings", { type: "geojson", data });
  map.addLayer({
    id: "buildings-3d",
    type: "fill-extrusion",
    source: "buildings",
    paint: {
      "fill-extrusion-height": ["*", ["get", "height_ft"], FEET_TO_M],
      "fill-extrusion-pattern": towerPattern([]),
      "fill-extrusion-opacity": 1,
      "fill-extrusion-vertical-gradient": true,
    },
  });
  map.on("click", "buildings-3d", (e) => handlers.current.onSelect(e.features[0].properties.id));
  map.on("mousemove", "buildings-3d", (e) => {
    map.getCanvas().style.cursor = "pointer";
    handlers.current.onHover(e.features[0].properties.id);
  });
  map.on("mouseleave", "buildings-3d", () => {
    map.getCanvas().style.cursor = "";
    handlers.current.onHover(null);
  });

  for (const { geometry, properties: p } of data.features) {
    const footprint = new LngLatBounds();
    for (const position of geometry.coordinates[0]) footprint.extend(position);
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
    pin.onclick = () => handlers.current.onSelect(p.id);
    pin.onmouseenter = () => handlers.current.onHover(p.id);
    pin.onmouseleave = () => handlers.current.onHover(null);
    new Marker({ element: pin, anchor: "top", offset: [0, 8] }).setLngLat(footprint.getCenter()).addTo(map);
    pins.set(p.id, pin);
  }
  fitAll(map, data, 0);
}
