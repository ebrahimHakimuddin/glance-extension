// In-browser replacement for Glance's server-side page rendering.
// Output markup mirrors internal/glance/templates/*.html so the stock CSS/JS keep working.
import { esc, url } from "./common.js";
import { basicWidgets } from "./widgets-basic.js";
import { feedWidgets } from "./widgets-feeds.js";
import { miscWidgets } from "./widgets-misc.js";
import { mediaWidgets } from "./widgets-media.js";
import { selfhostedWidgets } from "./widgets-selfhosted.js";
import { serverWidgets } from "./widgets-server.js";
import { renderCustomAPI } from "./widget-customapi.js";

let uid = 0;
const ALIASES = { stocks: "markets", "to-do": "todo" };

const registry = {
    ...basicWidgets, ...feedWidgets, ...miscWidgets, ...mediaWidgets, ...selfhostedWidgets, ...serverWidgets,
    "custom-api": { title: "Custom API", cache: 60, render: renderCustomAPI, frameless: (w) => !!w.frameless },
    group: { title: "", container: true },
    "split-column": { title: "Split Column", container: true, hideHeader: true },
};

const fn = (v, w) => (typeof v === "function" ? v(w) : v);
const parseDuration = (d) => { const m = /^(\d+)(s|m|h|d)$/.exec(d || ""); return m ? (+m[1] * { s: 1, m: 60, h: 3600, d: 86400 }[m[2]]) / 60 : 0; };

const errorContent = (msg) => `
<div class="widget-error-header"><div class="color-negative size-h3">ERROR</div>
<svg class="widget-error-icon" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" /></svg></div>
<p class="break-all">${esc(msg || "No error information provided")}</p>`;

const WIP = `<div data-popover-type="html" data-popover-position="above"><div data-popover-html><p class="size-h5">WORK IN PROGRESS</p><p class="margin-block-10 color-paragraph">This widget is still in development, certain features may not work as expected or may change drastically.</p><a class="color-primary visited-indicator" href="https://github.com/glanceapp/glance/issues" target="_blank" rel="noreferrer">Report issue</a></div><svg class="widget-beta-icon cursor-help" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M19 5.5a4.5 4.5 0 0 1-4.791 4.49c-.873-.055-1.808.128-2.368.8l-6.024 7.23a2.724 2.724 0 1 1-3.837-3.837L9.21 8.16c.672-.56.855-1.495.8-2.368a4.5 4.5 0 0 1 5.873-4.575c.324.105.39.51.15.752L13.34 4.66a.455.455 0 0 0-.11.494 3.01 3.01 0 0 0 1.617 1.617c.17.07.363.02.493-.111l2.692-2.692c.241-.241.647-.174.752.15.14.435.216.9.216 1.382ZM4 17a1 1 0 1 0 0-2 1 1 0 0 0 0-2Z" clip-rule="evenodd" /></svg></div>`;

function shell(w, meta, content, error) {
    const header = w["hide-header"] || meta.hideHeader ? "" : `
    <div class="widget-header">${meta.titleUrl
            ? `<h2><a href="${url(meta.titleUrl)}" target="_blank" rel="noreferrer" class="uppercase">${esc(meta.title)}</a></h2>`
            : `<h2 class="uppercase">${esc(meta.title)}</h2>`}${meta.wip ? WIP : ""}</div>`;
    return `<div class="widget widget-type-${esc(w.type)}${w["css-class"] ? " " + esc(w["css-class"]) : ""}">${header}
    <div class="widget-content${!error && meta.frameless ? " widget-content-frameless" : ""}">${error ? errorContent(error) : content}</div></div>`;
}

// ---- per-widget TTL cache in chrome.storage.local ----------------------------------------------
const hash = (s) => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); };
async function cacheGet(key, ttlMin) {
    try { const v = (await chrome.storage.local.get(key))[key]; if (v && Date.now() - v.t < ttlMin * 60000) return v; } catch { /* no storage */ }
}
const cacheSet = (key, v) => chrome.storage.local.set({ [key]: { ...v, t: Date.now() } }).catch(() => {});

