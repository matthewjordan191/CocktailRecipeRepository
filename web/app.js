if ("serviceWorker" in navigator) {
  // Whether this page load was already controlled by a service worker.
  // controllerchange also fires when the very first worker claims the page;
  // only a change *from* an existing worker means a new version deployed.
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register("./sw.js");
  // The worker uses skipWaiting + clients.claim, so a new version takes over
  // mid-session — this page's JS is then stale against the refreshed caches.
  // Offer a refresh instead of reloading underneath the user.
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (hadController) showUpdateToast();
  });
}

function showUpdateToast() {
  if (document.getElementById("update-toast")) return;
  const toast = document.createElement("div");
  toast.id = "update-toast";
  toast.setAttribute("role", "status");
  const msg = document.createElement("span");
  msg.textContent = "A new version is available.";
  const btn = document.createElement("button");
  btn.textContent = "Refresh";
  btn.addEventListener("click", () => location.reload());
  toast.append(msg, btn);
  document.body.appendChild(toast);
}

const STORAGE_KEY = "cocktail-bar-inventory";

// Trailing-edge debounce: delays fn until `ms` after the last call. `.cancel()`
// drops a pending call (used when an immediate apply supersedes typing).
function debounce(fn, ms) {
  let timer;
  const wrapped = (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
  wrapped.cancel = () => clearTimeout(timer);
  return wrapped;
}

// ── Fuzzy search ───────────────────────────────────────────────────────────
function trigrams(str) {
  const s = str.toLowerCase();
  const out = new Set();
  for (let i = 0; i <= s.length - 3; i++) out.add(s.slice(i, i + 3));
  return out;
}

function isSubsequence(query, str) {
  let qi = 0;
  for (let i = 0; i < str.length && qi < query.length; i++) {
    if (str[i] === query[qi]) qi++;
  }
  return qi === query.length;
}

// Precompile the query side of fuzzy matching once per keystroke. The browse
// filter runs the matcher against every cocktail, so the token list and
// trigram sets (which depend only on the query) are built here, not per item.
function compileQuery(query) {
  const tokens = query.split(/\s+/).filter(Boolean);
  return {
    query,
    tokens,
    // Trigram set per token (multi-word typo tolerance); null for short tokens.
    tokenTrigrams: tokens.map(t => (t.length >= 3 ? trigrams(t) : null)),
    // Trigram set of the whole query (single-word path); null when too short.
    queryTrigrams: query.length >= 3 ? trigrams(query) : null,
  };
}

// Score a single query word against a name, using the token's precomputed
// trigram set (qt): exact substring, per-word subsequence, or per-word trigram
// similarity for typo tolerance. 0 = no match; higher = stronger match.
function wordMatchScore(token, qt, name) {
  if (name.includes(token)) {
    // Word-start matches read as more intentional than mid-word hits
    // ("mar" → "Blue Margarita" over "Amaretto Sour").
    return name.startsWith(token) || name.includes(" " + token) ? 80 : 70;
  }
  if (token.length < 3) return 0;
  if (name.split(" ").some(word => isSubsequence(token, word))) return 40;
  let best = 0;
  for (const word of name.split(" ")) {
    const nt = trigrams(word);
    if (nt.size === 0) continue;
    let shared = 0;
    for (const g of qt) if (nt.has(g)) shared++;
    const sim = (2 * shared) / (qt.size + nt.size);
    if (sim > 0.45) best = Math.max(best, 10 + sim * 20);
  }
  return best;
}

// Score a precompiled query against a name. 0 = no match. Tiers: exact (100)
// > prefix (90) > word-start (85) > substring (75) > all-words (≤80 avg)
// > subsequence (40) > trigram similarity (≤30). The browse list sorts
// matches by this score so e.g. "mar" surfaces Margarita before names that
// merely contain the letters.
function matchScore(q, name) {
  if (name.includes(q.query)) {
    if (name === q.query) return 100;
    if (name.startsWith(q.query)) return 90;
    if (name.includes(" " + q.query)) return 85;
    return 75;
  }
  // Multi-word queries: require every word to match so the search narrows
  // instead of matching every "… Cocktail" via the shared common word.
  if (q.tokens.length > 1) {
    let sum = 0;
    for (let i = 0; i < q.tokens.length; i++) {
      const s = wordMatchScore(q.tokens[i], q.tokenTrigrams[i], name);
      if (s === 0) return 0;
      sum += s;
    }
    return sum / q.tokens.length;   // per-word avg ≤ 80, below any phrase hit
  }
  if (!q.queryTrigrams) return 0;   // query shorter than a trigram
  // Subsequence check per word: catches abbreviations like "daq" → "daiquiri".
  if (name.split(" ").some(word => isSubsequence(q.query, word))) return 40;
  // Trigram similarity: catches misspellings like "margerita" → "margarita".
  const qt = q.queryTrigrams;
  const nt = trigrams(name);
  let shared = 0;
  for (const g of qt) if (nt.has(g)) shared++;
  const sim = (2 * shared) / (qt.size + nt.size);
  return sim > 0.3 ? 10 + sim * 20 : 0;
}

// ── Alcoholic ingredient filter ────────────────────────────────────────────
// Substrings that reliably indicate an alcoholic ingredient.
const ALCOHOLIC_PATTERNS = [
  "vodka", "gin", "rum", "tequila", "whiskey", "whisky", "bourbon", "scotch",
  "brandy", "cognac", "mezcal", "pisco", "cachaca", "calvados",
  "grappa", "everclear", "applejack", "absinthe", "ouzo", "pernod", "ricard",
  "anisette", "champagne", "prosecco", "cider", "lager", "stout", "vermouth",
  "sherry", "liqueur", "schnapps", "amaretto", "cointreau", "curacao",
  "campari", "aperol", "drambuie", "galliano", "chartreuse", "benedictine",
  "sambuca", "frangelico", "malibu", "kahlua",
  "midori", "passoa", "lillet", "dubonnet", "advocaat", "falernum", "fernet",
  "amaro", "bitters", "absolut", "bacardi", "jager", "goldschlager", "baileys",
  "grand marnier", "triple sec", "southern comfort", "crown royal", "wild turkey",
  "jim beam", "jack daniels", "tia maria", "godiva", "yukon", "sloe",
  "heering", "pisang", "chambord", "creme de", "st. germain",
  "beer", "wine", "port", "anis", "apfelkorn",
];

// Ingredient names that match a pattern above but are NOT alcoholic.
const NON_ALCOHOLIC_EXCEPTIONS = new Set([
  "ginger", "ginger ale", "ginger beer", "ginger beer to top up",
  "ginger syrup", "root beer", "cream of coconut", "port wine reduction",
  "apple cider vinegar",
]);

function isAlcoholicIngredient(name) {
  const n = normalizeIngName(name);
  if (NON_ALCOHOLIC_EXCEPTIONS.has(n)) return false;
  return ALCOHOLIC_PATTERNS.some(p => n.includes(p));
}

// Canonical form for deduplication and matching.
// Strips accents and possessives so variants like "cachaça"/"cachaca" and
// "peychaud's bitters"/"peychaud bitters" collapse to the same entry.
function normalizeIngName(name) {
  return name
    .toLowerCase()
    .trim()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")  // cachaça→cachaca, kahlúa→kahlua
    .replace(/['']\s*s\b/g, "")  // possessives: peychaud's→peychaud
    .replace(/['']/g, "")         // any remaining apostrophes
    .replace(/\s+/g, " ")
    .trim();
}

// Base-spirit canonicalisation for the My Bar checklist. Difford's names spirits
// very specifically ("aged jamaican rum", "op high ester pot still rum"); these
// collapse to a base ("rum") so the bar stays a manageable shelf-level checklist.
// First matching keyword wins. Non-spirits (flavoured liqueurs, bitters, amari,
// wines) are kept distinct so "makeable" matching stays correct — only their
// names are cleaned of parentheticals and "alc. free" qualifiers.
const SPIRIT_FAMILIES = [
  ["sloe gin", "sloe gin"],
  ["bourbon", "bourbon"], ["jim beam", "bourbon"],
  ["rye whiskey", "rye whiskey"], ["scotch", "scotch"],
  ["irish whiskey", "irish whiskey"], ["jack daniel", "whiskey"],
  ["whiskey", "whiskey"], ["whisky", "whiskey"],
  ["gin", "gin"],
  ["pot still rum", "rum"], ["overproof rum", "rum"], ["white rum", "rum"],
  ["light rum", "rum"], ["gold rum", "rum"], ["dark rum", "rum"],
  ["spiced rum", "rum"], ["aged rum", "rum"], ["jamaican rum", "rum"],
  ["bacardi", "rum"], ["rum", "rum"],
  ["mezcal", "mezcal"], ["tequila", "tequila"],
  ["cognac", "brandy"], ["armagnac", "brandy"], ["apple brandy", "calvados"],
  ["calvados", "calvados"], ["pisco", "pisco"],
  ["apricot brandy", "apricot brandy"], ["cherry brandy", "cherry brandy"],
  ["brandy", "brandy"],
  ["absolut", "vodka"], ["vodka", "vodka"], ["cachaca", "cachaca"],
  ["sweet vermouth", "sweet vermouth"], ["rosso vermouth", "sweet vermouth"],
  ["vermouth (rosso)", "sweet vermouth"], ["dry vermouth", "dry vermouth"],
  ["vermouth", "vermouth"],
  ["amaro", "amaro"], ["fernet", "fernet"],
];

// Synonym/variant folding for non-spirit bottles, checked after spirit
// families (so e.g. "xo champagne cognac" stays brandy). First match wins;
// more specific keywords must precede the broader ones they contain.
const INGREDIENT_ALIASES = [
  ["chartreuse green", "green chartreuse"], ["green chartreuse", "green chartreuse"],
  ["chartreuse yellow", "yellow chartreuse"], ["yellow chartreuse", "yellow chartreuse"],
  ["creme de banane", "banana liqueur"],
  ["rose champagne", "rose champagne"],
  ["champagne", "brut sparkling wine"],
  ["quinquina", "red quinquina"], ["dubonnet", "red quinquina"],
  ["blue curacao", "blue curacao"],
  ["almond milk amaretto", "almond milk amaretto"],
  ["amaretto", "amaretto"],
  ["galliano espresso", "galliano espresso"],
  ["galliano", "galliano"],
  ["black sambuca", "black sambuca"],
  ["sambuca", "sambuca"],
  ["pilsner lager", "pilsner lager"],
  ["stout beer", "stout beer"],
  ["grappa", "grappa"],
  ["red wine", "red wine"],
  ["eau-de-vie", "eau-de-vie"],
  ["cider", "cider"],
  ["chambord", "black raspberry liqueur"],
  ["kahlua", "coffee liqueur"],
  ["cointreau", "triple sec"],
  ["campari", "red bitter liqueur"],
  ["baileys", "irish cream liqueur"], ["irish cream", "irish cream liqueur"],
];

function baseIngredient(name) {
  const n = normalizeIngName(name);
  for (const [kw, base] of SPIRIT_FAMILIES) {
    if (n.includes(kw)) return base;
  }
  for (const [kw, base] of INGREDIENT_ALIASES) {
    if (n.includes(kw)) return base;
  }
  // Keep distinct, but strip parenthetical notes and alcohol-free qualifiers.
  return n
    .replace(/\s*\([^)]*\)/g, "")
    .replace(/\b(?:alc\.?\s*free|alcohol-free)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function slugify(name) {
  return name
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// ── Filter definitions ─────────────────────────────────────────────────────
// Base spirits are the headline browse axis, shown in the always-visible row.
const SPIRIT_FILTERS = [
  { label: "Gin", tag: "gin" }, { label: "Whiskey", tag: "whiskey" },
  { label: "Rum", tag: "rum" }, { label: "Vodka", tag: "vodka" },
  { label: "Tequila", tag: "tequila" }, { label: "Brandy", tag: "brandy" },
  { label: "Sparkling", tag: "sparkling" },
];

// Remaining tags, grouped into labeled sections in the expandable panel.
const TAG_GROUPS = [
  { label: "Flavor", tags: [
    { label: "Spirit-forward", tag: "spirit-forward" }, { label: "Fruity", tag: "fruity" },
    { label: "Sour", tag: "sour" }, { label: "Bittersweet", tag: "bittersweet" },
    { label: "Herbal", tag: "herbal" }, { label: "Creamy", tag: "creamy" },
    { label: "Spicy", tag: "spicy" }, { label: "Floral", tag: "floral" },
    { label: "Savory", tag: "savory" }, { label: "Nutty", tag: "nutty" },
    { label: "Dessert", tag: "dessert" },
  ]},
  { label: "Occasion", tags: [
    { label: "Aperitif", tag: "aperitif" }, { label: "After-dinner", tag: "after-dinner" },
    { label: "Nightcap", tag: "nightcap" }, { label: "Brunch", tag: "brunch" },
    { label: "Summer", tag: "summer" }, { label: "Winter", tag: "winter" },
    { label: "Festive", tag: "festive" }, { label: "Party", tag: "party" },
    { label: "Romantic", tag: "romantic" },
  ]},
  { label: "Style", tags: [
    { label: "Highball", tag: "highball" }, { label: "Martini", tag: "martini" },
    { label: "Tropical", tag: "tropical" }, { label: "Frozen", tag: "frozen" },
    { label: "Hot", tag: "hot" }, { label: "Shot", tag: "shot" },
    { label: "Layered", tag: "layered" },
  ]},
  { label: "Collection", tags: [
    { label: "Classic", tag: "classic" }, { label: "New Era", tag: "new era" },
    { label: "IBA", tag: "iba" }, { label: "Must-try", tag: "must-try" },
    { label: "Punch", tag: "punch" }, { label: "Coffee", tag: "coffee" },
    { label: "Non-Alcoholic", tag: "non-alcoholic" },
  ]},
];

// ── Inventory (module-level so detail view can read it) ────────────────────
// Normalize on load so old stored names stay compatible after name cleanup.
const inventory = new Set(
  JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]").map(normalizeIngName)
);

// ── Favourites ─────────────────────────────────────────────────────────────
const FAVORITES_KEY = "cocktail-bar-favorites";
const favorites = new Set(JSON.parse(localStorage.getItem(FAVORITES_KEY) || "[]"));

// ── Firebase sync ─────────────────────────────────────────────────────────
// The SDK loads cross-origin from gstatic, so it can be missing offline (or
// blocked). The app must still boot in local-only mode: localStorage
// favorites/inventory, no sign-in, no ratings.
let auth = null, db = null, provider = null;
if (typeof firebase !== "undefined") {
  firebase.initializeApp({
    apiKey:            "AIzaSyAP2CK6O8Q3r1_ENk5J--JgqfVD4oWPE3o",
    authDomain:        "cocktailrepository.firebaseapp.com",
    projectId:         "cocktailrepository",
    storageBucket:     "cocktailrepository.firebasestorage.app",
    messagingSenderId: "55261064714",
    appId:             "1:55261064714:web:878091784d9db20c0cf9f3",
  });
  auth     = firebase.auth();
  db       = firebase.firestore();
  provider = new firebase.auth.GoogleAuthProvider();
}
let currentUser = null;

function userDocRef(uid) {
  return db.collection("users").doc(uid).collection("data").doc("sync");
}

async function saveToCloud() {
  if (!currentUser) return;
  try {
    await userDocRef(currentUser.uid).set({
      favorites: [...favorites],
      inventory: [...inventory],
    });
  } catch (err) {
    console.warn("Cloud sync failed:", err);
  }
}

async function loadFromCloud(uid) {
  try {
    const snap = await userDocRef(uid).get();
    if (!snap.exists) { saveToCloud(); return; }
    const data = snap.data();
    (data.favorites || []).forEach(n => favorites.add(n));
    (data.inventory || []).map(normalizeIngName).forEach(n => inventory.add(n));
    localStorage.setItem(FAVORITES_KEY, JSON.stringify([...favorites]));
    localStorage.setItem(STORAGE_KEY,   JSON.stringify([...inventory]));
  } catch (err) {
    console.warn("Cloud load failed:", err);
  }
}

const authBtn = document.getElementById("auth-btn");

function updateAuthBtn(user) {
  if (user) {
    authBtn.textContent = user.displayName?.split(" ")[0] || "Account";
    authBtn.title = `${user.email} — click to sign out`;
    authBtn.classList.add("signed-in");
  } else {
    authBtn.textContent = "Sign in";
    authBtn.title = "Sign in to sync across devices";
    authBtn.classList.remove("signed-in");
  }
}

authBtn.addEventListener("click", () => {
  if (!auth) return;   // local-only mode: sign-in unavailable
  if (currentUser) {
    auth.signOut();
  } else {
    auth.signInWithPopup(provider).catch(err => console.error("Sign-in failed:", err));
  }
});

// ── Ratings ───────────────────────────────────────────────────────────────
function ratingsRef(slug) {
  return db.collection("ratings").doc(slug).collection("votes");
}

async function loadRating(slug) {
  try {
    const snap = await ratingsRef(slug).get();
    const votes = {};
    snap.forEach(doc => { votes[doc.id] = doc.data().rating; });
    const vals = Object.values(votes);
    const avg = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
    return { avg, count: vals.length, userRating: currentUser ? (votes[currentUser.uid] ?? null) : null };
  } catch (err) {
    console.warn("Rating load failed:", err);
    return { avg: null, count: 0, userRating: null };
  }
}

async function submitRating(slug, rating) {
  if (!currentUser) return;
  try {
    await ratingsRef(slug).doc(currentUser.uid).set({ rating });
  } catch (err) {
    console.warn("Rating submit failed:", err);
  }
}

async function renderRatingUI(container, slug) {
  container.dataset.slug = slug;
  const { avg, count, userRating } = await loadRating(slug);
  if (container.dataset.slug !== slug) return; // navigated away, discard

  container.innerHTML = "";

  const summary = document.createElement("p");
  summary.className = "rating-summary";
  if (count > 0) {
    const filled = Math.round(avg);
    summary.textContent = `${"★".repeat(filled)}${"☆".repeat(5 - filled)} ${avg.toFixed(1)} (${count} rating${count === 1 ? "" : "s"})`;
  } else {
    summary.textContent = "No ratings yet";
    summary.classList.add("rating-none");
  }
  container.appendChild(summary);

  if (currentUser) {
    const starsDiv = document.createElement("div");
    starsDiv.className = "rating-stars";
    const stars = [];

    function updateStarDisplay(upTo) {
      const val = upTo ?? userRating ?? 0;
      stars.forEach((s, i) => s.classList.toggle("filled", i < val));
    }

    starsDiv.addEventListener("mouseleave", () => updateStarDisplay(null));

    for (let i = 1; i <= 5; i++) {
      const star = document.createElement("button");
      star.className = "star-btn";
      star.textContent = "★";
      star.setAttribute("aria-label", `Rate ${i} out of 5`);
      star.addEventListener("mouseenter", () => updateStarDisplay(i));
      star.addEventListener("click", async () => {
        await submitRating(slug, i);
        renderRatingUI(container, slug);
      });
      stars.push(star);
      starsDiv.appendChild(star);
    }
    updateStarDisplay(null);

    const label = document.createElement("p");
    label.className = "rating-label";
    label.textContent = userRating ? `Your rating: ${userRating}/5` : "Tap stars to rate";

    container.appendChild(starsDiv);
    container.appendChild(label);
  } else {
    const prompt = document.createElement("p");
    prompt.className = "rating-label";
    prompt.textContent = "Sign in to rate";
    container.appendChild(prompt);
  }
}

// Set by initBrowse / initFavorites once views are ready; used by renderDetail.
let filterByTag = null;
let filterByIngredient = null;
let refreshFavorites = null;
let refreshRecommended = null;
let refreshBar = null;

// ── Navigation ─────────────────────────────────────────────────────────────
const views = {
  list:        document.getElementById("view-list"),
  favorites:   document.getElementById("view-favorites"),
  recommended: document.getElementById("view-recommended"),
  bar:         document.getElementById("view-bar"),
  detail:      document.getElementById("view-detail"),
};
const nav = document.getElementById("main-nav");
let previousView = "list";
let currentView = "list";
// All cocktails, set once on load — used by similarity scoring from the
// detail view (which doesn't otherwise have the full list in scope).
let allCocktails = [];
// Remember scroll position per list view so returning from a recipe lands
// where you were instead of at the top.
const savedScroll = { list: 0, favorites: 0, recommended: 0 };

function showView(name) {
  currentView = name;
  for (const [key, el] of Object.entries(views)) el.hidden = key !== name;
  nav.hidden = name === "detail";
  nav.querySelectorAll(".nav-btn").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.view === name);
  });
  if (name === "favorites"   && refreshFavorites)   refreshFavorites();
  if (name === "recommended" && refreshRecommended) refreshRecommended();
}

