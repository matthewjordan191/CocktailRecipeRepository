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

  const total = cocktails.length;
  count.textContent = `${total} cocktails`;

  const fragment = document.createDocumentFragment();
  for (const cocktail of cocktails) {
    const li = document.createElement("li");
    li.textContent = cocktail.name;
    li.dataset.id = cocktail.id;
    li.dataset.name = cocktail.name.toLowerCase();
    fragment.appendChild(li);
  }
  list.appendChild(fragment);

  const items = list.querySelectorAll("li");
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
