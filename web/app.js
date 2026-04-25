async function init() {
  const list = document.getElementById("cocktail-list");
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

  count.textContent = `${cocktails.length} cocktails`;

  const fragment = document.createDocumentFragment();
  for (const cocktail of cocktails) {
    const li = document.createElement("li");
    li.textContent = cocktail.name;
    li.dataset.id = cocktail.id;
    fragment.appendChild(li);
  }
  list.appendChild(fragment);
}

init();
