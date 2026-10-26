/* controls/field (founder kit, Controls Catalog §5) and the chrome Field, Long field
 * (textarea.mjs) and Hunt field (searchbar.mjs) share. One sheet, never a fork.
 * Bring your own palette: every colour is a semantic token, no fallback colour:
 *   --os-fam-surface --os-fam-text --os-fam-muted --os-fam-border --os-fam-accent
 *   --os-status-danger --os-status-warning --os-focus-ring-color, caret from --os-caret-color
 *   (G-CARET-01, set globally in os-tokens and never overridden per field).
 * THE FLOATING LABEL WITHOUT JS: :placeholder-shown is the trick, so every control
 * carries a real placeholder (a single space). data-filled is kept as a second hook.
 * Validate on BLUR, clear on the next keystroke. Enter does nothing (not a submit).
 * Clear exists only when there is text, and returns focus to the input.
 */
import { seededUid } from "./uid.mjs";
const STYLE_ID = "wf-input-family-styles";

export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) {
    if (value == null || value === false) continue;
    if (name === "class") node.className = value;
    else if (name === "text") node.textContent = value;
    else node.setAttribute(name, value === true ? "" : String(value));
  }
  node.append(...children.filter(Boolean));
  return node;
}

export function faceId(prefix) {
  return seededUid(prefix);
}

