import { esc, url, timeAttrs, num, collapse, getJSON, iconImg, percentChange, polyline, CHECK, WARN } from "./common.js";

const CURRENCY = { USD: "$", EUR: "€", JPY: "¥", CAD: "C$", AUD: "A$", GBP: "£", CHF: "Fr", NZD: "N$", INR: "₹", BRL: "R$", RUB: "₽", TRY: "₺", ZAR: "R", CNY: "¥", KRW: "₩", HKD: "HK$", SGD: "S$", SEK: "kr", NOK: "kr", DKK: "kr", PLN: "zł", PHP: "₱" };
const WEATHER_CODES = { 0: "Clear Sky", 1: "Mainly Clear", 2: "Partly Cloudy", 3: "Overcast", 45: "Fog", 48: "Rime Fog", 51: "Drizzle", 53: "Drizzle", 55: "Drizzle", 56: "Drizzle", 57: "Drizzle", 61: "Rain", 63: "Moderate Rain", 65: "Heavy Rain", 66: "Freezing Rain", 67: "Freezing Rain", 71: "Snow", 73: "Moderate Snow", 75: "Heavy Snow", 77: "Snow Grains", 80: "Rain", 81: "Moderate Rain", 82: "Heavy Rain", 85: "Snow", 86: "Snow", 95: "Thunderstorm", 96: "Thunderstorm", 99: "Thunderstorm" };
const LABELS_12 = ["2am", "4am", "6am", "8am", "10am", "12pm", "2pm", "4pm", "6pm", "8pm", "10pm", "12am"];
const LABELS_24 = ["02:00", "04:00", "06:00", "08:00", "10:00", "12:00", "14:00", "16:00", "18:00", "20:00", "22:00", "00:00"];
const COUNTRY = { US: "United States", USA: "United States", UK: "United Kingdom" };

const hourIn = (unixSec, tz) => Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hourCycle: "h23", timeZone: tz }).format(unixSec * 1000));
const AREA = new Map(); // geocode cache for the page load

