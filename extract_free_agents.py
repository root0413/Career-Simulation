"""
Extract free-agent players from male_players.csv.

Filters out players already in teams_output.json (the 140 real teams).
Outputs free_agents_output.json with a diverse pool of unattached players.
"""

import csv
import json
import random
import math
from pathlib import Path

# ── Config ───────────────────────────────────────────────────
CSV_PATH = Path(__file__).parent / "male_players.csv"
TEAMS_JSON = Path(__file__).parent / "teams_output.json"
OUTPUT = Path(__file__).parent / "free_agents_output.json"

MAX_PLAYERS = 500        # cap the free-agent pool
MIN_OVR = 65             # only decent players
SAMPLE_SEED = 42

# ── Position mapping ─────────────────────────────────────────
POS_MAP = {
    "ST": "FWD", "LW": "FWD", "RW": "FWD", "CF": "FWD",
    "CDM": "MID", "CAM": "MID", "CM": "MID", "LM": "MID", "RM": "MID",
    "CB": "DEF", "LB": "DEF", "RB": "DEF", "LWB": "DEF", "RWB": "DEF",
    "GK": "GK",
}


def clamp(v, lo, hi):
    return max(lo, min(hi, v))


def generate_stats(pos: str, ovr: int):
    """Position-aware attack / defence / stamina."""
    base = ovr
    r = lambda n, v: clamp(n + random.randint(-v, v), 1, 99)
    if pos == "GK":
        return r(14, 4), r(base + 5, 4), r(base - 5, 6)
    elif pos == "DEF":
        return r(base - 20, 8), r(base + 5, 4), r(base - 3, 6)
    elif pos == "MID":
        return r(base, 5), r(base - 5, 5), r(base + 2, 5)
    else:  # FWD
        return r(base + 5, 5), r(base - 30, 8), r(base - 5, 6)


def generate_potential(age: int, ovr: int) -> int:
    if age >= 29:
        return clamp(ovr + random.randint(0, 2), ovr, 99)
    if age >= 26:
        return clamp(random.randint(ovr, min(99, ovr + 6)), 55, 99)
    return clamp(ovr + random.randint(5, 20), ovr, 99)


def calc_value(ovr: int) -> int:
    return round(100_000 * 10 ** ((ovr - 50) / 20))


# ── Load existing team names ─────────────────────────────────
def load_existing_team_names() -> set[str]:
    if not TEAMS_JSON.exists():
        return set()
    with open(TEAMS_JSON, encoding="utf-8") as f:
        data = json.load(f)
    return {t["name"].lower().strip() for t in data}


# ── Main extraction ──────────────────────────────────────────
def main():
    random.seed(SAMPLE_SEED)
    existing = load_existing_team_names()
    print(f"Loaded {len(existing)} existing team names from teams_output.json")

    free_agents = []
    with open(CSV_PATH, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            name = (row.get("Name") or "").strip()
            team = (row.get("Team") or "").strip()
            league = (row.get("League") or "").strip()
            pos_raw = (row.get("Position") or "").strip()
            ovr_str = (row.get("OVR") or "").strip()
            age_str = (row.get("Age") or "").strip()

            if not name or not ovr_str or not pos_raw:
                continue

            try:
                ovr = int(ovr_str)
                age = int(age_str) if age_str else 25
            except ValueError:
                continue

            if ovr < MIN_OVR:
                continue

            # Skip players already in a real team
            if team.lower() in existing:
                continue

            pos = POS_MAP.get(pos_raw, "MID")
            att, def_, sta = generate_stats(pos, ovr)
            pot = generate_potential(age, ovr)
            val = calc_value(ovr)

            free_agents.append({
                "id": f"fa-{len(free_agents):04d}",
                "name": name,
                "age": age,
                "position": pos,
                "attack": att,
                "defense": def_,
                "stamina": sta,
                "injuryWeeks": 0,
                "potential": pot,
                "overall": ovr,
                "value": val,
                "_source_team": team,
                "_source_league": league,
            })

    print(f"Found {len(free_agents)} eligible free agents (OVR ≥ {MIN_OVR})")

    # Sample down to MAX_PLAYERS with position diversity
    if len(free_agents) > MAX_PLAYERS:
        # Stratified sampling: keep proportional position mix
        by_pos = {}
        for p in free_agents:
            by_pos.setdefault(p["position"], []).append(p)
        sampled = []
        for pos, group in by_pos.items():
            n = max(10, int(MAX_PLAYERS * len(group) / len(free_agents)))
            sampled.extend(random.sample(group, min(n, len(group))))
        free_agents = sampled[:MAX_PLAYERS]
        random.shuffle(free_agents)

    # Strip internal fields
    for p in free_agents:
        del p["_source_team"]
        del p["_source_league"]

    with open(OUTPUT, "w", encoding="utf-8") as f:
        json.dump(free_agents, f, ensure_ascii=False, indent=2)

    print(f"Done: {len(free_agents)} free agents -> {OUTPUT}")


if __name__ == "__main__":
    main()
