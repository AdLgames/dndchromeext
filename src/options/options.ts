import { clearMisses, getMisses } from "../search";
import { getSettings, resolveTheme } from "../settings";
import { el } from "../ui/dom";

const COMMAND_LABELS: Record<string, string> = {
  "toggle-overlay": "Open/close the overlay",
  "lookup-selection": "Look up selected text",
};

async function renderShortcuts() {
  const host = document.getElementById("shortcuts")!;
  host.textContent = "";
  const commands = await chrome.commands.getAll();

  const list = el("ul", {});
  for (const command of commands) {
    if (!command.name || command.name === "_execute_action") continue;
    list.append(el("li", {}, [
      el("span", { text: COMMAND_LABELS[command.name] ?? command.description ?? command.name }),
      el("span", {
        class: `status count${command.shortcut ? "" : " unset"}`,
        text: command.shortcut || "Not set",
      }),
    ]));
  }
  host.append(list);
}

function relativeTime(ts: number): string {
  const days = Math.floor((Date.now() - ts) / (24 * 60 * 60 * 1000));
  if (days <= 0) return "today";
  if (days === 1) return "1 day ago";
  return `${days} days ago`;
}

async function renderMisses() {
  const list = document.getElementById("misses-list")!;
  const empty = document.getElementById("misses-empty")!;
  const misses = await getMisses();

  list.textContent = "";
  const has = misses.length > 0;
  empty.style.display = has ? "none" : "block";
  list.style.display = has ? "block" : "none";
  if (!has) return;

  for (const miss of misses.sort((a, b) => b.count - a.count || b.lastSeen - a.lastSeen)) {
    list.append(el("li", {}, [
      el("span", { text: miss.query }),
      el("span", { class: "count", text: `${miss.count}× · ${relativeTime(miss.lastSeen)}` }),
    ]));
  }
}

document.getElementById("open-shortcuts")!.addEventListener("click", () => {
  chrome.tabs.create({ url: "chrome://extensions/shortcuts" });
});

document.getElementById("clear-misses")!.addEventListener("click", async () => {
  await clearMisses();
  await renderMisses();
});

async function applyTheme() {
  document.body.dataset.theme = resolveTheme((await getSettings()).appearance);
}

void applyTheme();
void renderShortcuts();
void renderMisses();
