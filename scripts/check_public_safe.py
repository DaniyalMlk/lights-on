"""Before the repo goes public: search every commit for anything that must stay private.

    python -m scripts.check_public_safe

It looks through the whole git history (every branch, every version of every file) for:
  - the values of our keys, tokens and passwords in .env (not plain settings like file paths)
  - CoStar's field names (from data/costar_kit_map.json)
  - Matterport model ids (from data/raw/models_index.csv)
It prints what kind of thing it found and in which commit, never the secret itself.
"""
import csv
import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def history() -> list[tuple[str, str]]:
    """(commit, added line) for every line ever added on any branch."""
    log = subprocess.run(["git", "log", "-p", "--all", "--no-color", "--format=COMMIT %h"],
                         cwd=ROOT, capture_output=True, text=True, check=True).stdout
    commit, lines = "", []
    for line in log.splitlines():
        if line.startswith("COMMIT "):
            commit = line.split()[1]
        elif line.startswith("+") and not line.startswith("+++"):
            lines.append((commit, line[1:]))
    return lines


def env_secrets() -> dict:
    path = ROOT / ".env"
    if not path.exists():
        return {}
    secrets = {}
    for line in path.read_text().splitlines():
        name, _, value = line.partition("=")
        is_secret = any(word in name.upper() for word in ("KEY", "TOKEN", "PASSWORD", "SECRET"))
        if is_secret and len(value.strip()) >= 8 and not name.startswith("#"):
            secrets[value.strip()] = f".env value of {name.strip()}"
    return secrets


def costar_field_names() -> dict:
    """Distinctive field names only (camelCase, 10+ letters): words like 'id' or 'year' would match everywhere."""
    path = ROOT / "data" / "costar_kit_map.json"
    if not path.exists():
        return {}
    names = set()

    def walk(value):
        if isinstance(value, dict):
            for v in value.values():
                walk(v)
        elif isinstance(value, str):
            names.update(part for part in value.split(".") if len(part) >= 10 and re.search(r"[a-z][A-Z]", part))

    walk(json.loads(path.read_text()))
    return {name: "CoStar field name" for name in names}


def matterport_ids() -> set:
    path = ROOT / "data" / "raw" / "models_index.csv"
    if not path.exists():
        return set()
    with path.open(newline="", encoding="utf-8-sig") as f:
        return {row["sid"].strip() for row in csv.DictReader(f) if row.get("sid")}


def main() -> None:
    patterns = {**env_secrets(), **costar_field_names()}
    ids = matterport_ids()
    if not patterns and not ids:
        sys.exit("Nothing to check against: run this on a laptop that has .env and data/.")

    found = []
    for commit, line in history():
        for secret, kind in patterns.items():
            if secret in line:
                found.append((commit, kind))
        for token in re.findall(r"\b[0-9A-Za-z]{11}\b", line):
            if token in ids:
                found.append((commit, "Matterport model id"))

    print(f"Checked {len(patterns)} secrets and field names, {len(ids):,} model ids, across all history.")
    if not found:
        print("Clean: nothing private found. Safe to make the repo public.")
        return
    for commit, kind in sorted(set(found)):
        print(f"  FOUND {kind} in commit {commit}")
    sys.exit("Not safe to go public. Fix the history first (ask Daniyal).")


if __name__ == "__main__":
    main()
