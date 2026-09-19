import { esc, url, timeAttrs, num as fmtNum, approx, percentChange, getJSON } from "./common.js";
import { compile, render, SafeHTML, SafeAttr, GoFloat } from "./gotemplate.js";
import { parse, parseLines, valid, Result } from "./gjson.js";

// ---- Go time helpers ---------------------------------------------------------
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const p2 = (n, w = 2) => String(n).padStart(w, "0");
const LAYOUT_TOKENS = ["January", "Jan", "Monday", "Mon", "MST", "2006", "-07:00:00", "-0700", "-07:00", "-07", "Z07:00", "Z0700", "Z07", "01", "02", "03", "04", "05", "06", "15", "PM", "pm", "_2", "1", "2", "3", "4", "5", ".000000000", ".000000", ".000", ".999999999", ".999999", ".999", "002"];
const NAMED = { rfc3339: "2006-01-02T15:04:05Z07:00", rfc3339nano: "2006-01-02T15:04:05.999999999Z07:00", datetime: "2006-01-02 15:04:05", dateonly: "2006-01-02", rfc1123: "Mon, 02 Jan 2006 15:04:05 MST", rfc822: "02 Jan 06 15:04 MST", kitchen: "3:04PM", timeonly: "15:04:05", ansic: "Mon Jan _2 15:04:05 2006", rfc1123z: "Mon, 02 Jan 2006 15:04:05 -0700", stamp: "Jan _2 15:04:05" };

