// A subset of tidwall/gjson sufficient for Glance custom-api templates:
// dotted paths, \. escapes, array indexes, #, #.field, #(query), #(query)#, * and ? wildcards, @this/@reverse/@keys/@values/@flatten.

const NONE = Symbol("none");

function splitPath(path) {
    const parts = []; let cur = "", depth = 0;
    for (let i = 0; i < path.length; i++) {
        const c = path[i];
        if (c === "\\" && i + 1 < path.length) { cur += path[++i]; continue; }
        if (c === "(") depth++;
        if (c === ")") depth--;
        if (c === "." && depth === 0) { parts.push(cur); cur = ""; } else cur += c;
    }
    parts.push(cur);
    return parts;
}

const wild = (pat, s) => new RegExp("^" + pat.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".") + "$").test(s);

function cmpMatch(l, op, r) {
    if (l === NONE) return false;
    if (op === "%") return typeof l === "string" && wild(String(r), l);
    if (op === "!%") return typeof l === "string" && !wild(String(r), l);
    if (typeof l === "string" && typeof r === "string") { l = l.toLowerCase === undefined ? l : l; }
    switch (op) {
        case "==": case "=": return l == r;
        case "!=": return l != r;
        case "<": return l < r; case "<=": return l <= r;
        case ">": return l > r; case ">=": return l >= r;
    }
    return false;
}

function parseQuery(q) {
    const m = /^(.*?)(==|!=|<=|>=|!%|%|<|>|=)(.*)$/s.exec(q);
    if (!m) return { key: q, op: null };
    let v = m[3].trim();
    if (/^".*"$/s.test(v)) v = JSON.parse(v); else if (v === "true") v = true; else if (v === "false") v = false; else if (v === "null") v = null; else if (v !== "" && !isNaN(v)) v = Number(v);
    return { key: m[1].trim(), op: m[2], v };
}

function queryMatch(item, q) {
    const p = parseQuery(q);
    const l = p.key === "" ? item : get(item, p.key);
    if (!p.op) return l !== NONE;
    return cmpMatch(l, p.op, p.v);
}

const modifiers = {
    "@this": (v) => v,
    "@reverse": (v) => (Array.isArray(v) ? [...v].reverse() : v),
    "@keys": (v) => (v && typeof v === "object" ? Object.keys(v) : NONE),
    "@values": (v) => (v && typeof v === "object" ? Object.values(v) : NONE),
    "@flatten": (v) => (Array.isArray(v) ? v.flat() : v),
    "@ugly": (v) => v, "@pretty": (v) => v,
    "@valid": (v) => v,
};

export function get(value, path) {
    if (value === NONE || value === undefined) return NONE;
    if (path === "" || path === undefined) return value;
    const [head, ...rest] = splitPath(path);
    const restPath = rest.join(".").replace(/(?<!\\)\\/g, "\\"); // keep escapes
    const next = (v) => (rest.length ? get(v, joinRest(path)) : v);

    if (head.startsWith("@") && modifiers[head.split(":")[0]]) return next(modifiers[head.split(":")[0]](value));
    if (head === "#") {
        if (!Array.isArray(value)) return NONE;
        if (!rest.length) return value.length;
        const out = value.map((v) => get(v, joinRest(path))).filter((v) => v !== NONE);
        return out;
    }
    const q = /^#\((.*)\)(#?)$/s.exec(head);
    if (q) {
        if (!Array.isArray(value)) return NONE;
        if (q[2]) return next(value.filter((v) => queryMatch(v, q[1])));
        const hit = value.find((v) => queryMatch(v, q[1]));
        return hit === undefined ? NONE : next(hit);
    }
    if (Array.isArray(value)) {
        if (/^\d+$/.test(head)) return head in value ? next(value[head]) : NONE;
        return NONE;
    }
    if (value && typeof value === "object") {
        if (Object.hasOwn(value, head)) return next(value[head]);
        if (/[*?]/.test(head)) {
            const k = Object.keys(value).find((k) => wild(head, k));
            if (k !== undefined) return next(value[k]);
        }
    }
    return NONE;
}
// everything after the first path component, preserving escapes
function joinRest(path) {
    let depth = 0;
    for (let i = 0; i < path.length; i++) {
        const c = path[i];
        if (c === "\\") { i++; continue; }
        if (c === "(") depth++;
        if (c === ")") depth--;
        if (c === "." && depth === 0) return path.slice(i + 1);
    }
    return "";
}

const fmtNum = (n) => (Number.isInteger(n) ? String(n) : String(n));

// Result wrapper exposing the methods Glance's decoratedGJSONResult has.
export class Result {
    constructor(v = NONE) { this.v = v; }
    get exists() { return this.v !== NONE; }
    get Raw() { return this.exists ? JSON.stringify(this.v) : ""; }
    get Str() { return typeof this.v === "string" ? this.v : ""; }
    get Num() { return typeof this.v === "number" ? this.v : 0; }
    get Type() { const v = this.v; return v === NONE ? 0 : v === null ? 1 : v === false ? 2 : typeof v === "number" ? 3 : typeof v === "string" ? 4 : v === true ? 5 : 6; }
    IsArray() { return Array.isArray(this.v); }
    IsObject() { return this.exists && this.v !== null && typeof this.v === "object" && !Array.isArray(this.v); }
    Value() { return this.exists ? this.v : null; }
    _at(key) { return key === "" || key == null ? this : this.Get(key); }
    Exists(key) { return this._at(key).exists; }
    Get(key) { return new Result(get(this.v, key)); }
    String(key) {
        const v = this._at(key).v;
        if (v === NONE || v === null) return "";
        if (typeof v === "string") return v;
        if (typeof v === "number") return fmtNum(v);
        if (typeof v === "boolean") return String(v);
        return JSON.stringify(v);
    }
    Float(key) {
        const v = this._at(key).v;
        if (typeof v === "number") return v;
        if (typeof v === "string") return parseFloat(v) || 0;
        return v === true ? 1 : 0;
    }
    Int(key) { return Math.trunc(this.Float(key)); }
    Bool(key) {
        const v = this._at(key).v;
        if (typeof v === "boolean") return v;
        if (typeof v === "number") return v !== 0;
        if (typeof v === "string") return ["1", "t", "true", "T", "TRUE", "True"].includes(v);
        return false;
    }
    Array(key) {
        const r = this._at(key);
        if (r.v === NONE) return [];
        return Array.isArray(r.v) ? r.v.map((x) => new Result(x)) : [r];
    }
}

export function parse(text) {
    text = text.trim();
    if (!text) return new Result(NONE);
    try { return new Result(JSON.parse(text)); } catch { return new Result(NONE); }
}
export const valid = (text) => { try { JSON.parse(text); return true; } catch { return false; } };
export const parseLines = (text) => text.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => parse(l));