export function installInputFaceStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = el("style", { id: STYLE_ID });
  style.textContent = `
    .wf-inputs,.wf-textareas,.wf-searchbars,.wf-dropdowns{display:grid;gap:calc(var(--os-space-unit)*3);min-width:0}
    .wf-field-block{display:grid;gap:calc(var(--os-space-unit)*2);min-width:0}
    .wf-field{position:relative;display:grid;min-width:0;border:calc(var(--os-focus-ring-width)/2) solid var(--os-fam-border);border-radius:var(--os-radius-md);background:var(--os-fam-surface);box-shadow:var(--os-press-shadow-out);transition:border-color var(--os-focus-motion-duration) var(--os-focus-motion-easing),box-shadow var(--os-focus-motion-duration) var(--os-focus-motion-easing),transform var(--os-focus-motion-duration) var(--os-focus-motion-easing)}
    .wf-field:hover:not([data-disabled]){border-color:var(--os-fam-accent)}
    .wf-field:focus-within{border-color:var(--os-focus-ring-color);box-shadow:0 0 0 calc(var(--os-focus-ring-width)*2) color-mix(in srgb,var(--os-focus-ring-color) 14%,transparent);transform:translateY(calc(var(--os-press-y)*-1))}
    .wf-field.is-error{--wf-field-state:var(--os-status-danger);border-color:var(--wf-field-state)}
    .wf-field[data-disabled]{opacity:var(--os-press-disabled-opacity);cursor:var(--os-press-disabled-cursor)}
    .wf-field-label{position:absolute;z-index:1;top:calc(var(--os-space-unit)*3);left:calc(var(--os-space-unit)*3);max-width:calc(100% - var(--os-space-unit)*12);color:var(--os-fam-muted);font-size:var(--os-type-meta-size);line-height:var(--os-type-meta-leading);pointer-events:none;transform-origin:left top;transition:transform var(--ss-silk-duration) var(--ss-silk-easing),color var(--os-focus-motion-duration) var(--os-focus-motion-easing)}
    .wf-field:focus-within .wf-field-label,.wf-field[data-filled] .wf-field-label,.wf-field:has(.wf-field-control:not(:placeholder-shown)) .wf-field-label{color:var(--os-fam-accent);transform:translateY(calc(var(--os-space-unit)*-2)) scale(.82)}
    .wf-field-control{width:100%;min-width:0;min-height:calc(var(--os-space-unit)*14);padding:calc(var(--os-space-unit)*6) calc(var(--os-space-unit)*13) calc(var(--os-space-unit)*2) calc(var(--os-space-unit)*3);border:0;border-radius:inherit;background:transparent;color:var(--os-fam-text);font:inherit;font-size:var(--os-type-body-size);line-height:var(--os-type-body-leading)}
    .wf-field-control::-webkit-search-cancel-button{appearance:none}
    .wf-field-control::placeholder{color:transparent}
    .wf-field-control:focus-visible{outline:0;box-shadow:none}
    .wf-field-control:disabled{cursor:var(--os-press-disabled-cursor)}
    /* Dropdown trigger (kit: .wf-field-control.wf-dropdown-trigger). Two classes so the older
       ink-block .wf-dropdown-trigger rule in faces.css can never repaint it. */
    .wf-field-control.wf-dropdown-trigger{justify-self:stretch;min-height:calc(var(--os-space-unit)*14);padding:calc(var(--os-space-unit)*6) calc(var(--os-space-unit)*13) calc(var(--os-space-unit)*2) calc(var(--os-space-unit)*3);border:0;border-radius:inherit;background:transparent;color:var(--os-fam-text);font-size:var(--os-type-body-size);text-align:left;cursor:pointer}
    .wf-native-select{cursor:pointer}.wf-native-select:disabled{cursor:var(--os-press-disabled-cursor)}
    /* input/stepper (kit §22): a real number input between two .bb buttons (button.css), 44px targets */
    .wf-stepper-block{display:grid;gap:calc(var(--os-space-unit)*2)}
    .wf-stepper{display:flex;align-items:center;gap:calc(var(--os-space-unit)*2)}
    .wf-stepper > .bb{min-width:calc(var(--os-space-unit)*11);min-height:calc(var(--os-space-unit)*11)}
    .wf-stepper-value{display:grid;gap:2px;justify-items:center}
    .wf-stepper-label{color:var(--os-fam-muted);font-family:var(--os-font-mono);font-size:var(--os-type-label-size);letter-spacing:var(--os-type-caption-tracking);text-transform:uppercase}
    .wf-stepper-input{box-sizing:border-box;width:calc(var(--os-space-unit)*18);min-height:calc(var(--os-space-unit)*11);margin:0;padding:0 var(--os-space-unit);border:1px solid var(--os-fam-border);border-radius:var(--os-radius-sm);background:var(--os-fam-ground);color:var(--os-fam-text);font-family:var(--os-font-body);font-size:var(--os-type-body-size);text-align:center}
    .wf-stepper-input:focus-visible{outline:var(--os-focus-ring-width) solid var(--os-focus-ring-color);outline-offset:var(--os-focus-ring-offset)}
    .wf-stepper-status{margin:0;color:var(--os-fam-muted);font-size:var(--os-type-label-size);line-height:var(--os-type-label-leading)}
    .wf-stepper-status:empty{display:none}
    /* input/slider (kit §23): the platform range, wrapped; accent-color is the one knob, read from the user's accent */
    .wf-slider{display:grid;gap:calc(var(--os-space-unit)*2);max-width:620px}
    .wf-slider-label{color:var(--os-fam-muted);font-family:var(--os-font-mono);font-size:var(--os-type-label-size);letter-spacing:var(--os-type-caption-tracking);text-transform:uppercase}
    .wf-slider-row{display:flex;align-items:center;gap:calc(var(--os-space-unit)*3)}
    .wf-slider-end{color:var(--os-fam-muted);font-size:var(--os-type-meta-size);white-space:normal}
    .wf-slider-input{flex:1;min-width:calc(var(--os-space-unit)*45);margin:0;accent-color:var(--os-fam-accent);cursor:pointer}
    .wf-slider-input:disabled{cursor:var(--os-press-disabled-cursor)}
    .wf-slider-output{min-width:calc(var(--os-space-unit)*13);color:var(--os-fam-text);font-family:var(--os-font-mono);font-size:var(--os-type-body-size);font-weight:600;text-align:right}
    .wf-field-control.wf-dropdown-trigger:disabled{cursor:var(--os-press-disabled-cursor)}
    .wf-field-action{position:absolute;right:var(--os-space-unit);top:50%;display:inline-grid;place-items:center;min-width:calc(var(--os-space-unit)*11);min-height:calc(var(--os-space-unit)*11);padding:calc(var(--os-space-unit)*2);border:0;border-radius:var(--os-radius-sm);background:transparent;color:var(--os-fam-text);font:inherit;font-size:var(--os-type-label-size);cursor:pointer;transform:translateY(-50%)}
    .wf-field-action[hidden]{display:none}
    .wf-field-status{display:flex;align-items:flex-start;gap:calc(var(--os-space-unit)*2);min-width:0;color:var(--os-fam-muted);font-size:var(--os-type-label-size);line-height:var(--os-type-label-leading)}
    .wf-field-status[data-error]{color:var(--os-status-danger)}
    .wf-field-status-mark{display:inline-grid;flex:0 0 auto;place-items:center;width:calc(var(--os-space-unit)*4);height:calc(var(--os-space-unit)*4);border:calc(var(--os-focus-ring-width)/2) solid currentColor;border-radius:var(--os-radius-sm);font-family:var(--os-font-mono)}
    .wf-field[data-loading]::after{position:absolute;right:calc(var(--os-space-unit)*3);bottom:0;left:calc(var(--os-space-unit)*3);height:var(--os-focus-ring-width);border-radius:var(--os-radius-pill);background:var(--os-fam-accent);content:"";transform-origin:left;animation:wf-field-pulse var(--ss-pulse-duration) var(--ss-snap-easing) infinite}
    .wf-textarea-field{overflow:clip}
    .wf-textarea-control{min-height:calc(var(--os-space-unit)*24);max-height:calc(var(--os-space-unit)*48);padding-right:calc(var(--os-space-unit)*3);resize:none;overflow:auto;transform:none}
    /* More below: at the 48-unit clamp the text scrolls inside the box, and overlay scrollbars
       show nothing until the user scrolls. A shade is pinned to the box's bottom edge (scroll)
       and a surface-coloured cover rides the end of the content (local), so the shade shows
       only while there is text below the fold and vanishes at the end or when it all fits.
       Pure CSS, zero scroll reads; the kit's corner resize grip cannot sit on an autogrow box. */
    .wf-textarea-control{background:linear-gradient(var(--os-fam-surface),var(--os-fam-surface)) 0 100%/100% calc(var(--os-space-unit)*3) no-repeat local,linear-gradient(transparent,color-mix(in srgb,var(--os-fam-text) 18%,transparent)) 0 100%/100% calc(var(--os-space-unit)*3) no-repeat scroll}
    .wf-textarea-grow{display:grid;min-width:0}
    .wf-textarea-grow::after{content:attr(data-value) " ";white-space:pre-wrap;overflow-wrap:anywhere;visibility:hidden;overflow:hidden;pointer-events:none}
    .wf-textarea-grow>.wf-textarea-control,.wf-textarea-grow::after{grid-area:1/1;box-sizing:border-box;min-height:calc(var(--os-space-unit)*24);max-height:calc(var(--os-space-unit)*48);margin:0;padding:calc(var(--os-space-unit)*6) calc(var(--os-space-unit)*3) calc(var(--os-space-unit)*2) calc(var(--os-space-unit)*3);border:0;font-family:inherit;font-size:var(--os-type-body-size);line-height:var(--os-type-body-leading);letter-spacing:normal;word-spacing:normal;tab-size:8}
    .wf-textarea-meta{display:flex;flex-wrap:wrap;justify-content:space-between;gap:calc(var(--os-space-unit)*2)}
    .wf-counter{color:var(--os-fam-muted);font-family:var(--os-font-mono);font-size:var(--os-type-label-size)}
    .wf-counter[data-near]{color:var(--os-status-warning)}
    .wf-counter[data-near]::before{display:inline-block;width:calc(var(--os-space-unit)*2);height:calc(var(--os-space-unit)*2);margin-right:calc(var(--os-space-unit)*2);border-radius:var(--os-radius-pill);background:currentColor;content:"";animation:wf-field-pulse var(--ss-pulse-duration) var(--ss-snap-easing) infinite}
    .wf-textarea-field.limit-tension{border-radius:calc(var(--os-radius-sm)/4)}
    .wf-macros{display:flex;flex-wrap:wrap;gap:calc(var(--os-space-unit)*2)}
    .macro-chip{min-height:calc(var(--os-space-unit)*9);padding:calc(var(--os-space-unit)*2) calc(var(--os-space-unit)*3);border:calc(var(--os-focus-ring-width)/2) solid var(--os-fam-border);border-radius:var(--os-radius-pill);background:transparent;color:var(--os-fam-text);font:inherit;font-size:var(--os-type-label-size);cursor:pointer}
    .wf-search-form{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:calc(var(--os-space-unit)*2);min-width:0}
    .wf-search-form .wf-field{min-width:0}
    .wf-search-submit{min-width:calc(var(--os-space-unit)*11);min-height:calc(var(--os-space-unit)*11);padding:calc(var(--os-space-unit)*2) calc(var(--os-space-unit)*3);border:0;border-radius:var(--os-radius-sm);background:var(--os-fam-text);color:var(--os-fam-ground);font:inherit;font-size:var(--os-type-label-size);cursor:pointer}
    .wf-search-results{display:grid;max-height:calc(var(--os-space-unit)*56);margin:0;padding:var(--os-space-unit);overflow:auto;border:calc(var(--os-focus-ring-width)/2) solid var(--os-fam-border);border-radius:var(--os-radius-md);background:var(--os-fam-surface);list-style:none;box-shadow:var(--os-press-shadow-out)}
    .wf-search-results[hidden]{display:none}
    .wf-search-option{display:grid;gap:var(--os-space-unit);min-width:0;padding:calc(var(--os-space-unit)*2) calc(var(--os-space-unit)*3);border-radius:var(--os-radius-sm);color:var(--os-fam-text);cursor:pointer}
    /* Highlight is the user's accent as a wash with an inset ring (kit: "--os-fam-accent (highlight wash)"),
       not the fixed-blue --os-selection-object-* pair. Inset, as in the kit, so the list's overflow never clips it. */
    .wf-search-option[aria-selected="true"]{background:color-mix(in srgb,var(--os-fam-accent) 14%,transparent);box-shadow:inset 0 0 0 var(--os-focus-ring-width) color-mix(in srgb,var(--os-fam-accent) 40%,transparent)}
    /* Option groups (Select, Command): the heading labels a role=group and is never an option. */
    .wf-option-group,.wf-option-group-rows{display:grid;margin:0;padding:0;list-style:none}
    .wf-option-group-label{padding:calc(var(--os-space-unit)*2) calc(var(--os-space-unit)*3) var(--os-space-unit);color:var(--os-fam-muted);font-family:var(--os-font-mono);font-size:var(--os-type-caption-size);letter-spacing:var(--os-type-caption-tracking);text-transform:uppercase}
    .wf-search-option strong{font-size:var(--os-type-meta-size);font-weight:600;overflow-wrap:anywhere}
    .wf-search-option span,.wf-search-empty{color:var(--os-fam-muted);font-size:var(--os-type-label-size);line-height:var(--os-type-label-leading);overflow-wrap:anywhere}
    .wf-search-empty{padding:calc(var(--os-space-unit)*3)}
    @keyframes wf-field-pulse{0%,100%{opacity:.44;transform:scaleX(.62)}50%{opacity:1;transform:scaleX(1)}}
    html[data-reduced="1"] .wf-field,html[data-reduced="1"] .wf-field:focus-within{transform:none}
    html[data-reduced="1"] [data-widget-face] .wf-field-label{transition:none!important}
    html[data-reduced="1"] .wf-counter::before,html[data-reduced="1"] .wf-field[data-loading]::after{animation:none!important;transform:none}
    @media (prefers-reduced-motion:reduce){.wf-field,.wf-field:focus-within{transform:none}[data-widget-face] .wf-field-label{transition:none!important}.wf-counter::before,.wf-field[data-loading]::after{animation:none!important;transform:none}}
    @media (max-width:390px){.wf-search-form{grid-template-columns:minmax(0,1fr)}.wf-search-submit{width:100%}}
  `;
  document.head.append(style);
}