async function place(location) {
    if (AREA.has(location)) return AREA.get(location);
    const parts = location.split(",");
    let name = location, area = "";
    if (parts.length === 2) name = parts[0] + ", " + (COUNTRY[parts[1].trim()] || parts[1]);
    else if (parts.length > 2) { name = parts[0] + ", " + (COUNTRY[parts[2].trim()] || parts[2]); area = parts[1].trim().toLowerCase(); }
    const j = await getJSON(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=20&language=en&format=json`);
    if (!j.results?.length) throw new Error(`no places found for ${name}`);
    const p = area ? j.results.find((r) => (r.admin1 || "").toLowerCase() === area) : j.results[0];
    if (!p) throw new Error(`no place found for ${name} in ${area}`);
    AREA.set(location, p);
    return p;
}

const siteRow = (s, compact) => {
    const st = s.status;
    const ok = !st.error && (st.code === 200 || (s["alt-status-codes"] || []).includes(st.code));
    const text = ok ? "OK" : st.code === 404 ? "Not Found" : st.code === 403 ? "Forbidden" : st.code === 401 ? "Unauthorized" : st.code >= 500 ? "Server Error" : st.code >= 400 ? "Client Error" : st.code;
    const href = url(st.error && s["error-url"] ? s["error-url"] : s.url);
    const target = s["same-tab"] ? "" : 'target="_blank"';
    if (compact) return `
<div class="flex items-center gap-12" data-ok="${ok}">
    <a class="size-title-dynamic color-highlight text-truncate block grow" href="${href}" ${target} rel="noreferrer">${esc(s.title)}</a>
    ${st.timedOut ? "" : `<div>${num(st.ms)}ms</div>`}
    <div class="monitor-site-status-icon-compact" title="${esc(st.error ? st.error : st.code)}">${ok ? CHECK : WARN}</div>
</div>`;
    return `
<div class="monitor-site flex items-center gap-15" data-ok="${ok}">
    ${iconImg(s.icon, "monitor-site-icon")}
    <div class="grow min-width-0">
        <a class="size-h3 color-highlight text-truncate block" href="${href}" ${target} rel="noreferrer">${esc(s.title)}</a>
        <ul class="list-horizontal-text">${!st.error
            ? `<li title="${st.code}">${esc(text)}</li><li>${num(st.ms)}ms</li>`
            : st.timedOut ? `<li class="color-negative">Timed Out</li>` : `<li class="color-negative" title="${esc(st.error)}">ERROR</li>`}</ul>
    </div>
    <div class="monitor-site-status-icon">${ok ? CHECK : WARN}</div>
</div>`;
};

async function siteStatus(s) {
    const headers = {};
    if (s["basic-auth"]) headers.Authorization = "Basic " + btoa(`${s["basic-auth"].username}:${s["basic-auth"].password}`);
    const secs = parseDuration(s.timeout) || 3;
    const t0 = performance.now();
    try {
        const r = await fetch(s["check-url"] || s.url, { headers, signal: AbortSignal.timeout(secs * 1000), cache: "no-store" });
        return { code: r.status, ms: Math.round(performance.now() - t0) };
    } catch (e) {
        return { error: e.message, timedOut: e.name === "TimeoutError", ms: Math.round(performance.now() - t0) };
    }
}
const parseDuration = (d) => { const m = /^(\d+)(s|m|h|d)$/.exec(d || ""); return m ? +m[1] * { s: 1, m: 60, h: 3600, d: 86400 }[m[2]] : 0; };

export const miscWidgets = {
    weather: {
        title: "Weather",
        cache: 60,
        async render(w) {
            if (!w.location) throw new Error("location is required");
            const units = w.units || "metric";
            if (!["metric", "imperial"].includes(units)) throw new Error("units must be either metric or imperial");
            if (w["hour-format"] && !["12h", "24h"].includes(w["hour-format"])) throw new Error("hour-format must be either 12h or 24h");
            const p = await place(w.location);
            const q = new URLSearchParams({
                latitude: p.latitude, longitude: p.longitude, timeformat: "unixtime", timezone: p.timezone, forecast_days: 1,
                current: "temperature_2m,apparent_temperature,weather_code", hourly: "temperature_2m,precipitation_probability",
                daily: "sunrise,sunset", temperature_unit: units === "imperial" ? "fahrenheit" : "celsius",
            });
            const j = await getJSON("https://api.open-meteo.com/v1/forecast?" + q);
            const cur = Math.floor(hourIn(Date.now() / 1000, p.timezone) / 2);
            const sunrise = Math.floor(hourIn(j.daily.sunrise[0], p.timezone) / 2);
            const sunset = Math.max(0, Math.floor((hourIn(j.daily.sunset[0], p.timezone) - 1) / 2));
            const t = j.hourly.temperature_2m, pr = j.hourly.precipitation_probability;
            let cols = [];
            if (t.length === 24) {
                const temps = [], rain = [];
                for (let i = 0; i < 24; i += 2) {
                    temps.push(i / 2 === cur ? Math.trunc(j.current.temperature_2m) : Math.round((t[i] + t[i + 1]) / 2));
                    rain.push((pr[i] + pr[i + 1]) / 2 > 75);
                }
                const min = Math.min(...temps), max = Math.max(...temps);
                cols = temps.map((v, i) => ({ v, rain: rain[i], scale: max > min ? (v - min) / (max - min) : 1 }));
            }
            const labels = w["hour-format"] === "24h" ? LABELS_24 : LABELS_12;
            return `
<div class="widget-small-content-bounds">
    <div class="size-h2 color-highlight text-center">${WEATHER_CODES[j.current.weather_code] || ""}</div>
    <div class="size-h4 text-center">Feels like ${Math.trunc(j.current.apparent_temperature)}°${units === "metric" ? "C" : "F"}</div>
    <div class="weather-columns flex margin-top-15 justify-center">${cols.map((c, i) => `
        <div class="weather-column${i === cur ? " weather-column-current" : ""}">
            ${c.rain ? '<div class="weather-column-rain"></div>' : ""}
            ${i >= sunrise && i <= sunset ? `<div class="weather-column-daylight${i === sunrise ? " weather-column-daylight-sunrise" : i === sunset ? " weather-column-daylight-sunset" : ""}"></div>` : ""}
            <div class="weather-column-value${c.v < 0 ? " weather-column-value-negative" : ""}">${Math.abs(c.v)}</div>
            <div class="weather-bar" style="--weather-bar-height: ${c.scale.toFixed(2)}"></div>
            <div class="weather-column-time">${labels[i]}</div>
        </div>`).join("")}
    </div>
    ${w["hide-location"] ? "" : `<div class="flex items-center justify-center margin-top-15 gap-7 size-h5"><div class="location-icon"></div>
        <div class="text-truncate">${esc(p.name)},${w["show-area-name"] ? " " + esc(p.admin1) + "," : ""} ${esc(p.country)}</div></div>`}
</div>`;
        },
    },

    markets: {
        title: "Markets",
        cache: 60,
        async render(w) {
            const reqs = w.markets || w.stocks || [];
            const settled = await Promise.allSettled(reqs.map(async (r) => {
                const j = await getJSON(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(r.symbol)}?range=1mo&interval=1d`);
                const res = j.chart.result?.[0];
                if (!res) throw new Error("no data");
                let prices = (res.indicators.quote[0].close || []).map((v) => v ?? 0);
                prices = prices.slice(-21);
                const price = res.meta.regularMarketPrice;
                const prev = prices.length >= 2 && prices[prices.length - 2] !== 0 ? prices[prices.length - 2] : price;
                return {
                    symbol: r.symbol, name: r.name || res.meta.shortName, price, hint: res.meta.priceHint ?? 2, currency: res.meta.currency,
                    change: percentChange(price, prev), points: polyline(100, 50, prices),
                    chartLink: r["chart-link"] || (w["chart-link-template"] || "").replaceAll("{SYMBOL}", r.symbol),
                    symbolLink: r["symbol-link"] || (w["symbol-link-template"] || "").replaceAll("{SYMBOL}", r.symbol),
                };
            }));
            const ms = settled.filter((s) => s.status === "fulfilled").map((s) => s.value);
            if (!ms.length) throw new Error("no content");
            if (w["sort-by"] === "absolute-change") ms.sort((a, b) => Math.abs(b.change) - Math.abs(a.change));
            else if (w["sort-by"] === "change") ms.sort((a, b) => b.change - a.change);
            return `<div class="dynamic-columns list-gap-20 list-with-separator">${ms.map((m) => `