nav.addEventListener("click", e => {
  const btn = e.target.closest(".nav-btn");
  if (btn) { previousView = btn.dataset.view; showView(btn.dataset.view); }
});

function showDetail(cocktail) {
  // Save scroll only when leaving a list view, so detail→detail navigation
  // (e.g. tapping a "similar" cocktail) doesn't overwrite the list position.
  if (currentView in savedScroll) savedScroll[currentView] = window.scrollY;
  renderDetail(cocktail);
  document.title = cocktail.name;
  history.pushState(null, "", "#" + slugify(cocktail.name));
  showView("detail");
  window.scrollTo(0, 0);
}

document.getElementById("back-btn").addEventListener("click", () => {
  // Step back one entry in history; the hashchange handler renders the
  // previous screen — another recipe (if reached via "similar") or the list.
  history.back();
});

// Jump from a recipe to the (filtered) browse list. Drops the recipe hash so
// Back from any recipe opened next returns to this list, not the recipe.
function showListFromDetail() {
  history.replaceState(null, "", location.pathname + location.search);
  previousView = "list";
  showView("list");
  window.scrollTo(0, 0);
}

// Shared list row: thumbnail + name. `fromView` sets the view to return to on
// back; omit it (e.g. detail→detail "similar" navigation) to leave it unchanged.
function makeCocktailRow(cocktail, fromView) {
  const li = document.createElement("li");
  li.className = "cocktail-row";

  const thumb = document.createElement("span");
  thumb.className = "cocktail-thumb";
  if (cocktail.image_url) {
    const img = document.createElement("img");
    img.loading = "lazy";
    img.decoding = "async";
    img.alt = "";
    img.src = cocktail.image_url;
    img.addEventListener("error", () => { thumb.classList.add("is-empty"); img.remove(); });
    thumb.appendChild(img);
  } else {
    thumb.classList.add("is-empty");
  }

  const name = document.createElement("span");
  name.className = "cocktail-row-name";
  name.textContent = cocktail.name;

  li.append(thumb, name);
  li.addEventListener("click", () => {
    if (fromView) previousView = fromView;
    showDetail(cocktail);
  });
  return li;
}

