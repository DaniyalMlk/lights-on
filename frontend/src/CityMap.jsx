import { useEffect, useRef, useState } from "react";
import { LngLatBounds, Map as MapLibreMap, Marker, setWorkerUrl } from "maplibre-gl";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";

// Let Vite bundle MapLibre's web worker so it works in dev and in the production build
setWorkerUrl(workerUrl);

// OpenFreeMap needs no API key (CARTO's free tiles now answer "API KEY REQUIRED"). We drop its text labels,
// because the towers carry our own, and dim it so only our towers carry light. Without wifi: a plain background.
const BASEMAP_URL = "https://tiles.openfreemap.org/styles/dark";
const NIGHT = "#0c0e11";
const OFFLINE_STYLE = {
  version: 8,
  sources: {},
  layers: [{ id: "background", type: "background", paint: { "background-color": NIGHT } }],
};

// Basemap colors by layer id: a quiet city at night, so the lit towers are the brightest thing on screen
const DIM = {
  background: { "background-color": NIGHT },
  water: { "fill-color": "#0d1319" },
  waterway: { "line-color": "#0d1319" },
  landuse_residential: { "fill-color": "#0e1013" },
  landcover_wood: { "fill-color": "#0f1316" },
  landuse_park: { "fill-color": "#0f1316" },
  building: { "fill-color": "#13161a" },
  highway_minor: { "line-color": "#15181c" },
  highway_major_casing: { "line-color": "#1b1f24" },
  highway_major_inner: { "line-color": "#171a1f" },
  highway_major_subtle: { "line-color": "#171a1f" },
  highway_motorway_casing: { "line-color": "#20252b" },
  highway_motorway_inner: { "line-color": "#262c33" },
  highway_motorway_subtle: { "line-color": "#191d22" },
  railway: { "line-color": "#191c20" },
  railway_transit: { "line-color": "#191c20" },
  railway_minor: { "line-color": "#191c20" },
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

// Tower color: lit (clears the financial screen) > dark glass (doesn't yet) > dimmed (filtered out).
// The selected tower is a shade brighter so it reads against its neighbours.
function towerColor(selectedId) {
  const selected = ["==", ["get", "id"], selectedId ?? ""];
  return [
    "case",
    ["boolean", ["get", "map_only"], false], "#1b1f24",
    ["boolean", ["get", "gated_out"], false], ["case", selected, "#4a525c", "#1d2228"],
    ["boolean", ["get", "lit"], false], ["case", selected, "#ffd47e", "#eeb04a"],
    ["case", selected, "#8a95a3", "#3a434e"],
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

export default function CityMap({ data, selectedId, onSelect }) {
  const container = useRef(null);
  const map = useRef(null);
  const [ready, setReady] = useState(false);
  const latestData = useRef(data);
  latestData.current = data;

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
        addBuildings(instance, latestData.current, onSelect);
        setReady(true);
      });
    });
    return () => {
      cancelled = true;
      instance?.remove();
      map.current = null;
    };
  }, []);

  // Recolor when a slider changes; lit towers also light their labels
  useEffect(() => {
    const instance = map.current;
    if (!ready || !instance) return;
    instance.getSource("buildings")?.setData(data);
    instance.getSource("glow")?.setData(glowPoints(data));
    const lit = new Set(data.features.filter(f => f.properties.lit).map(f => f.properties.id));
    for (const label of instance.getContainer().querySelectorAll(".building-label"))
      label.dataset.lit = String(lit.has(label.dataset.id));
  }, [data, ready]);

  // Fly to the selected building once the towers are on the map
  useEffect(() => {
    const instance = map.current;
    if (!ready || !instance) return;
    instance.setPaintProperty("buildings-3d", "fill-extrusion-color", towerColor(selectedId));
    for (const label of instance.getContainer().querySelectorAll(".building-label"))
      label.setAttribute("aria-pressed", String(label.dataset.id === selectedId));
    if (!selectedId) {
      fitAll(instance, latestData.current, 600);
      return;
    }
    const feature = latestData.current.features.find(f => f.properties.id === selectedId);
    if (!feature) return;
    const bounds = new LngLatBounds();
    for (const point of feature.geometry.coordinates[0]) bounds.extend(point);
    instance.flyTo({ center: bounds.getCenter(), zoom: 16.4, ...CAMERA, duration: 700 });
  }, [selectedId, ready]);

  return <div ref={container} className="map" />;
}

function fitAll(map, data, duration) {
  const bounds = new LngLatBounds();
  for (const feature of data.features)
    if (!feature.properties.map_only)
      for (const point of feature.geometry.coordinates[0]) bounds.extend(point);
  if (!bounds.isEmpty())
    map.fitBounds(bounds, { padding: { top: 70, bottom: 210, left: 40, right: 40 }, maxZoom: 16.4, ...CAMERA, duration });
}

// Our towers go on top of the basemap: height from the data, color from the verdict
function addBuildings(map, data, onSelect) {
  map.addSource("glow", { type: "geojson", data: glowPoints(data) });
  map.addLayer({
    id: "glow",
    type: "circle",
    source: "glow",
    paint: {
      "circle-color": LAMP,
      "circle-blur": 1,
      "circle-opacity": 0.42,
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
      "fill-extrusion-color": towerColor(null),
      "fill-extrusion-opacity": 0.96,
      "fill-extrusion-vertical-gradient": true,
    },
  });
  map.on("click", "buildings-3d", (e) => onSelect(e.features[0].properties.id));
  map.on("mouseenter", "buildings-3d", () => (map.getCanvas().style.cursor = "pointer"));
  map.on("mouseleave", "buildings-3d", () => (map.getCanvas().style.cursor = ""));

  for (const [index, { geometry, properties }] of data.features.entries()) {
    const footprint = new LngLatBounds();
    for (const position of geometry.coordinates[0]) footprint.extend(position);
    const label = document.createElement("button");
    label.type = "button";
    label.dataset.id = properties.id;
    label.dataset.lit = String(Boolean(properties.lit));
    label.className = "building-label";
    label.textContent = String(index + 1);
    label.title = properties.name + (properties.indicative ? " · indicative" : "");
    label.setAttribute("aria-label", label.title);
    label.onclick = () => onSelect(properties.id);
    new Marker({ element: label, anchor: "top", offset: [0, 6] })
      .setLngLat(footprint.getCenter()).addTo(map);
  }
  fitAll(map, data, 0);
}