export class GoTime {
    constructor(ms, utc = false) { this.d = new Date(ms); this.utc = utc; }
    get y() { return this.utc ? this.d.getUTCFullYear() : this.d.getFullYear(); }
    get mo() { return this.utc ? this.d.getUTCMonth() : this.d.getMonth(); }
    get da() { return this.utc ? this.d.getUTCDate() : this.d.getDate(); }
    get h() { return this.utc ? this.d.getUTCHours() : this.d.getHours(); }
    get mi() { return this.utc ? this.d.getUTCMinutes() : this.d.getMinutes(); }
    get s() { return this.utc ? this.d.getUTCSeconds() : this.d.getSeconds(); }
    get wd() { return this.utc ? this.d.getUTCDay() : this.d.getDay(); }
    Unix() { return Math.floor(this.d.getTime() / 1000); }
    UnixMilli() { return this.d.getTime(); }
    Year() { return this.y; } Month() { return MONTHS[this.mo]; } Day() { return this.da; } Hour() { return this.h; }
    Minute() { return this.mi; } Second() { return this.s; } Weekday() { return DAYS[this.wd]; }
    YearDay() { return Math.round((Date.UTC(this.y, this.mo, this.da) - Date.UTC(this.y, 0, 0)) / 864e5); }
    Before(t) { return this.d < t.d; } After(t) { return this.d > t.d; } Equal(t) { return +this.d === +t.d; }
    IsZero() { return this.d.getTime() === -62135596800000 || this.Unix() === 0 && false; }
    Add(dur) { return new GoTime(this.d.getTime() + dur.ms, this.utc); }
    Sub(t) { return new GoDuration(this.d - t.d); }
    AddDate(y, m, d) { const x = new Date(this.d); if (this.utc) { x.setUTCFullYear(x.getUTCFullYear() + y, x.getUTCMonth() + m, x.getUTCDate() + d); } else x.setFullYear(x.getFullYear() + y, x.getMonth() + m, x.getDate() + d); return new GoTime(x.getTime(), this.utc); }
    UTC() { return new GoTime(this.d, true); } Local() { return new GoTime(this.d, false); }
    Format(layout) {
        const off = this.utc ? 0 : -this.d.getTimezoneOffset();
        const sign = off < 0 ? "-" : "+", ao = Math.abs(off), oh = p2(Math.floor(ao / 60)), om = p2(ao % 60);
        const tzName = this.utc ? "UTC" : (new Intl.DateTimeFormat("en", { timeZoneName: "short" }).formatToParts(this.d).find((p) => p.type === "timeZoneName")?.value || "");
        const ms = p2(this.d.getMilliseconds(), 3);
        const h12 = this.h % 12 || 12;
        const map = {
            January: MONTHS[this.mo], Jan: MONTHS[this.mo].slice(0, 3), Monday: DAYS[this.wd], Mon: DAYS[this.wd].slice(0, 3), MST: tzName,
            2006: this.y, "06": p2(this.y % 100), "01": p2(this.mo + 1), 1: this.mo + 1, "02": p2(this.da), 2: this.da, _2: String(this.da).padStart(2, " "),
            "15": p2(this.h), "03": p2(h12), 3: h12, "04": p2(this.mi), 4: this.mi, "05": p2(this.s), 5: this.s, PM: this.h >= 12 ? "PM" : "AM", pm: this.h >= 12 ? "pm" : "am",
            "-0700": sign + oh + om, "-07:00": `${sign}${oh}:${om}`, "-07": sign + oh, "-07:00:00": `${sign}${oh}:${om}:00`,
            "Z07:00": off === 0 ? "Z" : `${sign}${oh}:${om}`, Z0700: off === 0 ? "Z" : sign + oh + om, Z07: off === 0 ? "Z" : sign + oh,
            ".000": "." + ms, ".000000": "." + ms + "000", ".000000000": "." + ms + "000000", ".999": ms === "000" ? "" : "." + ms.replace(/0+$/, ""), ".999999": ms === "000" ? "" : "." + ms.replace(/0+$/, ""), ".999999999": ms === "000" ? "" : "." + ms.replace(/0+$/, ""), "002": p2(this.YearDay(), 3),
        };
        let out = "", i = 0;
        outer: while (i < layout.length) {
            for (const t of LAYOUT_TOKENS) if (layout.startsWith(t, i)) { out += map[t]; i += t.length; continue outer; }
            out += layout[i++];
        }
        return out;
    }
    toString() { return this.Format("2006-01-02 15:04:05.999999999 -0700 MST"); }
}
const ZERO_TIME = () => new GoTime(0, true);
export class GoDuration {
    constructor(ms) { this.ms = ms; }
    Hours() { return new GoFloat(this.ms / 36e5); } Minutes() { return new GoFloat(this.ms / 6e4); } Seconds() { return new GoFloat(this.ms / 1e3); }
    Milliseconds() { return Math.trunc(this.ms); }
    toString() { const s = this.ms / 1000; return s >= 3600 ? `${Math.floor(s / 3600)}h${Math.floor((s % 3600) / 60)}m${Math.floor(s % 60)}s` : s >= 60 ? `${Math.floor(s / 60)}m${Math.floor(s % 60)}s` : `${s}s`; }
}
function parseDur(str) {
    const re = /(-?\d+(?:\.\d+)?)(ns|us|µs|ms|s|m|h)/g; let m, ms = 0, any = false;
    while ((m = re.exec(str))) { any = true; ms += +m[1] * { ns: 1e-6, us: 1e-3, "µs": 1e-3, ms: 1, s: 1e3, m: 6e4, h: 36e5 }[m[2]]; }
    return any ? new GoDuration(ms) : null;
}
function goLayoutToRegex(layout) {
    const fields = []; let re = "", i = 0;
    outer: while (i < layout.length) {
        for (const t of LAYOUT_TOKENS) if (layout.startsWith(t, i)) {
            i += t.length;
            const r = { January: "[A-Za-z]+", Jan: "[A-Za-z]{3}", Monday: "[A-Za-z]+", Mon: "[A-Za-z]{3}", MST: "[A-Za-z]+", 2006: "\\d{4}", "06": "\\d{2}", "01": "\\d{2}", 1: "\\d{1,2}", "02": "\\d{2}", 2: "\\d{1,2}", _2: "\\s?\\d{1,2}", "15": "\\d{2}", "03": "\\d{2}", 3: "\\d{1,2}", "04": "\\d{2}", 4: "\\d{1,2}", "05": "\\d{2}", 5: "\\d{1,2}", PM: "[AP]M", pm: "[ap]m", "-0700": "[+-]\\d{4}", "-07:00": "[+-]\\d{2}:\\d{2}", "-07": "[+-]\\d{2}", "Z07:00": "Z|[+-]\\d{2}:\\d{2}", Z0700: "Z|[+-]\\d{4}", Z07: "Z|[+-]\\d{2}", "-07:00:00": "[+-]\\d{2}:\\d{2}:\\d{2}", "002": "\\d{3}" }[t] || "\\.\\d+";
            re += `(${r})`; fields.push(t); continue outer;
        }
        // Go accepts fractional seconds after the seconds field even if the layout omits them
        re += layout[i].replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); i++;
    }
    return { re: new RegExp("^" + re + "(?:\\.\\d+)?$"), fields };
}
function parseTime(layout, value, utc) {
    const l = NAMED[String(layout).toLowerCase()] || layout;
    if (String(layout).toLowerCase() === "unix") { const n = parseInt(value, 10); return isNaN(n) ? ZERO_TIME() : new GoTime(n * 1000, true); }
    const { re, fields } = goLayoutToRegex(l);
    const m = re.exec(value);
    if (!m) return ZERO_TIME();
    const v = { y: 1, mo: 0, d: 1, h: 0, mi: 0, s: 0, ms: 0, off: null, pm: null };
    fields.forEach((f, i) => {
        const x = m[i + 1];
        if (f === "2006") v.y = +x; else if (f === "06") v.y = 2000 + +x;
        else if (f === "01" || f === "1") v.mo = +x - 1; else if (f === "Jan" || f === "January") v.mo = MONTHS.findIndex((n) => n.toLowerCase().startsWith(x.toLowerCase().slice(0, 3)));
        else if (f === "02" || f === "2" || f === "_2") v.d = +x;
        else if (f === "15") v.h = +x; else if (f === "03" || f === "3") v.h = +x % 12;
        else if (f === "04" || f === "4") v.mi = +x; else if (f === "05" || f === "5") v.s = +x;
        else if (f === "PM" || f === "pm") v.pm = x.toLowerCase() === "pm";
        else if (/^Z|^-07/.test(f)) { if (x === "Z") v.off = 0; else { const mm = /([+-])(\d{2}):?(\d{2})?/.exec(x); v.off = (mm[1] === "-" ? -1 : 1) * (+mm[2] * 60 + +(mm[3] || 0)); } }
    });
    const frac = /\.(\d+)$/.exec(value);
    if (frac && !fields.some((f) => f.startsWith("."))) v.ms = Math.floor(+("0." + frac[1]) * 1000);
    if (v.pm) v.h += 12;
    if (v.off !== null) return new GoTime(Date.UTC(v.y, v.mo, v.d, v.h, v.mi, v.s, v.ms) - v.off * 6e4, true);
    return utc ? new GoTime(Date.UTC(v.y, v.mo, v.d, v.h, v.mi, v.s, v.ms), true) : new GoTime(new Date(v.y, v.mo, v.d, v.h, v.mi, v.s, v.ms).getTime(), false);
}

