/* record/receipt-row (founder kit §21): LABEL + CODE, NEVER A BUTTON.
 *
 * A record, not a control: no focus, no click, no role beyond a description list. Pair it with
 * Copy line when the id needs to travel. A row that is not real says SAMPLE in its own text
 * (data.rows[i].sample), so a screenshot can never pass a placeholder off as a receipt.
 * The id is never truncated: overflow-wrap:anywhere lets it break instead (faces.css .wf-receipt).
 *
 *   mountFace(root, { family: "receipt", data: { rows: [{ label: "Mark bought", value: "rcpt_…" },
 *                                                       { label: "Site saved", value: "rcpt_ ids unbuilt", sample: true }] } })
 */
import { el } from "./input.mjs";

export function renderReceipt(root, spec) {
  const rows = Array.isArray(spec.data.rows) ? spec.data.rows : [];
  root.append(el("dl", { class: "wf-receipts" }, rows.map((row) =>
    el("div", { class: "wf-receipt", "data-sample": row.sample ? "" : null }, [
      el("dt", { text: row.label }),
      el("dd", {}, [el("code", { text: row.sample ? `SAMPLE — ${row.value}` : String(row.value) })]),
    ]))));
}
