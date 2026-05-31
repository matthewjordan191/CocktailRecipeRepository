"""
Fetch all cocktail recipes from Difford's Guide via sitemap and extract JSON-LD.

Saves raw JSON-LD records to data/raw/diffordsguide.json.
Supports resuming: already-fetched URLs are skipped on re-runs.

Usage:
    uv run --with requests --with beautifulsoup4 --with lxml scripts/fetch_diffordsguide.py
"""
import json
import logging
import os
import sys

from scrape_lib import extract_jsonld, fetch_sitemap_urls, polite_get, robots_allowed

SITEMAP_URL  = "https://www.diffordsguide.com/sitemap/cocktail.xml"
RECIPE_PREFIX = "https://www.diffordsguide.com/cocktails/recipe/"
URLS_CACHE   = "data/raw/diffordsguide_urls.json"
OUTPUT_PATH  = "data/raw/diffordsguide.json"
SAVE_EVERY   = 50   # write output file after every N fetches
DELAY        = 1.5  # seconds between requests

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
log = logging.getLogger(__name__)


def load_or_fetch_urls() -> list[str]:
    if os.path.exists(URLS_CACHE):
        with open(URLS_CACHE, encoding="utf-8") as f:
            urls = json.load(f)
        log.info("Loaded %d URLs from cache %s", len(urls), URLS_CACHE)
        return urls
    log.info("Fetching sitemap %s …", SITEMAP_URL)
    urls = fetch_sitemap_urls(SITEMAP_URL, filter_prefix=RECIPE_PREFIX)
    os.makedirs(os.path.dirname(URLS_CACHE), exist_ok=True)
    with open(URLS_CACHE, "w", encoding="utf-8") as f:
        json.dump(urls, f, indent=2)
    log.info("Cached %d recipe URLs → %s", len(urls), URLS_CACHE)
    return urls


def save_results(records: list[dict]) -> None:
    os.makedirs(os.path.dirname(OUTPUT_PATH), exist_ok=True)
    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(records, f, ensure_ascii=False, indent=2)


def main() -> None:
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=None, help="Stop after N recipes (for testing)")
    args = parser.parse_args()

    urls = load_or_fetch_urls()

    # Load existing results to support resume.
    existing: dict[str, dict] = {}
    if os.path.exists(OUTPUT_PATH):
        with open(OUTPUT_PATH, encoding="utf-8") as f:
            for r in json.load(f):
                existing[r.get("url", "")] = r
        log.info("Resuming: %d already fetched", len(existing))

    todo = [u for u in urls if u not in existing]
    if args.limit:
        todo = todo[:args.limit]
    log.info("Total: %d  |  Done: %d  |  Remaining: %d", len(urls), len(existing), len(todo))

    if not todo:
        log.info("Nothing to do.")
        return

    results = list(existing.values())
    failed: list[str] = []

    for i, url in enumerate(todo, 1):
        # Robots check (cached per domain — only one domain here).
        if not robots_allowed(url):
            log.warning("robots.txt disallows %s — skipping", url)
            continue

        sys.stdout.write(f"\r[{i + len(existing)}/{len(urls)}] {url[-60:]:60s}")
        sys.stdout.flush()

        try:
            resp  = polite_get(url, delay=DELAY)
            record = extract_jsonld(resp.text)
            if record:
                record["source_url"] = url
                results.append(record)
            else:
                log.warning("\nNo JSON-LD Recipe found at %s", url)
                failed.append(url)
        except Exception as exc:
            log.warning("\nFailed %s: %s", url, exc)
            failed.append(url)

        if i % SAVE_EVERY == 0:
            save_results(results)
            log.info("\nSaved %d records (checkpoint)", len(results))

    save_results(results)
    print()
    log.info("Done. %d recipes saved → %s", len(results), OUTPUT_PATH)
    if failed:
        log.warning("%d URLs failed:", len(failed))
        for u in failed:
            log.warning("  %s", u)


if __name__ == "__main__":
    main()
