import { LOOKUP_MESSAGE, type RuntimeMessage } from "../types";
import { Panel } from "../ui/panel";

const panel = new Panel(document.getElementById("root")!, {
  showShortcutHint: true,
  themeTarget: document.body,
});

document.addEventListener("keydown", (e) => panel.handleKey(e));

// A pending lookup may already be waiting: the selection hotkey stores the
// query before opening the panel, since the panel takes a moment to boot.
const PENDING_KEY = "rulesOverlay:pendingLookup";
void chrome.storage.local.get(PENDING_KEY).then(async (stored) => {
  const pending = stored[PENDING_KEY] as string | undefined;
  if (!pending) return;
  await chrome.storage.local.remove(PENDING_KEY);
  await panel.lookup(pending);
});

chrome.runtime.onMessage.addListener((message: RuntimeMessage) => {
  if (message?.type === LOOKUP_MESSAGE) void panel.lookup(message.query);
});

// The panel has no close lifecycle, so log an abandoned empty search when
// the user navigates away from it.
window.addEventListener("blur", () => panel.flushMiss());
document.addEventListener("visibilitychange", () => {
  if (document.hidden) panel.flushMiss();
});