// ── Detail renderer ────────────────────────────────────────────────────────
function formatAmount(ing) {
  if (ing.amount == null) return "";
  return `${ing.amount} ${ing.unit ?? ""}`.trim();
}

function renderDetail(c) {
  document.getElementById("detail-name").textContent = c.name;

  const favBtn = document.getElementById("fav-btn");
  const updateFavBtn = () => {
    const isFav = favorites.has(c.name);
    favBtn.textContent = isFav ? "★" : "☆";
    favBtn.classList.toggle("active", isFav);
  };
  updateFavBtn();
  favBtn.onclick = () => {
    if (favorites.has(c.name)) favorites.delete(c.name); else favorites.add(c.name);
    localStorage.setItem(FAVORITES_KEY, JSON.stringify([...favorites]));
    saveToCloud();
    updateFavBtn();
    if (refreshFavorites) refreshFavorites();
  };

  renderRatingUI(document.getElementById("rating-content"), slugify(c.name));

  const img = document.getElementById("detail-img");
  if (c.image_url) {
    img.src = c.image_url;
    img.alt = c.name;
    img.hidden = false;
  } else {
    img.hidden = true;
  }

  const meta = document.getElementById("detail-meta");
  meta.innerHTML = "";
  for (const val of [c.method, c.glass].filter(Boolean)) {
    const chip = document.createElement("span");
    chip.className = "chip";
    chip.textContent = val;
    meta.appendChild(chip);
  }

  const ingList = document.getElementById("ingredient-list");
  ingList.innerHTML = "";

  // Equal-parts detection: all amounted ingredients share the same fractional
  // "piece" amount (e.g. ABC where each is stored as raw "1/3" with no unit).
  const amountedIngs = c.ingredients.filter(i => i.amount != null);
  const isEqualParts = amountedIngs.length >= 2 &&
    amountedIngs.every(i => i.unit === "piece" && i.amount < 1 && i.amount === amountedIngs[0].amount);

  for (const ing of c.ingredients) {
    const li = document.createElement("li");
    const amount = isEqualParts && ing.amount != null ? "1 part" : formatAmount(ing);

    // Colour-code alcoholic ingredients based on inventory.
    let statusClass = "";
    if (inventory.size > 0 && ing.name && isAlcoholicIngredient(ing.name)) {
      statusClass = isCovered(ing.name, inventory) ? " ing-have" : " ing-missing";
    }

    if (amount) {
      const amountSpan = document.createElement("span");
      amountSpan.className = "ing-amount";
      amountSpan.textContent = amount;
      li.appendChild(amountSpan);
    }
    const nameSpan = document.createElement("span");
    nameSpan.className = amount ? `ing-name${statusClass}` : `ing-name ing-full${statusClass}`;
    nameSpan.textContent = ing.name + (ing.notes ? ` (${ing.notes})` : "");
    nameSpan.classList.add("ing-clickable");
    nameSpan.title = `Browse cocktails with ${ing.name}`;
    nameSpan.addEventListener("click", () => {
      if (filterByIngredient) filterByIngredient(ing.name);
      showListFromDetail();
    });
    li.appendChild(nameSpan);
    ingList.appendChild(li);
  }

  const garnishSec = document.getElementById("detail-garnish");
  if (c.garnish) {
    document.getElementById("garnish-text").textContent = c.garnish;
    garnishSec.hidden = false;
  } else { garnishSec.hidden = true; }

  const instrSec = document.getElementById("detail-instructions");
  if (c.instructions) {
    document.getElementById("instructions-text").textContent = c.instructions;
    instrSec.hidden = false;
  } else { instrSec.hidden = true; }

  const tagsSec  = document.getElementById("detail-tags");
  const tagsList = document.getElementById("tags-list");
  tagsList.innerHTML = "";
  if (c.tags?.length) {
    for (const tag of c.tags) {
      const li = document.createElement("li");
      li.className = "tag tag-link";
      li.textContent = tag;
      li.addEventListener("click", () => {
        if (filterByTag) filterByTag(tag);
        showListFromDetail();
      });
      tagsList.appendChild(li);
    }
    tagsSec.hidden = false;
  } else { tagsSec.hidden = true; }

  const similarSec  = document.getElementById("detail-similar");
  const similarList = document.getElementById("similar-list");
  similarList.innerHTML = "";
  const similar = getSimilar(c);
  if (similar.length) {
    for (const s of similar) similarList.appendChild(makeCocktailRow(s));
    similarSec.hidden = false;
  } else { similarSec.hidden = true; }
}

