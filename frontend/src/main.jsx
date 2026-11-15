import { createRoot } from "react-dom/client";
import "maplibre-gl/dist/maplibre-gl.css";
import "./styles.css";
import { lazy, Suspense } from "react";
const App = lazy(() => import("./App.jsx"));

import Landing from "./Landing.jsx";

const query = new URLSearchParams(location.search);
const explorer = location.pathname === "/map" || ["view","tab","demo"].some(key => query.has(key));
createRoot(document.getElementById("root")).render(explorer ? <Suspense fallback={null}><App /></Suspense> : <Landing />);