export async function renderWidget(w, opts = {}) {
    const type = ALIASES[w.type] || w.type;
    if (type === "calendar-legacy" || type === "old-calendar") w = { ...w, type: "calendar-legacy" };
    const def = type === "calendar-legacy" ? miscWidgets["calendar-legacy"] : registry[type];
    if (w.type === "html") return miscWidgets.html.render(w); // raw source, no chrome
    if (!def) return shell(w, { title: w.type }, "", `unknown widget type: ${w.type}`);
    const hideHeader = opts.hideHeader || w["hide-header"];
    const meta = { title: w.title ?? fn(def.title, w), titleUrl: w["title-url"] || fn(def.titleUrl, w), frameless: !!fn(def.frameless, w), wip: def.wip, hideHeader: hideHeader || def.hideHeader };
    const id = ++uid;
    try {
        if (def.container) return await renderContainer(type, w, meta, id);
        const ttl = w.cache ? parseDuration(w.cache) : def.cache;
        const key = ttl ? "wc:" + hash(JSON.stringify(w)) : null;
        let content, hit = key && (await cacheGet(key, ttl));
        if (hit) { content = hit.html; Object.assign(meta, hit.meta); }
        else {
            const m2 = { ...meta };
            content = await def.render(w, id, m2);
            Object.assign(meta, m2);
            if (key) cacheSet(key, { html: content, meta: { title: meta.title, titleUrl: meta.titleUrl, frameless: meta.frameless } });
        }
        meta.title ||= "";
        return shell(w, meta, content);
    } catch (e) {
        console.error(`widget ${w.type}:`, e);
        return shell(w, meta, "", e.message);
    }
}

async function renderContainer(type, w, meta, id) {
    const kids = w.widgets || [];
    if (type === "split-column") {
        const inner = await Promise.all(kids.map((k) => renderWidget(k)));
        return shell(w, { ...meta, frameless: true }, `<div class="masonry" data-max-columns="${Math.max(2, w["max-columns"] || 2)}">${inner.join("")}</div>`);
    }
    // group: children render without header; titles become tabs
    for (const k of kids) if (k.type === "group" || k.type === "split-column") throw new Error(`${k.type === "group" ? "nested groups" : "split columns inside of groups"} are not supported`);
    const rendered = await Promise.all(kids.map((k) => renderWidget(k, { hideHeader: true })));
    const titles = kids.map((k) => {
        const d = registry[ALIASES[k.type] || k.type];
        return { title: k.title ?? fn(d?.title, k) ?? k.type, url: k["title-url"] || fn(d?.titleUrl, k) };
    });
    const content = `
<div class="widget-group-header"><div class="widget-header gap-20" role="tablist">${titles.map((t, i) => `<button class="widget-group-title${i === 0 ? " widget-group-title-current" : ""}"${t.url ? ` data-title-url="${esc(t.url)}"` : ""} aria-selected="${i === 0}" arial-level="2" role="tab" aria-controls="widget-${id}-tabpanel-${i}" id="widget-${id}-tab-${i}">${esc(t.title)}</button>`).join("")}</div></div>
<div class="widget-group-contents">${rendered.map((h, i) => `<div class="widget-group-content${i === 0 ? " widget-group-content-current" : ""}" id="widget-${id}-tabpanel-${i}" role="tabpanel" aria-labelledby="widget-${id}-tab-${i}" aria-hidden="${i !== 0}">${h}</div>`).join("")}</div>`;
    return shell(w, { ...meta, frameless: true, hideHeader: true }, content);
}

export async function renderPageContent(page) {
    const [head, ...cols] = await Promise.all([
        Promise.all((page["head-widgets"] || []).map((w) => renderWidget(w))),
        ...page.columns.map(async (c) => `<div class="page-column page-column-${esc(c.size)}">${(await Promise.all((c.widgets || []).map((w) => renderWidget(w)))).join("")}</div>`),
    ]);
    return `${page["show-mobile-header"] ? `<div class="mobile-reachability-header">${esc(page.name)}</div>` : ""}
${head.length ? `<div class="head-widgets">${head.join("")}</div>` : ""}
<div class="page-columns">${cols.join("")}</div>`;
}

export const clearCache = async () => {
    const all = await chrome.storage.local.get(null);
    await chrome.storage.local.remove(Object.keys(all).filter((k) => k.startsWith("wc:")));
};