// ── Ingredient matching ────────────────────────────────────────────────────
// A cocktail ingredient is "covered" if any selected item is a substring of
// its name or its name is a substring of the selected item.
// e.g. selecting "rum" covers "white rum", "dark rum", "spiced rum".
// Coverage core: an ingredient (given its base spirit + normalized name) is
// covered when the bar has its base spirit, or — fallback — a selected item
// substring-matches its specific name. The fallback handles specific-name
// ingredient filters (tapped on a recipe) and legacy inventory entries.
function coveredBy(item, selectedSet) {
  if (selectedSet.has(item.base)) return true;
  for (const sel of selectedSet) {
    if (item.norm.includes(sel) || sel.includes(item.norm)) return true;
  }
  return false;
}

function isCovered(ingName, selectedSet) {
  return coveredBy({ base: baseIngredient(ingName), norm: normalizeIngName(ingName) }, selectedSet);
}

// Per-cocktail alcoholic ingredients with their base spirit and normalized
// name, computed once and cached. Reused by the Makeable filter and by
// recIngredients so the classification work isn't redone on every keystroke.
function alcoholicCoverage(cocktail) {
  if (cocktail._alcCov) return cocktail._alcCov;
  const out = [];
  for (const ing of cocktail.ingredients || []) {
    if (ing.name && isAlcoholicIngredient(ing.name)) {
      out.push({ base: baseIngredient(ing.name), norm: normalizeIngName(ing.name) });
    }
  }
  cocktail._alcCov = out;
  return out;
}

