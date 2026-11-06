// Draws evenly spaced marquee bulbs around any element with class "marquee".
(() => {
  const NS = "http://www.w3.org/2000/svg";
  function init(el) {
    if (el.querySelector(":scope > .bulbs")) return;
    const svg = document.createElementNS(NS, "svg");
    svg.classList.add("bulbs");
    svg.setAttribute("aria-hidden", "true");
    const off = document.createElementNS(NS, "rect");
    const on = document.createElementNS(NS, "rect");
    off.classList.add("off");
    on.classList.add("on");
    svg.append(off, on);
    el.prepend(svg);

    const fit = () => {
      const W = el.clientWidth, H = el.clientHeight;
      if (!W || !H) return;
      const cs = getComputedStyle(el);
      const inset = parseFloat(cs.getPropertyValue("--bulb-inset")) || 13;
      const gap = parseFloat(cs.getPropertyValue("--bulb-gap")) || 30;
      const R = parseFloat(cs.borderTopLeftRadius) || 0;
      const rx = Math.max(0, R - inset);
      const w = Math.max(0, W - 2 * inset), h = Math.max(0, H - 2 * inset);
      const perimeter = 2 * (w + h - 4 * rx) + 2 * Math.PI * rx;
      const n = Math.max(4, Math.round(perimeter / gap));
      for (const r of [off, on]) {
        r.setAttribute("x", inset);
        r.setAttribute("y", inset);
        r.setAttribute("width", w);
        r.setAttribute("height", h);
        r.setAttribute("rx", rx);
        r.setAttribute("pathLength", 2 * n);
        r.setAttribute("stroke-dasharray", "0 2");
      }
      off.setAttribute("stroke-dashoffset", "1");
    };
    if ("ResizeObserver" in window) new ResizeObserver(fit).observe(el);
    window.addEventListener("resize", fit);
    fit();
  }
  window.initMarquees = (root = document) => root.querySelectorAll(".marquee").forEach(init);
  document.addEventListener("DOMContentLoaded", () => window.initMarquees());
})();
