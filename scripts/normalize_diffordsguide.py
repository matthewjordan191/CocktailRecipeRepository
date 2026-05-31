"""
Normalize raw Difford's Guide JSON-LD records → canonical schema.

Input:  data/raw/diffordsguide.json
Output: data/processed/diffordsguide_normalized.json

Usage:
    uv run scripts/normalize_diffordsguide.py
"""
import html
import json
import logging
import os
import re

from utils import ML_TO_OZ, CL_TO_OZ, infer_method, map_tags, round_to_quarter, slugify

INPUT_PATH  = "data/raw/diffordsguide.json"
OUTPUT_PATH = "data/processed/diffordsguide_normalized.json"

logging.basicConfig(level=logging.WARNING, format="%(levelname)s: %(message)s")
log = logging.getLogger(__name__)

# ── Unit normalization ─────────────────────────────────────────────────────

UNIT_MAP = {
    "ml": "ml", "milliliter": "ml", "millilitre": "ml",
    "cl": "cl",
    "oz": "oz", "fl oz": "oz", "fluid ounce": "oz",
    "dash": "dash", "dashes": "dash",
    "barspoon": "barspoon", "barspoons": "barspoon", "bar spoon": "barspoon",
    "tsp": "tsp", "teaspoon": "tsp", "teaspoons": "tsp",
    "tbsp": "tbsp", "tablespoon": "tbsp", "tablespoons": "tbsp",
    "drop": "drops", "drops": "drops",
    "splash": "splash", "splashes": "splash",
    "part": "part", "parts": "part",
    "pinch": "pinch", "pinches": "pinch",
    "scoop": "piece", "scoops": "piece",
    "sprig": "piece", "sprigs": "piece",
    "slice": "piece", "slices": "piece",
    "wedge": "piece", "wedges": "piece",
    "wheel": "piece", "wheels": "piece",
    "cube": "piece", "cubes": "piece",
    "piece": "piece", "pieces": "piece",
    "leaf": "piece", "leaves": "piece",
    "whole": "piece", "fresh": "piece",
}
LIQUID_UNITS = {"ml", "cl", "oz"}

# Longest-first so "fl oz" matches before "oz".
_UNITS_SORTED = sorted(UNIT_MAP, key=len, reverse=True)
UNIT_RE = re.compile(
    r"^(" + "|".join(re.escape(u) for u in _UNITS_SORTED) + r")\b",
    re.IGNORECASE,
)

# ── Ingredient parsing ─────────────────────────────────────────────────────

NUMBER_RE = re.compile(r"^(\d+(?:\.\d+)?)\s*")

# Prefixes that indicate a free-form/topper ingredient with no amount.
TOPPER_RE = re.compile(
    r"^(top(?:\s+up)?\s+with|a\s+pinch\s+of|pinch\s+of|some|to\s+taste)\s+",
    re.IGNORECASE,
)


def to_oz(amount: float, unit: str) -> float:
    if unit == "oz":  return amount
    if unit == "ml":  return amount * ML_TO_OZ
    if unit == "cl":  return amount * CL_TO_OZ
    return amount


def parse_ingredient(raw: str, recipe_name: str) -> dict:
    """
    Parse a Difford's JSON-LD ingredient string, e.g.:
      "45 ml Gin"            → {amount: 1.5, unit: "oz", name: "gin"}
      "1 dash Bitters"       → {amount: 1,   unit: "dash", name: "bitters"}
      "Top up with Soda"     → {amount: None, unit: None,  name: "soda"}
    """
    s = raw.strip()

    # Free-form toppers: "Top up with X", "A pinch of X"
    m = TOPPER_RE.match(s)
    if m:
        name = s[m.end():].strip().lower()
        return {"name": name, "amount": None, "unit": None, "notes": None, "raw": raw}

    # Try to extract a leading number.
    num_m = NUMBER_RE.match(s)
    if not num_m:
        # No number — whole string is the ingredient name.
        return {"name": s.lower(), "amount": None, "unit": None, "notes": None, "raw": raw}

    amount = float(num_m.group(1))
    remainder = s[num_m.end():].lstrip()

    # Try to match a unit.
    unit_m = UNIT_RE.match(remainder)
    if unit_m:
        raw_unit = unit_m.group(1).lower()
        unit = UNIT_MAP.get(raw_unit, raw_unit)
        remainder = remainder[unit_m.end():].lstrip()
    else:
        unit = "piece"

    name = remainder.strip().lower()
    if not name:
        log.warning("[%s] Empty ingredient name after parsing '%s'", recipe_name, raw)
        return {"name": raw.lower(), "amount": None, "unit": None, "notes": None, "raw": raw}

    # Convert liquid units to oz, rounded to nearest ¼.
    if unit in LIQUID_UNITS and amount is not None:
        amount = round_to_quarter(to_oz(amount, unit))
        unit = "oz"

    return {"name": name, "amount": amount, "unit": unit, "notes": None, "raw": raw}


# ── Glass / garnish extraction from HowToStep list ────────────────────────

