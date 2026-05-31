if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js");
}

const STORAGE_KEY = "cocktail-bar-inventory";

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

// Match a single query word against a name (exact substring, per-word
// subsequence, or per-word trigram similarity for typo tolerance).
function wordMatch(token, name) {
  if (name.includes(token)) return true;
  if (token.length < 3) return false;
  if (name.split(" ").some(word => isSubsequence(token, word))) return true;
  const qt = trigrams(token);
  return name.split(" ").some(word => {
    const nt = trigrams(word);
    if (nt.size === 0) return false;
    let shared = 0;
    for (const g of qt) if (nt.has(g)) shared++;
    return (2 * shared) / (qt.size + nt.size) > 0.45;
  });
}

function fuzzyMatch(query, name) {
  if (name.includes(query)) return true;
  // Multi-word queries: require every word to match so the search narrows
  // instead of matching every "… Cocktail" via the shared common word.
  const tokens = query.split(/\s+/).filter(Boolean);
  if (tokens.length > 1) return tokens.every(t => wordMatch(t, name));
  if (query.length < 3) return false;
  // Subsequence check per word: catches abbreviations like "daq" → "daiquiri".
  if (name.split(" ").some(word => isSubsequence(query, word))) return true;
  // Trigram similarity: catches misspellings like "margerita" → "margarita".
  const qt = trigrams(query);
  const nt = trigrams(name);
  let shared = 0;
  for (const g of qt) if (nt.has(g)) shared++;
  return (2 * shared) / (qt.size + nt.size) > 0.3;
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
  ["bourbon", "bourbon"], ["rye whiskey", "rye whiskey"], ["scotch", "scotch"],
  ["irish whiskey", "irish whiskey"], ["whiskey", "whiskey"], ["whisky", "whiskey"],
  ["gin", "gin"],
  ["pot still rum", "rum"], ["overproof rum", "rum"], ["white rum", "rum"],
  ["light rum", "rum"], ["gold rum", "rum"], ["dark rum", "rum"],
  ["spiced rum", "rum"], ["aged rum", "rum"], ["jamaican rum", "rum"], ["rum", "rum"],
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

function baseIngredient(name) {
  const n = normalizeIngName(name);
  for (const [kw, base] of SPIRIT_FAMILIES) {
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
firebase.initializeApp({
  apiKey:            "AIzaSyAP2CK6O8Q3r1_ENk5J--JgqfVD4oWPE3o",
  authDomain:        "cocktailrepository.firebaseapp.com",
  projectId:         "cocktailrepository",
  storageBucket:     "cocktailrepository.firebasestorage.app",
  messagingSenderId: "55261064714",
  appId:             "1:55261064714:web:878091784d9db20c0cf9f3",
});
const auth     = firebase.auth();
const db       = firebase.firestore();
const provider = new firebase.auth.GoogleAuthProvider();
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

function showView(name) {
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
  renderDetail(cocktail);
  document.title = cocktail.name;
  history.pushState(null, "", "#" + slugify(cocktail.name));
  showView("detail");
  window.scrollTo(0, 0);
}

document.getElementById("back-btn").addEventListener("click", () => {
  document.title = "Cocktail Recipes";
  history.replaceState(null, "", location.pathname + location.search);
  showView(previousView);
});

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
      previousView = "list";
      showView("list");
      window.scrollTo(0, 0);
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
        previousView = "list";
        showView("list");
        window.scrollTo(0, 0);
      });
      tagsList.appendChild(li);
    }
    tagsSec.hidden = false;
  } else { tagsSec.hidden = true; }
}

