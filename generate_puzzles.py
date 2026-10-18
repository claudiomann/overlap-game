import json
import os
import random
import re
import urllib.request
from datetime import date, datetime, timedelta

USER_AGENT = "OverlapDailyGameBot/1.0 (https://github.com/overlap-game; contact@example.com)"
PUZZLES_FILE = "puzzles.json"
TARGET_FUTURE_BUFFER_DAYS = 7


def fetch_onthisday(month: int, day: int) -> dict:
    url = f"https://en.wikipedia.org/api/rest_v1/feed/onthisday/all/{month:02d}/{day:02d}"
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=15) as response:
        return json.loads(response.read().decode("utf-8"))


def clean_event_text(text: str) -> str:
    cleaned = re.sub(r"\b(1[5-9]\d\d|20[0-2]\d)\b", "[year]", text)
    return cleaned.strip()


def extract_anchors_from_feed(data: dict) -> list:
    anchors = []
    for b in data.get("births", []):
        birth_year = b.get("year")
        if not birth_year or birth_year < 1750 or birth_year > 1935:
            continue

        pages = b.get("pages", [])
        if not pages:
            continue

        main_page = pages[0]
        extract = main_page.get("extract", "")
        text = b.get("text", "")

        death_match = re.search(r"\((?:d\.|died)\s*(1[89]\d\d|20[0-2]\d)\)", text)
        if not death_match:
            span_match = re.search(rf"{birth_year}\s*[–-]\s*[^)]*?(1[89]\d\d|20[0-2]\d)", extract)
            if span_match:
                death_year = int(span_match.group(1))
            else:
                continue
        else:
            death_year = int(death_match.group(1))

        lifespan = death_year - birth_year
        if lifespan < 35 or lifespan > 105:
            continue

        description = main_page.get("description") or (text.split(",")[1].strip() if "," in text else "Historical figure")
        description = re.sub(r"\((?:d\.|died).*?\)", "", description).strip()
        name = main_page.get("titles", {}).get("normalized") or text.split(",")[0].strip()

        anchors.append({
            "name": name,
            "description": description[:120],
            "birth": birth_year,
            "death": death_year,
            "score": len(extract)
        })

    anchors.sort(key=lambda x: x["score"], reverse=True)
    return anchors


def extract_events_from_feed(data: dict) -> list:
    events = []
    for ev in data.get("events", []):
        year = ev.get("year")
        text = ev.get("text", "").strip()
        pages = ev.get("pages", [])

        if not year or year < 1700 or year > 2025:
            continue
        if len(text) < 35 or len(text) > 145:
            continue
        if re.search(r"\b(1[7-9]\d\d|20[0-2]\d)\b", text):
            continue

        score = len(pages[0].get("extract", "")) if pages else 0
        events.append({
            "text": clean_event_text(text),
            "year": year,
            "score": score
        })

    return events


def load_existing_puzzles() -> list:
    if not os.path.exists(PUZZLES_FILE):
        return []
    try:
        with open(PUZZLES_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return []


def update_puzzle_buffer():
    existing_puzzles = load_existing_puzzles()
    today = date.today()

    if existing_puzzles:
        last_id = max(p["id"] for p in existing_puzzles)
        last_date = max(date.fromisoformat(p["date"]) for p in existing_puzzles)
        used_anchors = {p["anchor"]["name"] for p in existing_puzzles}
    else:
        last_id = 0
        last_date = today - timedelta(days=1)
        used_anchors = set()

    days_ahead = (last_date - today).days
    needed_days = TARGET_FUTURE_BUFFER_DAYS - max(0, days_ahead)

    if needed_days <= 0:
        print(f"Buffer già completo ({days_ahead} giorni futuri presenti). Nessuna generazione necessaria.")
        return

    print(f"Generazione di {needed_days} nuovi puzzle per coprire i prossimi giorni...")

    all_anchors = []
    all_events = []
    sampled_days = random.sample(range(1, 365), 8)
    base_date = datetime(2024, 1, 1)

    for offset in sampled_days:
        dt = base_date + timedelta(days=offset)
        try:
            feed = fetch_onthisday(dt.month, dt.day)
            all_anchors.extend(extract_anchors_from_feed(feed))
            all_events.extend(extract_events_from_feed(feed))
        except Exception as exc:
            print(f"Avviso: salto data {dt.month}/{dt.day} ({exc})")

    unique_anchors = {a["name"]: a for a in all_anchors}.values()
    sorted_anchors = sorted(unique_anchors, key=lambda x: x["score"], reverse=True)

    unique_events = {e["text"]: e for e in all_events}.values()
    sorted_events = sorted(unique_events, key=lambda x: x["score"], reverse=True)

    added_count = 0
    next_date = max(last_date + timedelta(days=1), today)

    for anchor in sorted_anchors:
        if added_count >= needed_days:
            break
        if anchor["name"] in used_anchors:
            continue

        b_year = anchor["birth"]
        d_year = anchor["death"]

        overlaps = [e for e in sorted_events if b_year <= e["year"] <= d_year]
        early_anach = [e for e in sorted_events if (b_year - 35) <= e["year"] < b_year]
        late_anach = [e for e in sorted_events if d_year < e["year"] <= (d_year + 35)]

        if len(overlaps) >= 5 and len(early_anach) >= 2 and len(late_anach) >= 2:
            chosen_overlaps = random.sample(overlaps[:15], 5)
            chosen_early = random.sample(early_anach[:10], 2)
            chosen_late = random.sample(late_anach[:10], 2)

            cards = []
            idx = 1
            for item in chosen_overlaps:
                cards.append({
                    "id": f"c{idx}",
                    "text": item["text"],
                    "year": item["year"],
                    "overlaps": True
                })
                idx += 1

            for item in chosen_early + chosen_late:
                cards.append({
                    "id": f"c{idx}",
                    "text": item["text"],
                    "year": item["year"],
                    "overlaps": False
                })
                idx += 1

            last_id += 1
            puzzle_date = (next_date + timedelta(days=added_count)).isoformat()

            existing_puzzles.append({
                "id": last_id,
                "date": puzzle_date,
                "anchor": {
                    "name": anchor["name"],
                    "description": anchor["description"],
                    "birth": b_year,
                    "death": d_year
                },
                "cards": cards
            })
            used_anchors.add(anchor["name"])
            added_count += 1

    with open(PUZZLES_FILE, "w", encoding="utf-8") as f:
        json.dump(existing_puzzles, f, indent=2, ensure_ascii=False)

    print(f"Aggiunti {added_count} nuovi puzzle! Totale in archivio: {len(existing_puzzles)}.")


if __name__ == "__main__":
    update_puzzle_buffer()