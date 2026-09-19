import { esc, url, timeAttrs, iconImg } from "./common.js";

// ---- docker-containers -------------------------------------------------------
// A browser cannot open a unix socket; only http(s):// / tcp:// sources (e.g. docker-socket-proxy) work.
const STATE_ICONS = {
    ok: `<svg class="docker-container-status-icon" fill="var(--color-positive)" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" aria-hidden="true"><path fill-rule="evenodd" d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm3.857-9.809a.75.75 0 0 0-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 1 0-1.06 1.061l2.5 2.5a.75.75 0 0 0 1.137-.089l4-5.5Z" clip-rule="evenodd" /></svg>`,
    warn: `<svg class="docker-container-status-icon" fill="var(--color-negative)" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" aria-hidden="true"><path fill-rule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495ZM10 5a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-1.5 0v-3.5A.75.75 0 0 1 10 5Zm0 9a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z" clip-rule="evenodd" /></svg>`,
    paused: `<svg class="docker-container-status-icon" fill="var(--color-text-base)" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" aria-hidden="true"><path fill-rule="evenodd" d="M2 10a8 8 0 1 1 16 0 8 8 0 0 1-16 0Zm5-2.25A.75.75 0 0 1 7.75 7h.5a.75.75 0 0 1 .75.75v4.5a.75.75 0 0 1-.75.75h-.5a.75.75 0 0 1-.75-.75v-4.5Zm4 0a.75.75 0 0 1 .75-.75h.5a.75.75 0 0 1 .75.75v4.5a.75.75 0 0 1-.75.75h-.5a.75.75 0 0 1-.75-.75v-4.5Z" clip-rule="evenodd" /></svg>`,
    other: `<svg class="docker-container-status-icon" fill="var(--color-text-base)" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" aria-hidden="true"><path fill-rule="evenodd" d="M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0ZM8.94 6.94a.75.75 0 1 1-1.061-1.061 3 3 0 1 1 2.871 5.026v.345a.75.75 0 0 1-1.5 0v-.5c0-.72.57-1.172 1.081-1.287A1.5 1.5 0 1 0 8.94 6.94ZM10 15a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z" clip-rule="evenodd" /></svg>`,
};
const PRIORITY = { warn: 0, other: 1, paused: 2, ok: 3 };
const truthy = (s) => s === "true" || s === "yes";
const stateIcon = (c) => {
    if ((c.Status || "").toLowerCase().includes("(unhealthy)")) return "warn";
    return { running: "ok", paused: "paused", exited: "warn", dead: "warn" }[(c.State || "").toLowerCase()] || "other";
};
const byIconThenName = (a, b) => PRIORITY[a.icon] - PRIORITY[b.icon] || a.name.toLowerCase().localeCompare(b.name.toLowerCase());

