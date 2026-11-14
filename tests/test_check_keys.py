import zipfile

from scripts import check_keys


def test_check_kit_prints_csv_headers(tmp_path, monkeypatch, capsys):
    kit = tmp_path / "kit.zip"
    with zipfile.ZipFile(kit, "w") as z:
        z.writestr("records.csv", "﻿col_a,col_b\n1,2\n")
    monkeypatch.setenv("COSTAR_KIT_ZIP", str(kit))
    check_keys.check_kit()
    assert "columns: col_a,col_b" in capsys.readouterr().out


def test_check_kit_says_where_to_put_a_missing_kit(tmp_path, monkeypatch, capsys):
    monkeypatch.setenv("COSTAR_KIT_ZIP", str(tmp_path / "nope.zip"))
    check_keys.check_kit()
    assert "not found" in capsys.readouterr().out
