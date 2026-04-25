import glob
import json
import logging
import os
import re

INPUT_GLOB = "data/processed/*.json"
OUTPUT_PATH = "web/cocktails.json"

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
log = logging.getLogger(__name__)


def canonical_name(name: str) -> str:
    """Lowercase, strip leading 'the ', collapse whitespace."""
    name = name.lower().strip()
    name = re.sub(r"^the\s+", "", name)
    return re.sub(r"\s+", " ", name)


def completeness_score(record: dict) -> float:
    """
    Higher score = more complete data. Weights reflect how useful each field
    is downstream (instructions and ingredients matter most).
    """
    score = 0.0

    # Top-level scalar fields
    if record.get("instructions"):
        score += 3.0
    if record.get("method"):
        score += 1.5
    if record.get("glass"):
        score += 1.0
    if record.get("garnish"):
        score += 1.0
    if record.get("image_url"):
        score += 0.5
    if record.get("tags"):
        score += len(record["tags"]) * 0.1

    # Ingredient completeness
    for ing in record.get("ingredients", []):
        score += 0.5                          # ingredient present at all
        if ing.get("amount") is not None:
            score += 1.0                      # has a numeric amount
        if ing.get("unit"):
            score += 0.25
        if ing.get("notes"):
            score += 0.25

    return score


def merge_records(existing: dict, incoming: dict) -> dict:
    """
    Return the record with higher completeness score, filling any null fields
    in the winner from the loser where the loser has data.
    """
    existing_score = completeness_score(existing)
    incoming_score = completeness_score(incoming)

    if incoming_score > existing_score:
        winner, loser = incoming, existing
        decision = (
            f"PREFER incoming ({incoming['source']}, score={incoming_score:.2f}) "
            f"over existing ({existing['source']}, score={existing_score:.2f})"
        )
    else:
        winner, loser = existing, incoming
        decision = (
            f"KEEP existing ({existing['source']}, score={existing_score:.2f}) "
            f"over incoming ({incoming['source']}, score={incoming_score:.2f})"
        )

    log.info("DUPLICATE '%s': %s", winner["name"], decision)

    # Patch null scalar fields in winner from loser — never overwrite real data.
    for field in ("method", "glass", "garnish", "instructions", "image_url"):
        if not winner.get(field) and loser.get(field):
            log.info(
                "  PATCH '%s'.%s from %s (was null in winner)",
                winner["name"], field, loser["source"],
            )
            winner = {**winner, field: loser[field]}

    # Union tags, preserving winner's order.
    loser_tags = [t for t in loser.get("tags", []) if t not in winner.get("tags", [])]
    if loser_tags:
        log.info("  MERGE tags from %s: %s", loser["source"], loser_tags)
        winner = {**winner, "tags": winner.get("tags", []) + loser_tags}

    # Track which sources contributed.
    sources = list({existing["source"], incoming["source"]})
    winner = {**winner, "sources": sources}

    return winner


def load_file(path: str) -> list[dict]:
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    # Accept either a bare list or {"drinks": [...]}
    if isinstance(data, list):
        return data
    if isinstance(data, dict):
        for key in ("drinks", "cocktails", "records"):
            if key in data:
                return data[key]
    raise ValueError(f"Unrecognised structure in {path}")


def main():
    files = sorted(glob.glob(INPUT_GLOB))
    if not files:
        log.error("No files matched %s — run the normalizer scripts first.", INPUT_GLOB)
        return

    log.info("Found %d input file(s): %s", len(files), ", ".join(files))

    # name_key → record
    merged: dict[str, dict] = {}
    total_loaded = 0

    for path in files:
        records = load_file(path)
        log.info("Loaded %d records from %s", len(records), path)
        total_loaded += len(records)

        for record in records:
            key = canonical_name(record.get("name", ""))
            if not key:
                log.warning("Skipping record with no name in %s", path)
                continue

            if key not in merged:
                merged[key] = {**record, "sources": [record["source"]]}
            else:
                merged[key] = merge_records(merged[key], record)

    # Strip fields the web app never reads to keep cocktails.json lean.
    STRIP_FIELDS = {"id", "source", "sources"}
    output = [
        {k: v for k, v in r.items() if k not in STRIP_FIELDS}
        for r in sorted(merged.values(), key=lambda r: r["name"].lower())
    ]

    os.makedirs(os.path.dirname(OUTPUT_PATH), exist_ok=True)
    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(output, f, separators=(',', ':'), ensure_ascii=False)

    duplicates = total_loaded - len(output)
    log.info(
        "Done. %d input records -> %d unique cocktails (%d duplicate(s) merged) -> %s",
        total_loaded, len(output), duplicates, OUTPUT_PATH,
    )


if __name__ == "__main__":
    main()