// ── Ingredient matching ────────────────────────────────────────────────────
// A cocktail ingredient is "covered" if any selected item is a substring of
// its name or its name is a substring of the selected item.
// e.g. selecting "rum" covers "white rum", "dark rum", "spiced rum".
function isCovered(ingName, selectedSet) {
  // Bar inventory stores base spirits, so match on base first.
  if (selectedSet.has(baseIngredient(ingName))) return true;
  // Fallback: substring match for specific-name filters (e.g. browsing by a
  // specific ingredient tapped on a recipe) and legacy inventory entries.
  const n = normalizeIngName(ingName);
  for (const sel of selectedSet) {
    if (n.includes(sel) || sel.includes(n)) return true;
  }
  return false;
}

function scoreCocktail(cocktail, selectedSet) {
  // Only gate on alcoholic ingredients — juices, mixers, garnishes assumed available.
  const ings = cocktail.ingredients.filter(i => i.name && isAlcoholicIngredient(i.name));
  const missing = ings.filter(i => !isCovered(i.name, selectedSet));
  return { total: ings.length, missingCount: missing.length, missing };
}

// ── Bar view ───────────────────────────────────────────────────────────────
function initBar(allIngredients) {
  const ingSearch   = document.getElementById("ing-search");
  const ingList     = document.getElementById("ing-list");
  const barSubtitle = document.getElementById("bar-subtitle");

  function updateSubtitle() {
    const n = inventory.size;
    barSubtitle.textContent = n === 0
      ? "Check off what you have"
      : `${n} ingredient${n === 1 ? "" : "s"} in your bar`;
  }

  function renderIngredients() {
    const query = ingSearch.value.toLowerCase().trim();
    const filtered = query
      ? allIngredients.filter(name => name.includes(query))
      : allIngredients;

    ingList.innerHTML = "";
    const sorted = [
      ...filtered.filter(n => inventory.has(n)),
      ...filtered.filter(n => !inventory.has(n)),
    ];

    const frag = document.createDocumentFragment();
    for (const name of sorted) {
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
    ingList.appendChild(frag);
  }

  ingSearch.addEventListener("input", renderIngredients);

  updateSubtitle();
  renderIngredients();
  return renderIngredients;
}

// ── Browse view ────────────────────────────────────────────────────────────
function initBrowse(cocktails) {
  const list      = document.getElementById("cocktail-list");
  const count     = document.getElementById("count");
  const filterBar = document.getElementById("filter-bar");
  const search    = document.getElementById("search");
  const total     = cocktails.length;

  count.textContent = `${total} cocktails`;

  const frag = document.createDocumentFragment();
  const items = [];
  for (const cocktail of cocktails) {
    const li = document.createElement("li");
    li.textContent = cocktail.name;
    li.dataset.name = cocktail.name.toLowerCase();
    li._tagSet = new Set(cocktail.tags || []);
    li._cocktail = cocktail;
    li.addEventListener("click", () => { previousView = "list"; showDetail(cocktail); });
    frag.appendChild(li);
    items.push(li);
  }
  list.appendChild(frag);

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
    const filterTags = activeFilter ? new Set(activeFilter.tags) : null;
    const ingFilterSet = activeIngredientFilter ? new Set([activeIngredientFilter]) : null;
    let visible = 0;
    for (const li of items) {
      const matchesSearch = !query || fuzzyMatch(query, li.dataset.name);
      const matchesFilter = !filterTags || [...filterTags].some(t => li._tagSet.has(t));
      let matchesMakeable = true;
      if (makeableActive) {
        const s = scoreCocktail(li._cocktail, inventory);
        matchesMakeable = s.total > 0 && s.missingCount === 0;
      }
      const matchesIng = !ingFilterSet ||
        li._cocktail.ingredients.some(i => i.name && isCovered(i.name, ingFilterSet));
      li.hidden = !(matchesSearch && matchesFilter && matchesMakeable && matchesIng);
      if (!li.hidden) visible++;
    }
    count.textContent = (query || filterTags || makeableActive || activeIngredientFilter)
      ? `${visible} of ${total} cocktails`
      : `${total} cocktails`;
  }

  search.addEventListener("input", applyFilters);

  document.getElementById("random-btn").addEventListener("click", () => {
    const visible = items.filter(li => !li.hidden);
    if (!visible.length) return;
    const li = visible[Math.floor(Math.random() * visible.length)];
    previousView = "list";
    showDetail(li._cocktail);
  });

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
        const li = document.createElement("li");
        li.textContent = cocktail.name;
        li.addEventListener("click", () => { previousView = "favorites"; showDetail(cocktail); });
        frag.appendChild(li);
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

// Distinct alcoholic base ingredients in a cocktail (spirits consolidated via
// baseIngredient so all rums reinforce each other, etc.).
function recIngredients(cocktail) {
  const out = new Set();
  for (const ing of cocktail.ingredients || []) {
    if (ing.name && isAlcoholicIngredient(ing.name)) out.add(baseIngredient(ing.name));
  }
  return out;
}

function getRecommendations(cocktails, limit = 20) {
  if (favorites.size === 0) return [];

  // Document frequencies across the whole library, for inverse-frequency
  // weighting: a trait shared by few cocktails is more telling of taste than
  // a ubiquitous one (e.g. "creamy" matters more than "classic").
  const N = cocktails.length;
  const tagDf = {};
  const ingDf = {};
  for (const c of cocktails) {
    for (const tag of c.tags || []) {
      if (!REC_TAG_EXCLUDE.has(tag)) tagDf[tag] = (tagDf[tag] || 0) + 1;
    }
    for (const ing of recIngredients(c)) ingDf[ing] = (ingDf[ing] || 0) + 1;
  }
  const idf = df => Math.log(N / (df || 1));

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

  const INGREDIENT_BOOST = 1.5;
  return cocktails
    .filter(c => !favorites.has(c.name))
    .map(c => {
      let score = 0;
      for (const tag of c.tags || []) {
        if (tagFreq[tag]) score += tagFreq[tag] * idf(tagDf[tag]);
      }
      for (const ing of recIngredients(c)) {
        if (ingFreq[ing]) score += ingFreq[ing] * idf(ingDf[ing]) * INGREDIENT_BOOST;
      }
      return { cocktail: c, score };
    })
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
      const li = document.createElement("li");
      li.textContent = cocktail.name;
      li.addEventListener("click", () => { previousView = "recommended"; showDetail(cocktail); });
      frag.appendChild(li);
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

  // Build the bar checklist from alcoholic ingredients, collapsed to base
  // spirits so the list stays shelf-level rather than listing every variant.
  const ingSet = new Set();
  for (const c of cocktails) {
    for (const i of c.ingredients) {
      if (i.name && isAlcoholicIngredient(i.name)) {
        ingSet.add(baseIngredient(i.name));
      }
    }
  }
  const allIngredients = [...ingSet].sort();

  currentUser = user;
  updateAuthBtn(user);
  await loadFromCloud(user.uid);

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
  refreshBar        = initBar(allIngredients);

  // Persistent listener for auth changes after initial load.
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

  const cocktailsBySlug = new Map(cocktails.map(c => [slugify(c.name), c]));

  // Handle browser back/forward through cocktail detail views.
  window.addEventListener("hashchange", () => {
    const slug = location.hash.slice(1);
    if (!slug) {
      document.title = "Cocktail Recipes";
      showView(previousView);
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
    renderDetail(initialCocktail);
    document.title = initialCocktail.name;
    showView("detail");
  } else {
    showView("list");
  }
}

// Boot: show sign-in screen until Firebase confirms a signed-in user.
let appBooted = false;

document.getElementById("signin-btn").addEventListener("click", () => {
  auth.signInWithPopup(provider).catch(err => console.error("Sign-in failed:", err));
});

auth.onAuthStateChanged(async user => {
  if (user && !appBooted) {
    appBooted = true;
    document.getElementById("view-signin").hidden = true;
    await init(user);
  } else if (!user && appBooted) {
    location.reload();
  }
});