export const serverWidgets = {
    "docker-containers": {
        title: "Docker Containers",
        cache: 1,
        async render(w) {
            const src = w["sock-path"] || "/var/run/docker.sock";
            if (!/^(tcp|https?):\/\//.test(src))
                throw new Error("browsers cannot reach a unix socket; set sock-path to an http(s):// docker-socket-proxy URL");
            const base = src.replace(/^tcp:/, "http:").replace(/\/+$/, "");
            const list = await (await fetch(`${base}/containers/json?all=${w["running-only"] ? "false" : "true"}`, { signal: AbortSignal.timeout(5000) })).json();
            const overrides = w.containers || {};
            for (const c of list) {
                const o = overrides[(c.Names?.[0] || "").replace(/^\/+/, "")];
                if (o) { c.Labels ||= {}; for (const [k, v] of Object.entries(o)) c.Labels["glance." + k] = String(v); }
            }
            const L = (c, k, d = "") => c.Labels?.[k] || d;
            const items = w.category ? list.filter((c) => L(c, "glance.category") === w.category) : list;
            const name = (c) => {
                if (L(c, "glance.name")) return L(c, "glance.name");
                let n = (c.Names?.[0] || "").replace(/^\/+/, "");
                if (!n) return "n/a";
                if (w["format-container-names"]) n = n.replace(/[_-]/g, " ").split(" ").map((x) => x && x[0].toUpperCase() + x.slice(1)).join(" ");
                return n;
            };
            const hidden = (c) => (L(c, "glance.hide") ? truthy(L(c, "glance.hide")) : !!w["hide-by-default"]);
            const parents = [], children = {};
            for (const c of items.filter((c) => !hidden(c))) {
                const par = L(c, "glance.parent");
                if (!L(c, "glance.id") && par) (children[par] ||= []).push(c); else parents.push(c);
            }
            const rows = parents.map((c) => {
                const kids = (children[L(c, "glance.id")] || []).map((k) => ({ name: name(k), stateText: k.Status, icon: stateIcon(k) })).sort(byIconThenName);
                return {
                    name: name(c), url: L(c, "glance.url"), description: L(c, "glance.description"), sameTab: truthy(L(c, "glance.same-tab", "false")),
                    image: c.Image, state: (c.State || "").toLowerCase(), stateText: (c.Status || "").toLowerCase(),
                    iconVal: L(c, "glance.icon", "si:docker"), kids,
                    icon: kids.some((k) => k.icon === "warn") ? "warn" : stateIcon(c),
                };
            }).sort(byIconThenName);
            return `<ul class="dynamic-columns list-gap-20 list-with-separator">${rows.map((c) => `
<li class="docker-container flex items-center gap-15">
    <div class="shrink-0" data-popover-type="html" data-popover-position="above" data-popover-offset="0.25" data-popover-margin="0.1rem" data-popover-max-width="400px" aria-hidden="true">
        ${iconImg(c.iconVal, "docker-container-icon")}
        <div data-popover-html>
            <div class="color-highlight text-truncate block">${esc(c.image)}</div><div>${esc(c.stateText)}</div>
            ${c.kids.length ? `<ul class="list list-gap-4 margin-top-10">${c.kids.map((k) => `<li class="flex gap-7 items-center"><div class="margin-bottom-3">${STATE_ICONS[k.icon]}</div><div class="color-highlight">${esc(k.name)} <span class="size-h5 color-base">${esc(k.stateText)}</span></div></li>`).join("")}</ul>` : ""}
        </div>
    </div>
    <div class="min-width-0 grow">
        ${c.url ? `<a href="${url(c.url)}" class="color-highlight size-title-dynamic block text-truncate" ${c.sameTab ? "" : 'target="_blank"'} rel="noreferrer">${esc(c.name)}</a>` : `<div class="color-highlight text-truncate size-title-dynamic">${esc(c.name)}</div>`}
        ${c.description ? `<div class="text-truncate">${esc(c.description)}</div>` : ""}
    </div>
    <div class="margin-left-auto shrink-0" data-popover-type="text" data-popover-position="above" data-popover-text="${esc(c.state)}" aria-label="${esc(c.state)}">${STATE_ICONS[c.icon]}</div>
    <div class="visually-hidden" aria-label="${esc(c.stateText)}"></div>
</li>`).join("") || '<div class="text-center">No containers available to show.</div>'}</ul>`;
        },
    },

    "server-stats": {
        title: "Server Stats",
        cache: 0.25,
        wip: true,
        async render(w) {
            const servers = w.servers?.length ? w.servers : [{ type: "local" }];
            const mb = (n) => {
                const [v, l] = n < 1e3 ? [n, "MB"] : n < 1e6 ? [n < 1e4 ? (n / 1e3).toFixed(1) : Math.trunc(n / 1e3), "GB"] : [(n / 1e6).toFixed(1), "TB"];
                return `${v} <span class="color-base size-h5">${l}</span>`;
            };
            const parseSecs = (d) => { const m = /^(\d+)(s|m|h|d)$/.exec(d || ""); return m ? +m[1] * { s: 1, m: 60, h: 3600, d: 86400 }[m[2]] : 3; };
            const one = async (s, i) => {
                let info = null;
                if (s.type === "remote") {
                    try {
                        const r = await fetch(s.url.replace(/\/+$/, "") + "/api/sysinfo/all", {
                            headers: s.token ? { Authorization: "Bearer " + s.token } : {}, signal: AbortSignal.timeout(parseSecs(s.timeout) * 1000),
                        });
                        if (!r.ok) throw new Error(r.status);
                        info = await r.json();
                    } catch { /* unreachable */ }
                }
                const reachable = !!info;
                info ||= { hostname: "Unnamed server #" + (i + 1), cpu: {}, memory: {}, mountpoints: [] };
                const cpu = info.cpu || {}, mem = info.memory || {}, mp = info.mountpoints || [];
                const bar = (p) => `<div class="progress-value${p >= 85 ? " progress-value-notice" : ""}" style="--percent: ${p}"></div>`;
                const row = (a, b) => `<div class="flex"><div class="size-h5">${a}</div><div class="value-separator"></div><div class="color-highlight text-very-compact">${b}</div></div>`;
                const swap = !s["hide-swap"] && mem.swap_is_available;
                return `
<div class="server">
    <div class="server-info">
        <div class="server-details">
            <div class="server-name color-highlight size-h3">${esc(s.name || info.hostname)}</div>
            <div>${reachable ? `${info.host_info_is_available ? `<span ${timeAttrs(info.boot_time)}></span>` : "unknown"} uptime` : s.type === "remote" ? "unreachable" : "unavailable in a browser (use type: remote)"}</div>
        </div>
        <div class="shrink-0"${reachable ? ' data-popover-type="html" data-popover-margin="0.2rem" data-popover-max-width="400px"' : ""}>
            ${reachable ? `<div data-popover-html><div class="size-h5 text-compact">PLATFORM</div><div class="color-highlight">${info.host_info_is_available ? esc(info.platform) : "Unknown"}</div></div>` : ""}
            <svg class="server-icon" stroke="var(--color-${reachable ? "positive" : "negative"})" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M21.75 17.25v-.228a4.5 4.5 0 0 0-.12-1.03l-2.268-9.64a3.375 3.375 0 0 0-3.285-2.602H7.923a3.375 3.375 0 0 0-3.285 2.602l-2.268 9.64a4.5 4.5 0 0 0-.12 1.03v.228m19.5 0a3 3 0 0 1-3 3H5.25a3 3 0 0 1-3-3m19.5 0a3 3 0 0 0-3-3H5.25a3 3 0 0 0-3 3m16.5 0h.008v.008h-.008v-.008Zm-3 0h.008v.008h-.008v-.008Z" /></svg>
        </div>
    </div>
    <div class="server-stats">
        <div class="flex-1${cpu.load_is_available ? "" : " server-stat-unavailable"}">
            <div class="flex items-end size-h5"><div>CPU</div>
                ${cpu.temperature_is_available && cpu.temperature_c >= 80 ? '<svg class="server-spicy-cpu-icon" fill="var(--color-negative)" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path fill-rule="evenodd" d="M8.074.945A4.993 4.993 0 0 0 6 5v.032c.004.6.114 1.176.311 1.709.16.428-.204.91-.61.7a5.023 5.023 0 0 1-1.868-1.677c-.202-.304-.648-.363-.848-.058a6 6 0 1 0 8.017-1.901l-.004-.007a4.98 4.98 0 0 1-2.18-2.574c-.116-.31-.477-.472-.744-.28Zm.78 6.178a3.001 3.001 0 1 1-3.473 4.341c-.205-.365.215-.694.62-.59a4.008 4.008 0 0 0 1.873.03c.288-.065.413-.386.321-.666A3.997 3.997 0 0 1 8 8.999c0-.585.126-1.14.351-1.641a.42.42 0 0 1 .503-.235Z" clip-rule="evenodd" /></svg>' : ""}
                <div class="color-highlight margin-left-auto text-very-compact">${cpu.load_is_available ? `${cpu.load1_percent} <span class="color-base">%</span>` : "n/a"}</div></div>
            <div${cpu.load_is_available ? ' data-popover-type="html"' : ""}>
                ${cpu.load_is_available ? `<div data-popover-html>${row("1M AVG", `${cpu.load1_percent} <span class="color-base size-h5">%</span>`)}<div class="margin-top-3">${row("15M AVG", `${cpu.load15_percent} <span class="color-base size-h5">%</span>`)}</div>${cpu.temperature_is_available ? `<div class="margin-top-3">${row("TEMP C", `${cpu.temperature_c} <span class="color-base size-h5">°</span>`)}</div>` : ""}</div>` : ""}
                <div class="progress-bar progress-bar-combined">${cpu.load_is_available ? bar(cpu.load1_percent) + bar(cpu.load15_percent) : ""}</div>
            </div>
        </div>
        <div class="flex-1${mem.memory_is_available ? "" : " server-stat-unavailable"}">
            <div class="flex justify-between items-end size-h5"><div>RAM</div><div class="color-highlight text-very-compact">${mem.memory_is_available ? `${mem.used_percent} <span class="color-base">%</span>` : "n/a"}</div></div>
            <div${mem.memory_is_available ? ' data-popover-type="html"' : ""}>
                ${mem.memory_is_available ? `<div data-popover-html>${row("RAM", `${mb(mem.used_mb)} <span class="color-base size-h5">/</span> ${mb(mem.total_mb)}`)}${swap ? `<div class="margin-top-3">${row("SWAP", `${mb(mem.swap_used_mb)} <span class="color-base size-h5">/</span> ${mb(mem.swap_total_mb)}`)}</div>` : ""}</div>` : ""}
                <div class="progress-bar progress-bar-combined">${mem.memory_is_available ? bar(mem.used_percent) + (swap ? bar(mem.swap_used_percent) : "") : ""}</div>
            </div>
        </div>
        <div class="flex-1${mp.length ? "" : " server-stat-unavailable"}">
            <div class="flex justify-between items-end size-h5"><div>DISK</div><div class="color-highlight text-very-compact">${mp.length ? `${mp[0].used_percent} <span class="color-base">%</span>` : "n/a"}</div></div>
            <div${mp.length ? ' data-popover-type="html"' : ""}>
                ${mp.length ? `<div data-popover-html><ul class="list list-gap-2">${mp.map((m) => `<li class="flex"><div class="size-h5">${esc(m.name || m.path)}</div><div class="value-separator"></div><div class="color-highlight text-very-compact">${mb(m.used_mb)} <span class="color-base size-h5">/</span> ${mb(m.total_mb)}</div></li>`).join("")}</ul></div>` : ""}
                <div class="progress-bar progress-bar-combined">${mp.length ? bar(mp[0].used_percent) + (mp.length >= 2 ? bar(mp[1].used_percent) : "") : ""}</div>
            </div>
        </div>
    </div>
</div>`;
            };
            return (await Promise.all(servers.map(one))).join("");
        },
    },
};
