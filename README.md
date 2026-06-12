# Cocktail Recipe Repository

A progressive web app (PWA) for browsing, searching, and saving cocktail recipes. Installable on mobile and desktop, works offline, and syncs your favorites and bar inventory across devices.

**[Open the app](https://matthewjordan191.github.io/CocktailRecipeRepository/)**

---

## Features

- **6,913 cocktails** with images, ingredients, instructions, garnish notes, and glassware — sourced primarily from Difford's Guide, supplemented by IBA and TheCocktailDB
- **Google sign-in** — favorites, bar inventory, and ratings sync across devices via Firestore
- **Fuzzy search with relevance ranking** — finds cocktails by partial name, abbreviation ("daq" → Daiquiri), or rough spelling ("margerita"), with the best matches sorted to the top
- **Filters** — base-spirit pills (Gin, Whiskey, Rum, …) plus a More panel grouped by flavor, occasion, style, and collection; filter by a specific ingredient from any recipe
- **Makeable filter** — shows only cocktails you can make with your current bar inventory
- **My Bar** — check off the spirits and liqueurs you own (collapsed to shelf-level families like "rum" or "sweet vermouth"); recipe ingredients highlight green (have) or amber (missing)
- **For You** — personalized recommendations scored from your favorites' tags and ingredients
- **Ratings** — rate any cocktail 1–5 stars and see the community average
- **Similar cocktails** — related recipes suggested at the bottom of every detail page
- **Favorites** — save recipes with the ☆ button
- **Surprise me** — opens a random cocktail from whatever is currently visible
- **Deep links** — every cocktail has a shareable URL (e.g. `.../#negroni`), and Back walks one screen at a time
- **PWA** — installable from the browser, works offline via service worker; the 6.9k-row list stays fast through windowed rendering

---

## Data Pipeline

Cocktail data is fetched from each source, normalized to a common schema, and merged into a single `web/cocktails.json`:

```
scripts/
  fetch_diffordsguide.py   # Scrapes Difford's Guide → data/raw/
  fetch_iba.py             # Fetches IBA cocktails → data/raw/
  fetch_cocktaildb.py      # Fetches TheCocktailDB → data/raw/
  scrape_lib.py            # Shared scraping helpers (robots.txt checks, polite fetch, sitemap parsing)
  normalize_*.py           # Per-source normalizers → data/processed/*.json
  merge.py                 # Dedupes by name and merges → web/cocktails.json
  fetch_missing_images.py  # Patches image_url via TheCocktailDB + Wikipedia API
  utils.py                 # Shared helpers (unit conversion, tag taxonomy, method inference)
  generate_icons.py        # Draws the PWA icons (icon-192/512.png)
```

When the same cocktail appears in multiple sources, the merge keeps the higher-priority record (Difford's > IBA > TheCocktailDB) and patches its missing fields from the others. Tags are normalized to a canonical taxonomy (flavor / occasion / style / collection), and base-spirit tags are derived from the ingredient list.

To regenerate after adding or refreshing a source:

```bash
pip install -r requirements.txt
python scripts/fetch_<source>.py
python scripts/normalize_<source>.py
python scripts/merge.py
python scripts/fetch_missing_images.py  # only if new cocktails lack images
```

---

## Firebase

The app uses Firebase Auth (Google) and Firestore:

- `users/{uid}/data/sync` — each user's favorites and bar inventory (owner-only access)
- `ratings/{slug}/votes/{uid}` — one star vote per user per cocktail, validated as an integer 1–5

Security rules are versioned in [`firestore.rules`](firestore.rules). After editing them, publish via the Firebase console or:

```bash
firebase deploy --only firestore:rules
```

---

## Tech Stack

- Vanilla JS, CSS, HTML — no framework, no build step
- GitHub Pages for hosting
- Firebase Auth + Firestore for sign-in, cross-device sync, and ratings
- Service worker for offline support and caching (the cache version in `web/sw.js` is bumped by a local pre-commit hook so clients refresh after each deploy)
- `localStorage` as the local cache for favorites and bar inventory

---

## Feedback & Bug Reports

Found a bug or want to request a feature? [Open an issue on GitHub](https://github.com/matthewjordan191/CocktailRecipeRepository/issues).
