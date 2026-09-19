import { esc, url, iconImg } from "./common.js";
import { hsl } from "./common.js";

const SEARCH_ENGINES = {
    duckduckgo: "https://duckduckgo.com/?q={QUERY}", google: "https://www.google.com/search?q={QUERY}", bing: "https://www.bing.com/search?q={QUERY}",
    perplexity: "https://www.perplexity.ai/search?q={QUERY}", kagi: "https://kagi.com/search?q={QUERY}", startpage: "https://www.startpage.com/search?q={QUERY}",
};

export const basicWidgets = {
    clock: {
        title: "Clock",
        render(w) {
            const fmt = w["hour-format"] === "12h" ? "12h" : "24h";
            if (w["hour-format"] && !["12h", "24h"].includes(w["hour-format"])) throw new Error("hour-format must be either 12h or 24h");
            return `
<div class="clock" data-hour-format="${fmt}">
    <div class="flex justify-between items-center" data-local-time>
        <div><div class="color-highlight size-h1" data-date></div><div data-year></div></div>
        <div class="text-right"><div class="clock-time size-h1" data-time></div><div data-weekday></div></div>
    </div>
    ${(w.timezones || []).length ? `<hr class="margin-block-10"><ul class="list list-gap-4">${w.timezones.map((t) => `
        <li class="flex items-center gap-15" data-time-in-zone="${esc(t.timezone)}">
            <div class="grow min-width-0"><div class="text-truncate">${esc(t.label || t.timezone)}</div></div>
            <div class="color-subdue" data-time-diff></div>
            <div class="size-h4 clock-time shrink-0 text-right" data-time></div>
        </li>`).join("")}</ul>` : ""}
</div>`;
        },
    },

    calendar: {
        title: "Calendar",
        render(w) {
            const days = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
            const d = w["first-day-of-week"] || "monday";
            if (!days.includes(d)) throw new Error("invalid first day of week");
            return `<div class="widget-small-content-bounds"><div class="calendar" data-first-day-of-week="${days.indexOf(d)}"></div></div>`;
        },
    },

    todo: { title: "To-do", render: (w) => `<div class="todo" data-todo-id="${esc(w.id ?? "")}"></div>` },

    search: {
        title: "Search",
        frameless: true,
        render(w) {
            const engine = (SEARCH_ENGINES[w["search-engine"]] || w["search-engine"] || SEARCH_ENGINES.duckduckgo).replace("{QUERY}", "!QUERY!");
            (w.bangs || []).forEach((b, i) => { if (!b.shortcut) throw new Error(`search bang #${i + 1} has no shortcut`); if (!b.url) throw new Error(`search bang #${i + 1} has no URL`); });
            return `
<div class="search widget-content-frame padding-inline-widget flex gap-15 items-center" data-default-search-url="${esc(engine)}" data-new-tab="${!!w["new-tab"]}" data-target="${esc(w.target || "")}">
    <div class="search-bangs">${(w.bangs || []).map((b) => `<input type="hidden" data-shortcut="${esc(b.shortcut)}" data-title="${esc(b.title)}" data-url="${esc(b.url.replace("{QUERY}", "!QUERY!"))}">`).join("")}</div>
    <div class="search-icon-container"><svg class="search-icon" stroke="var(--color-text-subdue)" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" /></svg></div>
    <input class="search-input" type="text" placeholder="${esc(w.placeholder || "Type here to search…")}" autocomplete="off"${w.autofocus ? " autofocus" : ""}>
    <div class="search-bang"></div>
    <kbd class="hide-on-mobile" title="Press [S] to focus the search input">S</kbd>
</div>`;
        },
    },

    bookmarks: {
        title: "Bookmarks",
        render: (w) => `
<div class="dynamic-columns list-gap-24 list-with-separator">${(w.groups || []).map((g) => {
            const color = hsl(g.color);
            return `<div class="bookmarks-group"${color ? ` style="--bookmarks-group-color: ${color}"` : ""}>
        ${g.title ? `<div class="bookmarks-group-title size-h3 margin-bottom-3">${esc(g.title)}</div>` : ""}
        <ul class="list list-gap-2">${(g.links || []).map((l) => {
                const same = l["same-tab"] ?? g["same-tab"] ?? false;
                const hide = l["hide-arrow"] ?? g["hide-arrow"] ?? false;
                const target = l.target || g.target || (same ? "" : "_blank");
                return `<li>
            <div class="flex items-center gap-10">
                ${l.icon ? `<div class="bookmarks-icon-container">${iconImg(l.icon, "bookmarks-icon")}</div>` : ""}
                <a href="${url(l.url)}" class="bookmarks-link ${hide ? "bookmarks-link-no-arrow " : ""}color-highlight size-h4" ${target ? `target="${esc(target)}"` : ""} rel="noreferrer">${esc(l.title)}</a>
            </div>
            ${l.description ? `<div class="margin-bottom-5">${esc(l.description)}</div>` : ""}
        </li>`;
            }).join("")}</ul>
    </div>`;
        }).join("")}</div>`,
    },
};
