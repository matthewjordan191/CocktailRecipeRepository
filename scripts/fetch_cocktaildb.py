import json
import string
import time

import requests

BASE_URL = "https://www.thecocktaildb.com/api/json/v1/1/search.php"
OUTPUT_PATH = "data/raw/cocktaildb.json"
DELAY_SECONDS = 1


def fetch_all_cocktails():
    all_cocktails = []
    letters = string.ascii_lowercase

    for letter in letters:
        print(f"Fetching cocktails starting with '{letter}'...", flush=True)
        response = requests.get(BASE_URL, params={"f": letter}, timeout=10)
        response.raise_for_status()

        data = response.json()
        drinks = data.get("drinks") or []
        all_cocktails.extend(drinks)
        print(f"  -> {len(drinks)} cocktail(s) found (total so far: {len(all_cocktails)})", flush=True)

        if letter != letters[-1]:
            time.sleep(DELAY_SECONDS)

    return all_cocktails


def main():
    print(f"Starting fetch from TheCocktailDB ({len(string.ascii_lowercase)} requests)...\n")
    cocktails = fetch_all_cocktails()
    print(f"\nDone. Total cocktails fetched: {len(cocktails)}")

    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump({"drinks": cocktails}, f, indent=2, ensure_ascii=False)

    print(f"Saved to {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