// "Makeable" gating: only alcoholic ingredients matter (juices, mixers,
// garnishes assumed on hand). Reuses the cached coverage list rather than
// re-running isAlcoholicIngredient + baseIngredient + normalizeIngName for
// every ingredient on every keystroke.
function scoreCocktail(cocktail, inventorySet) {
  const list = alcoholicCoverage(cocktail);
  let missingCount = 0;
  for (const item of list) if (!coveredBy(item, inventorySet)) missingCount++;
  return { total: list.length, missingCount };
}

// ── Bar view ───────────────────────────────────────────────────────────────
// Bottles used by fewer cocktails than this are hidden from the checklist
// (the long tail is one-off obscurities); anything already checked is always
// shown so a stored bar never has invisible entries.
const MIN_BAR_USES = 5;

const BAR_CATEGORY_ORDER = [
  "Spirits", "Liqueurs & more", "Vermouth & fortified", "Bitters", "Wine, beer & cider",
];

function barCategory(name) {
  if (/\b(gin|vodka|rum|tequila|mezcal|whiskey|bourbon|scotch|brandy|pisco|cachaca|calvados|absinthe|grappa|aquavit|akvavit|ouzo|arrack|soju|shochu|baijiu|moonshine|eau-de-vie)\b/.test(name)) return "Spirits";
  if (/vermouth|sherry|\bport\b|quinquina|lillet|madeira|chinato|\bsake\b/.test(name)) return "Vermouth & fortified";
  if (/bitters/.test(name)) return "Bitters";
  if (/wine|prosecco|cava|champagne|beer|lager|stout|\bale\b|cider|perry/.test(name)) return "Wine, beer & cider";
  return "Liqueurs & more";
}

function initBar(barCounts) {
  const ingSearch   = document.getElementById("ing-search");
  const ingList     = document.getElementById("ing-list");
  const barSubtitle = document.getElementById("bar-subtitle");
  const barClear    = document.getElementById("bar-clear");

  function updateSubtitle() {
    const n = inventory.size;
    barSubtitle.textContent = n === 0
      ? "Check off what you have"
      : `${n} ingredient${n === 1 ? "" : "s"} in your bar`;
    barClear.hidden = n === 0;
  }

  barClear.addEventListener("click", () => {
    const n = inventory.size;
    if (!n) return;
    if (!confirm(`Uncheck all ${n} ingredient${n === 1 ? "" : "s"} in your bar?`)) return;
    inventory.clear();
    localStorage.setItem(STORAGE_KEY, JSON.stringify([]));
    saveToCloud();
    updateSubtitle();
    renderIngredients();
  });

  function renderIngredients() {
    const query = ingSearch.value.toLowerCase().trim();

    const items = [];
    for (const [name, count] of barCounts) {
      if (count >= MIN_BAR_USES || inventory.has(name)) items.push({ name, count });
    }
    for (const name of inventory) {
      if (!barCounts.has(name)) items.push({ name, count: 0 });
    }
    const filtered = query ? items.filter(i => i.name.includes(query)) : items;

    ingList.innerHTML = "";
    const frag = document.createDocumentFragment();
    for (const cat of BAR_CATEGORY_ORDER) {
      // Within each category: checked bottles first, then by popularity.
      const group = filtered
        .filter(i => barCategory(i.name) === cat)
        .sort((a, b) =>
          (inventory.has(b.name) - inventory.has(a.name)) ||
          (b.count - a.count) ||
          a.name.localeCompare(b.name));
      if (!group.length) continue;

      const heading = document.createElement("li");
      heading.className = "ing-group-label";
      heading.setAttribute("aria-hidden", "true");
      heading.textContent = cat;
      frag.appendChild(heading);

      renderGroupRows(group, frag);
    }
    ingList.appendChild(frag);
  }

  function renderGroupRows(group, frag) {
    for (const { name } of group) {
      const li = document.createElement("li");
      li.className = "ing-check-item";

      const id = `ing-${name.replace(/\s+/g, "-")}`;
      const cb = document.createElement("input");
      cb.type    = "checkbox";
      cb.id      = id;
      cb.checked = inventory.has(name);
      cb.addEventListener("change", () => {
        if (cb.checked) inventory.add(name); else inventory.delete(name);
        localStorage.setItem(STORAGE_KEY, JSON.stringify([...inventory]));
        saveToCloud();
        updateSubtitle();
        if (!ingSearch.value.trim()) renderIngredients();
      });

      const label = document.createElement("label");
      label.htmlFor = id;
      label.textContent = name;

      const browseBtn = document.createElement("button");
      browseBtn.className = "ing-browse-btn";
      browseBtn.setAttribute("aria-label", `Browse cocktails with ${name}`);
      browseBtn.title = `Browse cocktails with ${name}`;
      browseBtn.textContent = "→";
      browseBtn.addEventListener("click", () => {
        if (filterByIngredient) filterByIngredient(name);
        previousView = "list";
        showView("list");
        window.scrollTo(0, 0);
      });

      li.appendChild(cb);
      li.appendChild(label);
      li.appendChild(browseBtn);
      frag.appendChild(li);
    }
  }

  ingSearch.addEventListener("input", renderIngredients);

  function refresh() {
    updateSubtitle();
    renderIngredients();
  }
  refresh();
  return refresh;
}

