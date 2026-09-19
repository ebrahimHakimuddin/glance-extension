// A compact interpreter for the subset of Go's html/template used by Glance custom-api widgets.
// Supports: text, {{ pipelines }}, if/else if/else, with, range (incl. $i,$e :=, else, break/continue),
// define/template/block, variables ($x :=, $x =), comments, trim markers, (sub pipelines), builtin funcs.
import { esc } from "./common.js";

export class SafeHTML { constructor(s) { this.s = String(s); } toString() { return this.s; } }
export class SafeAttr extends SafeHTML {}
export class GoFloat { constructor(v) { this.v = v; } valueOf() { return this.v; } toString() { return String(this.v); } }
const num = (x) => (x instanceof GoFloat ? x.v : x);

// ---------------- lexer ----------------
function lex(src) {
    const out = [];
    let i = 0;
    while (i < src.length) {
        const open = src.indexOf("{{", i);
        if (open < 0) { out.push({ t: "text", s: src.slice(i) }); break; }
        let text = src.slice(i, open);
        let a = open + 2;
        const trimL = src[a] === "-" && /\s/.test(src[a + 1] || "");
        if (trimL) { text = text.replace(/\s+$/, ""); a++; }
        if (text) out.push({ t: "text", s: text });
        // find closing, respecting strings
        let j = a, close = -1;
        while (j < src.length) {
            const c = src[j];
            if (c === '"') { j++; while (j < src.length && src[j] !== '"') j += src[j] === "\\" ? 2 : 1; j++; continue; }
            if (c === "`") { j = src.indexOf("`", j + 1) + 1 || src.length; continue; }
            if (c === "'") { j++; while (j < src.length && src[j] !== "'") j += src[j] === "\\" ? 2 : 1; j++; continue; }
            if (c === "/" && src[j + 1] === "*") { j = src.indexOf("*/", j) + 2; continue; }
            if (c === "}" && src[j + 1] === "}") { close = j; break; }
            j++;
        }
        if (close < 0) throw new Error("unclosed action");
        let body = src.slice(a, close);
        let end = close + 2;
        const trimR = /\s-$/.test(body);
        if (trimR) { body = body.slice(0, -1); }
        i = end;
        if (trimR) { const m = /^\s+/.exec(src.slice(i)); if (m) i += m[0].length; }
        body = body.trim();
        if (body.startsWith("/*")) continue;
        out.push({ t: "action", s: body });
    }
    return out;
}

function tokens(s) {
    const re = /\s*(?:("(?:\\.|[^"\\])*")|(`[^`]*`)|('(?:\\.|[^'\\])')|(:=|=|\||\(|\)|,)|(\$[\w]*(?:\.[\w]+)*)|((?:\.[\w]+)+|\.)|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|([A-Za-z_][\w]*))/y;
    const out = []; let m; re.lastIndex = 0;
    while (re.lastIndex < s.length && (m = re.exec(s))) {
        if (m[1] !== undefined) out.push({ k: "str", v: JSON.parse(m[1]) });
        else if (m[2] !== undefined) out.push({ k: "str", v: m[2].slice(1, -1) });
        else if (m[3] !== undefined) out.push({ k: "str", v: m[3].slice(1, -1), ch: true });
        else if (m[4] !== undefined) out.push({ k: "p", v: m[4] });
        else if (m[5] !== undefined) out.push({ k: "var", v: m[5] });
        else if (m[6] !== undefined) out.push({ k: "field", v: m[6] });
        else if (m[7] !== undefined) out.push({ k: "num", v: m[7] });
        else if (m[8] !== undefined) out.push({ k: "id", v: m[8] });
        if (re.lastIndex === 0) break;
    }
    if (!/^\s*$/.test(s.slice(re.lastIndex))) throw new Error(`unexpected input in action: ${s.slice(re.lastIndex).trim()}`);
    return out;
}

