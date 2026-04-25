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

function fuzzyMatch(query, name) {
  if (name.includes(query)) return true;
  if (query.length < 3) return false;
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
  "brandy", "cognac", "mezcal", "pisco", "cachaca", "cachaça", "calvados",
  "grappa", "everclear", "applejack", "absinthe", "ouzo", "pernod", "ricard",
  "anisette", "champagne", "prosecco", "cider", "lager", "stout", "vermouth",
  "sherry", "liqueur", "schnapps", "amaretto", "cointreau", "curacao", "curaçao",
  "campari", "aperol", "drambuie", "galliano", "chartreuse", "benedictine",
  "bénédictine", "sambuca", "frangelico", "malibu", "kahlua", "kahlúa",
  "midori", "passoa", "lillet", "dubonnet", "advocaat", "falernum", "fernet",
  "amaro", "bitters", "absolut", "bacardi", "jager", "goldschlager", "baileys",
  "grand marnier", "triple sec", "southern comfort", "crown royal", "wild turkey",
  "jim beam", "jack daniels", "tia maria", "godiva", "yukon", "sloe",
  "heering", "pisang", "chambord", "creme de", "crème de", "st. germain",
  "beer", "wine", "port", "anis", "apfelkorn",
];

// Ingredient names that match a pattern above but are NOT alcoholic.
const NON_ALCOHOLIC_EXCEPTIONS = new Set([
  "ginger", "ginger ale", "ginger beer", "ginger beer to top up",
  "ginger syrup", "root beer", "cream of coconut", "port wine reduction",
]);

function isAlcoholicIngredient(name) {
  const n = name.toLowerCase().trim();
  if (NON_ALCOHOLIC_EXCEPTIONS.has(n)) return false;
  return ALCOHOLIC_PATTERNS.some(p => n.includes(p));
}

// ── Filter definitions ─────────────────────────────────────────────────────
const FILTERS = [
  { label: "IBA",           tags: ["iba"] },
  { label: "Classics",      tags: ["classic", "contemporaryclassic", "contemporary classics", "the unforgettables"] },
  { label: "New Era",       tags: ["new era drinks", "newera"] },
  { label: "Non-Alcoholic", tags: ["non-alcoholic"] },
  { label: "Shots",         tags: ["shot"] },
  { label: "Coffee",        tags: ["coffee / tea"] },
  { label: "Punch",         tags: ["punch / party drink"] },
  { label: "Sours",         tags: ["sour"] },
  { label: "Festive",       tags: ["christmas", "holiday", "halloween", "winter"] },
];

// ── Inventory (module-level so detail view can read it) ────────────────────
const inventory = new Set(JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]"));

// ── Navigation ─────────────────────────────────────────────────────────────
const views = {
  list:   document.getElementById("view-list"),
  bar:    document.getElementById("view-bar"),
  detail: document.getElementById("view-detail"),
};
const nav = document.getElementById("main-nav");
let previousView = "list";

function showView(name) {
  for (const [key, el] of Object.entries(views)) el.hidden = key !== name;
  nav.hidden = name === "detail";
  nav.querySelectorAll(".nav-btn").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.view === name);
  });
}

nav.addEventListener("click", e => {
  const btn = e.target.closest(".nav-btn");
  if (btn) { previousView = btn.dataset.view; showView(btn.dataset.view); }
});

function showDetail(cocktail) {
  renderDetail(cocktail);
  document.title = cocktail.name;
  showView("detail");
  window.scrollTo(0, 0);
}

document.getElementById("back-btn").addEventListener("click", () => {
  document.title = "Cocktail Recipes";
  showView(previousView);
});

// ── Detail renderer ────────────────────────────────────────────────────────
function formatAmount(ing) {
  if (ing.amount == null) return ing.raw || "";
  return `${ing.amount} ${ing.unit ?? ""}`.trim();
}

function renderDetail(c) {
  document.getElementById("detail-name").textContent = c.name;

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
  for (const ing of c.ingredients) {
    const li = document.createElement("li");
    const amount = formatAmount(ing);
    const notes = ing.notes ? ` (${ing.notes})` : "";

    // Colour-code alcoholic ingredients based on inventory.
    let statusClass = "";
    if (inventory.size > 0 && ing.name && isAlcoholicIngredient(ing.name)) {
      statusClass = isCovered(ing.name, inventory) ? " ing-have" : "";
    }

    li.innerHTML = amount
      ? `<span class="ing-amount">${amount}</span><span class="ing-name${statusClass}">${ing.name}${notes}</span>`
      : `<span class="ing-name ing-full${statusClass}">${ing.name}${notes}</span>`;
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
      li.className = "tag";
      li.textContent = tag;
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
  for (const sel of selectedSet) {
    if (ingName.includes(sel) || sel.includes(ingName)) return true;
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
        updateSubtitle();
        if (!ingSearch.value.trim()) renderIngredients();
      });

      const label = document.createElement("label");
      label.htmlFor = id;
      label.textContent = name;

      li.appendChild(cb);
      li.appendChild(label);
      frag.appendChild(li);
    }
    ingList.appendChild(frag);
  }

  ingSearch.addEventListener("input", renderIngredients);

  updateSubtitle();
  renderIngredients();
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
    li.addEventListener("click", () => { previousView = "list"; showDetail(cocktail); });
    frag.appendChild(li);
    items.push(li);
  }
  list.appendChild(frag);

  let activeFilter = null;
  const pills = FILTERS.map(f => {
    const btn = document.createElement("button");
    btn.className = "filter-pill";
    btn.textContent = f.label;
    btn.addEventListener("click", () => {
      if (activeFilter === f) {
        activeFilter = null;
        btn.classList.remove("active");
      } else {
        pills.forEach(p => p.classList.remove("active"));
        btn.classList.add("active");
        activeFilter = f;
      }
      applyFilters();
    });
    filterBar.appendChild(btn);
    return btn;
  });

  function applyFilters() {
    const query = search.value.toLowerCase().trim();
    const filterTags = activeFilter ? new Set(activeFilter.tags) : null;
    let visible = 0;
    for (const li of items) {
      const matchesSearch = !query || fuzzyMatch(query, li.dataset.name);
      const matchesFilter = !filterTags || [...filterTags].some(t => li._tagSet.has(t));
      li.hidden = !(matchesSearch && matchesFilter);
      if (!li.hidden) visible++;
    }
    count.textContent = (query || filterTags)
      ? `${visible} of ${total} cocktails`
      : `${total} cocktails`;
  }

  search.addEventListener("input", applyFilters);
}

// ── Boot ───────────────────────────────────────────────────────────────────
async function init() {
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

  // Extract alcoholic ingredient names only for the bar checklist.
  const ingSet = new Set();
  for (const c of cocktails) {
    for (const i of c.ingredients) {
      if (i.name && isAlcoholicIngredient(i.name)) {
        ingSet.add(i.name.toLowerCase().trim());
      }
    }
  }
  const allIngredients = [...ingSet].sort();

  initBrowse(cocktails);
  initBar(allIngredients);

  showView("list");
}

init();
