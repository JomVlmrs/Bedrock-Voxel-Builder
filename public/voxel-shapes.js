(() => {
  const tbody = document.getElementById("shapeRows");
  const search = document.getElementById("shapeSearch");
  const family = document.getElementById("familyFilter");
  const count = document.getElementById("resultCount");
  const total = document.getElementById("shapeTotal");
  const empty = document.getElementById("emptyState");
  const clear = document.getElementById("clearFilters");
  const normalize = value => String(value || "").toLowerCase().trim();

  function makeCell(className, text) {
    const cell = document.createElement("td");
    if (className) cell.className = className;
    if (text !== undefined) cell.textContent = text;
    return cell;
  }

  function render(rows) {
    tbody.replaceChildren();
    rows.forEach(item => {
      const tr = document.createElement("tr");
      tr.dataset.category = item.category;
      tr.dataset.search = normalize(item.identifier + " " + item.notes);

      const shapeCell = makeCell("shape-cell");
      const preview = document.createElement("a");
      preview.className = "shape-preview";
      preview.href = item.image;
      preview.target = "_blank";
      preview.rel = "noopener noreferrer";
      preview.setAttribute("aria-label", "Open shape preview for " + item.identifier);
      const image = document.createElement("img");
      image.src = item.image;
      image.alt = "Voxel shape preview: " + item.identifier;
      image.loading = "lazy";
      image.decoding = "async";
      image.width = 100;
      image.height = 100;
      preview.append(image);
      shapeCell.append(preview);

      const identifierCell = makeCell("identifier-cell");
      const actions = document.createElement("div");
      actions.className = "identifier-actions";
      const code = document.createElement("code");
      code.className = "identifier-code";
      code.textContent = item.identifier;
      const copy = document.createElement("button");
      copy.className = "copy-id";
      copy.type = "button";
      copy.textContent = "Copy ID";
      copy.setAttribute("aria-label", "Copy " + item.identifier);
      copy.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(item.identifier);
          copy.textContent = "Copied";
          window.setTimeout(() => { copy.textContent = "Copy ID"; }, 1200);
        } catch {
          copy.textContent = "Select ID";
          const range = document.createRange();
          range.selectNodeContents(code);
          const selection = window.getSelection();
          selection.removeAllRanges();
          selection.addRange(range);
        }
      });
      actions.append(code, copy);
      identifierCell.append(actions);

      const notesCell = makeCell("shape-notes", item.notes || "No additional notes listed.");
      if (!item.notes) notesCell.classList.add("empty");

      tr.append(shapeCell, identifierCell, notesCell);
      tbody.append(tr);
    });
  }

  function applyFilters() {
    const query = normalize(search.value);
    const category = family.value;
    let visible = 0;
    tbody.querySelectorAll("tr").forEach(row => {
      const matchText = !query || row.dataset.search.includes(query);
      const matchCategory = category === "all" || row.dataset.category === category;
      const show = matchText && matchCategory;
      row.hidden = !show;
      if (show) visible++;
    });
    count.textContent = visible + " of " + tbody.querySelectorAll("tr").length + " shapes";
    empty.hidden = visible !== 0;
  }

  search.addEventListener("input", applyFilters);
  family.addEventListener("change", applyFilters);
  clear.addEventListener("click", () => {
    search.value = "";
    family.value = "all";
    applyFilters();
    search.focus();
  });
  document.addEventListener("keydown", event => {
    if (event.key === "/" && !["INPUT","TEXTAREA","SELECT"].includes(document.activeElement?.tagName)) {
      event.preventDefault();
      search.focus();
    }
    if (event.key === "Escape" && document.activeElement === search) {
      search.value = "";
      applyFilters();
      search.blur();
    }
  });

  fetch("./voxel-shapes.json")
    .then(response => {
      if (!response.ok) throw new Error("Could not load voxel shape reference data.");
      return response.json();
    })
    .then(data => {
      const rows = Array.isArray(data.rows) ? data.rows : [];
      total.textContent = rows.length;
      render(rows);
      applyFilters();
    })
    .catch(error => {
      tbody.replaceChildren();
      const row = document.createElement("tr");
      const cell = makeCell("loading-cell", error.message || "Could not load the reference data.");
      cell.colSpan = 3;
      row.append(cell);
      tbody.append(row);
      count.textContent = "Unavailable";
    });
})();