// ---- request plumbing ----------------------------------------------------------
class Headers_ { constructor(h) { this.h = h; } Get(k) { return this.h.get(k) || ""; } Values(k) { return [this.h.get(k)].filter(Boolean); } }
class Options {
    constructor(o) { this.o = o || {}; }
    StringOr(k, d) { return typeof this.o[k] === "string" ? this.o[k] : d; }
    IntOr(k, d) { return Number.isInteger(this.o[k]) ? this.o[k] : d; }
    FloatOr(k, d) { return typeof this.o[k] === "number" ? new GoFloat(this.o[k]) : d; }
    BoolOr(k, d) { return typeof this.o[k] === "boolean" ? this.o[k] : d; }
    JSON(k) { if (!(k in this.o)) throw new Error(`key "${k}" does not exist in options`); return JSON.stringify(this.o[k]); }
}
const mapOf = (obj) => new Proxy(obj, { get: (t, k) => (k in t ? t[k] : undefined) });

const STATUS_TEXT = { 200: "OK", 201: "Created", 204: "No Content", 301: "Moved Permanently", 302: "Found", 400: "Bad Request", 401: "Unauthorized", 403: "Forbidden", 404: "Not Found", 429: "Too Many Requests", 500: "Internal Server Error", 502: "Bad Gateway", 503: "Service Unavailable" };