// ── Browse view ────────────────────────────────────────────────────────────
function initBrowse(cocktails) {
  const list      = document.getElementById("cocktail-list");
  const count      = document.getElementById("count");
  const filterBar  = document.getElementById("filter-bar");
  const search     = document.getElementById("search");
  const searchClear = document.getElementById("search-clear");
  const browseEmpty = document.getElementById("browse-empty");
  const browseClear = document.getElementById("browse-clear");
  const total      = cocktails.length;

  count.textContent = `${total} cocktails`;

  // Precompute searchable fields once; rows are created lazily (see below).
  for (const cocktail of cocktails) {
    cocktail._lname = cocktail.name.toLowerCase();
    cocktail._tagSet = new Set(cocktail.tags || []);
  }

  // Windowed rendering: only a page of matching rows is in the DOM at a time,
  // with more appended as the user scrolls. Keeps the DOM light for ~6.9k
  // cocktails instead of mounting every row up front.
  const PAGE = 60;
  let filtered = cocktails;   // current match set
  let rendered = 0;           // how many of `filtered` are in the DOM

  const sentinel = document.createElement("li");
  sentinel.id = "list-sentinel";
  sentinel.setAttribute("aria-hidden", "true");

  const makeRow = cocktail => makeCocktailRow(cocktail, "list");

  function renderNextPage() {
    const end = Math.min(rendered + PAGE, filtered.length);
    const frag = document.createDocumentFragment();
    for (let i = rendered; i < end; i++) frag.appendChild(makeRow(filtered[i]));
    list.insertBefore(frag, sentinel);
    rendered = end;
    if (rendered >= filtered.length) observer.unobserve(sentinel);
  }

  const observer = new IntersectionObserver(entries => {
    if (entries.some(e => e.isIntersecting) && rendered < filtered.length) renderNextPage();
  }, { rootMargin: "600px" });

  function renderList() {
    list.replaceChildren(sentinel);
    rendered = 0;
    renderNextPage();
    if (rendered < filtered.length) observer.observe(sentinel);
  }

  let activeFilter = null;
  let activeIngredientFilter = null;

  // Tag frequencies — used to label chips and hide empty ones.
  const tagCounts = {};
  for (const cocktail of cocktails) {
    for (const tag of cocktail.tags || []) {
      tagCounts[tag] = (tagCounts[tag] || 0) + 1;
    }
  }

  const allPills = [];
  function makePill(label, tag, container) {
    if (!tagCounts[tag]) return null;   // skip tags with no cocktails
    const btn = document.createElement("button");
    btn.className = "filter-pill";
    btn.textContent = label;
    btn._tag = tag;
    btn.addEventListener("click", () => {
      const isActive = activeFilter && activeFilter.tags[0] === tag;
      allPills.forEach(p => p.classList.remove("active"));
      activeFilter = isActive ? null : { tags: [tag] };
      if (!isActive) btn.classList.add("active");
      applyFilters();
    });
    container.appendChild(btn);
    allPills.push(btn);
    return btn;
  }

  // Always-visible spirit row.
  SPIRIT_FILTERS.forEach(f => makePill(f.label, f.tag, filterBar));

  // Makeable pill — shows only cocktails fully covered by the current bar.
  let makeableActive = false;
  const makeableBtn = document.createElement("button");
  makeableBtn.className = "filter-pill";
  makeableBtn.textContent = "Makeable";
  makeableBtn.disabled = inventory.size === 0;
  makeableBtn.title = inventory.size === 0 ? "Add ingredients to My Bar first" : "";
  makeableBtn.addEventListener("click", () => {
    makeableActive = !makeableActive;
    makeableBtn.classList.toggle("active", makeableActive);
    applyFilters();
  });
  filterBar.appendChild(makeableBtn);

  // More button toggles the grouped panel.
  const moreBtn = document.createElement("button");
  moreBtn.className = "filter-pill filter-more";
  moreBtn.textContent = "More ▾";
  filterBar.appendChild(moreBtn);

  // Ingredient filter chip — shown when user navigates here via an ingredient click.
  const ingChip = document.createElement("div");
  ingChip.id = "ing-filter-chip";
  ingChip.hidden = true;
  const ingChipText = document.createElement("span");
  const ingChipClear = document.createElement("button");
  ingChipClear.className = "ing-filter-clear";
  ingChipClear.setAttribute("aria-label", "Clear ingredient filter");
  ingChipClear.textContent = "×";
  ingChipClear.addEventListener("click", () => {
    activeIngredientFilter = null;
    ingChip.hidden = true;
    applyFilters();
  });
  ingChip.appendChild(ingChipText);
  ingChip.appendChild(ingChipClear);
  filterBar.insertAdjacentElement("afterend", ingChip);

  // Build grouped sections in the expandable panel.
  const allTagsPanel = document.getElementById("all-tags-panel");
  let panelOpen = false;
  for (const group of TAG_GROUPS) {
    const section = document.createElement("div");
    section.className = "filter-group";
    const heading = document.createElement("h3");
    heading.className = "filter-group-label";
    heading.textContent = group.label;
    const chips = document.createElement("div");
    chips.className = "filter-group-chips";
    let any = false;
    for (const t of group.tags) {
      if (makePill(t.label, t.tag, chips)) any = true;
    }
    if (any) {
      section.appendChild(heading);
      section.appendChild(chips);
      allTagsPanel.appendChild(section);
    }
  }

  const spiritTagSet = new Set(SPIRIT_FILTERS.map(f => f.tag));
  function filterByTag(tag) {
    allPills.forEach(p => p.classList.remove("active"));
    activeFilter = { tags: [tag] };
    const match = allPills.find(p => p._tag === tag);
    if (match) match.classList.add("active");
    // Reveal the grouped panel so a non-spirit filter chip is visible as active.
    if (match && !spiritTagSet.has(tag) && !panelOpen) {
      panelOpen = true;
      allTagsPanel.hidden = false;
      moreBtn.textContent = "Less ▴";
    }
    applyFilters();
  }

  function filterByIngredientFn(name) {
    activeIngredientFilter = normalizeIngName(name);
    ingChipText.textContent = `Includes: ${name}`;
    ingChip.hidden = false;
    // Clear tag and makeable filters to avoid zero-result combinations.
    activeFilter = null;
    allPills.forEach(p => p.classList.remove("active"));
    makeableActive = false;
    makeableBtn.classList.remove("active");
    applyFilters();
  }

  moreBtn.addEventListener("click", () => {
    panelOpen = !panelOpen;
    allTagsPanel.hidden = !panelOpen;
    moreBtn.textContent = panelOpen ? "Less ▴" : "More ▾";
  });

  function applyFilters() {
    const query = search.value.toLowerCase().trim();
    const compiledQuery = query ? compileQuery(query) : null;
    const filterTag = activeFilter ? activeFilter.tags[0] : null;
    const ingFilterSet = activeIngredientFilter ? new Set([activeIngredientFilter]) : null;

    filtered = cocktails.filter(c => {
      if (compiledQuery) {
        const score = matchScore(compiledQuery, c._lname);
        if (score === 0) return false;
        c._score = score;
      }
      if (filterTag && !c._tagSet.has(filterTag)) return false;
      if (makeableActive) {
        const s = scoreCocktail(c, inventory);
        if (!(s.total > 0 && s.missingCount === 0)) return false;
      }
      if (ingFilterSet && !c.ingredients.some(i => i.name && isCovered(i.name, ingFilterSet))) return false;
      return true;
    });

    // Rank search results by relevance; ties go to shorter names ("Margarita"
    // before "Margarita Especial"), then dataset (alphabetical) order via
    // stable sort. Without a query, dataset order is kept as-is.
    if (compiledQuery) {
      filtered.sort((a, b) => b._score - a._score || a._lname.length - b._lname.length);
    }

    const isFiltering = query || filterTag || makeableActive || activeIngredientFilter;
    count.textContent = isFiltering
      ? `${filtered.length} of ${total} cocktails`
      : `${total} cocktails`;

    browseEmpty.hidden = filtered.length > 0;
    renderList();
    window.scrollTo(0, 0);   // a new result set starts from the top
  }

  // Reset every filter back to the full list.
  function clearAllFilters() {
    search.value = "";
    searchClear.hidden = true;
    activeFilter = null;
    activeIngredientFilter = null;
    ingChip.hidden = true;
    makeableActive = false;
    makeableBtn.classList.remove("active");
    allPills.forEach(p => p.classList.remove("active"));
    applyFilters();
  }
  browseClear.addEventListener("click", clearAllFilters);

  // Debounce filtering while typing — each keystroke re-filters all cocktails
  // and rebuilds the list, so coalesce rapid input. The clear (×) toggle stays
  // immediate since it's just showing/hiding the button.
  const debouncedApply = debounce(applyFilters, 120);
  search.addEventListener("input", () => {
    searchClear.hidden = search.value === "";
    debouncedApply();
  });
  searchClear.addEventListener("click", () => {
    search.value = "";
    searchClear.hidden = true;
    search.focus();
    debouncedApply.cancel();   // supersede any pending keystroke filter
    applyFilters();
  });

  document.getElementById("random-btn").addEventListener("click", () => {
    if (!filtered.length) return;
    const pick = filtered[Math.floor(Math.random() * filtered.length)];
    previousView = "list";
    showDetail(pick);
  });

  applyFilters();   // initial render
  return { filterByTag, filterByIngredient: filterByIngredientFn };
}

