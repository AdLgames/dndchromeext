import { clearMisses, getMisses } from "../content/search";

const TOGGLE_COMMAND = "toggle-overlay";

async function renderShortcut() {
  const statusEl = document.getElementById("shortcut-status")!;
  const commands = await chrome.commands.getAll();
  const toggle = commands.find((c) => c.name === TOGGLE_COMMAND);

  if (toggle?.shortcut) {
    statusEl.textContent = `Current shortcut: ${toggle.shortcut}`;
    statusEl.classList.remove("unset");
  } else {
    statusEl.textContent = "No shortcut is set yet — the overlay won't open until you assign one below.";
    statusEl.classList.add("unset");
  }
}

function relativeTime(ts: number): string {
  const days = Math.floor((Date.now() - ts) / (24 * 60 * 60 * 1000));
  if (days <= 0) return "today";
  if (days === 1) return "1 day ago";
  return `${days} days ago`;
}

async function renderMisses() {
  const listEl = document.getElementById("misses-list")!;
  const emptyEl = document.getElementById("misses-empty")!;
  const misses = await getMisses();

  listEl.innerHTML = "";
  if (misses.length === 0) {
    emptyEl.style.display = "block";
    listEl.style.display = "none";
    return;
  }
  emptyEl.style.display = "none";
  listEl.style.display = "block";

  for (const miss of misses.sort((a, b) => b.count - a.count || b.lastSeen - a.lastSeen)) {
    const li = document.createElement("li");
    const query = document.createElement("span");
    query.textContent = miss.query;
    const count = document.createElement("span");
    count.className = "count";
    count.textContent = `${miss.count}× · ${relativeTime(miss.lastSeen)}`;
    li.append(query, count);
    listEl.appendChild(li);
  }
}

document.getElementById("open-shortcuts")!.addEventListener("click", () => {
  chrome.tabs.create({ url: "chrome://extensions/shortcuts" });
});

document.getElementById("clear-misses")!.addEventListener("click", async () => {
  await clearMisses();
  await renderMisses();
});

void renderShortcut();
void renderMisses();
