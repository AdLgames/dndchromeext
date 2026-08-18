import type { Rule } from "../types";
import { buildAliasIndex, getRecency, recordMiss, recordView, search, type SearchMatch } from "../content/search";
import rulesData from "../data/rules.json";
import aliasesData from "../data/aliases.json";

const rules = rulesData as Rule[];
const rulesById = new Map(rules.map((r) => [r.id, r]));
const aliasIndex = buildAliasIndex(aliasesData as Record<string, string>);

let recency: Record<string, number> = {};
void getRecency().then((r) => (recency = r));

type View = "search" | "detail";
let view: View = "search";
let results: SearchMatch[] = [];
let selectedIndex = 0;
let detailRule: Rule | null = null;
const detailStack: string[] = [];

const input = document.getElementById("search-input") as HTMLInputElement;
const body = document.getElementById("body") as HTMLDivElement;

function renderResultsList() {
  body.innerHTML = "";

  if (results.length === 0) {
    const el = document.createElement("div");
    if (input.value.trim().length > 0) {
      el.className = "empty";
      el.textContent = "No matching rule. Try a shorter term.";
    } else {
      el.className = "hint";
      el.textContent = "Start typing a rule, spell, monster, item, or table-slang.";
    }
    body.appendChild(el);
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

  const detail = document.createElement("div");
  detail.className = "detail-view";
  detail.append(back, heading, text);

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
      if (i < rule.seeAlso!.length - 1) seeAlso.appendChild(document.createTextNode(", "));
    });
    detail.appendChild(seeAlso);
  }

  body.appendChild(detail);
}

function openDetail(rule: Rule, pushHistory: boolean) {
  if (pushHistory && detailRule) detailStack.push(detailRule.id);
  detailRule = rule;
  view = "detail";
  void recordView(rule.id)
    .then(() => getRecency())
    .then((r) => (recency = r));
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

function flushMissIfAny() {
  const query = input.value.trim();
  if (view === "search" && query.length >= 3 && results.length === 0) {
    void recordMiss(query);
  }
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

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    if (view === "detail") {
      e.preventDefault();
      closeDetail();
    }
    // In search view there's nothing to "close" — the panel stays pinned open.
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

// The panel has no toggle/close lifecycle, so log a miss whenever the user
// wanders off (loses focus) with an empty result set still showing.
window.addEventListener("blur", flushMissIfAny);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) flushMissIfAny();
});

input.focus();
renderResultsList();
