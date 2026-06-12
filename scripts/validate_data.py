"""Sanity-check web/cocktails.json before deploying to Pages.

Catches pipeline regressions (broken merge, truncated output, malformed
records) in CI instead of shipping them. Exits non-zero with a report on
any failure. Usage: python3 scripts/validate_data.py [path]
"""
import json
import sys
from urllib.parse import urlparse

# Full dataset is ~6,900 cocktails; far fewer means a truncated/partial merge.
MIN_ENTRIES = 5000
MAX_REPORTED = 20

OPTIONAL_STR_FIELDS = ("method", "glass", "garnish", "instructions")


def check_entry(i: int, c) -> list[str]:
    where = f"entry {i} ({c.get('name', '?')!r})" if isinstance(c, dict) else f"entry {i}"
    if not isinstance(c, dict):
        return [f"{where}: not an object"]

    errors = []
    name = c.get("name")
    if not isinstance(name, str) or not name.strip():
        errors.append(f"{where}: missing or empty name")

    ingredients = c.get("ingredients")
    if not isinstance(ingredients, list) or not ingredients:
        errors.append(f"{where}: ingredients must be a non-empty list")
    else:
        for j, ing in enumerate(ingredients):
            if not isinstance(ing, dict):
                errors.append(f"{where}: ingredient {j} is not an object")
                continue
            if not isinstance(ing.get("name"), str) or not ing["name"].strip():
                errors.append(f"{where}: ingredient {j} has no name")
            amount = ing.get("amount")
            if amount is not None and not isinstance(amount, (int, float)):
                errors.append(f"{where}: ingredient {j} amount is not numeric: {amount!r}")

    url = c.get("image_url")
    if url is not None:
        parsed = urlparse(url) if isinstance(url, str) else None
        if not parsed or parsed.scheme not in ("http", "https") or not parsed.netloc:
            errors.append(f"{where}: image_url does not parse as http(s): {url!r}")

    tags = c.get("tags")
    if tags is not None and (
        not isinstance(tags, list) or any(not isinstance(t, str) or not t for t in tags)
    ):
        errors.append(f"{where}: tags must be a list of non-empty strings")

    for field in OPTIONAL_STR_FIELDS:
        value = c.get(field)
        if value is not None and not isinstance(value, str):
            errors.append(f"{where}: {field} must be a string or null, got {type(value).__name__}")

    return errors


def main() -> int:
    path = sys.argv[1] if len(sys.argv) > 1 else "web/cocktails.json"
    try:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, json.JSONDecodeError) as e:
        print(f"FAIL {path}: {e}")
        return 1

    if not isinstance(data, list):
        print(f"FAIL {path}: top level must be a list")
        return 1

    errors = []
    if len(data) < MIN_ENTRIES:
        errors.append(f"only {len(data)} entries (expected >= {MIN_ENTRIES}) — truncated merge?")

    seen_names: set[str] = set()
    for i, c in enumerate(data):
        errors.extend(check_entry(i, c))
        name = c.get("name") if isinstance(c, dict) else None
        if isinstance(name, str):
            key = name.lower().strip()
            if key in seen_names:
                errors.append(f"duplicate name: {name!r} (merge dedup failed)")
            seen_names.add(key)

    if errors:
        print(f"FAIL {path}: {len(errors)} problem(s)")
        for e in errors[:MAX_REPORTED]:
            print(f"  - {e}")
        if len(errors) > MAX_REPORTED:
            print(f"  ... and {len(errors) - MAX_REPORTED} more")
        return 1

    print(f"OK {path}: {len(data)} cocktails validated")
    return 0


if __name__ == "__main__":
    sys.exit(main())