function dispatch(root, item, value) {
  item.onChange?.(value);
  root.dispatchEvent(new CustomEvent("facechange", {
    bubbles: true,
    detail: { id: item.id, value },
  }));
}

function renderField(root, item) {
  const id = item.id || faceId("wf-input");
  const detailId = item.detail || item.error || item.disabledReason || item.required ? `${id}-detail` : null;
  const input = el("input", {
    id,
    class: "wf-field-control",
    type: item.type || "text",
    inputmode: item.inputMode || null,
    autocomplete: item.autocomplete || null,
    value: item.value || "",
    placeholder: " ",
    name: item.name || item.id || id,
    disabled: item.disabled,
    readonly: item.readOnly,
    "aria-disabled": item.disabled ? "true" : "false",
    "aria-readonly": item.readOnly ? "true" : "false",
    "aria-invalid": item.error ? "true" : "false",
    "aria-required": item.required ? "true" : null,
    "aria-describedby": detailId,
    "aria-busy": item.loading ? "true" : null,
  });
  const label = el("label", { class: "wf-field-label", for: id, text: item.label });
  const clear = el("button", {
    type: "button",
    class: "wf-field-action",
    "aria-label": `Clear ${item.label}`,
    "data-press": "",
    text: "Clear",
  });
  const field = el("div", {
    class: `wf-field${item.error ? " is-error" : ""}`,
    "data-disabled": item.disabled ? "" : null,
    "data-loading": item.loading ? "" : null,
  }, [label, input, clear]);
  const quiet = item.disabledReason || item.detail || "";
  const status = detailId ? el("span", { id: detailId, class: "wf-field-status" }) : null;
  /* keepDetail (kit forms/aria-field): the description stays put and the error is a second line
     that exists only while it is true, chained after it in aria-describedby, so a screen reader
     hears what the field wants before what went wrong. Without it the one line swaps text (Field). */
  const errorId = `${id}-error`;
  const split = Boolean(item.keepDetail && quiet);
  const errorLine = split ? el("p", { id: errorId, class: "wf-field-status", "data-error": true, role: "alert" }) : null;
  /* touched: blurred at least once since the last Clear. A required field that is
     touched, blurred and empty is in error; the next keystroke clears it. */
  let touched = false;
  let typing = false;
  const projectStatus = () => {
    const settled = touched && !typing;
    const empty = input.value.trim() === "";
    const message = item.error
      || (item.required && settled && empty ? item.requiredMessage || `${item.label} is needed.` : null)
      || (settled && !empty && typeof item.validate === "function" ? item.validate(input.value) || null : null);
    const bad = Boolean(message);
    const text = message || quiet;
    field.classList.toggle("is-error", bad);
    input.setAttribute("aria-invalid", bad ? "true" : "false");
    if (split) {
      status.replaceChildren(el("span", { text: quiet }));
      input.setAttribute("aria-describedby", bad ? `${detailId} ${errorId}` : detailId);
      if (bad) {
        errorLine.replaceChildren(el("span", { class: "wf-field-status-mark", "aria-hidden": "true", text: "!" }), el("span", { text: message }));
        if (!errorLine.isConnected) status.after(errorLine);
      } else errorLine.remove();
      return;
    }
    if (!status) return;
    status.toggleAttribute("data-error", bad);
    if (bad) status.setAttribute("role", "alert"); else status.removeAttribute("role");
    status.replaceChildren(...[
      bad ? el("span", { class: "wf-field-status-mark", "aria-hidden": "true", text: "!" }) : null,
      el("span", { text }),
    ].filter(Boolean));
  };
  const project = () => {
    field.toggleAttribute("data-filled", input.value.length > 0);
    clear.hidden = input.value.trim().length === 0 || item.disabled || item.readOnly;
    projectStatus();
  };
  input.addEventListener("input", () => {
    typing = true;
    project();
    dispatch(root, item, input.value);
  });
  input.addEventListener("blur", () => {
    touched = true;
    typing = false;
    projectStatus();
  });
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !item.submitOnEnter) event.preventDefault();
  });
  clear.addEventListener("click", () => {
    input.value = "";
    touched = false;
    project();
    input.focus();
    dispatch(root, item, "");
  });
  const block = el("div", { class: "wf-field-block" }, [field, status]);
  project();
  return block;
}

