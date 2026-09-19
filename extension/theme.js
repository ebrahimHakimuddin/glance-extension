// Port of theme-style.gotmpl and theme-preset-preview.html.
const hsl = (v) => {
    const m = /^\s*(\d+(?:\.\d+)?)(?:deg)?\s+(\d+(?:\.\d+)?)%?\s+(\d+(?:\.\d+)?)%?\s*$/.exec(String(v ?? ""));
    return m ? { h: +m[1], s: +m[2], l: +m[3], css: `hsl(${(+m[1]).toFixed(1)}, ${(+m[2]).toFixed(1)}%, ${(+m[3]).toFixed(1)}%)` } : null;
};

export function themeCSS(p = {}) {
    const bg = hsl(p["background-color"]), pri = hsl(p["primary-color"]), pos = hsl(p["positive-color"]), neg = hsl(p["negative-color"]);
    const lines = [];
    if (bg) lines.push(`--bgh: ${bg.h};`, `--bgs: ${bg.s}%;`, `--bgl: ${bg.l}%;`);
    if (p["contrast-multiplier"]) lines.push(`--cm: ${p["contrast-multiplier"]};`);
    if (p["text-saturation-multiplier"]) lines.push(`--tsm: ${p["text-saturation-multiplier"]};`);
    if (pri) lines.push(`--color-primary: ${pri.css};`);
    if (pos) lines.push(`--color-positive: ${pos.css};`);
    if (neg) lines.push(`--color-negative: ${neg.css};`);
    return `:root {\n${lines.join("\n")}\n}`;
}

export function backgroundHex(p = {}) {
    const bg = hsl(p["background-color"]);
    if (!bg) return "#151519";
    const s = bg.s / 100, l = bg.l / 100, a = s * Math.min(l, 1 - l);
    const f = (n) => { const k = (n + bg.h / 30) % 12; return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))).toString(16).padStart(2, "0"); };
    return `#${f(0)}${f(8)}${f(4)}`;
}

export function previewHTML(key, p = {}) {
    const bg = hsl(p["background-color"])?.css || "hsl(240, 8%, 9%)";
    const pri = hsl(p["primary-color"])?.css || "hsl(43, 50%, 70%)";
    const pos = hsl(p["positive-color"])?.css || (p["primary-color"] ? pri : "hsl(43, 50%, 70%)");
    const neg = hsl(p["negative-color"])?.css || "hsl(0, 70%, 70%)";
    return `<button class="theme-preset${p.light ? " theme-preset-light" : ""}" style="--color: ${bg}" data-key="${key}">
    <div class="theme-color" style="--color: ${pri}"></div><div class="theme-color" style="--color: ${pos}"></div><div class="theme-color" style="--color: ${neg}"></div></button>`;
}