// ── Favorites view ─────────────────────────────────────────────────────────
function initFavorites(cocktails) {
  const list  = document.getElementById("favorites-list");
  const empty = document.getElementById("fav-empty");
  const count = document.getElementById("fav-count");

  function refresh() {
    list.innerHTML = "";
    const favCocktails = cocktails.filter(c => favorites.has(c.name));
    const n = favCocktails.length;
    if (n === 0) {
      empty.hidden = false;
      count.textContent = "";
    } else {
      empty.hidden = true;
      count.textContent = `${n} recipe${n === 1 ? "" : "s"}`;
      const frag = document.createDocumentFragment();
      for (const cocktail of favCocktails) {
        frag.appendChild(makeCocktailRow(cocktail, "favorites"));
      }
      list.appendChild(frag);
    }
  }

  refresh();
  return refresh;
}

// ── Recommendations ────────────────────────────────────────────────────────
// Pure curation/quality markers, not taste dimensions — excluded from scoring
// so they don't drown out flavor/spirit/occasion signal.
const REC_TAG_EXCLUDE = new Set(["iba", "must-try"]);

const INGREDIENT_BOOST = 1.5;

// Distinct alcoholic base ingredients in a cocktail (spirits consolidated via
// baseIngredient so all rums reinforce each other, etc.). Cached per cocktail,
// derived from the same cached coverage list as the Makeable filter.
function recIngredients(cocktail) {
  if (cocktail._recIngs) return cocktail._recIngs;
  const out = new Set();
  for (const item of alcoholicCoverage(cocktail)) out.add(item.base);
  cocktail._recIngs = out;
  return out;
}

// Library-wide document frequencies for inverse-frequency weighting: a trait
// shared by few cocktails is more telling of taste than a ubiquitous one
// (e.g. "creamy" matters more than "classic"). Computed once and memoized.
let _libStats = null;
function libraryStats() {
  if (_libStats) return _libStats;
  const N = allCocktails.length;
  const tagDf = {};
  const ingDf = {};
  for (const c of allCocktails) {
    for (const tag of c.tags || []) {
      if (!REC_TAG_EXCLUDE.has(tag)) tagDf[tag] = (tagDf[tag] || 0) + 1;
    }
    for (const ing of recIngredients(c)) ingDf[ing] = (ingDf[ing] || 0) + 1;
  }
  _libStats = { tagDf, ingDf, idf: df => Math.log(N / (df || 1)) };
  return _libStats;
}

// Score how well a candidate matches a taste profile (tag → weight maps).
function similarityScore(candidate, tagWeight, ingWeight, idf, tagDf, ingDf) {
  let score = 0;
  for (const tag of candidate.tags || []) {
    if (tagWeight[tag]) score += tagWeight[tag] * idf(tagDf[tag]);
  }
  for (const ing of recIngredients(candidate)) {
    if (ingWeight[ing]) score += ingWeight[ing] * idf(ingDf[ing]) * INGREDIENT_BOOST;
  }
  return score;
}

