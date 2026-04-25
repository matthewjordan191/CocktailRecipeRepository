// ── Views ──────────────────────────────────────────────────────────────────
const viewList   = document.getElementById("view-list");
const viewDetail = document.getElementById("view-detail");

function showList() {
  viewDetail.hidden = true;
  viewList.hidden = false;
  document.title = "Cocktail Recipes";
}

function showDetail(cocktail) {
  viewList.hidden = true;
  viewDetail.hidden = false;
  renderDetail(cocktail);
  document.title = cocktail.name;
  window.scrollTo(0, 0);
}

// ── Detail renderer ────────────────────────────────────────────────────────
function formatAmount(ing) {
  if (ing.amount == null) return ing.raw || "";
  const amt = Number.isInteger(ing.amount) ? ing.amount : ing.amount;
  return `${amt} ${ing.unit ?? ""}`.trim();
}

function renderDetail(c) {
  document.getElementById("detail-name").textContent = c.name;

  // Meta chips: method, glass
  const meta = document.getElementById("detail-meta");
  meta.innerHTML = "";
  for (const val of [c.method, c.glass].filter(Boolean)) {
    const chip = document.createElement("span");
    chip.className = "chip";
    chip.textContent = val;
    meta.appendChild(chip);
  }

  // Ingredients
  const ingList = document.getElementById("ingredient-list");
  ingList.innerHTML = "";
  for (const ing of c.ingredients) {
    const li = document.createElement("li");
    const amount = formatAmount(ing);
    const notes = ing.notes ? ` (${ing.notes})` : "";
    li.innerHTML = amount
      ? `<span class="ing-amount">${amount}</span><span class="ing-name">${ing.name}${notes}</span>`
      : `<span class="ing-name ing-full">${ing.name}${notes}</span>`;
    ingList.appendChild(li);
  }

  // Garnish
  const garnishSec = document.getElementById("detail-garnish");
  if (c.garnish) {
    document.getElementById("garnish-text").textContent = c.garnish;
    garnishSec.hidden = false;
  } else {
    garnishSec.hidden = true;
  }

  // Instructions
  const instrSec = document.getElementById("detail-instructions");
  if (c.instructions) {
    document.getElementById("instructions-text").textContent = c.instructions;
    instrSec.hidden = false;
  } else {
    instrSec.hidden = true;
  }

  // Tags
  const tagsSec = document.getElementById("detail-tags");
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
  } else {
    tagsSec.hidden = true;
  }
}

// ── Back button ────────────────────────────────────────────────────────────
document.getElementById("back-btn").addEventListener("click", showList);

// ── List + search ──────────────────────────────────────────────────────────
async function init() {
  const list  = document.getElementById("cocktail-list");
  const count = document.getElementById("count");
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

  const total = cocktails.length;
  count.textContent = `${total} cocktails`;

  const fragment = document.createDocumentFragment();
  for (const cocktail of cocktails) {
    const li = document.createElement("li");
    li.textContent = cocktail.name;
    li.dataset.name = cocktail.name.toLowerCase();
    li.addEventListener("click", () => showDetail(cocktail));
    fragment.appendChild(li);
  }
  list.appendChild(fragment);

  const items  = list.querySelectorAll("li");
  const search = document.getElementById("search");

  search.addEventListener("input", () => {
    const query = search.value.toLowerCase().trim();
    let visible = 0;
    for (const li of items) {
      const match = !query || li.dataset.name.includes(query);
      li.hidden = !match;
      if (match) visible++;
    }
    count.textContent = query
      ? `${visible} of ${total} cocktails`
      : `${total} cocktails`;
  });
}

init();
