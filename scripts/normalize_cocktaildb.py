import json
import logging
import os
import re

INPUT_PATH = "data/raw/cocktaildb.json"
OUTPUT_PATH = "data/processed/cocktaildb_normalized.json"

logging.basicConfig(level=logging.WARNING, format="%(levelname)s: %(message)s")

ML_TO_OZ = 0.033814
CL_TO_OZ = 0.33814
SHOT_TO_OZ = 1.5  # standard US shot

# Maps raw unit strings (lowercase) to a canonical unit or conversion action.
UNIT_ALIASES = {
    "oz": "oz",
    "ml": "ml",
    "cl": "cl",
    "shot": "shot",
    "shots": "shot",
    "tsp": "tsp",
    "tblsp": "tbsp",
    "tbsp": "tbsp",
    "dash": "dash",
    "dashes": "dash",
    "part": "part",
    "parts": "part",
    "twist": "twist",
    "twists": "twist",
    "drop": "drops",
    "drops": "drops",
    "piece": "piece",
    "pieces": "piece",
}

# Units we convert to oz; all others are kept as-is.
LIQUID_UNITS = {"oz", "ml", "cl", "shot"}

# Matches the number portion of a measure: "1", "1/2", "1 1/2", "1.5"
NUMBER_RE = re.compile(r"^(\d+\s+\d+/\d+|\d+/\d+|\d+(?:\.\d+)?)")

# Matches the unit immediately after the number (with optional leading space).
UNIT_RE = re.compile(
    r"^\s*(oz|ml|cl|shots?|tsps?|tblsps?|tbsps?|dashes?|dash|parts?|twists?|drops?|pieces?)\b",
    re.IGNORECASE,
)


def round_to_quarter(value: float) -> float:
    return round(value * 4) / 4


def parse_number(s: str) -> float | None:
    s = s.strip()
    # Mixed fraction: "1 1/2"
    m = re.match(r"^(\d+)\s+(\d+)/(\d+)$", s)
    if m:
        return int(m.group(1)) + int(m.group(2)) / int(m.group(3))
    # Simple fraction: "3/4"
    m = re.match(r"^(\d+)/(\d+)$", s)
    if m:
        return int(m.group(1)) / int(m.group(2))
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
    if unit == "shot":
        return amount * SHOT_TO_OZ
    return amount  # unreachable given LIQUID_UNITS guard, but satisfies type checker


def parse_measure(raw: str, drink_name: str, ing_name: str) -> tuple[float | None, str | None]:
    """
    Parse a raw CocktailDB measure string into (amount, unit).
    Liquid units are converted and rounded to the nearest ¼ oz.
    Returns (None, None) on failure, logging a warning.
    """
    s = raw.strip()
    if not s:
        return None, None

    # Extract leading number.
    num_match = NUMBER_RE.match(s)
    if not num_match:
        logging.warning(
            "[%s] Unparseable measure '%s' for '%s' — no leading number", drink_name, raw, ing_name
        )
        return None, None

    amount = parse_number(num_match.group(1))
    if amount is None:
        logging.warning(
            "[%s] Could not parse number in measure '%s' for '%s'", drink_name, raw, ing_name
        )
        return None, None

    remainder = s[num_match.end():]

    # Extract optional unit.
    unit_match = UNIT_RE.match(remainder)
    if unit_match:
        canonical_unit = UNIT_ALIASES.get(unit_match.group(1).lower())
    else:
        # No recognised unit — treat as a plain count (e.g. "1 cherry").
        canonical_unit = "piece"

    if canonical_unit in LIQUID_UNITS:
        return round_to_quarter(to_oz(amount, canonical_unit)), "oz"

    return amount, canonical_unit


def slugify(name: str) -> str:
    name = name.lower()
    name = re.sub(r"[^\w\s-]", "", name)
    name = re.sub(r"[\s_]+", "-", name)
    return name.strip("-")


def infer_method(instructions: str | None) -> str | None:
    if not instructions:
        return None
    lower = instructions.lower()
    if "shake" in lower or "shaken" in lower:
        return "shaken"
    if "blend" in lower or "blended" in lower:
        return "blended"
    if "stir" in lower or "stirred" in lower:
        return "stirred"
    if "build" in lower or "built" in lower:
        return "built"
    return None


def normalize_drink(drink: dict) -> dict:
    name = drink.get("strDrink", "")

    ingredients = []
    for i in range(1, 16):
        ing_name = drink.get(f"strIngredient{i}")
        if not ing_name or not ing_name.strip():
            break

        ing_name = ing_name.strip()
        raw = (drink.get(f"strMeasure{i}") or "").strip() or None

        amount, unit = None, None
        if raw:
            try:
                amount, unit = parse_measure(raw, name, ing_name)
            except Exception as exc:
                logging.warning("[%s] Error parsing measure '%s' for '%s': %s", name, raw, ing_name, exc)

        ingredients.append(
            {
                "name": ing_name.lower(),
                "amount": amount,
                "unit": unit,
                "notes": None,
                "raw": raw,
            }
        )

    tags = []
    if drink.get("strTags"):
        tags.extend(t.strip().lower() for t in drink["strTags"].split(",") if t.strip())
    if drink.get("strCategory"):
        tags.append(drink["strCategory"].lower())
    if drink.get("strIBA"):
        tags.append("iba")
    if drink.get("strAlcoholic") == "Non alcoholic":
        tags.append("non-alcoholic")
    # deduplicate while preserving order
    seen = set()
    tags = [t for t in tags if not (t in seen or seen.add(t))]

    return {
        "id": slugify(name),
        "name": name,
        "method": infer_method(drink.get("strInstructions")),
        "glass": drink.get("strGlass"),
        "garnish": None,  # CocktailDB has no dedicated garnish field
        "instructions": drink.get("strInstructions"),
        "ingredients": ingredients,
        "tags": tags,
        "source": "cocktaildb",
        "image_url": drink.get("strDrinkThumb"),
    }


def main():
    with open(INPUT_PATH, encoding="utf-8") as f:
        data = json.load(f)

    raw_drinks = data.get("drinks", [])
    print(f"Loaded {len(raw_drinks)} drinks from {INPUT_PATH}")

    normalized = []
    skipped = 0
    for drink in raw_drinks:
        try:
            normalized.append(normalize_drink(drink))
        except Exception as exc:
            logging.warning("Skipping '%s': %s", drink.get("strDrink", "?"), exc)
            skipped += 1

    os.makedirs(os.path.dirname(OUTPUT_PATH), exist_ok=True)
    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(normalized, f, indent=2, ensure_ascii=False)

    print(f"Normalized {len(normalized)} drinks ({skipped} skipped) -> {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