function getRecommendations(cocktails, limit = 20) {
  if (favorites.size === 0) return [];
  const { tagDf, ingDf, idf } = libraryStats();

  // Taste profile: how many favorites carry each tag / base ingredient.
  const tagFreq = {};
  const ingFreq = {};
  for (const c of cocktails) {
    if (!favorites.has(c.name)) continue;
    for (const tag of c.tags || []) {
      if (!REC_TAG_EXCLUDE.has(tag)) tagFreq[tag] = (tagFreq[tag] || 0) + 1;
    }
    for (const ing of recIngredients(c)) ingFreq[ing] = (ingFreq[ing] || 0) + 1;
  }

  return cocktails
    .filter(c => !favorites.has(c.name))
    .map(c => ({ cocktail: c, score: similarityScore(c, tagFreq, ingFreq, idf, tagDf, ingDf) }))
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(s => s.cocktail);
}

// Cocktails most similar to a single one — same scoring with a one-item profile.
function getSimilar(target, limit = 6) {
  const { tagDf, ingDf, idf } = libraryStats();
  const tagWeight = {};
  for (const tag of target.tags || []) if (!REC_TAG_EXCLUDE.has(tag)) tagWeight[tag] = 1;
  const ingWeight = {};
  for (const ing of recIngredients(target)) ingWeight[ing] = 1;
  if (!Object.keys(tagWeight).length && !Object.keys(ingWeight).length) return [];

  return allCocktails
    .filter(c => c.name !== target.name)
    .map(c => ({ cocktail: c, score: similarityScore(c, tagWeight, ingWeight, idf, tagDf, ingDf) }))
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(s => s.cocktail);
}

function initRecommended(cocktails) {
  const list     = document.getElementById("rec-list");
  const empty    = document.getElementById("rec-empty");
  const subtitle = document.getElementById("rec-subtitle");

  function refresh() {
    list.innerHTML = "";
    const recs = getRecommendations(cocktails);
    if (recs.length === 0) {
      empty.hidden = false;
      subtitle.textContent = "";
      return;
    }
    empty.hidden = true;
    subtitle.textContent = `${recs.length} suggestion${recs.length === 1 ? "" : "s"}`;
    const frag = document.createDocumentFragment();
    for (const cocktail of recs) {
      frag.appendChild(makeCocktailRow(cocktail, "recommended"));
    }
    list.appendChild(frag);
  }

  refresh();
  return refresh;
}

// ── Boot ───────────────────────────────────────────────────────────────────
async function init(user) {
  const error = document.getElementById("error");

  let cocktails;
  try {
    const res = await fetch("cocktails.json");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    cocktails = await res.json();
  } catch (err) {
    error.textContent = `Failed to load cocktails: ${err.message}`;
    error.hidden = false;
    return;
  }
  allCocktails = cocktails;

  // Build the bar checklist from alcoholic ingredients, collapsed to base
  // spirits so the list stays shelf-level rather than listing every variant.
  // Counts (cocktails per base) drive the popularity sort and usage floor.
  const barCounts = new Map();
  for (const c of cocktails) {
    const bases = new Set();
    for (const i of c.ingredients) {
      if (i.name && isAlcoholicIngredient(i.name)) bases.add(baseIngredient(i.name));
    }
    for (const b of bases) barCounts.set(b, (barCounts.get(b) || 0) + 1);
  }

  currentUser = user;
  updateAuthBtn(user);
  if (user) await loadFromCloud(user.uid);

  // Migrate any legacy/specific inventory entries to base names so saved bars
  // map onto the new checklist.
  const migrated = new Set([...inventory].map(baseIngredient));
  if (migrated.size !== inventory.size || [...migrated].some(x => !inventory.has(x))) {
    inventory.clear();
    migrated.forEach(x => inventory.add(x));
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...inventory]));
  }

  const browse      = initBrowse(cocktails);
  filterByTag       = browse.filterByTag;
  filterByIngredient = browse.filterByIngredient;
  refreshFavorites  = initFavorites(cocktails);
  refreshRecommended = initRecommended(cocktails);
  refreshBar        = initBar(barCounts);

  // Persistent listener for auth changes after initial load. In local-only
  // mode (no SDK) there is no auth to listen to — user is null here.
  if (auth) {
    let knownUid = user.uid;
    auth.onAuthStateChanged(async user => {
      const uid = user?.uid ?? null;
      if (uid === knownUid) return;
      knownUid = uid;
      currentUser = user;
      updateAuthBtn(user);
      if (user) {
        await loadFromCloud(user.uid);
        refreshFavorites();
        refreshRecommended();
        refreshBar();
      }
    });
  }

  const cocktailsBySlug = new Map(cocktails.map(c => [slugify(c.name), c]));

  // Handle browser back/forward through cocktail detail views.
  window.addEventListener("hashchange", () => {
    const slug = location.hash.slice(1);
    if (!slug) {
      document.title = "Cocktail Recipes";
      showView(previousView);
      window.scrollTo(0, savedScroll[previousView] || 0);
    } else {
      const cocktail = cocktailsBySlug.get(slug);
      if (cocktail) {
        renderDetail(cocktail);
        document.title = cocktail.name;
        showView("detail");
        window.scrollTo(0, 0);
      }
    }
  });

  // Open directly to a cocktail if the URL already has a hash.
  const initialSlug = location.hash.slice(1);
  const initialCocktail = initialSlug && cocktailsBySlug.get(initialSlug);
  if (initialCocktail) {
    // Seed a list entry beneath the detail so Back returns to the list
    // instead of leaving the app.
    history.replaceState(null, "", location.pathname + location.search);
    history.pushState(null, "", "#" + initialSlug);
    renderDetail(initialCocktail);
    document.title = initialCocktail.name;
    showView("detail");
  } else {
    showView("list");
  }
}

// Boot: show sign-in screen until Firebase confirms a signed-in user.
// Auth state is restored from IndexedDB, so returning users get through the
// gate even offline (as long as the precached SDK loaded).
let appBooted = false;

document.getElementById("signin-btn").addEventListener("click", () => {
  if (!auth) return;
  auth.signInWithPopup(provider).catch(err => console.error("Sign-in failed:", err));
});

if (auth) {
  auth.onAuthStateChanged(async user => {
    if (user && !appBooted) {
      appBooted = true;
      document.getElementById("view-signin").hidden = true;
      await init(user);
    } else if (!user && appBooted) {
      location.reload();
    }
  });
} else {
  // SDK unavailable (offline before it was cached, or blocked): skip the
  // sign-in gate and boot with local data only.
  appBooted = true;
  document.getElementById("view-signin").hidden = true;
  authBtn.disabled = true;
  authBtn.title = "Sign-in unavailable offline";
  init(null);
}
