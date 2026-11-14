from fastapi.testclient import TestClient

from backend.main import app

client = TestClient(app)


def test_health():
    assert client.get("/api/health").json()["status"] == "ok"


def test_buildings_geojson():
    data = client.get("/api/buildings").json()
    assert data["type"] == "FeatureCollection" and len(data["features"]) >= 1
    props = data["features"][0]["properties"]
    for key in ("id", "homes", "score", "verdict", "height_ft"):
        assert key in props


def test_detail_svg_and_verify():
    bid = client.get("/api/buildings").json()["features"][0]["properties"]["id"]
    detail = client.get(f"/api/buildings/{bid}").json()
    assert {"geometry", "econ", "carbon", "score"} <= detail.keys()
    assert client.get(f"/api/buildings/{bid}/plate.svg").text.startswith("<svg")

    homes = detail["geometry"]["by_depth"]["36"]["homes"]
    ok = client.post("/api/verify", json={"building_id": bid, "text": f"This tower fits {homes} homes."}).json()
    assert ok["status"] == "success"
    bad = client.post("/api/verify", json={"building_id": bid, "text": f"This tower fits {homes + 137} homes."}).json()
    assert bad["status"] == "error"


def test_unknown_building_is_404():
    assert client.get("/api/buildings/NOPE").status_code == 404


def test_coordinate_only_feature_is_indicative_and_has_no_analysis(monkeypatch):
    from backend import main

    monkeypatch.setattr(main, "MAP_ONLY", [{"id": "map-test", "lat": 29.75, "lon": -95.36}])
    features = client.get("/api/buildings").json()["features"]
    feature = next(f for f in features if f["properties"]["id"] == "map-test")
    assert feature["properties"]["map_only"] and feature["properties"]["indicative"]
    ring = feature["geometry"]["coordinates"][0]
    assert len(ring) == 5 and ring[0] == ring[-1]
    assert "homes" not in feature["properties"]
    assert client.get("/api/buildings/map-test").status_code == 404


def test_depth_specific_plates(monkeypatch, tmp_path):
    import json
    from backend import main, pipeline
    sample = json.loads(main.SAMPLE_FILE.read_text())["buildings"][0]
    bid = sample["id"]
    monkeypatch.setattr(main, "BUILDINGS", {bid: sample})
    monkeypatch.setattr(main, "WORK_DIR", tmp_path)
    monkeypatch.setattr(pipeline, "WORK_DIR", tmp_path)
    path = f"/api/buildings/{bid}/plate.svg"
    plates = [client.get(path, params={"depth": depth}) for depth in (30, 36, 42)]
    assert all(r.status_code == 200 and r.text.startswith("<svg") for r in plates)
    from backend.pipeline import WORK_DIR
    for response, depth in zip(plates, (30, 36, 42)):
        assert response.content == (WORK_DIR / bid / f"plate_{depth}.svg").read_bytes()
    assert plates[0].content != plates[1].content
    assert client.get(path).content == plates[1].content
    assert client.get(path, params={"depth": 31}).status_code == 422