function buildRequest(r) {
    if (!r?.url) return null;
    const method = (r.method || (r.body != null ? "POST" : "GET")).toUpperCase();
    const bodyType = r["body-type"] || (r.body != null ? "json" : "");
    if (r.body != null && !["json", "string"].includes(bodyType)) throw new Error("invalid body type, must be either 'json' or 'string'");
    const u = new URL(r.url);
    for (const [k, v] of Object.entries(r.parameters || {})) [].concat(v).forEach((x) => u.searchParams.append(k, x));
    const headers = { ...(r.headers || {}) };
    if (bodyType === "json") headers["Content-Type"] = "application/json";
    const ba = r["basic-auth"];
    if (ba && (ba.username || ba.password)) headers.Authorization = "Basic " + btoa(unescape(encodeURIComponent(`${ba.username}:${ba.password}`)));
    let body;
    if (r.body != null) body = bodyType === "json" ? JSON.stringify(r.body) : String(r.body);
    return { url: u.toString(), init: { method, headers, body }, skip: !!r["skip-json-validation"] };
}

async function fetchResponse(r) {
    const req = buildRequest(r);
    if (!req) return { JSON: new Result(), Response: { StatusCode: 0, Status: "", Header: new Headers_(new Headers()) } };
    const resp = await fetch(req.url, req.init);
    const text = (await resp.text()).trim();
    if (!req.skip && text && !valid(text)) {
        if (resp.status >= 200 && resp.status < 300) throw new Error("invalid response JSON");
        throw new Error(`${resp.status} ${STATUS_TEXT[resp.status] || resp.statusText}`);
    }
    return { JSON: parse(text), Response: { StatusCode: resp.status, Status: `${resp.status} ${STATUS_TEXT[resp.status] || resp.statusText}`, Header: new Headers_(resp.headers), Body: text }, _text: text };
}

const cmpKey = (order) => (a, b) => (order === "asc" ? (a < b ? -1 : a > b ? 1 : 0) : a < b ? 1 : a > b ? -1 : 0);
const mathOp = (op) => (a, b) => {
    const fl = a instanceof GoFloat || b instanceof GoFloat;
    const x = +a, y = +b;
    if (Number.isNaN(x) || Number.isNaN(y)) return NaN;
    let r = op === "add" ? x + y : op === "sub" ? x - y : op === "mul" ? x * y : y === 0 ? 0 : fl ? x / y : Math.trunc(x / y);
    return fl ? new GoFloat(r) : r;
};
const timeFn = (fmt) => (fmt.toLowerCase() === "unix" ? (t) => String(t.Unix()) : (t) => t.Format(NAMED[fmt.toLowerCase()] || fmt));

