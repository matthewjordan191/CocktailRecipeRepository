import re

ML_TO_OZ = 0.033814
CL_TO_OZ = 0.33814


def round_to_quarter(value: float) -> float:
    return round(value * 4) / 4


def slugify(name: str) -> str:
    name = name.lower()
    name = re.sub(r"[^\w\s-]", "", name)
    name = re.sub(r"[\s_]+", "-", name)
    return name.strip("-")


# Maps raw source tags → canonical app tags (None / absent = discard).
# Canonical tags are grouped into dimensions in the web app (see TAG_GROUPS in
# app.js): flavor, occasion, style, and collection. Base-spirit tags (gin, rum,
# whiskey, …) are derived separately from ingredients in merge.py.
TAG_MAP: dict[str, str | None] = {
    # ── Collection ─────────────────────────────────────────────
    "iba":                            "iba",
    "iba cocktail":                   "iba",
    "non-alcoholic":                  "non-alcoholic",
    "non alcoholic":                  "non-alcoholic",
    "alcohol-free":                   "non-alcoholic",
    "sugar-free and low-calorie":     "non-alcoholic",
    "classic":                        "classic",
    "classic/vintage":                "classic",
    "the unforgettables":             "classic",
    "contemporary classic":           "classic",
    "contemporary classics":          "classic",
    "contemporaryclassic":            "classic",
    "new era":                        "new era",
    "new era drinks":                 "new era",
    "newera":                         "new era",
    "modern":                         "new era",
    "hall of fame and must know/try": "must-try",
    "punch":                          "punch",
    "punch/party drink":              "punch",
    "punch / party drink":            "punch",
    "coffee":                         "coffee",
    "coffee / tea":                   "coffee",
    # ── Flavor profile ─────────────────────────────────────────
    "fruity":                         "fruity",
    "fruitini":                       "fruity",
    "sour":                           "sour",
    "sours":                          "sour",
    "sours (citrus)":                 "sour",
    "citrusy":                        "sour",
    "citrus":                         "sour",
    "bittersweet":                    "bittersweet",
    "herbal":                         "herbal",
    "creamy":                         "creamy",
    "spicy":                          "spicy",
    "floral":                         "floral",
    "savoury":                        "savory",
    "savory":                         "savory",
    "nutty":                          "nutty",
    "dessert cocktails":              "dessert",
    "ice-cream cocktails":            "dessert",
    # ── Occasion / time ────────────────────────────────────────
    "aperitif":                       "aperitif",
    "aperitivo":                      "aperitif",
    "aperitivo/aperitif":             "aperitif",
    "after dinner/digestif":          "after-dinner",
    "nightcap/sipping":               "nightcap",
    "breakfast/brunch":               "brunch",
    "breakfast":                      "brunch",
    "brunch":                         "brunch",
    "summer":                         "summer",
    "winter":                         "winter",
    "christmas":                      "festive",
    "festive":                        "festive",
    "christmas and thanksgiving":     "festive",
    "new year's eve":                 "festive",
    "party":                          "party",
    "romantic and valentine's day":   "romantic",
    # ── Style / build ──────────────────────────────────────────
    "spirit-forward":                 "spirit-forward",
    "long drinks and highballs":      "highball",
    "martini-style":                  "martini",
    "tropical":                       "tropical",
    "tiki":                           "tropical",
    "tiki/tropical":                  "tropical",
    "frozen":                         "frozen",
    "frozen (blended)":               "frozen",
    "blended":                        "frozen",
    "hot drink":                      "hot",
    "hot drinks":                     "hot",
    "layered":                        "layered",
    "shot":                           "shot",
    "shot/shooter":                   "shot",
    "shot cocktails":                 "shot",
}


def map_tags(raw_tags: list[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for t in raw_tags:
        # Normalise: lowercase, drop parenthetical examples e.g.
        # "fruity (e.g. pornstar martini)" → "fruity".
        key = re.sub(r"\s*\(.*?\)", "", t.lower()).strip()
        mapped = TAG_MAP.get(key) or TAG_MAP.get(t.lower().strip())
        if mapped and mapped not in seen:
            result.append(mapped)
            seen.add(mapped)
    return result


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
    if any(w in lower for w in ("build", "built", "layer", "pour", "swizzle", "churn", "throw")):
        return "built"
    return None
