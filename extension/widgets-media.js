import { esc, url, timeAttrs, collapse } from "./common.js";

const IMG_ICON = `<path stroke-linecap="round" stroke-linejoin="round" d="m2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 0 0 1.5-1.5V6a1.5 1.5 0 0 0-1.5-1.5H3.75A1.5 1.5 0 0 0 2.25 6v12a1.5 1.5 0 0 0 1.5 1.5Zm10.5-11.25h.008v.008h-.008V8.25Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z" />`;
const svgImg = (cls, extra = "", stroke = "var(--color-text-subdue)") =>
    `<svg class="${cls}" ${extra} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="${stroke}">${IMG_ICON}</svg>`;

const decode = (s) => { const t = document.createElement("textarea"); t.innerHTML = s; return t.value; };
const shorten = (html, max) => {
    let s = (html || "").slice(0, 1000).replace(/\n/g, " ").replace(/<\/?[a-zA-Z0-9-]+[^>]*>/g, "").replace(/\s+/g, " ").trim();
    s = decode(s);
    return s.length > max ? s.slice(0, max) + "…" : s;
};
const origin = (u) => { try { return new URL(u).origin; } catch { return u; } };

async function parseFeed(req, style) {
    const r = await fetch(req.url, { headers: req.headers || {} });
    if (!r.ok) throw new Error(`unexpected status code ${r.status} from ${req.url}`);
    const doc = new DOMParser().parseFromString(await r.text(), "text/xml");
    if (doc.querySelector("parsererror")) throw new Error("could not parse feed " + req.url);
    const txt = (n, sel) => n.querySelector(sel)?.textContent?.trim() || "";
    const isAtom = !!doc.querySelector("feed");
    const feedLink = isAtom
        ? doc.querySelector("feed > link:not([rel]), feed > link[rel=alternate]")?.getAttribute("href") || ""
        : txt(doc, "channel > link");
    const feedTitle = txt(doc, isAtom ? "feed > title" : "channel > title");
    const feedImage = txt(doc, "channel > image > url");
    let nodes = [...doc.querySelectorAll(isAtom ? "entry" : "item")];
    if (req.limit > 0) nodes = nodes.slice(0, req.limit);
    return nodes.map((n) => {
        let link = isAtom
            ? (n.querySelector("link:not([rel]), link[rel=alternate]") || n.querySelector("link"))?.getAttribute("href") || ""
            : txt(n, "link");
        if (req["item-link-prefix"]) link = req["item-link-prefix"] + link;
        else if (!/^https?:\/\//.test(link)) link = origin(feedLink || req.url) + (link.startsWith("/") ? "" : "/") + link;
        const desc = txt(n, isAtom ? "summary, content" : "description");
        const rawTitle = txt(n, "title");
        const item = { channelUrl: feedLink, link, title: rawTitle ? decode(rawTitle) : shorten(desc, 100) };
        if (style === "detailed-list") {
            if (!req["hide-description"] && desc && rawTitle) item.description = shorten(desc, 200);
            if (!req["hide-categories"]) {
                item.categories = [...n.querySelectorAll("category")]
                    .map((c) => c.getAttribute("term") || c.textContent.trim())
                    .filter((c) => c && c.length <= 30).slice(0, 6);
            }
        }
        item.channelName = req.title || feedTitle;
        const media = [...n.getElementsByTagNameNS("*", "thumbnail"), ...n.getElementsByTagNameNS("*", "image")].find((e) => e.getAttribute("url"));
        const enc = n.querySelector('enclosure[type^="image"]')?.getAttribute("url");
        item.image = enc || media?.getAttribute("url") || (feedImage.startsWith("/") ? feedLink.replace(/\/+$/, "") + feedImage : feedImage);
        if (item.image.startsWith("/")) item.image = (req["thumbnail-link-prefix"] || feedLink.replace(/^\/+/, "") || origin(req.url)).replace(/\/+$/, "") + item.image;
        const d = Date.parse(txt(n, isAtom ? "published, updated" : "pubDate") || txt(n, "date"));
        item.time = isNaN(d) ? Date.now() / 1000 : d / 1000;
        return item;
    });
}

const cards = (inner, extraStyle = "") => `<div class="carousel-container"><div class="cards-horizontal carousel-items-container"${extraStyle}>${inner}</div></div>`;
const empty = `<div class="widget-content-frame padding-widget">No items were returned from the feeds.</div>`;

export const mediaWidgets = {
    rss: {
        title: "RSS Feed",
        cache: 120,
        frameless: (w) => w.style === "horizontal-cards" || w.style === "horizontal-cards-2",
        async render(w) {
            const style = w.style;
            const reqs = (w.feeds || []).map((f) => (typeof f === "string" ? { url: f } : f));
            const settled = await Promise.allSettled(reqs.map((r) => parseFeed(r, style)));
            const ok = settled.filter((s) => s.status === "fulfilled");
            if (reqs.length && !ok.length) throw new Error(settled[0].reason?.message || "no content");
            const seen = new Set();
            let items = ok.flatMap((s) => s.value).filter((i) => !seen.has(i.link) && seen.add(i.link));
            if (!w["preserve-order"]) items.sort((a, b) => b.time - a.time);
            items = items.slice(0, w.limit > 0 ? w.limit : 25);
            const ca = collapse(w["collapse-after"]);
            const a = (i) => `<a href="${url(i.link)}" target="_blank" rel="noreferrer"`;
            if (style === "horizontal-cards") {
                if (!items.length) return empty;
                const h = w["thumbnail-height"] > 0 ? ` style="--rss-thumbnail-height: ${w["thumbnail-height"]}rem;"` : "";
                return cards(items.map((i) => `
<div class="card widget-content-frame thumbnail-parent">
    ${i.image ? `<img class="rss-card-image thumbnail" loading="lazy" src="${url(i.image)}" alt="">` : svgImg("rss-card-image")}
    <div class="margin-bottom-widget padding-inline-widget flex flex-column grow">
        ${a(i)} class="text-truncate-3-lines color-primary-if-not-visited margin-top-10 margin-bottom-auto">${esc(i.title)}</a>
        <ul class="list-horizontal-text flex-nowrap margin-top-7"><li class="shrink-0" ${timeAttrs(i.time)}></li><li class="min-width-0 text-truncate">${esc(i.channelName)}</li></ul>
    </div>
</div>`).join(""), h);
            }
            if (style === "horizontal-cards-2") {
                if (!items.length) return empty;
                const h = w["card-height"] > 0 ? ` style="--rss-card-height: ${w["card-height"]}rem;"` : "";
                return cards(items.map((i) => `
<div class="card rss-card-2 widget-content-frame thumbnail-parent">
    ${i.image ? `<img class="rss-card-2-image thumbnail" loading="lazy" src="${url(i.image)}" alt="">` : svgImg("rss-card-2-image", 'style="transform: scale(0.35) translateY(-25%)"')}
    <div class="rss-card-2-content padding-inline-widget">
        ${a(i)} class="block text-truncate color-primary-if-not-visited">${esc(i.title)}</a>
        <ul class="list-horizontal-text flex-nowrap margin-top-5"><li class="shrink-0" ${timeAttrs(i.time)}></li><li class="min-width-0 text-truncate">${esc(i.channelName)}</li></ul>
    </div>
</div>`).join(""), h);
            }
            if (style === "detailed-list") {
                return `<ul class="list list-gap-24 collapsible-container" data-collapse-after="${ca}">${items.map((i) => `
<li class="flex gap-15 items-start row-reverse-on-mobile thumbnail-parent">
    <div class="thumbnail-container rss-detailed-thumbnail">${i.image ? `<img class="thumbnail" loading="lazy" src="${url(i.image)}" alt="">` : svgImg("scale-half hide-on-mobile")}</div>
    <div class="grow min-width-0">
        ${a(i)} class="size-h3 color-primary-if-not-visited">${esc(i.title)}</a>
        <ul class="list-horizontal-text flex-nowrap"><li ${timeAttrs(i.time)}></li>
            <li class="min-width-0"><a class="block text-truncate" href="${url(i.channelUrl)}" target="_blank" rel="noreferrer">${esc(i.channelName)}</a></li></ul>
        ${i.description ? `<p class="rss-detailed-description text-truncate-2-lines margin-top-10">${esc(i.description)}</p>` : ""}
        ${i.categories?.length ? `<ul class="attachments margin-top-10">${i.categories.map((c) => `<li>${esc(c)}</li>`).join("")}</ul>` : ""}
    </div>
</li>`).join("") || "<li>No items were returned from the feeds.</li>"}</ul>`;
            }
            return `<ul class="list list-gap-14 collapsible-container${w["single-line-titles"] ? " single-line-titles" : ""}" data-collapse-after="${ca}">${items.map((i) => `
<li>
    ${a(i)} class="title size-title-dynamic color-primary-if-not-visited">${esc(i.title)}</a>
    <ul class="list-horizontal-text flex-nowrap"><li ${timeAttrs(i.time)}></li>
        <li class="min-width-0"><a class="block text-truncate" href="${url(i.channelUrl)}" target="_blank" rel="noreferrer">${esc(i.channelName)}</a></li></ul>
</li>`).join("") || "<li>No items were returned from the feeds.</li>"}</ul>`;
        },
    },

    videos: {
        title: "Videos",
        cache: 60,
        frameless: (w) => w.style !== "vertical-list",
        async render(w) {
            const ids = [...(w.channels || []), ...(w.playlists || []).map((p) => "playlist:" + p)];
            const settled = await Promise.allSettled(ids.map(async (id) => {
                let feed;
                if (id.startsWith("playlist:")) feed = "https://www.youtube.com/feeds/videos.xml?playlist_id=" + id.slice(9);
                else if (!w["include-shorts"] && id.startsWith("UC")) feed = "https://www.youtube.com/feeds/videos.xml?playlist_id=" + id.replace("UC", "UULF");
                else feed = "https://www.youtube.com/feeds/videos.xml?channel_id=" + id;
                const r = await fetch(feed);
                if (!r.ok) throw new Error(`HTTP ${r.status}`);
                const doc = new DOMParser().parseFromString(await r.text(), "text/xml");
                const author = doc.querySelector("feed > author > name")?.textContent || "";
                const authorUrl = (doc.querySelector("feed > author > uri")?.textContent || "") + "/videos";
                return [...doc.querySelectorAll("entry")].map((e) => {
                    const href = e.querySelector("link")?.getAttribute("href") || "";
                    let u = href;
                    if (w["video-url-template"]) u = w["video-url-template"].replaceAll("{VIDEO-ID}", new URL(href).searchParams.get("v") || "");
                    return {
                        title: e.querySelector("title")?.textContent || "", url: u, author, authorUrl,
                        thumb: e.getElementsByTagNameNS("*", "thumbnail")[0]?.getAttribute("url") || "",
                        time: Date.parse(e.querySelector("published")?.textContent) / 1000,
                    };
                });
            }));
            const vids = settled.flatMap((s) => (s.status === "fulfilled" ? s.value : [])).sort((a, b) => b.time - a.time).slice(0, w.limit > 0 ? w.limit : 25);
            if (!vids.length) throw new Error("no content");
            const card = (v) => `
<img class="video-thumbnail thumbnail" loading="lazy" src="${url(v.thumb)}" alt="">
<div class="margin-top-10 margin-bottom-widget flex flex-column grow padding-inline-widget">
    <a class="text-truncate-2-lines margin-bottom-auto color-primary-if-not-visited" href="${url(v.url)}" target="_blank" rel="noreferrer">${esc(v.title)}</a>
    <ul class="list-horizontal-text flex-nowrap margin-top-7"><li class="shrink-0" ${timeAttrs(v.time)}></li>
        <li class="min-width-0"><a class="block text-truncate" href="${url(v.authorUrl)}" target="_blank" rel="noreferrer">${esc(v.author)}</a></li></ul>
</div>`;
            if (w.style === "grid-cards") {
                const rows = w["collapse-after-rows"] === 0 || w["collapse-after-rows"] < -1 || w["collapse-after-rows"] == null ? 4 : w["collapse-after-rows"];
                return `<div class="cards-grid collapsible-container" data-collapse-after-rows="${rows}">${vids.map((v) => `<div class="card widget-content-frame thumbnail-parent">${card(v)}</div>`).join("")}</div>`;
            }
            if (w.style === "vertical-list") {
                return `<ul class="list list-gap-14 collapsible-container" data-collapse-after="${collapse(w["collapse-after"] ?? 7)}">${vids.map((v) => `
<li class="flex thumbnail-parent gap-10 items-center">
    <img class="video-horizontal-list-thumbnail thumbnail" loading="lazy" src="${url(v.thumb)}" alt="">
    <div class="min-width-0"><a class="block text-truncate color-primary-if-not-visited" href="${url(v.url)}" target="_blank" rel="noreferrer">${esc(v.title)}</a>
        <ul class="list-horizontal-text flex-nowrap"><li class="shrink-0" ${timeAttrs(v.time)}></li><li class="min-width-0"><a class="block text-truncate" href="${url(v.authorUrl)}" target="_blank" rel="noreferrer">${esc(v.author)}</a></li></ul></div>
</li>`).join("")}</ul>`;
            }
            return cards(vids.map((v) => `<div class="card widget-content-frame thumbnail-parent">${card(v)}</div>`).join(""));
        },
    },
};
