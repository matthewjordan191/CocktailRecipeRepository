import json

import requests

# rasmusab/iba-cocktails — 98 IBA official cocktails sourced from Wikipedia
SOURCE_URL = (
    "https://raw.githubusercontent.com/rasmusab/iba-cocktails"
    "/master/wikipedia/iba-cocktails-wiki.json"
)
OUTPUT_PATH = "data/raw/iba.json"


def main():
    print(f"Downloading IBA cocktails from:\n  {SOURCE_URL}\n")

    response = requests.get(SOURCE_URL, timeout=15)
    response.raise_for_status()

    cocktails = response.json()
    print(f"Fetched {len(cocktails)} cocktails.")

    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(cocktails, f, indent=2, ensure_ascii=False)

    print(f"Saved to {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