// ---------------- parser ----------------
function parsePipe(toks) {
    let pos = 0;
    const decl = [];
    // variable declarations: $a, $b := ... / $a := ... / $a = ...
    const save = pos;
    const vars = [];
    while (toks[pos]?.k === "var") {
        vars.push(toks[pos].v); pos++;
        if (toks[pos]?.v === ",") pos++; else break;
    }
    let assign = false;
    if (vars.length && (toks[pos]?.v === ":=" || toks[pos]?.v === "=")) { assign = toks[pos].v === "="; pos++; decl.push(...vars); }
    else pos = save;

    function operand() {
        const t = toks[pos++];
        if (!t) throw new Error("missing operand");
        if (t.k === "p" && t.v === "(") {
            const sub = []; let depth = 1;
            while (pos < toks.length) {
                const x = toks[pos++];
                if (x.k === "p" && x.v === "(") depth++;
                if (x.k === "p" && x.v === ")" && --depth === 0) break;
                sub.push(x);
            }
            let node = { type: "pipe", pipe: parsePipe(sub) };
            // (expr).Field chains
            if (toks[pos]?.k === "field" && toks[pos].v !== ".") { node = { type: "chain", base: node, fields: toks[pos++].v.slice(1).split(".") }; }
            return node;
        }
        if (t.k === "str") return { type: "lit", v: t.v };
        if (t.k === "num") return { type: "lit", v: t.v.includes(".") || /e/i.test(t.v) ? new GoFloat(parseFloat(t.v)) : parseInt(t.v, 10) };
        if (t.k === "var") { const [name, ...f] = t.v.split("."); return { type: "var", name, fields: f }; }
        if (t.k === "field") return { type: "field", fields: t.v === "." ? [] : t.v.slice(1).split(".") };
        if (t.k === "id") {
            if (t.v === "true") return { type: "lit", v: true };
            if (t.v === "false") return { type: "lit", v: false };
            if (t.v === "nil") return { type: "lit", v: null };
            return { type: "id", name: t.v };
        }
        throw new Error("unexpected token " + t.v);
    }
    const cmds = [];
    let cur = [];
    while (pos < toks.length) {
        if (toks[pos].k === "p" && toks[pos].v === "|") { pos++; cmds.push(cur); cur = []; continue; }
        cur.push(operand());
    }
    cmds.push(cur);
    return { decl, assign, cmds };
}

function parse(src) {
    const lexed = lex(src);
    let p = 0;
    const defs = {};
    function list(stop) {
        const nodes = [];
        while (p < lexed.length) {
            const tk = lexed[p];
            if (tk.t === "text") { nodes.push({ type: "text", s: tk.s }); p++; continue; }
            const kw = /^(\w+)\b/.exec(tk.s)?.[1];
            const rest = tk.s.slice(kw?.length || 0).trim();
            if (["end", "else"].includes(kw) && stop) return { nodes, end: kw, rest };
            p++;
            if (kw === "if" || kw === "with" || kw === "range") {
                const pipe = parsePipe(tokens(rest));
                const body = list(true);
                let elseNodes = null;
                let cur = body;
                const branch = { type: kw, pipe, body: body.nodes, else: null };
                let tail = branch;
                while (cur.end === "else") {
                    p++; // consume else
                    if (cur.rest.startsWith("if ") || cur.rest.startsWith("with ")) {
                        const k2 = cur.rest.startsWith("if ") ? "if" : "with";
                        const nb = list(true);
                        const n2 = { type: k2, pipe: parsePipe(tokens(cur.rest.slice(k2.length))), body: nb.nodes, else: null };
                        tail.else = [n2]; tail = n2; cur = nb;
                    } else { const eb = list(true); tail.else = eb.nodes; cur = eb; }
                }
                if (cur.end !== "end") throw new Error("unexpected EOF, missing {{ end }}");
                p++; // consume end
                nodes.push(branch);
            } else if (kw === "define" || kw === "block") {
                const m = /^("(?:\\.|[^"])*")\s*(.*)$/s.exec(rest);
                const name = JSON.parse(m[1]);
                const body = list(true);
                p++;
                defs[name] = body.nodes;
                if (kw === "block") nodes.push({ type: "template", name, pipe: m[2] ? parsePipe(tokens(m[2])) : null });
            } else if (kw === "template") {
                const m = /^("(?:\\.|[^"])*")\s*(.*)$/s.exec(rest);
                nodes.push({ type: "template", name: JSON.parse(m[1]), pipe: m[2] ? parsePipe(tokens(m[2])) : null });
            } else if (kw === "break" || kw === "continue") nodes.push({ type: kw });
            else nodes.push({ type: "action", pipe: parsePipe(tokens(tk.s)), ctxBefore: prevText(nodes) });
        }
        if (stop) throw new Error("unexpected EOF");
        return { nodes };
    }
    const prevText = (nodes) => (nodes[nodes.length - 1]?.type === "text" ? nodes[nodes.length - 1].s : "");
    const root = list(false).nodes;
    return { root, defs };
}

// ---------------- runtime ----------------
const isTrue = (v) => {
    v = num(v);
    if (v == null || v === false || v === 0 || v === "") return false;
    if (Array.isArray(v)) return v.length > 0;
    if (v instanceof Map) return v.size > 0;
    return true;
};

