import { loadDataset } from "../data/load";
import { LOOKUP_MESSAGE, TOGGLE_MESSAGE, GET_SELECTION_MESSAGE, type RuntimeMessage } from "../types";
import { Panel } from "../ui/panel";
import panelCss from "../ui/panel.css";
import themeCss from "../ui/theme.css";
import overlayCss from "./styles.css";

const HOST_ID = "rules-overlay-host";

let host: HTMLDivElement | null = null;
let panel: Panel | null = null;

function ensureMounted(): Panel {
  if (panel && host) return panel;

  // A fresh host, appended to <html> (not <body> — some VTTs swap out body
  // children wholesale) with a closed shadow root. `all: initial` on the
  // host neutralizes any inherited/global styles the page cascades down
  // (Roll20/Foundry both ship aggressive resets and font/z-index overrides).
  host = document.createElement("div");
  host.id = HOST_ID;
  host.style.cssText =
    "all: initial; position: fixed; inset: 0; z-index: 2147483647; display: none;";

  const shadow = host.attachShadow({ mode: "closed" });
  const style = document.createElement("style");
  style.textContent = [themeCss, panelCss, overlayCss].join("\n");
  shadow.append(style);

  const backdrop = document.createElement("div");
  backdrop.className = "backdrop";
  backdrop.addEventListener("click", hide);

  const frame = document.createElement("div");
  frame.className = "ro-root frame";

  const shell = document.createElement("div");
  shell.className = "shell";
  shell.append(backdrop, frame);
  shadow.append(shell);

  panel = new Panel(frame, { onClose: hide });

  // Keystrokes must not reach the host page — typing "t" in our search box
  // should never toggle a VTT's token layer.
  for (const type of ["keydown", "keyup", "keypress"] as const) {
    frame.addEventListener(type, (e) => e.stopPropagation());
  }
  frame.addEventListener("keydown", (e) => panel!.handleKey(e as KeyboardEvent));

  document.documentElement.append(host);
  return panel;
}

function isOpen(): boolean {
  return !!host && host.style.display !== "none";
}

function show(query?: string) {
  const p = ensureMounted();
  if (!host) return;
  host.style.display = "block";
  if (query) void p.lookup(query);
  else p.reset();
  p.focus();
  // VTTs steal focus aggressively; re-assert on the next frame.
  requestAnimationFrame(() => p.focus());
}

function hide() {
  if (!host) return;
  panel?.flushMiss();
  host.style.display = "none";
}

chrome.runtime.onMessage.addListener((message: RuntimeMessage, _sender, sendResponse) => {
  if (message?.type === TOGGLE_MESSAGE) {
    if (isOpen()) hide();
    else show();
  } else if (message?.type === LOOKUP_MESSAGE) {
    show(message.query);
  } else if (message?.type === GET_SELECTION_MESSAGE) {
    sendResponse({ selection: window.getSelection()?.toString().trim().slice(0, 80) ?? "" });
  }
});

// Warm the dataset while the page is idle so the first open stays instant.
requestIdleCallback?.(() => void loadDataset(), { timeout: 4000 });
