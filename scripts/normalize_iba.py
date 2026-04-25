import json
import logging
import os
import re

from utils import CL_TO_OZ, ML_TO_OZ, infer_method, round_to_quarter, slugify

INPUT_PATH = "data/raw/iba.json"
OUTPUT_PATH = "data/processed/iba_normalized.json"

logging.basicConfig(level=logging.WARNING, format="%(levelname)s: %(message)s")

# Canonical unit after normalization
UNIT_CANONICAL = {
    "ml": "ml",
    "cl": "cl",
    "oz": "oz",
    "bar spoon": "barspoon",
    "bar spoons": "barspoon",
    "barspoon": "barspoon",
    "barspoons": "barspoon",
    "tablespoon": "tbsp",
    "tablespoons": "tbsp",
    "teaspoon": "tsp",
    "teaspoons": "tsp",
    "tsp": "tsp",
    "tsps": "tsp",
    "dash": "dash",
    "dashes": "dash",
    "drop": "drops",
    "drops": "drops",
    "splash": "splash",
    "part": "part",
    "parts": "part",
    "sprig": "piece",
    "sprigs": "piece",
    "leaf": "piece",
    "leaves": "piece",
    "cube": "piece",
    "cubes": "piece",
    "slice": "piece",
    "slices": "piece",
    "piece": "piece",
    "pieces": "piece",
}

LIQUID_UNITS = {"ml", "cl", "oz"}

# Sorted longest-first so multi-word units ("bar spoon") match before "bar".
_UNIT_TOKENS = sorted(UNIT_CANONICAL.keys(), key=len, reverse=True)
UNIT_RE = re.compile(
    r"^\s*(" + "|".join(re.escape(u) for u in _UNIT_TOKENS) + r")\b\s*",
    re.IGNORECASE,
)

# Strips "(2 parts)", "(0.34 US fl oz)", etc.
PAREN_RE = re.compile(r"\([^)]+\)")

# Matches a leading number: fraction before decimal so "1/2" beats "1".
NUMBER_RE = re.compile(r"^(\d+/\d+|\d+(?:\.\d+)?)(?:\s*(?:to|-)\s*\d+(?:\.\d+)?)?")

# Catches leftover measure fragments inside a name, e.g. "Goslings Rum100 ml Ginger Beer".
TRAILING_MEASURE_RE = re.compile(r"\s*\d+\s*(?:ml|cl|oz)\s+.*$", re.IGNORECASE)


def parse_number(s: str) -> float | None:
    if "/" in s:
        num, den = s.split("/", 1)
        try:
            return int(num) / int(den)
        except (ValueError, ZeroDivisionError):
            return None
    try:
        return float(s)
    except ValueError:
        return None


def to_oz(amount: float, unit: str) -> float:
    if unit == "oz":
        return amount
    if unit == "ml":
        return amount * ML_TO_OZ
    if unit == "cl":
        return amount * CL_TO_OZ
    return amount


def parse_ingredient(raw: str, cocktail_name: str) -> dict:
    """
    Parse a raw IBA ingredient string into a structured dict.
    Examples:
      "4.5 cl (3 parts) vodka"      -> {amount: 1.5, unit: "oz", name: "vodka"}
      "2 dashes Angostura bitters"  -> {amount: 2,   unit: "dash", name: "angostura bitters"}
      "1 egg white"                 -> {amount: 1,   unit: "piece", name: "egg white"}
      "Soda water"                  -> {amount: None, unit: None, name: "soda water"}
    """
    original_raw = raw.strip()

    # Strip parentheticals like "(3 parts)" or "(0.34 US fl oz)".
    s = PAREN_RE.sub("", original_raw).strip()

    amount: float | None = None
    unit: str | None = None
    name: str = s.lower()

    # Try to extract a leading number.
    num_match = NUMBER_RE.match(s)
    if not num_match:
        # No leading number — descriptive entry like "Soda water" or "Black pepper".
        return {"name": name, "amount": None, "unit": None, "notes": None, "raw": original_raw}

    amount = parse_number(num_match.group(1))
    remainder = s[num_match.end():].lstrip()

    # Try to match a unit immediately after the number.
    unit_match = UNIT_RE.match(remainder)
    if unit_match:
        raw_unit = unit_match.group(1).lower()
        unit = UNIT_CANONICAL.get(raw_unit, raw_unit)
        remainder = remainder[unit_match.end():]
    else:
        # No recognised unit — treat as a plain count (e.g. "1 egg white").
        unit = "piece"

    # Strip leading "of " (e.g. "6 drops of egg white" -> "egg white").
    remainder = re.sub(r"^of\s+", "", remainder, flags=re.IGNORECASE)
    name = remainder.strip().lower()

    # Remove trailing concatenated measure fragments (data quality issue in source).
    name = TRAILING_MEASURE_RE.sub("", name).strip()

    if not name:
        logging.warning("[%s] Empty ingredient name after parsing '%s'", cocktail_name, original_raw)

    # Convert liquid units to oz and round to nearest ¼.
    if unit in LIQUID_UNITS and amount is not None:
        amount = round_to_quarter(to_oz(amount, unit))
        unit = "oz"

    return {"name": name, "amount": amount, "unit": unit, "notes": None, "raw": original_raw}


def normalize_cocktail(raw: dict) -> dict:
    name = raw.get("name", "")
    # IBA "method" is actually the instructions text.
    instructions = raw.get("method")
    if raw.get("notes"):
        instructions = (instructions or "") + f"\n\nNote: {raw['notes']}"

    ingredients = []
    for ing_str in raw.get("ingredients", []):
        try:
            parsed = parse_ingredient(ing_str, name)
            if parsed["name"] == "ice":
                continue
            ingredients.append(parsed)
        except Exception as exc:
            logging.warning("[%s] Error parsing ingredient '%s': %s", name, ing_str, exc)

    tags = []
    if raw.get("category"):
        tags.append(raw["category"].lower())
    if raw.get("type"):
        t = raw["type"].lower()
        if t not in tags:
            tags.append(t)
    tags.append("iba")

    return {
        "id": slugify(name),
        "name": name,
        "method": infer_method(instructions),
        "glass": raw.get("standard_drinkware"),
        "garnish": None,
        "instructions": instructions,
        "ingredients": ingredients,
        "tags": tags,
        "source": "iba",
        "image_url": None,
    }


def main():
    with open(INPUT_PATH, encoding="utf-8") as f:
        data = json.load(f)

    print(f"Loaded {len(data)} cocktails from {INPUT_PATH}")

    normalized = []
    skipped = 0
    for record in data:
        try:
            normalized.append(normalize_cocktail(record))
        except Exception as exc:
            logging.warning("Skipping '%s': %s", record.get("name", "?"), exc)
            skipped += 1

    os.makedirs(os.path.dirname(OUTPUT_PATH), exist_ok=True)
    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(normalized, f, indent=2, ensure_ascii=False)

    print(f"Normalized {len(normalized)} cocktails ({skipped} skipped) -> {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
