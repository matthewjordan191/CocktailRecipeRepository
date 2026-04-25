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
