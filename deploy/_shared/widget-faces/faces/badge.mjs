import { el } from "./el.mjs";


export function renderBadge(root, spec) {
  const items = Array.isArray(spec.data.items) ? spec.data.items : [];
  const row = el("div", { class: "wf-badge-row", role: "list" });

  items.forEach((item) => {
    row.append(el("span", {
      class: "wf-badge",
      role: "listitem",
      "data-variant": item.variant || "neutral",
      text: item.label,
      title: item.detail || "",
    }));
  });

  root.append(el("div", { class: "wf-badges" }, [
    el("p", { class: "wf-label", text: spec.data.title || "Gate status chips" }),
    row,
    el("p", {
      class: "wf-badge-note",
      text: spec.data.note || "Variants map to recorded gate truth — not decorative color.",
    }),
  ]));
}
