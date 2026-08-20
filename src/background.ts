import { getSettings } from "./settings";
import {
  GET_SELECTION_MESSAGE, LOOKUP_MESSAGE, OPEN_TAB_MESSAGE, TOGGLE_MESSAGE, type RuntimeMessage,
} from "./types";

const PENDING_KEY = "rulesOverlay:pendingLookup";

// Makes the toolbar icon open the persistent side panel instead of showing
// nothing (this extension defines no popup). The hotkey-triggered overlay
// is a separate, independent entry point — this just gives the icon a job.
chrome.sidePanel?.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

async function send<T>(tabId: number, message: RuntimeMessage): Promise<T | undefined> {
  try {
    return (await chrome.tabs.sendMessage(tabId, message)) as T;
  } catch {
    // No content script on this tab (chrome:// pages, the web store, …).
    return undefined;
  }
}

// Content scripts have no chrome.tabs, so the overlay asks the worker to
// open the pages it links to. Only extension pages and the shortcuts screen
// are allowed through — the message crosses from a content script running on
// an arbitrary site, so the URL is checked here rather than trusted.
chrome.runtime.onMessage.addListener((message: RuntimeMessage) => {
  if (message?.type !== OPEN_TAB_MESSAGE) return;
  const url = String(message.url);
  const own = chrome.runtime.getURL("");
  if (url.startsWith(own) || url === "chrome://extensions/shortcuts") {
    void chrome.tabs.create({ url });
  }
});

// The hotkeys are registered via chrome.commands in the manifest (not a
// content-script keydown listener) so they fire even when focus is inside a
// VTT's canvas or iframe.
chrome.commands.onCommand.addListener(async (command, tab) => {
  if (!tab?.id) return;

  if (command === "toggle-overlay") {
    await send(tab.id, { type: TOGGLE_MESSAGE });
    return;
  }

  if (command !== "lookup-selection") return;
  if (!(await getSettings()).selectionLookup) return;

  const result = await send<{ selection: string }>(tab.id, { type: GET_SELECTION_MESSAGE });
  const query = result?.selection?.trim();
  if (!query) return;

  // The panel may still be booting, so hand the query over through storage
  // and let it pick the query up on load; the message covers an open panel.
  await chrome.storage.local.set({ [PENDING_KEY]: query });
  if (tab.windowId !== undefined) await chrome.sidePanel.open({ windowId: tab.windowId });
  await chrome.runtime.sendMessage({ type: LOOKUP_MESSAGE, query } satisfies RuntimeMessage).catch(() => {});
});
