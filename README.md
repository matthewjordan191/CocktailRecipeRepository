# Cocktail Recipe Repository

A progressive web app (PWA) for browsing, searching, and saving cocktail recipes. Installable on mobile and desktop, works offline, and loads fast.

**[Open the app](https://matthewjordan191.github.io/CocktailRecipeRepository/)**

---

## Features

- **456 cocktails** with images, ingredients, instructions, garnish notes, and glassware
- **Fuzzy search** — finds cocktails by partial name, abbreviation, or rough spelling
- **Filter pills** — browse by category (IBA, Classics, New Era, Sours, Non-Alcoholic, Shots, Coffee, Punch, Festive) or any tag via the More panel
- **Makeable filter** — shows only cocktails you can make with your current bar inventory
- **Surprise me** — opens a random cocktail from whatever is currently visible
- **Favorites** — save recipes with the ☆ button; persists across sessions
- **My Bar** — check off the spirits and liqueurs you own; alcoholic ingredients in recipes are highlighted green (have) or amber (missing)
- **Deep links** — every cocktail has a shareable URL (e.g. `.../#negroni`)
- **PWA** — installable from the browser, works fully offline via service worker

---

## Data Pipeline

Cocktail data is assembled from multiple sources and merged into a single `web/cocktails.json` file:

```
scripts/
  normalize_*.py       # Per-source normalizers → data/processed/*.json
  merge.py             # Deduplicates and merges all sources → web/cocktails.json
  fetch_missing_images.py  # Patches image_url via TheCocktailDB + Wikipedia API
  utils.py             # Shared helpers (unit conversion, slugify, method inference)
```

To regenerate after adding a new data source:

```bash
python scripts/normalize_<source>.py
python scripts/merge.py
python scripts/fetch_missing_images.py  # only if new cocktails lack images
```

---

## Tech Stack

- Vanilla JS, CSS, HTML — no framework, no build step
- GitHub Pages for hosting
- Service worker for offline support and caching
- `localStorage` for favorites and bar inventory

---

## Feedback & Bug Reports

Found a bug or want to request a feature? [Open an issue on GitHub](https://github.com/matthewjordan191/CocktailRecipeRepository/issues).