function fmtVal(v) {
    v = num(v ?? "");
    if (v === null || v === undefined) return "<no value>";
    if (Array.isArray(v)) return "[" + v.map(fmtVal).join(" ") + "]";
    if (v instanceof Date) return v.toISOString();
    if (typeof v === "object" && !(v instanceof SafeHTML) && v.String && v.constructor.name !== "Result") return String(v);
    return String(v);
}

function sprintf(f, ...a) {
    let i = 0;
    return f.replace(/%([-+ 0#]*)(\d+)?(?:\.(\d+))?([a-zA-Z%])/g, (m, flags, w, prec, verb) => {
        if (verb === "%") return "%";
        let v = num(a[i++]);
        let s;
        switch (verb) {
            case "d": s = String(Math.trunc(Number(v))); if (flags.includes("+") && v >= 0) s = "+" + s; break;
            case "f": case "F": s = Number(v).toFixed(prec ?? 6); if (flags.includes("+") && v >= 0) s = "+" + s; break;
            case "e": s = Number(v).toExponential(prec ?? 6).replace(/e([+-])(\d)$/, "e$10$2"); break;
            case "g": s = String(Number(v)); break;
            case "s": case "v": s = fmtVal(v); if (prec !== undefined && verb === "s") s = s.slice(0, +prec); break;
            case "q": s = JSON.stringify(String(v)); break;
            case "t": s = String(!!v); break;
            case "x": s = typeof v === "number" ? Math.trunc(v).toString(16) : [...new TextEncoder().encode(String(v))].map((b) => b.toString(16).padStart(2, "0")).join(""); break;
            case "X": s = Math.trunc(Number(v)).toString(16).toUpperCase(); break;
            case "c": s = String.fromCodePoint(Number(v)); break;
            default: s = fmtVal(v);
        }
        if (w) s = flags.includes("-") ? s.padEnd(+w) : s.padStart(+w, flags.includes("0") && verb !== "s" ? "0" : " ");
        return s;
    });
}

const cmp = (a, b) => { a = num(a); b = num(b); return a < b ? -1 : a > b ? 1 : 0; };
export const builtins = {
    and: (...a) => { for (const x of a) if (!isTrue(x)) return x; return a[a.length - 1]; },
    or: (...a) => { for (const x of a) if (isTrue(x)) return x; return a[a.length - 1]; },
    not: (x) => !isTrue(x),
    eq: (a, ...b) => b.some((x) => num(a) === num(x) || (typeof num(a) !== "object" && num(a) == num(x) && typeof num(a) === typeof num(x))),
    ne: (a, b) => num(a) !== num(b),
    lt: (a, b) => cmp(a, b) < 0, le: (a, b) => cmp(a, b) <= 0, gt: (a, b) => cmp(a, b) > 0, ge: (a, b) => cmp(a, b) >= 0,
    len: (x) => (x == null ? 0 : x instanceof Map ? x.size : x.length ?? Object.keys(x).length),
    index: (x, ...k) => k.reduce((v, i) => (v == null ? v : v instanceof Map ? v.get(i) : v[num(i)]), x),
    slice: (x, ...i) => x.slice(...i.map(num)),
    print: (...a) => a.map(fmtVal).join(" "),
    println: (...a) => a.map(fmtVal).join(" ") + "\n",
    printf: sprintf,
    html: (s) => new SafeHTML(esc(fmtVal(s))),
    js: (s) => JSON.stringify(String(s)).slice(1, -1),
    urlquery: (s) => encodeURIComponent(fmtVal(s)),
    call: (f, ...a) => f(...a),
};

export function render(tpl, data, funcs) {
    const fns = { ...builtins, ...funcs };
    const frames = [{ $: data }];
    const lookup = (n) => { for (let i = frames.length - 1; i >= 0; i--) if (n in frames[i]) return frames[i]; return null; };
    let out = "";
    let steps = 0;

    function field(v, name) {
        if (v == null) throw new Error(`nil pointer evaluating .${name}`);
        v = num(v);
        if (v instanceof Map) return v.get(name);
        if (name in Object(v)) return v[name];
        // Go method names are capitalised; allow case-insensitive fallback for plain objects
        if (typeof v === "object") { const k = Object.keys(v).find((k) => k === name); if (k) return v[k]; }
        return undefined;
    }
    function chain(base, fields, args, mustCall) {
        let v = base;
        fields.forEach((f, idx) => {
            const last = idx === fields.length - 1;
            let m = field(v, f);
            if (typeof m === "function") v = m.apply(num(v), last ? args : []);
            else { if (last && args.length) throw new Error(`can't give argument to non-function .${f}`); v = m; }
        });
        return v;
    }
    function evalOperand(o, dot, args = [], isFirst = false) {
        switch (o.type) {
            case "lit": return o.v;
            case "pipe": return evalPipe(o.pipe, dot);
            case "chain": return chain(evalOperand(o.base, dot), o.fields, args);
            case "field": return o.fields.length ? chain(dot, o.fields, args) : dot;
            case "var": {
                const fr = lookup(o.name);
                if (!fr) throw new Error(`undefined variable ${o.name}`);
                return o.fields.length ? chain(fr[o.name], o.fields, args) : fr[o.name];
            }
            case "id": {
                const f = fns[o.name];
                if (!f) throw new Error(`function "${o.name}" not defined`);
                return f(...args.map((a) => a));
            }
        }
    }
    function evalPipe(pipe, dot) {
        let val, has = false;
        for (const cmd of pipe.cmds) {
            const head = cmd[0];
            const rest = cmd.slice(1).map((o) => evalOperand(o, dot));
            if (has) rest.push(val);
            if (head.type === "id") val = evalOperand(head, dot, rest);
            else if (head.type === "field" && head.fields.length || head.type === "var" && head.fields.length || head.type === "chain") val = evalOperand(head, dot, rest);
            else { if (rest.length && !has) throw new Error("can't give arguments to non-function"); val = has && rest.length === 1 ? (evalOperand(head, dot)) : evalOperand(head, dot); }
            has = true;
        }
        if (pipe.decl.length) {
            if (pipe.assign) { const fr = lookup(pipe.decl[0]); if (!fr) throw new Error("undeclared " + pipe.decl[0]); fr[pipe.decl[0]] = val; }
            else frames[frames.length - 1][pipe.decl[0]] = val;
            return { declared: true };
        }
        return val;
    }
    const BREAK = Symbol("break"), CONT = Symbol("continue");

    function emit(v, ctx) {
        if (v && v.declared) return;
        if (v instanceof SafeHTML) { out += v.s; return; }
        let s = fmtVal(v);
        s = esc(s);
        if (/(?:href|src|action|formaction)\s*=\s*["']?\s*$/i.test(ctx) && /^\s*(javascript|data|vbscript):/i.test(fmtVal(v))) s = "#ZgotmplZ";
        out += s;
    }
    function run(nodes, dot) {
        for (const n of nodes) {
            if (++steps > 200000) throw new Error("template exceeded step limit");
            switch (n.type) {
                case "text": out += n.s; break;
                case "action": emit(evalPipe(n.pipe, dot), n.ctxBefore || ""); break;
                case "if": case "with": {
                    frames.push({});
                    const v = evalPipe(n.pipe, dot);
                    let r;
                    if (isTrue(v)) r = run(n.body, n.type === "with" ? v : dot);
                    else if (n.else) r = run(n.else, dot);
                    frames.pop();
                    if (r) return r;
                    break;
                }
                case "range": {
                    frames.push({});
                    const seq = evalPipe({ ...n.pipe, decl: [] }, dot);
                    const vars = n.pipe.decl;
                    let items;
                    const s = num(seq);
                    if (Array.isArray(s)) items = s.map((v, i) => [i, v]);
                    else if (s instanceof Map) items = [...s.keys()].sort().map((k) => [k, s.get(k)]);
                    else if (typeof s === "number") items = Array.from({ length: s }, (_, i) => [i, i]);
                    else if (s && typeof s === "object") items = Object.keys(s).sort().map((k) => [k, s[k]]);
                    else items = [];
                    if (!items.length) { if (n.else) run(n.else, dot); frames.pop(); break; }
                    for (const [k, v] of items) {
                        const fr = {};
                        if (vars.length === 1) fr[vars[0]] = v; else if (vars.length === 2) { fr[vars[0]] = k; fr[vars[1]] = v; }
                        frames.push(fr);
                        const r = run(n.body, v);
                        frames.pop();
                        if (r === BREAK) break;
                    }
                    frames.pop();
                    break;
                }
                case "template": {
                    const body = tpl.defs[n.name];
                    if (!body) throw new Error(`template "${n.name}" not defined`);
                    const saved = frames.splice(1);
                    frames.push({});
                    run(body, n.pipe ? evalPipe(n.pipe, dot) : null);
                    frames.length = 1; frames.push(...saved);
                    break;
                }
                case "break": return BREAK;
                case "continue": return CONT;
            }
        }
    }
    run(tpl.root, data);
    return out;
}

export function compile(src) { return parse(src); }
