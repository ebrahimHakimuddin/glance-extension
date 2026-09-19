// Builds the page shell (header, nav, theme, footer) from the stored config, then hands off to Glance's page.js.
import { loadStored, buildConfig } from "./config.js";
import { themeCSS, backgroundHex, previewHTML } from "./theme.js";
import { renderPageContent } from "./render.js";
import { esc, url } from "./common.js";

const LOGO = `<svg style="max-height: 2rem;" width="100%" viewBox="0 0 108 108" fill="none" xmlns="http://www.w3.org/2000/svg"><rect fill="var(--color-text-subdue)" width="50" height="108" rx="6.875" /><path fill="var(--color-primary)" fill-rule="evenodd" clip-rule="evenodd" d="M64.875 0C61.078 0 58 3.07804 58 6.875V43.125C58 46.922 61.078 50 64.875 50H101.125C104.922 50 108 46.922 108 43.125V6.875C108 3.07804 104.922 0 101.125 0H64.875ZM75.7545 11L71.3078 15.6814H85.2233C85.9209 15.6814 86.5835 15.6633 87.2113 15.627C87.839 15.5544 88.3273 15.4093 88.6761 15.1915L70 34.5706L73.4004 38L91.8149 18.7843C91.6056 19.1835 91.4487 19.7097 91.3441 20.3629C91.2743 20.9798 91.2394 21.5968 91.2394 22.2137V37.1835L96 32.2843V11H75.7545Z"/><rect fill="var(--color-text-base)" x="58" y="58" width="50" height="50" rx="6.875" /></svg>`;

const $ = (id) => document.getElementById(id);
const showError = (msg) => {
    document.body.innerHTML = `<div style="max-width:40rem;margin:4rem auto;padding:0 1rem;font:15px system-ui;color:var(--color-text-base,#ddd)"><h2>Glance config error</h2><pre style="white-space:pre-wrap">${esc(msg)}</pre><p><a href="options.html" style="color:var(--color-primary,#e5c07b)">Open options</a></p></div>`;
};

