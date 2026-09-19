import { esc, url, timeAttrs, num, approx, collapse, getJSON } from "./common.js";

// ---- dns-stats -------------------------------------------------------------
const BARS = 8;
const b64 = (s) => btoa(unescape(encodeURIComponent(s)));

// values: array of per-bucket [queries, blocked] already grouped into BARS bars
function series(pairs) {
    const max = Math.max(...pairs.map((p) => p[0]));
    return pairs.map(([q, b]) => ({
        queries: q, blocked: b,
        percentBlocked: q > 0 ? Math.trunc((b / q) * 100) : 0,
        percentTotal: max > 0 ? Math.trunc((q / max) * 100) : 0,
    }));
}
const padTo = (a, n) => (a.length > n ? a.slice(-n) : [...Array(n - a.length).fill(0), ...a]);
const group = (q, b, per) => Array.from({ length: BARS }, (_, i) => {
    let sq = 0, sb = 0;
    for (let j = 0; j < per; j++) { sq += q[i * per + j] || 0; sb += b[i * per + j] || 0; }
    return [sq, sb];
});
const pct = (n, d) => (d > 0 ? Math.trunc((n / d) * 100) : 0);

const dns = {
    async adguard(w) {
        const j = await getJSON(w.url.replace(/\/+$/, "") + "/control/stats", { headers: { Authorization: "Basic " + b64(`${w.username}:${w.password}`) } });
        const s = { total: j.num_dns_queries, blockedPercent: 0, latency: Math.trunc(j.avg_processing_time * 1000), domains: 0, series: [], top: [] };
        if (s.total <= 0) return s;
        s.blockedPercent = pct(j.num_blocked_filtering, s.total);
        s.top = (j.top_blocked_domains || []).slice(0, 5).map((d) => { const [k, v] = Object.entries(d)[0] || []; return k && { domain: k, percent: pct(v, j.num_blocked_filtering) }; }).filter(Boolean);
        if (!w["hide-graph"]) s.series = series(group(padTo(j.dns_queries, 24), padTo(j.blocked_filtering, 24), 3));
        return s;
    },
    async pihole(w) {
        if (!w.token) throw new Error("missing API token");
        const j = await getJSON(`${w.url.replace(/\/+$/, "")}/admin/api.php?summaryRaw&topItems&overTimeData10mins&auth=${w.token}`);
        const s = { total: j.dns_queries_today, blockedPercent: Math.trunc(j.ads_percentage_today), domains: j.domains_being_blocked, latency: 0, series: [], top: [] };
        const top = Array.isArray(j.top_ads) ? {} : j.top_ads || {};
        s.top = Object.entries(top).map(([domain, c]) => ({ domain, percent: pct(c, j.ads_blocked_today) })).sort((a, b) => b.percent - a.percent).slice(0, 5);
        const dq = j.domains_over_time, ab = j.ads_over_time;
        if (!w["hide-graph"] && dq && !Array.isArray(dq) && Object.keys(dq).length === 144 && Object.keys(ab).length === 144) {
            const keys = Object.keys(dq).map(Number).sort((a, b) => a - b);
            const q = keys.map((k) => dq[k] || 0), b = keys.map((k) => ab[k] || 0);
            s.series = series(group(q, b, 18));
        }
        return s;
    },
    async "pihole-v6"(w, state) {
        const base = w.url.replace(/\/+$/, "");
        const H = () => ({ "x-ftl-sid": state.sid || "" });
        const login = async () => {
            const r = await fetch(base + "/api/auth", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: w.password }) });
            const j = await r.json();
            if (!r.ok || !j.session?.sid) throw new Error(`authentication failed: ${j.session?.message || r.status}`);
            state.sid = j.session.sid;
        };
        if (w.password) {
            if (!state.sid) await login();
            else if ((await fetch(base + "/api/auth", { headers: H() })).status !== 200) await login();
        }
        const [sum, hist, top] = await Promise.all([
            getJSON(base + "/api/stats/summary", { headers: H() }),
            w["hide-graph"] ? null : getJSON(base + "/api/history", { headers: H() }).catch(() => null),
            w["hide-top-domains"] ? null : getJSON(base + "/api/stats/top_domains?blocked=true", { headers: H() }).catch(() => null),
        ]);
        const s = { total: sum.queries.total, blockedPercent: Math.trunc(sum.queries.percent_blocked), domains: sum.gravity.domains_being_blocked, latency: 0, series: [], top: [] };
        if (hist?.history?.length === 145) {
            const h = hist.history.slice(1);
            s.series = series(group(h.map((x) => x.total), h.map((x) => x.blocked), 18));
        }
        if (top?.domains?.length) s.top = top.domains.map((d) => ({ domain: d.domain, percent: pct(d.count, sum.queries.blocked) })).sort((a, b) => b.percent - a.percent).slice(0, 5);
        return s;
    },
    async technitium(w) {
        if (!w.token) throw new Error("missing API token");
        const r = (await getJSON(`${w.url.replace(/\/+$/, "")}/api/dashboard/stats/get?token=${w.token}&type=LastDay`)).response;
        const s = { total: r.stats.totalQueries, blockedPercent: 0, latency: 0, domains: r.stats.blockedZones + r.stats.blockListZones, series: [], top: [] };
        if (s.total <= 0) return s;
        s.blockedPercent = pct(r.stats.totalBlocked, s.total);
        s.top = (r.topBlockedDomains || []).slice(0, 5).map((d) => ({ domain: d.name, percent: pct(d.hits, r.stats.totalBlocked) }));
        if (!w["hide-graph"]) {
            const ds = (l) => r.mainChartData.datasets.find((d) => d.label === l)?.data || [];
            s.series = series(group(padTo(ds("Total"), 24), padTo(ds("Blocked"), 24), 3));
        }
        return s;
    },
};

