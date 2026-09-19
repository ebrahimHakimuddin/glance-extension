// Loads/validates a glance.yml stored in chrome.storage, mirroring internal/glance/config.go.
import yaml from "./vendor/js-yaml.mjs";

export const DEFAULT_YAML = `pages:
  - name: Home
    columns:
      - size: small
        widgets:
          - type: calendar
            first-day-of-week: monday
          - type: todo
      - size: full
        widgets:
          - type: search
            autofocus: true
          - type: bookmarks
            groups:
              - title: General
                links:
                  - title: GitHub
                    url: https://github.com
                  - title: YouTube
                    url: https://youtube.com
          - type: hacker-news
      - size: small
        widgets:
          - type: clock
            hour-format: 24h
          - type: rss
            title: Feeds
            feeds:
              - url: https://hnrss.org/frontpage
`;

export async function loadStored() {
    const s = await chrome.storage.local.get(["yaml", "env", "includes"]);
    return { yaml: s.yaml ?? DEFAULT_YAML, env: s.env ?? "", includes: s.includes ?? {} };
}

const parseEnv = (text) => Object.fromEntries(text.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#")).map((l) => { const i = l.indexOf("="); return i < 0 ? [l, ""] : [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^(["'])(.*)\1$/, "$2")]; }));

const posix = {
    dir: (p) => p.split("/").slice(0, -1).join("/"),
    join: (...parts) => { const out = []; for (const seg of parts.join("/").split("/")) { if (seg === "..") out.pop(); else if (seg && seg !== ".") out.push(seg); } return out.join("/"); },
};

const INCLUDE = /^([ \t]*)(?:-[ \t]*)?(?:!|\$)include:[ \t]*(.+)$/gm;
function resolveIncludes(text, includes, dir = "", depth = 0) {
    if (depth > 20) throw new Error("include recursion depth limit of 20 reached");
    return text.replace(/\r\n/g, "\n").replace(INCLUDE, (_, indent, path) => {
        path = path.trim();
        const full = posix.join(dir, path);
        const key = full in includes ? full : path in includes ? path : Object.keys(includes).find((k) => k.split("/").pop() === path.split("/").pop());
        if (key === undefined) throw new Error(`include "${path}" not uploaded (add it on the options page)`);
        const body = resolveIncludes(includes[key], includes, posix.dir(key), depth + 1);
        return body.split("\n").map((l) => indent + l).join("\n");
    });
}

// ${VAR}, \${VAR} (escape), ${secret:name}, ${readFileFromEnv:VAR} all resolve from the options-page variable list.
const VAR = /(^|.)\$\{(?:([a-zA-Z]+):)?([a-zA-Z0-9_-]+)\}/gs;
function resolveVars(text, env) {
    return text.replace(VAR, (m, prefix, type, name) => {
        if (prefix === "\\") return m.slice(1);
        type ||= "env";
        if (type === "env" || type === "readFileFromEnv") {
            if (!/^[A-Z0-9_]+$/.test(name)) return m;
            if (!(name in env)) throw new Error(`environment variable ${name} not found (add it on the options page)`);
            return prefix + env[name];
        }
        if (type === "secret") {
            if (!(name in env)) throw new Error(`secret ${name} not found (add ${name}=... on the options page)`);
            return prefix + env[name].trim();
        }
        throw new Error(`unknown variable type ${type}`);
    });
}

export function validate(cfg) {
    if (!cfg || typeof cfg !== "object") throw new Error("config is empty");
    if (!cfg.pages?.length) throw new Error("no pages configured");
    const seen = new Set();
    cfg.pages.forEach((p, i) => {
        const n = i + 1;
        if (!p.name) throw new Error(`page ${n} has no name`);
        p.slug = p.slug || slugify(p.name);
        if (seen.has(p.slug)) throw new Error(`page slug "${p.slug}" is not unique`);
        seen.add(p.slug);
        if (p.width && !["slim", "wide", "default"].includes(p.width)) throw new Error(`page ${n}: width can only be either slim or wide`);
        if (p["desktop-navigation-width"] && !["wide", "slim", "default"].includes(p["desktop-navigation-width"])) throw new Error(`page ${n}: desktop-navigation-width can only be either wide or slim`);
        if (!p.columns?.length) throw new Error(`page ${n} has no columns`);
        if (p.width === "slim" ? p.columns.length > 2 : p.columns.length > 3) throw new Error(`page ${n} has too many columns`);
        p.columns.forEach((c, j) => { if (c.size !== "small" && c.size !== "full") throw new Error(`column ${j + 1} of page ${n}: size can only be either small or full`); });
        const full = p.columns.filter((c) => c.size === "full").length;
        if (full === 0 || full > 2) throw new Error(`page ${n} must have either 1 or 2 full width columns`);
    });
    return cfg;
}

export const slugify = (s) => String(s).toLowerCase().replace(/\s+/g, "-").replace(/^-+|-+$/g, "");

export function buildConfig({ yaml: text, env, includes }) {
    const merged = resolveVars(resolveIncludes(text, includes), parseEnv(env));
    return validate(yaml.load(merged));
}

export const parseYAML = (t) => yaml.load(t);