# Group 1: optional qualifier words (e.g. "COUPE", "NICK & NORA", "HIGHBALL (MAX 10OZ/300ML)")
# Group 2: required terminal glass-type word
# HTML entities are unescaped before matching so "&AMP;" → "&".
_GLASS_TERMINALS = r"GLASS|MUG|FLUTE|GOBLET|CUP|SNIFTER|STEIN|CHALICE|TIN|BOTTLE|BOWL|JAR"
GLASS_RE = re.compile(
    r"\b(?:a|an)\s+"
    r"(?:([A-Z0-9(][A-Z0-9\s&/\'\-\(\)]*?)\s+)?"  # optional qualifier (group 1)
    r"(" + _GLASS_TERMINALS + r")\b",               # terminal type  (group 2)
    re.IGNORECASE,
)


def extract_glass(steps: list[dict]) -> str | None:
    for step in steps:
        name = step.get("name", "").lower()
        text = html.unescape(step.get("text", ""))
        if any(k in name for k in ("glass", "pre-chill", "select", "pour into", "serve in")):
            m = GLASS_RE.search(text)
            if m:
                qualifier, terminal = m.group(1), m.group(2)
                glass = f"{qualifier} {terminal}".strip() if qualifier else terminal
                return glass.title()
    return None


# Patterns to pull the garnish item from step text.
_GARNISH_PATTERNS = [
    re.compile(r"garnish\s+(?:with|of)\s+(?:a\s+|an\s+)?(.+?)(?:\.|,|$)", re.IGNORECASE),
    re.compile(r"(?:of|with)\s+(?:a\s+|an\s+)?(.+?)\s+(?:over|on|around|into|and\s+use\s+as\s+garnish)", re.IGNORECASE),
    re.compile(r"^(?:ADD|PLACE|LAY|REST|FLOAT|TWIST|EXPRESS|GRATE|DUST|SPRINKLE)\s+(.+?)\s+(?:over|on|into|as|to)", re.IGNORECASE),
]


def extract_garnish(steps: list[dict]) -> str | None:
    parts: list[str] = []
    for step in steps:
        name = step.get("name", "").lower()
        text = step.get("text", "")
        if "garnish" not in name and "garnish" not in text.lower():
            continue
        for pat in _GARNISH_PATTERNS:
            m = pat.search(text)
            if m:
                g = m.group(1).strip().rstrip(".")
                if g and len(g) < 80:
                    parts.append(g)
                break
    return "; ".join(dict.fromkeys(parts)) or None  # deduplicate, preserve order


def build_instructions(steps: list[dict]) -> str | None:
    """
    Return the preparation steps as a single paragraph, excluding glass
    setup and garnish-only steps. The step text is used as-is (it describes
    standard bartending actions — not original creative prose).
    """
    skip_keywords = ("glass", "pre-chill", "select", "prepare glass")
    lines = []
    for step in steps:
        name = step.get("name", "").lower()
        text = step.get("text", "").strip()
        if not text:
            continue
        if any(k in name for k in skip_keywords):
            continue
        lines.append(text)
    return " ".join(lines) or None




# ── Record normalization ───────────────────────────────────────────────────

def normalize_record(raw: dict) -> dict | None:
    name = raw.get("name", "").strip()
    if not name:
        return None

    steps: list[dict] = raw.get("recipeInstructions") or []
    if isinstance(steps, str):
        steps = []

    ingredients = []
    for ing_str in raw.get("recipeIngredient") or []:
        try:
            parsed = parse_ingredient(ing_str, name)
            if parsed["name"].strip() in ("ice", ""):
                continue
            ingredients.append(parsed)
        except Exception as exc:
            log.warning("[%s] Ingredient parse error '%s': %s", name, ing_str, exc)

    glass    = extract_glass(steps)
    garnish  = extract_garnish(steps)
    instructions = build_instructions(steps)
    method   = infer_method(instructions)

    # Image: prefer the URL from the ImageObject, fall back to plain string.
    # Discard relative URLs — they are Difford's placeholder "pixelated" images.
    image = raw.get("image")
    if isinstance(image, dict):
        image_url = image.get("url") or image.get("contentUrl")
    elif isinstance(image, str):
        image_url = image
    else:
        image_url = None
    if image_url and not image_url.startswith("http"):
        image_url = None

    # Tags: map Difford's keywords to our vocabulary, always add source tag.
    keywords = raw.get("keywords") or []
    if isinstance(keywords, str):
        keywords = [k.strip() for k in keywords.split(",")]
    tags = map_tags(keywords)

    return {
        "id":           slugify(name),
        "name":         name,
        "method":       method,
        "glass":        glass,
        "garnish":      garnish,
        "instructions": instructions,
        "ingredients":  ingredients,
        "tags":         tags,
        "source":       "diffordsguide",
        "image_url":    image_url,
    }


def main() -> None:
    with open(INPUT_PATH, encoding="utf-8") as f:
        raw_records = json.load(f)
    print(f"Loaded {len(raw_records)} raw records from {INPUT_PATH}")

    normalized, skipped = [], 0
    for raw in raw_records:
        try:
            rec = normalize_record(raw)
            if rec:
                normalized.append(rec)
            else:
                skipped += 1
        except Exception as exc:
            log.warning("Skipping '%s': %s", raw.get("name", "?"), exc)
            skipped += 1

    os.makedirs(os.path.dirname(OUTPUT_PATH), exist_ok=True)
    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(normalized, f, indent=2, ensure_ascii=False)

    print(f"Normalized {len(normalized)} records ({skipped} skipped) -> {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
