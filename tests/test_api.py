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
