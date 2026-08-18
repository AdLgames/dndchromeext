import { TOGGLE_MESSAGE, type RuntimeMessage } from "./types";

// The hotkey is registered via chrome.commands in the manifest (not a
// content-script keydown listener) so it fires even when focus is inside a
// VTT's canvas or iframe. We just relay it to the content script, which
// owns the actual overlay lifecycle.
chrome.commands.onCommand.addListener((command, tab) => {
  if (command !== "toggle-overlay" || !tab?.id) return;
  const message: RuntimeMessage = { type: TOGGLE_MESSAGE };
  chrome.tabs.sendMessage(tab.id, message).catch(() => {
    // No content script listening on this tab (e.g. chrome:// pages) — ignore.
  });
});
