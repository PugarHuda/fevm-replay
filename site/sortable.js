// Every column of a table marked data-sortable sorts on a click (or Enter on
// its header): numbers as numbers (12,345, 1.2 s, 26%, −1,024), the rest as
// text; again to reverse. Rows filled in later are sorted as they are then.
function sortable(table) {
  table.querySelectorAll("thead th").forEach((th, col) => {
    // A column without a heading (a chart, a bar) has nothing to sort by.
    if (!th.textContent.trim()) return;
    const b = document.createElement("button");
    b.type = "button";
    b.append(...th.childNodes);
    th.append(b);
    b.addEventListener("click", () => {
      const down = th.getAttribute("aria-sort") !== "descending";
      table.querySelectorAll("thead th").forEach((x) => x.removeAttribute("aria-sort"));
      th.setAttribute("aria-sort", down ? "descending" : "ascending");
      const key = (tr) => {
        const t = tr.children[col]?.textContent.trim() ?? "";
        const n = parseFloat(t.replace(/−/g, "-").replace(/,/g, "").replace(/^[^\d.+-]+/, ""));
        return Number.isNaN(n) ? t : n;
      };
      const body = table.querySelector("tbody");
      const rows = [...body.rows].sort((x, y) => {
        const a = key(x), c = key(y);
        const d = typeof a === "number" && typeof c === "number" ? a - c : String(a).localeCompare(String(c));
        return down ? -d : d;
      });
      body.append(...rows);
    });
  });
}
document.querySelectorAll("table[data-sortable]").forEach(sortable);
