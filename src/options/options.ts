const TOGGLE_COMMAND = "toggle-overlay";

async function render() {
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

document.getElementById("open-shortcuts")!.addEventListener("click", () => {
  chrome.tabs.create({ url: "chrome://extensions/shortcuts" });
});

void render();
