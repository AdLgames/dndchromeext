import { TOGGLE_MESSAGE, type RuntimeMessage } from "../types";
import { createOverlay, type OverlayHandle } from "./overlay";
import stylesText from "./styles.css";

const HOST_ID = "rules-overlay-host";

let host: HTMLDivElement | null = null;
let overlay: OverlayHandle | null = null;

function ensureMounted(): OverlayHandle {
  if (overlay && host) return overlay;

  // A fresh host, appended to <html> (not <body> — some VTTs swap out body
  // children wholesale) with a closed shadow root. `all: initial` on the
  // host neutralizes any inherited/global styles the page cascades down
  // (Roll20/Foundry both ship aggressive resets and font/z-index overrides).
  host = document.createElement("div");
  host.id = HOST_ID;
  host.style.cssText =
    "all: initial; position: fixed; inset: 0; z-index: 2147483647; display: none;";

  const shadow = host.attachShadow({ mode: "closed" });

  const styleEl = document.createElement("style");
  styleEl.textContent = stylesText;
  shadow.appendChild(styleEl);

  overlay = createOverlay(shadow, { onClose: hide });

  document.documentElement.appendChild(host);
  return overlay;
}

function isOpen(): boolean {
  return !!host && host.style.display !== "none";
}

function show() {
  const handle = ensureMounted();
  if (!host) return;
  host.style.display = "block";
  handle.reset();
  handle.focusInput();
  // VTTs steal focus aggressively; re-assert on the next frame as a
  // defensive second attempt.
  requestAnimationFrame(() => handle.focusInput());
}

function hide() {
  if (!host) return;
  overlay?.flushMiss();
  host.style.display = "none";
}

function toggle() {
  if (isOpen()) hide();
  else show();
}

chrome.runtime.onMessage.addListener((message: RuntimeMessage) => {
  if (message?.type === TOGGLE_MESSAGE) toggle();
});
