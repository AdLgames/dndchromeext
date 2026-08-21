const p = new URLSearchParams(location.search);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const find = (sel, re) => [...document.querySelectorAll(sel)].find((n) => re.test(n.textContent || ""));
(async () => {
  await wait(1100);
  if (p.get("q")) {
    const i = document.querySelector(".searchbox input");
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(i, p.get("q"));
    i.dispatchEvent(new Event("input", { bubbles: true }));
    await wait(600);
  }
  if (p.get("open") !== null) { document.querySelectorAll(".row")[Number(p.get("open"))]?.click(); await wait(450); }
  for (const c of (p.get("click") || "").split("|").filter(Boolean)) {
    (find(".tabs button", new RegExp(`^${c}$`, "i")) || find("button", new RegExp(c, "i")))?.click();
    await wait(550);
  }
  if (p.get("hdr")) { document.querySelectorAll(".head-actions .icon-btn")[Number(p.get("hdr"))]?.click(); await wait(450); }
  for (const n of (p.get("dice") || "").split("|").filter(Boolean)) {
    find(".die-btn", new RegExp(`^${n}$`))?.click(); await wait(200);
  }
  if (p.get("scroll")) document.querySelector(".body").scrollTop = Number(p.get("scroll"));
})();
