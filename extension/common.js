// Helpers shared by the widget modules.
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
// Only allow http(s)/relative URLs in href/src; blocks javascript: etc.
export const url = (u) => (/^(https?:|\/|#)/i.test(u) ? esc(u) : "#");
export const timeAttrs = (unix) => `data-dynamic-relative-time="${Math.floor(unix)}"`;
export const unix = (iso) => { const t = Date.parse(iso); return isNaN(t) ? 0 : t / 1000; };
export const num = (n) => Number(n).toLocaleString();
export const approx = (n) =>
    n < 1e3 ? String(n) : n < 1e4 ? (n / 1e3).toFixed(1) + "k" : n < 1e6 ? Math.floor(n / 1e3) + "k" : (n / 1e6).toFixed(1) + "m";
export const domain = (u) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; } };
export const collapse = (v) => (v === 0 || v < -1 || v == null ? 5 : v);

export async function getJSON(u, opts) {
    const r = await fetch(u, opts);
    if (!r.ok) throw new Error(`${u}: HTTP ${r.status}`);
    return r.json();
}

const ICON = (path) => `<svg class="forum-post-list-thumbnail hide-on-mobile" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="-9 -8 40 40" stroke-width="1.5" stroke="var(--color-text-subdue)"><path stroke-linecap="round" stroke-linejoin="round" d="${path}" /></svg>`;
const ICON_CROSS = ICON("M7.5 21 3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5");
const ICON_LINK = ICON("M13.19 8.688a4.5 4.5 0 0 1 1.242 7.244l-4.5 4.5a4.5 4.5 0 0 1-6.364-6.364l1.757-1.757m13.35-.622 1.757-1.757a4.5 4.5 0 0 0-6.364-6.364l-4.5 4.5a4.5 4.5 0 0 0 1.242 7.244");
const ICON_CHAT = ICON("M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 0 1 .865-.501 48.172 48.172 0 0 0 3.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0 0 12 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018Z");

// posts: [{title, discussionUrl, targetUrl, thumbnailUrl, tags, score, commentCount, timePosted(unix s), isCrosspost}]
export function forumPosts(posts, { collapseAfter, showThumbnails }) {
    return `<ul class="list list-gap-14 collapsible-container" data-collapse-after="${collapse(collapseAfter)}">${posts.map((p) => `
<li><div class="flex gap-10 row-reverse-on-mobile thumbnail-parent">
    ${showThumbnails ? (p.isCrosspost ? ICON_CROSS : p.thumbnailUrl ? `<img class="forum-post-list-thumbnail thumbnail" src="${url(p.thumbnailUrl)}" alt="" loading="lazy">` : p.targetUrl ? ICON_LINK : ICON_CHAT) : ""}
    <div class="grow min-width-0">
        <a href="${url(p.discussionUrl)}" class="size-title-dynamic color-primary-if-not-visited" target="_blank" rel="noreferrer">${esc(p.title)}</a>
        ${p.tags?.length ? `<div class="inline-block forum-post-tags-container"><ul class="attachments">${p.tags.map((t) => `<li>${esc(t)}</li>`).join("")}</ul></div>` : ""}
        <ul class="list-horizontal-text flex-nowrap text-compact">
            <li ${timeAttrs(p.timePosted)}></li>
            <li class="shrink-0">${approx(p.score)} points</li>
            <li class="shrink-0${p.targetUrl ? " forum-post-autohide" : ""}">${approx(p.commentCount)} comments</li>
            ${p.targetUrl ? `<li class="min-width-0"><a class="visited-indicator text-truncate block" href="${url(p.targetUrl)}" target="_blank" rel="noreferrer">${esc(p.targetDomain)}</a></li>` : ""}
        </ul>
    </div>
</div></li>`).join("")}</ul>`;
}

// engagement sort used by hacker-news / reddit `extra-sort-by: engagement`
export function sortByEngagement(posts) {
    const now = Date.now() / 1000;
    const score = (p) => (p.score + p.commentCount * 3) / Math.pow(Math.max(now - p.timePosted, 1) / 3600 + 2, 1.5);
    return [...posts].sort((a, b) => score(b) - score(a));
}

// Mirrors newCustomIconField in config-fields.go. Returns {url, invert}.
export function icon(value) {
    if (!value) return { url: "", invert: false };
    let invert = false;
    if (value.startsWith("auto-invert ")) { invert = true; value = value.slice(12); }
    const i = value.indexOf(":");
    if (i < 0 || /^https?$/.test(value.slice(0, i))) return { url: value, invert };
    const prefix = value.slice(0, i);
    let [base, ext] = value.slice(i + 1).split(/\.(.*)/s);
    if (!["svg", "png", "webp"].includes(ext)) ext = "svg";
    switch (prefix) {
        case "si": return { url: `https://cdn.jsdelivr.net/npm/simple-icons@latest/icons/${base}.svg`, invert: true };
        case "di": return { url: `https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/${ext}/${base}.${ext}`, invert };
        case "mdi": return { url: `https://cdn.jsdelivr.net/npm/@mdi/svg@latest/svg/${base}.svg`, invert: true };
        case "sh": return { url: `https://cdn.jsdelivr.net/gh/selfhst/icons@main/${ext}/${base}.${ext}`, invert };
        default: return { url: value, invert };
    }
}
export const iconImg = (value, cls) => {
    const i = icon(value);
    return i.url ? `<img class="${cls}${i.invert ? " flat-icon" : ""}" src="${url(i.url)}" alt="" loading="lazy">` : "";
};

export const percentChange = (cur, prev) => (prev === 0 ? (cur === 0 ? 0 : 100) : ((cur - prev) / prev) * 100);

// "H S L" (glance hsl field) -> css color
export const hsl = (v) => {
    const m = /^\s*(\d+(?:\.\d+)?)(?:deg)?\s+(\d+(?:\.\d+)?)%?\s+(\d+(?:\.\d+)?)%?\s*$/.exec(String(v));
    return m ? `hsl(${m[1]}, ${m[2]}%, ${m[3]}%)` : "";
};

export function polyline(width, height, values) {
    values = values.filter((v) => v !== 0);
    if (values.length < 2) return "";
    const pad = height * 0.02, h = height - pad * 2;
    const min = Math.min(...values), max = Math.max(...values), step = width / (values.length - 1);
    return values.map((v, i) => `${(i * step).toFixed(2)},${(((max - v) / (max - min)) * h + pad).toFixed(2)}`).join(" ");
}

export const CHECK = `<svg fill="var(--color-positive)" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm3.857-9.809a.75.75 0 0 0-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 1 0-1.06 1.061l2.5 2.5a.75.75 0 0 0 1.137-.089l4-5.5Z" clip-rule="evenodd" /></svg>`;
export const WARN = `<svg fill="var(--color-negative)" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495ZM10 5a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-1.5 0v-3.5A.75.75 0 0 1 10 5Zm0 9a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z" clip-rule="evenodd" /></svg>`;
