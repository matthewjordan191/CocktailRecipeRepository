"""
Patch image_url for cocktails that don't have one.
Sources tried in order: TheCocktailDB, then Wikipedia article thumbnail.
Reads and writes web/cocktails.json directly — run after the full pipeline.
"""
import json
import time
import unicodedata

import requests

PATH = "web/cocktails.json"

# Alternate names to try when the canonical name returns nothing.
ALIASES: dict[str, list[str]] = {
    "Bee's knees":       ["Bees Knees", "Bee's Knees"],
    "Brandy crusta":     ["Brandy Crusta"],
    "Corpse reviver #2": ["Corpse Reviver", "Corpse Reviver #2"],
    "Dark 'n' stormy":   ["Dark and Stormy", "Dark N Stormy", "Dark 'N' Stormy"],
    "Hanky panky":       ["Hanky Panky"],
    "Lemon drop martini":["Lemon Drop", "Lemon Drop Martini"],
    "Martinez":          ["Martinez Cocktail", "The Martinez", "Martinez 2"],
    "Naked and famous":  ["Naked And Famous"],
    "Paper plane":       ["Paper Plane"],
    "Ramos fizz":        ["Ramos Gin Fizz", "Ramos Fizz"],
    "Southside":         ["Southside Fizz", "Southside Cocktail"],
    "Suffering bastard": ["Suffering Bastard"],
    "Tommy's margarita": ["Tommy's Margarita", "Tommys Margarita"],
    "Trinidad sour":     ["Trinidad Sour"],
    "Tuxedo":            ["Tuxedo #2"],
    "Vieux carré":       ["Vieux Carre", "Vieux Carré"],
    "Vieux Carré":       ["Vieux Carre"],
}


def normalize(name: str) -> str:
    nfd = unicodedata.normalize("NFD", name)
    return "".join(c for c in nfd if unicodedata.category(c) != "Mn").lower().strip()


def search(name: str) -> str | None:
    url = "https://www.thecocktaildb.com/api/json/v1/1/search.php"
    try:
        resp = requests.get(url, params={"s": name}, timeout=10)
        resp.raise_for_status()
        drinks = resp.json().get("drinks") or []
    except Exception as exc:
        print(f"    ERROR: {exc}")
        return None

    name_norm = normalize(name)
    # Prefer exact name match.
    for d in drinks:
        if normalize(d.get("strDrink", "")) == name_norm:
            return d.get("strDrinkThumb")
    # Accept the only result if there's no ambiguity.
    if len(drinks) == 1:
        return drinks[0].get("strDrinkThumb")
    return None


WIKI_HEADERS = {
    "User-Agent": "CocktailRecipeBot/1.0 (https://github.com/matthewjordan191/CocktailRecipeRepository) python-requests"
}


def search_wikipedia(name: str) -> str | None:
    """Return the main article thumbnail from Wikipedia, or None."""
    api = "https://en.wikipedia.org/w/api.php"
    params = {
        "action": "query",
        "prop": "pageimages",
        "format": "json",
        "pithumbsize": 500,
        "redirects": 1,
    }
    # Try "<name> cocktail" first, then bare name.
    for title in (f"{name} cocktail", name):
        try:
            resp = requests.get(api, params={**params, "titles": title},
                                headers=WIKI_HEADERS, timeout=10)
            resp.raise_for_status()
            pages = resp.json().get("query", {}).get("pages", {})
            for page in pages.values():
                if "thumbnail" in page:
                    return page["thumbnail"]["source"]
        except Exception as exc:
            print(f"    WIKI ERROR: {exc}")
        time.sleep(0.2)
    return None


def main():
    with open(PATH, encoding="utf-8") as f:
        cocktails = json.load(f)

    missing = [(i, c) for i, c in enumerate(cocktails) if not c.get("image_url")]
    print(f"{len(missing)} cocktails without images.\n")

    found = 0
    for i, cocktail in missing:
        name = cocktail["name"]
        print(f"  {name} ...", end=" ", flush=True)

        image_url = search(name)

        # Retry without accents.
        if not image_url:
            plain = normalize(name).title()
            if plain != name:
                image_url = search(plain)

        # Retry with known aliases.
        if not image_url:
            for alias in ALIASES.get(name, []):
                image_url = search(alias)
                if image_url:
                    break

        # Fall back to Wikipedia article thumbnail.
        if not image_url:
            image_url = search_wikipedia(name)

        if image_url:
            cocktails[i]["image_url"] = image_url
            print("found")
            found += 1
        else:
            print("not found")

        time.sleep(0.25)

    with open(PATH, "w", encoding="utf-8") as f:
        json.dump(cocktails, f, indent=2, ensure_ascii=False)

    print(f"\nPatched {found}/{len(missing)} -> {PATH}")


if __name__ == "__main__":
    main()