/* controls/native-select (kit §16): the platform's own <select>, wrapped in Field's box and label,
   never repainted. appearance stays auto, so the arrow, the open state, the scroll container, the
   phone's system picker and every key belong to the browser. No aria and no key handlers added. */
function renderNativeSelect(root, item) {
  const id = item.id || faceId("wf-input");
  const detailId = item.detail || item.disabledReason ? `${id}-detail` : null;
  const options = Array.isArray(item.options) ? item.options : [];
  const select = el("select", {
    id,
    class: "wf-field-control wf-native-select",
    name: item.name || item.id || id,
    disabled: item.disabled,
    "aria-describedby": detailId,
  }, options.map((o) => {
    const opt = el("option", { value: String(o.value ?? o.label), text: o.label });
    if (String(o.value ?? o.label) === String(item.value)) opt.selected = true;
    return opt;
  }));
  const field = el("div", { class: "wf-field", "data-filled": true, "data-disabled": item.disabled ? "" : null }, [
    el("label", { class: "wf-field-label", for: id, text: item.label }),
    select,
  ]);
  select.addEventListener("change", () => dispatch(root, item, select.value));
  return el("div", { class: "wf-field-block" }, [
    field,
    detailId ? el("p", { id: detailId, class: "wf-field-status" }, [el("span", { text: item.disabledReason || item.detail })]) : null,
  ]);
}