<div class="flex items-center gap-15">
    <div class="min-width-0">
        <a${m.symbolLink ? ` href="${url(m.symbolLink)}" target="_blank" rel="noreferrer"` : ""} class="color-highlight size-h3 block text-truncate">${esc(m.symbol)}</a>
        <div class="text-truncate">${esc(m.name)}</div>
    </div>
    <a class="market-chart"${m.chartLink ? ` href="${url(m.chartLink)}" target="_blank" rel="noreferrer"` : ""}>
        <svg class="market-chart shrink-0" viewBox="0 0 100 50"><polyline fill="none" stroke="var(--color-text-subdue)" stroke-linejoin="round" stroke-width="1.5px" points="${m.points}" vector-effect="non-scaling-stroke"></polyline></svg>
    </a>
    <div class="market-values shrink-0">
        <div class="size-h3 text-right ${m.change === 0 ? "" : m.change > 0 ? "color-positive" : "color-negative"}">${m.change >= 0 ? "+" : ""}${m.change.toFixed(2)}%</div>
        <div class="text-right" title="${esc(m.currency)}">${CURRENCY[m.currency] || ""}${m.price.toLocaleString(undefined, { minimumFractionDigits: m.hint, maximumFractionDigits: m.hint })}</div>
    </div>
</div>`).join("")}</div>`;
        },
    },

    monitor: {
        title: "Monitor",
        cache: 5,
        async render(w) {
            const sites = w.sites || [];
            const statuses = await Promise.all(sites.map(siteStatus));
            const rows = sites.map((s, i) => siteRow({ ...s, status: statuses[i] }, w.style === "compact"));
            const failing = rows.some((r) => r.includes('data-ok="false"'));
            if (w["show-failing-only"] && !failing) return `
<div class="flex items-center justify-center gap-10 padding-block-5"><p>All sites are online</p>
<svg class="shrink-0" style="width: 1.7rem;" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="var(--color-positive)"><path fill-rule="evenodd" d="M2.25 12c0-5.385 4.365-9.75 9.75-9.75s9.75 4.365 9.75 9.75-4.365 9.75-9.75 9.75S2.25 17.385 2.25 12Zm13.36-1.814a.75.75 0 1 0-1.22-.872l-3.236 4.53L9.53 12.22a.75.75 0 0 0-1.06 1.06l2.25 2.25a.75.75 0 0 0 1.14-.094l3.75-5.25Z" clip-rule="evenodd" /></svg></div>`;
            const shown = rows.filter((r) => !w["show-failing-only"] || r.includes('data-ok="false"'));
            return `<ul class="dynamic-columns ${w.style === "compact" ? "list-gap-8" : "list-gap-20 list-with-separator"}">${shown.join("")}</ul>`;
        },
    },

    "change-detection": {
        title: "Change Detection",
        cache: 60,
        async render(w) {
            const inst = (w["instance-url"] || "https://www.changedetection.io").replace(/\/+$/, "");
            const headers = w.token ? { "x-api-key": w.token } : {};
            const ids = w.watches?.length ? w.watches : Object.keys(await getJSON(`${inst}/api/v1/watch`, { headers }));
            const settled = await Promise.allSettled(ids.map((id) => getJSON(`${inst}/api/v1/watch/${id}`, { headers }).then((d) => ({ d, id }))));
            const ok = settled.filter((s) => s.status === "fulfilled").map((s) => s.value);
            if (!ok.length) throw new Error("no content");
            const items = ok.map(({ d, id }) => ({
                title: d.title || d.url.replace(/^[a-z]+:\/\//, "").replace(/^\/+|\/+$/g, "").replace(/^www\./, ""),
                url: d.url, changed: d.last_changed || d.date_created,
                diff: `${inst}/diff/${id}?from_version=${d.last_changed - 1}`, hash: (d.previous_md5 || "").slice(0, 8),
            })).sort((a, b) => b.changed - a.changed).slice(0, w.limit > 0 ? w.limit : 10);
            return `<ul class="list list-gap-14 collapsible-container" data-collapse-after="${collapse(w["collapse-after"])}">${items.map((i) => `
<li>
    <a class="size-h4 block text-truncate color-highlight" href="${url(i.url)}" target="_blank" rel="noreferrer">${esc(i.title)}</a>
    <ul class="list-horizontal-text"><li ${timeAttrs(i.changed)}></li>
    <li class="shrink min-width-0"><a class="visited-indicator" href="${url(i.diff)}" target="_blank" rel="noreferrer">diff:${esc(i.hash)}</a></li></ul>
</li>`).join("")}</ul>`;
        },
    },

    iframe: {
        title: "IFrame",
        frameless: true,
        render(w) {
            if (!w.source) throw new Error("source is required");
            const h = w.height === 50 ? 300 : Math.max(50, w.height || 300);
            return `<iframe src="${url(w.source)}" width="100%" height="${h}px" frameborder="0"></iframe>`;
        },
    },

    html: { title: "", raw: true, render: (w) => w.source || "" },

    extension: {
        title: "Extension",
        cache: 30,
        async render(w, i, meta) {
            if (!w.url) throw new Error("URL is required");
            const u = new URL(w.url);
            for (const [k, v] of Object.entries(w.parameters || {})) [].concat(v).forEach((x) => u.searchParams.append(k, x));
            const r = await fetch(u, { headers: w.headers || {} });
            const body = await r.text();
            if (r.headers.get("Widget-Title") && !w.title) meta.title = r.headers.get("Widget-Title");
            if (r.headers.get("Widget-Title-URL") && !w["title-url"]) meta["title-url"] = r.headers.get("Widget-Title-URL");
            meta.frameless = /^(true|1)$/i.test(r.headers.get("Widget-Content-Frameless") || "");
            const type = r.headers.get("Widget-Content-Type") || w["fallback-content-type"];
            return type === "html" && w["allow-potentially-dangerous-html"] ? body : `<pre>${esc(body)}</pre>`;
        },
    },

    "calendar-legacy": {
        title: "Calendar",
        render(w) {
            const now = new Date();
            const dim = (y, m) => new Date(y, m + 1, 0).getDate(); // m: 0-based
            const wd = w["start-sunday"] ? now.getDay() : (now.getDay() + 6) % 7;
            const cur = dim(now.getFullYear(), now.getMonth()), prev = dim(now.getFullYear(), now.getMonth() - 1);
            const start = now.getDate() - wd - 7;
            const days = Array.from({ length: 21 }, (_, i) => { const d = start + i; return d < 1 ? prev + d : d > cur ? d - cur : d; });
            const d0 = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
            d0.setUTCDate(d0.getUTCDate() + 4 - (d0.getUTCDay() || 7)); // ISO week: Thursday decides the year
            const week = Math.ceil(((d0 - Date.UTC(d0.getUTCFullYear(), 0, 1)) / 864e5 + 1) / 7);
            const names = ["Mo", "Tu", "We", "Th", "Fr", "Sa"].map((n) => `<div class="old-calendar-day">${n}</div>`).join("");
            const su = '<div class="old-calendar-day">Su</div>';
            return `
<div class="widget-small-content-bounds">
    <div class="flex justify-between items-center">
        <div class="color-highlight size-h1">${now.toLocaleString("en", { month: "long" })}</div>
        <ul class="list-horizontal-text color-highlight size-h4"><li>Week ${week}</li><li>${d0.getUTCFullYear()}</li></ul>
    </div>
    <div class="flex flex-wrap size-h6 margin-top-10 color-subdue">${w["start-sunday"] ? su + names : names + su}</div>
    <div class="flex flex-wrap">${days.map((d) => `<div class="old-calendar-day${d === now.getDate() ? " old-calendar-day-today" : ""}">${d}</div>`).join("")}</div>
</div>`;
        },
    },
};
