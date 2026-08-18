import type { Rule } from "../types";
import { buildAliasIndex, getRecency, recordView, search, type SearchMatch } from "./search";
import rulesData from "../data/rules.json";
import aliasesData from "../data/aliases.json";

const rules = rulesData as Rule[];
const rulesById = new Map(rules.map((r) => [r.id, r]));
const aliasIndex = buildAliasIndex(aliasesData as Record<string, string>);

const SRD_ATTRIBUTION =
  'This work includes material from the D&D System Reference Document 5.1, © Wizards of the Coast LLC, available under the ' +
  "Creative Commons Attribution 4.0 International License.";

export type OverlayHandle = {
  focusInput: () => void;
  reset: () => void;
};

type View = "search" | "detail";

export function createOverlay(shadow: ShadowRoot, opts: { onClose: () => void }): OverlayHandle {
  let recency: Record<string, number> = {};
  getRecency().then((r) => (recency = r));

  let view: View = "search";
  let results: SearchMatch[] = [];
  let selectedIndex = 0;
  let detailRule: Rule | null = null;
  const detailStack: string[] = [];

  const root = document.createElement("div");
  root.className = "root";

  const backdrop = document.createElement("div");
  backdrop.className = "backdrop";

  const panel = document.createElement("div");
  panel.className = "panel";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "Rules lookup");

  const input = document.createElement("input");
  input.type = "text";
  input.className = "search-input";
  input.placeholder = "Search rules… (e.g. “aoo”, “crit”, “how far can i jump”)";
  input.autocomplete = "off";
  input.spellcheck = false;

  const body = document.createElement("div");
  body.className = "body";

  const footer = document.createElement("div");
  footer.className = "footer";
  footer.textContent = SRD_ATTRIBUTION;

  panel.append(input, body, footer);
  root.append(backdrop, panel);
  shadow.appendChild(root);

  function renderResultsList() {
    body.innerHTML = "";
    body.classList.remove("detail-view");

    if (results.length === 0 && input.value.trim().length > 0) {
      const empty = document.createElement("div");
      empty.className = "empty";
      empty.textContent = "No matching rule. Try a shorter term.";
      body.appendChild(empty);
      return;
    }

    const list = document.createElement("ul");
    list.className = "results";
    results.forEach((match, i) => {
      const item = document.createElement("li");
      item.className = "result" + (i === selectedIndex ? " selected" : "");
      item.dataset.index = String(i);

      const title = document.createElement("span");
      title.className = "result-title";
      title.textContent = match.rule.title;

      const category = document.createElement("span");
      category.className = "result-category";
      category.textContent = match.rule.category;

      item.append(title, category);
      item.addEventListener("mouseenter", () => {
        selectedIndex = i;
        updateSelection();
      });
      item.addEventListener("click", () => openDetail(match.rule, true));
      list.appendChild(item);
    });
    body.appendChild(list);
  }

  function updateSelection() {
    body.querySelectorAll<HTMLLIElement>(".result").forEach((el) => {
      el.classList.toggle("selected", el.dataset.index === String(selectedIndex));
    });
    body.querySelector(".result.selected")?.scrollIntoView({ block: "nearest" });
  }

  function renderDetail(rule: Rule) {
    body.innerHTML = "";
    body.classList.add("detail-view");

    const back = document.createElement("button");
    back.type = "button";
    back.className = "back-button";
    back.textContent = "← Back";
    back.addEventListener("click", () => closeDetail());

    const heading = document.createElement("div");
    heading.className = "detail-heading";
    const h = document.createElement("h2");
    h.textContent = rule.title;
    const cat = document.createElement("span");
    cat.className = "result-category";
    cat.textContent = rule.category;
    heading.append(h, cat);

    const text = document.createElement("div");
    text.className = "detail-body";
    text.textContent = rule.body;

    body.append(back, heading, text);

    if (rule.seeAlso?.length) {
      const seeAlso = document.createElement("div");
      seeAlso.className = "see-also";
      const label = document.createElement("span");
      label.textContent = "See also: ";
      seeAlso.appendChild(label);
      rule.seeAlso.forEach((id, i) => {
        const related = rulesById.get(id);
        if (!related) return;
        const link = document.createElement("button");
        link.type = "button";
        link.className = "see-also-link";
        link.textContent = related.title;
        link.addEventListener("click", () => openDetail(related, true));
        seeAlso.appendChild(link);
        if (i < rule.seeAlso!.length - 1) {
          seeAlso.appendChild(document.createTextNode(", "));
        }
      });
      body.appendChild(seeAlso);
    }
  }

  function openDetail(rule: Rule, pushHistory: boolean) {
    if (pushHistory && detailRule) detailStack.push(detailRule.id);
    detailRule = rule;
    view = "detail";
    void recordView(rule.id).then(() => getRecency()).then((r) => (recency = r));
    renderDetail(rule);
  }

  function closeDetail() {
    const prevId = detailStack.pop();
    if (prevId && rulesById.has(prevId)) {
      detailRule = rulesById.get(prevId)!;
      renderDetail(detailRule);
      return;
    }
    view = "search";
    detailRule = null;
    runSearch();
  }

  function runSearch() {
    results = search(input.value, rules, aliasIndex, recency);
    selectedIndex = 0;
    renderResultsList();
  }

  input.addEventListener("input", () => {
    if (view !== "search") {
      view = "search";
      detailRule = null;
      detailStack.length = 0;
    }
    runSearch();
  });

  // Keep keystrokes from reaching the host page — typing "t" here must not
  // toggle a VTT's token layer, etc.
  panel.addEventListener("keydown", (e) => {
    e.stopPropagation();

    if (e.key === "Escape") {
      e.preventDefault();
      if (view === "detail") closeDetail();
      else opts.onClose();
      return;
    }

    if (view === "detail") return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (results.length) {
        selectedIndex = (selectedIndex + 1) % results.length;
        updateSelection();
      }
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (results.length) {
        selectedIndex = (selectedIndex - 1 + results.length) % results.length;
        updateSelection();
      }
    } else if (e.key === "Enter") {
      e.preventDefault();
      const match = results[selectedIndex];
      if (match) openDetail(match.rule, true);
    }
  });
  panel.addEventListener("keyup", (e) => e.stopPropagation());
  panel.addEventListener("keypress", (e) => e.stopPropagation());

  backdrop.addEventListener("click", () => opts.onClose());
  panel.addEventListener("click", (e) => e.stopPropagation());

  return {
    focusInput: () => input.focus(),
    reset: () => {
      view = "search";
      detailRule = null;
      detailStack.length = 0;
      input.value = "";
      results = [];
      selectedIndex = 0;
      renderResultsList();
    },
  };
}