/* input/stepper (kit §22): the platform's number input kept between two .bb buttons.
   THE MAX IS A REAL BOUND (the kit's is the stock line, "Two left"): the + button carries real
   disabled at the edge and the status line says why, so a screen reader hears the bound instead of
   a dead press. The input is the value: type it, paste it, or arrow it (the platform's spinbutton).
   Out-of-range numbers clamp as you type; an empty box is allowed while typing and becomes the
   minimum when you leave it. */
function renderStepper(root, item) {
  const id = item.id || faceId("wf-input");
  const statusId = `${id}-status`;
  const min = Number.isFinite(item.min) ? item.min : 0;
  const max = Number.isFinite(item.max) ? item.max : Infinity;
  const clamp = (n) => Math.min(max, Math.max(min, n));
  let value = clamp(Number.isFinite(item.value) ? item.value : min);
  const button = (label, text) => el("button", { type: "button", class: "bb", "data-look": "outline", "data-size": "sm", "data-press": "", "aria-label": label, "aria-controls": id, text });
  const less = button(item.lessLabel || `One fewer ${item.unit || ""}`.trim(), "−");
  const more = button(item.moreLabel || `One more ${item.unit || ""}`.trim(), "+");
  const input = el("input", {
    id, class: "wf-stepper-input", type: "number", inputmode: "numeric", name: item.name || item.id || id,
    min: String(min), max: Number.isFinite(max) ? String(max) : null, step: "1", value: String(value),
    disabled: item.disabled, "aria-describedby": statusId,
  });
  const status = el("p", { id: statusId, class: "wf-stepper-status", "aria-live": "polite" });
  const project = () => {
    less.disabled = Boolean(item.disabled) || value <= min;
    more.disabled = Boolean(item.disabled) || value >= max;
    /* a button that disables under focus would drop the keyboard on <body>: hand focus to its partner */
    for (const [gone, to] of [[more, less], [less, more]]) if (gone.disabled && document.activeElement === gone) (to.disabled ? input : to).focus();
    status.textContent = item.disabled && item.disabledReason ? item.disabledReason
      : value >= max && item.maxReason ? item.maxReason
      : value <= min && item.minReason ? item.minReason : "";
  };
  const set = (n, write = true) => {
    const next = clamp(n);
    if (write) input.value = String(next);
    if (next !== value) { value = next; dispatch(root, item, value); }
    project();
  };
  less.addEventListener("click", () => set(value - 1));
  more.addEventListener("click", () => set(value + 1));
  input.addEventListener("input", () => {
    if (input.value.trim() === "") return; // mid-typing
    const n = Math.round(Number(input.value));
    if (!Number.isFinite(n)) return;
    set(n, n !== clamp(n) || String(n) !== input.value);
  });
  input.addEventListener("change", () => { if (input.value.trim() === "" || !Number.isFinite(Number(input.value))) set(min); });
  project();
  return el("div", { class: "wf-stepper-block" }, [
    el("div", { class: "wf-stepper" }, [
      less,
      el("div", { class: "wf-stepper-value" }, [el("label", { class: "wf-stepper-label", for: id, text: item.label }), input]),
      more,
    ]),
    status,
  ]);
}