async function main() {
    let cfg;
    try { cfg = buildConfig(await loadStored()); } catch (e) { showError(e.message); return; }

    const themeCfg = cfg.theme || {};
    const presets = themeCfg.presets || {};
    const themes = { default: themeCfg, ...presets };
    let current = "default";
    try { const k = localStorage.getItem("theme"); if (k && themes[k]) current = k; } catch { /* storage blocked */ }
    const cur = themes[current];

    const pageSlug = location.hash.slice(1);
    const page = cfg.pages.find((p) => p.slug === pageSlug) || cfg.pages[0];
    const branding = cfg.branding || {};
    const primary = Math.max(0, page.columns.findIndex((c) => c.size === "full"));

    window.pageData = { slug: page.slug, baseURL: "", theme: current };
    window.glanceTheme = async (key) => {
        const t = themes[key];
        try { localStorage.setItem("theme", key); } catch { /* ignore */ }
        return { css: themeCSS(t), scheme: t.light ? "light" : "dark" };
    };

    const html = document.documentElement;
    html.dataset.theme = current; html.dataset.scheme = cur.light ? "light" : "dark";
    document.title = page.name;
    if (branding["favicon-url"]) $("favicon").href = branding["favicon-url"];
    $("theme-style").textContent = themeCSS(cur);
    document.querySelector('meta[name="theme-color"]').content = backgroundHex(cur);
    if (themeCfg["custom-css-file"]) document.head.insertAdjacentHTML("beforeend", `<link rel="stylesheet" href="${url(themeCfg["custom-css-file"])}">`);
    if (cfg.document?.head) document.head.insertAdjacentHTML("beforeend", String(cfg.document.head));

    const navLinks = cfg.pages.map((p) => `<a href="#${esc(p.slug)}" class="nav-item${p === page ? " nav-item-current" : ""}"${p === page ? ' aria-current="page"' : ""}><div class="nav-item-text">${esc(p.name)}</div></a>`).join("");
    const picker = !themeCfg["disable-picker"];
    const choices = Object.entries(themes).map(([k, t]) => previewHTML(k, t)).join("");
    const logo = branding["logo-url"] ? `<img src="${url(branding["logo-url"])}" alt="">` : branding["logo-text"] ? esc(branding["logo-text"]) : LOGO;
    const bounds = page["desktop-navigation-width"] ? ` content-bounds-${esc(page["desktop-navigation-width"])}` : "";
    const chevron = `<svg class="ui-icon" stroke="var(--color-text-subdue)" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M4.098 19.902a3.75 3.75 0 0 0 5.304 0l6.401-6.402M6.75 21A3.75 3.75 0 0 1 3 17.25V4.125C3 3.504 3.504 3 4.125 3h5.25c.621 0 1.125.504 1.125 1.125v4.072M6.75 21a3.75 3.75 0 0 0 3.75-3.75V8.197M6.75 21h13.125c.621 0 1.125-.504 1.125-1.125v-5.25c0-.621-.504-1.125-1.125-1.125h-4.072M10.5 8.197l2.88-2.88c.438-.439 1.15-.439 1.59 0l3.712 3.713c.44.44.44 1.152 0 1.59l-2.879 2.88M6.75 17.25h.008v.008H6.75v-.008Z" /></svg>`;

    $("body-content").innerHTML = `
    ${page["hide-desktop-navigation"] ? "" : `<div class="header-container content-bounds${bounds}"><div class="header flex padding-inline-widget widget-content-frame">
        <div class="logo" aria-hidden="true">${logo}</div>
        <nav class="desktop-navigation flex grow hide-scrollbars">${navLinks}</nav>
        ${picker ? `<div class="theme-picker self-center" data-popover-type="html" data-popover-position="below" data-popover-show-delay="0"><div class="current-theme-preview">${previewHTML(current, cur)}</div><div data-popover-html><div class="theme-choices"></div></div></div>` : ""}
    </div></div>`}
    <div class="mobile-navigation">
        <div class="mobile-navigation-icons">
            <a class="mobile-navigation-label" href="#top">↑</a>
            ${page.columns.map((_, i) => `<label class="mobile-navigation-label"><input type="radio" class="mobile-navigation-input" name="column" value="${i}" autocomplete="off"${i === primary ? " checked" : ""}><div class="mobile-navigation-pill"></div></label>`).join("")}
            <label class="mobile-navigation-label"><input type="checkbox" class="mobile-navigation-page-links-input" autocomplete="on"><div class="hamburger-icon"></div></label>
        </div>
        <div class="mobile-navigation-page-links hide-scrollbars">${navLinks}</div>
        ${picker ? `<div class="mobile-navigation-actions flex flex-column margin-block-10"><div class="theme-picker flex justify-between items-center" data-popover-type="html" data-popover-position="above" data-popover-show-delay="0" data-popover-hide-delay="100" data-popover-anchor=".current-theme-preview" data-popover-trigger="click">
            <div data-popover-html><div class="theme-choices">${choices}</div></div>
            <div class="size-h3 pointer-events-none select-none">Change theme</div>
            <div class="flex gap-15 items-center pointer-events-none"><div class="current-theme-preview">${previewHTML(current, cur)}</div>${chevron}</div>
        </div></div>` : ""}
    </div>
    <div class="content-bounds grow${page.width ? " content-bounds-" + esc(page.width) : ""}">
        <main class="page${page["center-vertically"] ? " center-vertically" : ""}" id="page" aria-live="polite" aria-busy="true">
            <h1 class="visually-hidden">${esc(page.name)}</h1>
            <div class="page-content" id="page-content"></div>
            <div class="page-loading-container"><div class="visually-hidden">Loading</div><div class="loading-icon" aria-hidden="true"></div></div>
        </main>
    </div>
    ${branding["hide-footer"] ? "" : `<footer class="footer flex items-center flex-column">${branding["custom-footer"] ? String(branding["custom-footer"]) : `<div><a class="size-h3" href="https://github.com/glanceapp/glance" target="_blank" rel="noreferrer">Glance</a></div>`}</footer>`}
    <div class="mobile-navigation-offset"></div>`;

    window.glancePageContent = () => renderPageContent(page);
    window.addEventListener("hashchange", () => location.reload());
    await import("./static/js/page.js");
}
main();
