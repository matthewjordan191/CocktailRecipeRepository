"""Shared utilities for web scraping: robots.txt checking, polite HTTP fetch, sitemap parsing."""
import json
import time
import xml.etree.ElementTree as ET
from urllib.parse import urlparse
from urllib.robotparser import RobotFileParser

import requests

USER_AGENT = "CocktailRecipeBot/1.0 (https://github.com/matthewjordan191/CocktailRecipeRepository)"

_robots_cache: dict[str, RobotFileParser] = {}


def _get_robots(base_url: str) -> RobotFileParser:
    parsed = urlparse(base_url)
    origin = f"{parsed.scheme}://{parsed.netloc}"
    if origin not in _robots_cache:
        rp = RobotFileParser()
        rp.set_url(f"{origin}/robots.txt")
        try:
            rp.read()
        except Exception:
            pass
        _robots_cache[origin] = rp
    return _robots_cache[origin]


def robots_allowed(url: str) -> bool:
    return _get_robots(url).can_fetch(USER_AGENT, url)


def polite_get(url: str, delay: float = 1.5, timeout: int = 20, **kwargs) -> requests.Response:
    time.sleep(delay)
    headers = kwargs.pop("headers", {})
    headers.setdefault("User-Agent", USER_AGENT)
    resp = requests.get(url, headers=headers, timeout=timeout, **kwargs)
    resp.raise_for_status()
    return resp


def fetch_sitemap_urls(sitemap_url: str, filter_prefix: str = "") -> list[str]:
    """Return all <loc> URLs from a sitemap XML, optionally filtered by prefix."""
    resp = polite_get(sitemap_url, delay=0.5)
    root = ET.fromstring(resp.content)
    ns = {"sm": "http://www.sitemaps.org/schemas/sitemap/0.9"}
    urls = [loc.text.strip() for loc in root.findall(".//sm:loc", ns) if loc.text]
    if filter_prefix:
        urls = [u for u in urls if u.startswith(filter_prefix)]
    return urls


def extract_jsonld(html: str) -> dict | None:
    """Extract the first schema.org/Recipe JSON-LD block from a page's HTML."""
    from bs4 import BeautifulSoup
    soup = BeautifulSoup(html, "lxml")
    for script in soup.find_all("script", type="application/ld+json"):
        try:
            data = json.loads(script.string or "")
            if data.get("@type") == "Recipe":
                return data
        except (json.JSONDecodeError, AttributeError):
            continue
    return None