function templateFuncs() {
    const re = new Map();
    const rx = (p) => { if (!re.has(p)) re.set(p, new RegExp(p.replace(/\(\?P</g, "(?<"), "g")); return re.get(p); };
    const fmtN = (n) => Number(n).toLocaleString();
    return {
        toFloat: (a) => new GoFloat(a), toInt: (a) => Math.trunc(+a),
        add: mathOp("add"), sub: mathOp("sub"), mul: mathOp("mul"), div: mathOp("div"), mod: (a, b) => (b === 0 ? 0 : a % b),
        now: () => new GoTime(Date.now()), offsetNow: (o) => new GoTime(Date.now() + (parseDur(o)?.ms || 0)),
        duration: (s) => parseDur(s) || new GoDuration(0),
        parseTime: (l, v) => parseTime(l, v, true), parseLocalTime: (l, v) => parseTime(l, v, false),
        formatTime: (l, t) => timeFn(l)(t),
        toRelativeTime: (t) => new SafeAttr(`data-dynamic-relative-time="${t.Unix()}"`),
        parseRelativeTime: (l, v) => new SafeAttr(`data-dynamic-relative-time="${parseTime(l, v, true).Unix()}"`),
        startOfDay: (t) => (t.utc ? new GoTime(Date.UTC(t.y, t.mo, t.da), true) : new GoTime(new Date(t.y, t.mo, t.da).getTime())),
        endOfDay: (t) => (t.utc ? new GoTime(Date.UTC(t.y, t.mo, t.da, 23, 59, 59), true) : new GoTime(new Date(t.y, t.mo, t.da, 23, 59, 59).getTime())),
        trimPrefix: (p, s) => (String(s).startsWith(p) ? String(s).slice(p.length) : s), trimSuffix: (p, s) => (String(s).endsWith(p) ? String(s).slice(0, -p.length || undefined) : s),
        trimSpace: (s) => String(s).trim(), replaceAll: (o, n, s) => String(s).split(o).join(n),
        replaceMatches: (p, r, s) => (s === "" ? "" : String(s).replace(rx(p), r.replace(/\$\{?(\d+)\}?/g, "$$$1"))),
        findMatch: (p, s) => (s === "" ? "" : (String(s).match(new RegExp(p))?.[0] ?? "")),
        findSubmatch: (p, s) => (s === "" ? "" : (String(s).match(new RegExp(p))?.[1] ?? "")),
        percentChange: (a, b) => new GoFloat(percentChange(+a, +b)),
        sortByString: (k, o, rs) => [...rs].sort((a, b) => cmpKey(o)(a.String(k), b.String(k))),
        sortByInt: (k, o, rs) => [...rs].sort((a, b) => cmpKey(o)(a.Int(k), b.Int(k))),
        sortByFloat: (k, o, rs) => [...rs].sort((a, b) => cmpKey(o)(a.Float(k), b.Float(k))),
        sortByTime: (k, l, o, rs) => [...rs].sort((a, b) => cmpKey(o)(parseTime(l, a.String(k), true).d, parseTime(l, b.String(k), true).d)),
        concat: (...a) => a.join(""),
        unique: (k, rs) => { const seen = new Set(); return rs.filter((r) => { const v = r.String(k); return !seen.has(v) && seen.add(v); }); },
        newRequest: (u) => ({ url: u }),
        withHeader: (k, v, r) => ({ ...r, headers: { ...(r.headers || {}), [k]: v } }),
        withParameter: (k, v, r) => ({ ...r, parameters: { ...(r.parameters || {}), [k]: [...[].concat(r.parameters?.[k] || []), v] } }),
        withStringBody: (b, r) => ({ ...r, body: b, "body-type": "string" }),
        withAllowInsecure: (_, r) => r,
        withBasicAuth: (u, p, r) => ({ ...r, "basic-auth": { username: u, password: p } }),
        getResponse: (r) => { throw new Error("getResponse needs async resolution"); }, // replaced by prefetch below
        // global helpers shared with the other widget templates
        formatApproxNumber: (n) => approx(+n), formatNumber: (n) => fmtN(n),
        formatPrice: (p) => Number(p).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
        formatPriceWithPrecision: (pr, p) => Number(p).toLocaleString(undefined, { minimumFractionDigits: pr, maximumFractionDigits: pr }),
        dynamicRelativeTimeAttrs: (t) => new SafeAttr(`data-dynamic-relative-time="${t.Unix()}"`),
        safeCSS: (s) => new SafeHTML(s), safeURL: (s) => new SafeHTML(s), safeHTML: (s) => new SafeHTML(s), absInt: (i) => Math.abs(i),
    };
}

// getResponse is called synchronously from templates; pre-scan the template source for newRequest chains is impractical,
// so we resolve them lazily: first render collects requests, then we fetch and re-render (up to a few rounds).
export async function renderCustomAPI(w) {
    if (!w.template) throw new Error("template is required");
    const tpl = compile(w.template);
    const primary = await withSub(w);
    const funcs = templateFuncs();
    const cache = new Map();   // request key -> resolved response
    let pending;
    funcs.getResponse = (r) => {
        const key = JSON.stringify(r);
        if (cache.has(key)) return cache.get(key);
        pending.set(key, r);
        return { JSON: new Result(), Response: { StatusCode: 0, Status: "", Header: new Headers_(new Headers()) } };
    };
    for (let round = 0; round < 5; round++) {
        pending = new Map();
        const data = { ...primary.data, Options: new Options(w.options) };
        const html = render(tpl, data, funcs);
        if (!pending.size) return html;
        await Promise.all([...pending].map(async ([k, r]) => {
            try { cache.set(k, await fetchResponse(r)); }
            catch (e) { cache.set(k, { JSON: new Result(), Response: { StatusCode: 0, Status: e.message, Header: new Headers_(new Headers()) } }); }
        }));
    }
    throw new Error("too many nested getResponse rounds");
}

async function withSub(w) {
    const subs = w.subrequests || {};
    const [p, ...rest] = await Promise.all([fetchResponse(w), ...Object.values(subs).map(fetchResponse)]);
    const subData = Object.fromEntries(Object.keys(subs).map((k, i) => [k, rest[i]]));
    const data = {
        JSON: p.JSON, Response: p.Response,
        JSONLines: () => parseLines(p._text || ""),
        Subrequest: (k) => { if (!(k in subData)) throw new Error(`subrequest with key "${k}" has not been defined`); return subData[k]; },
    };
    return { data };
}