/* input/slider (kit §23): WRAPPED, NOT REPAINTED. The platform's input[type=range] keeps its
   keyboard (arrows, Home/End, PageUp/Down) and its look; the one knob taken is accent-color, read
   from --os-fam-accent so recolouring stays free. The <output> is mandatory: a range with no
   printed value is a mood dial. The ends are labelled in words (item.ends), and the same text the
   output prints is given to assistive tech as aria-valuetext. */
function renderSlider(root, item) {
  const id = item.id || faceId("wf-input");
  const min = Number.isFinite(item.min) ? item.min : 0;
  const max = Number.isFinite(item.max) ? item.max : 100;
  const format = typeof item.format === "function" ? item.format : (v) => `${v}${item.suffix || ""}`;
  const input = el("input", {
    id, class: "wf-slider-input", type: "range", name: item.name || item.id || id,
    min: String(min), max: String(max), step: String(item.step || 1),
    value: String(Number.isFinite(item.value) ? item.value : min), disabled: item.disabled,
  });
  const output = el("output", { class: "wf-slider-output", for: id });
  const [low, high] = Array.isArray(item.ends) ? item.ends : [];
  const project = () => {
    const text = format(Number(input.value));
    output.textContent = text;
    input.setAttribute("aria-valuetext", low && Number(input.value) === min ? `${text}, ${low}` : high && Number(input.value) === max ? `${text}, ${high}` : text);
  };
  input.addEventListener("input", () => { project(); dispatch(root, item, Number(input.value)); });
  project();
  return el("div", { class: "wf-slider" }, [
    el("label", { class: "wf-slider-label", for: id, text: item.label }),
    el("div", { class: "wf-slider-row" }, [
      low ? el("span", { class: "wf-slider-end", "aria-hidden": "true", text: low }) : null,
      input,
      high ? el("span", { class: "wf-slider-end", "aria-hidden": "true", text: high }) : null,
      output,
    ]),
  ]);
}

export function renderInput(root, spec) {
  installInputFaceStyles();
  const fields = Array.isArray(spec.data.fields) ? spec.data.fields : [];
  root.append(el("div", { class: "wf-inputs" }, [
    spec.data.title === false ? null : el("p", { class: "wf-label", text: spec.data.title || "Input family" }),
    ...fields.map((item) => (item.type === "select" ? renderNativeSelect(root, item)
      : item.type === "stepper" ? renderStepper(root, item)
      : item.type === "range" ? renderSlider(root, item)
      : renderField(root, item))),
  ]));
}
