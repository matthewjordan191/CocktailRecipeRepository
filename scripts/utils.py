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


# Maps raw source tags → canonical app tags (None = discard).
TAG_MAP: dict[str, str | None] = {
    # keep
    "iba":                    "iba",
    "non-alcoholic":          "non-alcoholic",
    "non alcoholic":          "non-alcoholic",
    "sour":                   "sour",
    "shot":                   "shot",
    "shot/shooter":           "shot",
    "classic":                "classic",
    "aperitif":               "aperitif",
    "aperitivo":              "aperitif",
    "aperitivo/aperitif":     "aperitif",
    "tropical":               "tropical",
    "tiki":                   "tropical",
    "tiki/tropical":          "tropical",
    "frozen":                 "frozen",
    "frozen (blended)":       "frozen",
    "blended":                "frozen",
    "spritz":                 "spritz",
    "coffee":                 "coffee",
    "coffee / tea":           "coffee",
    "hot drink":              "coffee",
    "hot drinks":             "coffee",
    "christmas":              "christmas",
    "festive":                "christmas",
    "punch":                  "punch",
    "punch/party drink":      "punch",
    "punch / party drink":    "punch",
    "new era":                "new era",
    # source-specific → canonical
    "the unforgettables":     "classic",
    "classic/vintage":        "classic",
    "contemporary classics":  "classic",
    "contemporary classic":   "classic",
    "contemporaryclassic":    "classic",
    "new era drinks":         "new era",
    "newera":                 "new era",
    "iba cocktail":           "iba",
    "alcohol-free":           "non-alcoholic",
    "party drink":            "punch",
    # discard — generic/noisy
    "ordinary drink":         None,
    "cocktail":               None,
    "mixed drink":            None,
    "wine cocktail":          None,
    "other / unknown":        None,
    "alcoholic":              None,
    "highball":               None,
    "highball/collins":       None,
    "collins":                None,
    "sparkling":              None,
    "short drink":            None,
    "long drink":             None,
    "all day cocktail":       None,
    "shake":                  None,
    "dairy":                  None,
    "sweet":                  None,
    "salty":                  None,
    "savory":                 None,
    "fruity":                 None,
    "citrus":                 None,
    "mild":                   None,
    "strong":                 None,
    "strongflavor":           None,
    "expensive":              None,
    "drunk":                  None,
    "hangover":               None,
    "breakfast":              None,
    "brunch":                 None,
    "datenight":              None,
    "dinnerparty":            None,
    "halloween":              None,
    "beach":                  None,
    "usa":                    None,
    "asia":                   None,
    "vegan":                  None,
}


def map_tags(raw_tags: list[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for t in raw_tags:
        mapped = TAG_MAP.get(t.lower().strip())
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
