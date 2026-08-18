import { TOGGLE_MESSAGE, type RuntimeMessage } from "./types";

// Makes the toolbar icon open the persistent side panel instead of showing
// nothing (this extension defines no popup). The hotkey-triggered overlay
// is a separate, independent entry point — this just gives the icon a job.
chrome.sidePanel?.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

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