const dnsLabels = (fmt24) => Array.from({ length: BARS }, (_, i) => {
    const d = new Date(Date.now() - (24 - i * 3) * 3600e3);
    return fmt24 ? String(d.getHours()).padStart(2, "0") + ":00" : ((d.getHours() % 12) || 12) + (d.getHours() < 12 ? "am" : "pm");
});

const twitchGql = (body) => fetch("https://gql.twitch.tv/gql", { method: "POST", headers: { "Client-ID": "kimne78kx3ncx6brgo4mv6wki5h1ko" }, body: JSON.stringify(body) }).then((r) => r.json());

export const selfhostedWidgets = {
    "dns-stats": {
        title: "DNS Stats",
        cache: 10,
        titleUrl: (w) => (w.url || "").replace(/\/+$/, "") + (String(w.service).startsWith("pihole") ? "/admin" : ""),
        state: {},
        async render(w, i, meta) {
            if (!dns[w.service]) throw new Error("service must be one of: adguard, pihole, pihole-v6, technitium");
            meta.state ??= {};
            const s = await dns[w.service](w, meta.state);
            const labels = dnsLabels(w["hour-format"] === "24h");
            const graph = !w["hide-graph"] && s.series.length;
            return `
<div class="widget-small-content-bounds dns-stats">
    <div class="flex text-center justify-between dns-stats-totals">
        <div><div class="color-highlight size-h3">${num(s.total)}</div><div class="size-h6">QUERIES</div></div>
        <div><div class="color-highlight size-h3">${s.blockedPercent}%</div><div class="size-h6">BLOCKED</div></div>
        ${s.latency > 0
            ? `<div><div class="color-highlight size-h3">${num(s.latency)}ms</div><div class="size-h6">LATENCY</div></div>`
            : `<div class="cursor-help" data-popover-type="text" data-popover-text="Total number of blocked domains from all adlists" data-popover-max-width="200px" data-popover-text-align="center"><div class="color-highlight size-h3">${approx(s.domains)}</div><div class="size-h6">DOMAINS</div></div>`}
    </div>
    ${graph ? `
    <div class="dns-stats-graph margin-top-15">
        <div class="dns-stats-graph-gridlines-container"><svg class="dns-stats-graph-gridlines" shape-rendering="crispEdges" viewBox="0 0 1 100" preserveAspectRatio="none"><g stroke="var(--color-graph-gridlines)" stroke-width="1">
            ${[1, 25, 50, 75].map((y) => `<line x1="0" y1="${y}" x2="1" y2="${y}" vector-effect="non-scaling-stroke" />`).join("")}
            <line x1="0" y1="99" x2="1" y2="99" vector-effect="non-scaling-stroke" stroke="var(--color-progress-bar-border)"/></g></svg></div>
        <div class="dns-stats-graph-columns">${s.series.map((c, n) => `
            <div class="dns-stats-graph-column" data-popover-type="html" data-popover-position="above" data-popover-show-delay="500">
                <div data-popover-html><div class="flex text-center justify-between gap-25">
                    <div><div class="color-highlight size-h3">${num(c.queries)}</div><div class="size-h6">QUERIES</div></div>
                    <div><div class="color-highlight size-h3">${c.percentBlocked}%</div><div class="size-h6">BLOCKED</div></div></div></div>
                ${c.percentTotal > 0 ? `<div class="dns-stats-graph-bar" style="--bar-height: ${c.percentTotal}">
                    ${c.queries !== c.blocked ? '<div class="queries"></div>' : ""}
                    ${c.percentBlocked > 0 ? `<div class="blocked" style="--percent: ${c.percentBlocked}%"></div>` : ""}</div>` : ""}
                <div class="dns-stats-graph-time">${labels[n]}</div>
            </div>`).join("")}
        </div>
    </div>` : ""}
    ${!w["hide-top-domains"] && s.top.length ? `
    <details class="details ${graph ? "margin-top-40" : "margin-top-15"}"><summary class="summary">Top blocked domains</summary>
        <ul class="list list-gap-4 list-with-transition size-h5">${s.top.map((d) => `
            <li class="flex justify-between gap-10"><div class="text-truncate rtl">${esc(d.domain)}</div>
            <div class="text-right" style="width: 4rem;"><span class="color-highlight">${d.percent}</span>%</div></li>`).join("")}
        </ul></details>` : ""}
</div>`;
        },
    },

    "twitch-channels": {
        title: "Twitch Channels",
        titleUrl: "https://www.twitch.tv/directory/following",
        cache: 10,
        async render(w) {
            const one = async (login) => {
                const r = await twitchGql([
                    { operationName: "ChannelShell", variables: { login }, extensions: { persistedQuery: { version: 1, sha256Hash: "580ab410bcd0c1ad194224957ae2241e5d252b2c5173d8e0cce9d32d5bb14efe" } } },
                    { operationName: "StreamMetadata", variables: { channelLogin: login }, extensions: { persistedQuery: { version: 1, sha256Hash: "676ee2f834ede42eb4514cdb432b3134fefc12590080c9a2c9bb44a2a4a63266" } } },
                ]);
                const c = { login: login.toLowerCase(), name: login.toLowerCase(), viewers: 0 };
                const shell = r.find((x) => x.extensions?.operationName === "ChannelShell")?.data.userOrError;
                const meta = r.find((x) => x.extensions?.operationName === "StreamMetadata")?.data.user;
                if (shell?.__typename !== "User") return c;
                Object.assign(c, { exists: true, name: shell.displayName, avatar: shell.profileImageURL });
                if (shell.stream) {
                    Object.assign(c, { live: true, viewers: shell.stream.viewersCount, title: meta?.lastBroadcast?.title || "" });
                    const st = meta?.stream;
                    if (st) { c.category = st.game?.name; c.slug = st.game?.slug; c.since = Date.parse(st.createdAt) / 1000; }
                } else c.viewers = -1;
                return c;
            };
            const settled = await Promise.allSettled((w.channels || []).map(one));
            const cs = settled.filter((s) => s.status === "fulfilled").map((s) => s.value);
            if ((w.channels || []).length && !cs.length) throw new Error("no content");
            if (w["sort-by"] === "live") cs.sort((a, b) => (b.live ? 1 : 0) - (a.live ? 1 : 0));
            else cs.sort((a, b) => b.viewers - a.viewers);
            return `<ul class="list list-gap-14 collapsible-container" data-collapse-after="${collapse(w["collapse-after"])}">${cs.map((c) => `
<li><div class="${c.live ? "twitch-channel-live " : ""}flex gap-10 items-start thumbnail-parent">
    <div class="twitch-channel-avatar-container"${c.live ? ' data-popover-type="html" data-popover-position="above" data-popover-margin="0.15rem" data-popover-offset="0.2"' : ""}>
        ${c.live ? `<div data-popover-html><img class="twitch-stream-preview" src="https://static-cdn.jtvnw.net/previews-ttv/live_user_${esc(c.login)}-440x248.jpg" loading="lazy" alt=""><p class="margin-top-10 color-highlight text-truncate-3-lines">${esc(c.title)}</p></div>` : ""}
        ${c.exists ? `<a href="https://twitch.tv/${esc(c.login)}" target="_blank" rel="noreferrer"><img class="twitch-channel-avatar thumbnail" src="${url(c.avatar)}" alt="" loading="lazy"></a>`
            : `<svg class="twitch-channel-avatar thumbnail" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z" /></svg>`}
    </div>
    <div class="min-width-0">
        <a href="https://twitch.tv/${esc(c.login)}" class="size-h3${c.live ? " color-highlight" : ""} block text-truncate" target="_blank" rel="noreferrer">${esc(c.name)}</a>
        ${!c.exists ? '<div class="color-negative">Not found</div>' : c.live ? `
            ${c.category ? `<a class="text-truncate block" href="https://www.twitch.tv/directory/category/${esc(c.slug)}" target="_blank" rel="noreferrer">${esc(c.category)}</a>` : ""}
            <ul class="list-horizontal-text">${c.since ? `<li ${timeAttrs(c.since)}></li>` : ""}<li>${approx(c.viewers)} viewers</li></ul>` : "<div>Offline</div>"}
    </div>
</div></li>`).join("")}</ul>`;
        },
    },

    "twitch-top-games": {
        title: "Top games on Twitch",
        titleUrl: "https://www.twitch.tv/directory?sort=VIEWER_COUNT",
        cache: 10,
        async render(w) {
            const n = w.limit > 0 ? w.limit : 10, ex = w.exclude || [];
            const r = await twitchGql([{ operationName: "BrowsePage_AllDirectories", variables: { limit: ex.length + n, options: { sort: "VIEWER_COUNT", tags: [] } }, extensions: { persistedQuery: { version: 1, sha256Hash: "2f67f71ba89f3c0ed26a141ec00da1defecb2303595f5cda4298169549783d9e" } } }]);
            const edges = r?.[0]?.data?.directoriesWithTags?.edges;
            if (!edges) throw new Error("no categories could be retrieved");
            const cats = edges.map((e) => e.node).filter((c) => !ex.includes(c.slug)).slice(0, n);
            return `<ul class="list list-gap-14 collapsible-container" data-collapse-after="${collapse(w["collapse-after"])}">${cats.map((c) => `
<li class="twitch-category thumbnail-parent"><div class="flex gap-10 items-start">
    <img class="twitch-category-thumbnail thumbnail" loading="lazy" src="${url((c.avatarURL || "").replace("285x380", "144x192"))}" alt="">
    <div class="min-width-0">
        <a class="size-h3 color-highlight text-truncate block" href="https://www.twitch.tv/directory/category/${esc(c.slug)}" target="_blank" rel="noreferrer">${esc(c.name)}</a>
        <ul class="list-horizontal-text"><li>${approx(c.viewersCount)} viewers</li>${Date.now() - Date.parse(c.originalReleaseDate) < 14 * 864e5 ? '<li class="color-primary">NEW</li>' : ""}</ul>
        <ul class="list-horizontal-text flex-nowrap">${(c.tags || []).slice(0, 2).map((t, i) => `<li class="${i ? "text-truncate min-width-0" : "shrink-0"}">${esc(t.tagName)}</li>`).join("")}</ul>
    </div>
</div></li>`).join("")}</ul>`;
        },
    },
};
