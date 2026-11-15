import { createRoot } from "react-dom/client";
import { lazy, Suspense } from "react";
import "maplibre-gl/dist/maplibre-gl.css";
import "./styles.css";
import App from "./App.jsx";

// The map is the app and stays at "/". The introduction lives at /about (or /?about), loaded only when asked for.
const Landing = lazy(() => import("./Landing.jsx"));
const about = location.pathname === "/about" || new URLSearchParams(location.search).has("about");

createRoot(document.getElementById("root")).render(about ? <Suspense fallback={null}><Landing /></Suspense> : <App />);
