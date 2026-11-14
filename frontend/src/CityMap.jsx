import { useEffect, useRef, useState } from "react";
import { LngLatBounds, Map as MapLibreMap, Marker, setWorkerUrl } from "maplibre-gl";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";

// Let Vite bundle MapLibre's web worker so it works in dev and in the production build
setWorkerUrl(workerUrl);

// OpenFreeMap needs no API key (CARTO's free tiles now answer "API KEY REQUIRED"). We drop its text labels,
// because the towers carry our own, and tint it to the night palette. Without wifi: a plain background.
const BASEMAP_URL = "https://tiles.openfreemap.org/styles/dark";
const NIGHT_BACKGROUND = "#141d27";
const OFFLINE_STYLE = {
  version: 8,
  sources: {},
  layers: [{ id: "background", type: "background", paint: { "background-color": NIGHT_BACKGROUND } }],
};

async function loadNightStyle() {
  try {
    const res = await fetch(BASEMAP_URL, { signal: AbortSignal.timeout(4000) });
    if (res.ok) {
      const style = await res.json();
      style.layers = style.layers.filter((layer) => layer.type !== "symbol");
      for (const layer of style.layers) {
        if (layer.type === "background") layer.paint = { ...layer.paint, "background-color": NIGHT_BACKGROUND };
      }
      return style;
    }
  } catch {
    // offline or blocked: use the plain background
  }
  return OFFLINE_STYLE;
}

const FEET_TO_M = 0.3048;

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
        pitch: 55,
        bearing: -20,
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

  // Recolor when the slider changes
  useEffect(() => {
    const source = map.current?.getSource("buildings");
    if (source) source.setData(data);
  }, [data]);

  // Fly to the selected building once the towers are on the map
  useEffect(() => {
    const instance = map.current;
    if (!selectedId || !ready || !instance) return;
    const labels = instance.getContainer().querySelectorAll(".building-label");
    for (const label of labels) label.setAttribute("aria-pressed", String(label.dataset.id === selectedId));
    const feature = latestData.current.features.find(f => f.properties.id === selectedId);
    if (!feature) return;
    const bounds = new LngLatBounds();
    for (const point of feature.geometry.coordinates[0]) bounds.extend(point);
    instance.flyTo({ center: bounds.getCenter(), zoom: 17, duration: 550 });
  }, [selectedId, ready]);

  return <div ref={container} className="map" />;
}

// Our towers go on top of the basemap: height from the data, color from the verdict
function addBuildings(map, data, onSelect) {
  map.addSource("buildings", { type: "geojson", data });
  map.addLayer({
    id: "buildings-3d",
    type: "fill-extrusion",
    source: "buildings",
    paint: {
      "fill-extrusion-height": ["*", ["get", "height_ft"], FEET_TO_M],
      "fill-extrusion-color": [
        "case",
        ["boolean", ["get", "map_only"], false], "#8794a7",
        ["get", "gated_out"], "#9aa0a6",
        ["get", "lit"], "#ffc857",
        "#526786",
      ],
      "fill-extrusion-opacity": 0.9,
    },
  });
  map.on("click", "buildings-3d", (e) => onSelect(e.features[0].properties.id));
  map.on("mouseenter", "buildings-3d", () => (map.getCanvas().style.cursor = "pointer"));
  map.on("mouseleave", "buildings-3d", () => (map.getCanvas().style.cursor = ""));

  const bounds = new LngLatBounds();
  for (const { geometry, properties } of data.features) {
    const footprint = new LngLatBounds();
    for (const position of geometry.coordinates[0]) footprint.extend(position);
    bounds.extend(footprint);
    const label = document.createElement("button");
    label.type = "button";
    label.dataset.id = properties.id;
    label.className = "building-label";
    label.textContent = properties.name + (properties.indicative ? " · indicative" : "");
    label.onclick = () => onSelect(properties.id);
    new Marker({ element: label, anchor: "top", offset: [0, 4] })
      .setLngLat(footprint.getCenter()).addTo(map);
  }
  if (!bounds.isEmpty()) {
    map.fitBounds(bounds, { padding: 120, maxZoom: 17, pitch: 55, bearing: -20, duration: 0 });
  }
}
