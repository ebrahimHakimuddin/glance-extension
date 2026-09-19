import { esc, url, timeAttrs, unix, num, approx, domain, collapse, getJSON, forumPosts, sortByEngagement } from "./common.js";

const limit = (w, d) => (w.limit > 0 ? w.limit : d);

export const feedWidgets = {
    "hacker-news": {
        title: "Hacker News",
        titleUrl: "https://news.ycombinator.com/",
        cache: 30,
        async render(w) {
            const base = "https://hacker-news.firebaseio.com/v0";
            const sort = ["top", "new", "best"].includes(w["sort-by"]) ? w["sort-by"] : "top";
            const ids = (await getJSON(`${base}/${sort}stories.json`)).slice(0, 40);
            const items = (await Promise.all(ids.map((id) => getJSON(`${base}/item/${id}.json`).catch(() => null)))).filter(Boolean);
            let posts = items.map((p) => ({
                title: p.title,
                discussionUrl: w["comments-url-template"]
                    ? w["comments-url-template"].replaceAll("{POST-ID}", p.id)
                    : "https://news.ycombinator.com/item?id=" + p.id,
                targetUrl: p.url, targetDomain: domain(p.url),
                commentCount: p.descendants ?? 0, score: p.score, timePosted: p.time,
            }));
            if (!posts.length) throw new Error("no content");
            if (w["extra-sort-by"] === "engagement") posts = sortByEngagement(posts);
            return forumPosts(posts.slice(0, limit(w, 15)), w);
        },
    },

    lobsters: {
        title: "Lobsters",
        cache: 60,
        titleUrl: (w) => w["instance-url"] || "https://lobste.rs",
        async render(w) {
            let feed = w["custom-url"];
            if (!feed) {
                const inst = (w["instance-url"] ? w["instance-url"].replace(/\/+$/, "") : "https://lobste.rs") + "/";
                const sort = w["sort-by"] === "new" ? "newest" : "hottest";
                feed = w.tags?.length ? `${inst}t/${w.tags.join(",")}.json` : `${inst}${sort}.json`;
            }
            const posts = (await getJSON(feed)).map((p) => ({
                title: p.title, discussionUrl: p.comments_url, targetUrl: p.url, targetDomain: domain(p.url),
                commentCount: p.comment_count, score: p.score, timePosted: unix(p.created_at), tags: p.tags,
            }));
            if (!posts.length) throw new Error("no content");
            return forumPosts(posts.slice(0, limit(w, 15)), w);
        },
    },

    reddit: {
        title: (w) => "r/" + w.subreddit,
        titleUrl: (w) => `https://www.reddit.com/r/${w.subreddit}/`,
        cache: 30,
        async render(w) {
            if (!w.subreddit) throw new Error("subreddit is required");
            const sort = ["hot", "new", "top", "rising"].includes(w["sort-by"]) ? w["sort-by"] : "hot";
            const period = ["hour", "day", "week", "month", "year", "all"].includes(w["top-period"]) ? w["top-period"] : "day";
            const q = new URLSearchParams();
            const n = limit(w, 15);
            if (n > 25) q.set("limit", n);
            const app = w["app-auth"];
            const base = app ? "https://oauth.reddit.com" : "https://www.reddit.com";
            let reqUrl, headers = {};
            if (w.search) {
                q.set("q", `${w.search} subreddit:${w.subreddit}`); q.set("sort", sort);
                reqUrl = `${base}/search.json?${q}`;
            } else {
                if (sort === "top") q.set("t", period);
                reqUrl = `${base}/r/${w.subreddit}/${sort}.json?${q}`;
            }
            if (app) {
                const tok = await getJSON("https://www.reddit.com/api/v1/access_token", {
                    method: "POST",
                    headers: { Authorization: "Basic " + btoa(`${app.id}:${app.secret}`), "Content-Type": "application/x-www-form-urlencoded" },
                    body: "grant_type=client_credentials",
                });
                headers.Authorization = "Bearer " + tok.access_token;
            }
            if (w["request-url-template"]) reqUrl = w["request-url-template"].replace("{REQUEST-URL}", reqUrl);
            if (!app && !w["request-url-template"]) await redditCookie();
            const json = await getJSON(reqUrl, { headers, credentials: "include" });
            const tpl = (s, sub, id, path) => s.replaceAll("{SUBREDDIT}", sub).replaceAll("{POST-ID}", id).replaceAll("{POST-PATH}", path.replace(/^\/+/, ""));
            const comments = (sub, id, path) => w["comments-url-template"] ? tpl(w["comments-url-template"], sub, id, path) : "https://www.reddit.com" + path;
            const dec = (s) => { const t = document.createElement("textarea"); t.innerHTML = s; return t.value; };
            let posts = json.data.children.map((c) => c.data).filter((d) => !d.stickied && !d.pinned).map((d) => {
                const p = {
                    title: dec(d.title), discussionUrl: comments(w.subreddit, d.id, d.permalink),
                    targetDomain: d.domain, commentCount: d.num_comments, score: d.ups, timePosted: d.created,
                };
                if (d.thumbnail && !["self", "default", "nsfw"].includes(d.thumbnail)) p.thumbnailUrl = dec(d.thumbnail);
                if (!d.is_self) p.targetUrl = d.url;
                if (w["show-flairs"] && d.link_flair_text) p.tags = [d.link_flair_text];
                const parent = d.crosspost_parent_list?.[0];
                if (parent) {
                    p.isCrosspost = true;
                    p.targetDomain = "r/" + parent.subreddit;
                    p.targetUrl = comments(parent.subreddit, parent.id, parent.permalink);
                }
                return p;
            });
            if (!posts.length) throw new Error("no posts found");
            posts = posts.slice(0, n);
            if (w["extra-sort-by"] === "engagement") posts = sortByEngagement(posts);
            w = { ...w, "show-thumbnails": w["show-thumbnails"] };
            if (w.style === "horizontal-cards" || w.style === "vertical-cards") return redditCards(posts, w);
            return forumPosts(posts, { collapseAfter: w["collapse-after"], showThumbnails: w["show-thumbnails"] });
        },
        frameless: (w) => w.style === "horizontal-cards" || w.style === "vertical-cards",
    },

    releases: {
        title: "Releases",
        cache: 120,
        async render(w) {
            const reqs = (w.repositories || []).map((r) => {
                const o = typeof r === "string" ? { repository: r } : { ...r };
                const m = /^(github|gitlab|dockerhub|codeberg):(.*)$/.exec(o.repository);
                o.source = m ? m[1] : "github";
                if (m) o.repository = m[2];
                return o;
            });
            const settled = await Promise.allSettled(reqs.map((r) => latestRelease(r, w)));
            const ok = settled.filter((s) => s.status === "fulfilled").map((s) => s.value);
            if (!ok.length) throw new Error("no content");
            ok.sort((a, b) => b.time - a.time);
            return `<ul class="list list-gap-10 collapsible-container" data-collapse-after="${collapse(w["collapse-after"])}">${ok.slice(0, limit(w, 10)).map((r) => `
<li>
    <div class="flex items-center gap-10">
        <a class="size-h4 block text-truncate color-primary-if-not-visited" href="${url(r.notesUrl)}" target="_blank" rel="noreferrer">${esc(r.name)}</a>
        ${w["show-source-icon"] ? `<img class="flat-icon release-source-icon" src="static/icons/${r.source}.svg" alt="" loading="lazy">` : ""}
    </div>
    <ul class="list-horizontal-text">
        <li ${timeAttrs(r.time)}></li><li>${esc(r.version)}</li>
        ${r.downvotes > 3 ? `<li>${num(r.downvotes)} ⚠</li>` : ""}
    </ul>
</li>`).join("")}</ul>`;
        },
    },

    repository: {
        title: "Repository",
        cache: 60,
        async render(w) {
            const repo = w.repository;
            const headers = w.token ? { Authorization: "Bearer " + w.token } : {};
            const gh = (p) => getJSON("https://api.github.com" + p, { headers });
            const prN = w["pull-requests-limit"] === 0 || w["pull-requests-limit"] == null ? 3 : w["pull-requests-limit"];
            const isN = w["issues-limit"] === 0 || w["issues-limit"] == null ? 3 : w["issues-limit"];
            const cmN = w["commits-limit"] === 0 || w["commits-limit"] == null ? -1 : w["commits-limit"];
            const [info, prs, iss, cms] = await Promise.all([
                gh(`/repos/${repo}`),
                prN > 0 ? gh(`/search/issues?q=is:pr+is:open+repo:${repo}&per_page=${prN}`).catch(() => null) : null,
                isN > 0 ? gh(`/search/issues?q=is:issue+is:open+repo:${repo}&per_page=${isN}`).catch(() => null) : null,
                cmN > 0 ? gh(`/repos/${repo}/commits?per_page=${cmN}`).catch(() => null) : null,
            ]);
            const rows = (label, href, items, path) => !items?.items.length ? "" : `
<hr class="margin-block-8">
<a class="text-compact" href="https://github.com/${esc(info.full_name)}/${href}" target="_blank" rel="noreferrer">${label} (${num(items.total_count)} total)</a>
<div class="flex gap-7 size-h5 size-base-on-mobile margin-top-3">
    <ul class="list list-gap-2">${items.items.map((t) => `<li ${timeAttrs(unix(t.created_at))}></li>`).join("")}</ul>
    <ul class="list list-gap-2 min-width-0">${items.items.map((t) => `<li><a class="color-primary-if-not-visited text-truncate block" target="_blank" rel="noreferrer" href="https://github.com/${esc(info.full_name)}/${path}/${t.number}">${esc(t.title)}</a></li>`).join("")}</ul>
</div>`;
            return `
<a class="size-h4 color-highlight" href="https://github.com/${esc(info.full_name)}" target="_blank" rel="noreferrer">${esc(info.full_name)}</a>
<ul class="list-horizontal-text"><li>${num(info.stargazers_count)} stars</li><li>${num(info.forks_count)} forks</li></ul>
${cms?.length ? `<hr class="margin-block-8">
<a class="text-compact" href="https://github.com/${esc(info.full_name)}/commits" target="_blank" rel="noreferrer">Last ${cmN} commits</a>
<div class="flex gap-7 size-h5 size-base-on-mobile margin-top-3">
    <ul class="list list-gap-2">${cms.map((c) => `<li ${timeAttrs(unix(c.commit.author.date))}></li>`).join("")}</ul>
    <ul class="list list-gap-2 min-width-0">${cms.map((c) => `<li><a class="color-primary-if-not-visited text-truncate block" title="${esc(c.commit.author.name)}" target="_blank" rel="noreferrer" href="https://github.com/${esc(info.full_name)}/commit/${c.sha}">${esc(c.commit.message.split("\n\n")[0])}</a></li>`).join("")}</ul>
</div>` : ""}
${rows("Open pull requests", "pulls", prs, "pull")}${rows("Open issues", "issues", iss, "issues")}`;
        },
    },
};

function redditCards(posts, w) {
    const vertical = w.style === "vertical-cards";
    const thumb = (p) => p.thumbnailUrl ? `<div class="reddit-card-thumbnail-container"><img class="reddit-card-thumbnail" loading="lazy" src="${url(p.thumbnailUrl)}" alt=""></div>` : "";
    const head = (p) => p.targetUrl
        ? `<a class="color-highlight size-h5 text-truncate visited-indicator${vertical ? " block" : ""}" href="${url(p.targetUrl)}" target="_blank" rel="noreferrer">${esc(p.targetDomain)}</a>`
        : `<div class="color-highlight size-h5 text-truncate">/r/${esc(w.subreddit)}</div>`;
    const meta = `<ul class="list-horizontal-text margin-top-7">`;
    if (vertical) {
        return `<div class="cards-vertical">${posts.map((p) => `
<div class="widget-content-frame relative">${thumb(p)}
    <div class="padding-widget relative">${head(p)}
        <a href="${url(p.discussionUrl)}" class="text-truncate-3-lines color-primary-if-not-visited margin-top-7" target="_blank" rel="noreferrer">${esc(p.title)}</a>
        ${meta}<li ${timeAttrs(p.timePosted)}></li><li>${approx(p.score)} points</li></ul>
    </div>
</div>`).join("")}</div>`;
    }
    return `<div class="carousel-container"><div class="cards-horizontal carousel-items-container">${posts.map((p) => `
<div class="card widget-content-frame relative">${thumb(p)}
    <div class="padding-widget flex flex-column grow relative">${head(p)}
        <a href="${url(p.discussionUrl)}" class="text-truncate-3-lines color-primary-if-not-visited margin-top-7 margin-bottom-auto" target="_blank" rel="noreferrer">${esc(p.title)}</a>
        ${meta}<li ${timeAttrs(p.timePosted)}></li><li>${approx(p.score)} points</li></ul>
    </div>
</div>`).join("")}</div></div>`;
}

const ver = (v) => { v = v.trim().toLowerCase(); return v && v[0] !== "v" ? "v" + v : v; };

async function latestRelease(r, w) {
    const repo = r.repository;
    if (r.source === "github") {
        const h = w.token ? { Authorization: "Bearer " + w.token } : {};
        let d;
        if (r["include-prereleases"]) {
            d = (await getJSON(`https://api.github.com/repos/${repo}/releases`, { headers: h }))[0];
            if (!d) throw new Error("no releases");
        } else d = await getJSON(`https://api.github.com/repos/${repo}/releases/latest`, { headers: h });
        return { source: "github", name: repo, version: ver(d.tag_name), notesUrl: d.html_url, time: unix(d.published_at), downvotes: d.reactions?.["-1"] ?? 0 };
    }
    if (r.source === "gitlab") {
        const h = w["gitlab-token"] ? { "PRIVATE-TOKEN": w["gitlab-token"] } : {};
        const d = await getJSON(`https://gitlab.com/api/v4/projects/${encodeURIComponent(repo)}/releases/permalink/latest`, { headers: h });
        return { source: "gitlab", name: repo, version: ver(d.tag_name), notesUrl: d._links.self, time: unix(d.released_at) };
    }
    if (r.source === "codeberg") {
        const d = await getJSON(`https://codeberg.org/api/v1/repos/${repo}/releases/latest`);
        return { source: "codeberg", name: repo, version: ver(d.tag_name), notesUrl: d.html_url, time: unix(d.published_at) };
    }
    // dockerhub
    let parts = repo.split("/");
    if (parts.length === 1) parts = ["library", parts[0]];
    const [name, tag] = parts[1].split(":");
    const d = tag
        ? await getJSON(`https://hub.docker.com/v2/namespaces/${parts[0]}/repositories/${name}/tags/${tag}`)
        : (await getJSON(`https://hub.docker.com/v2/namespaces/${parts[0]}/repositories/${name}/tags`)).results[0];
    if (!d) throw new Error("no tags");
    const display = parts[0] === "library" ? name : `${parts[0]}/${name}`;
    return {
        source: "dockerhub", name: display, version: d.name, time: unix(d.tag_last_pushed),
        notesUrl: parts[0] === "library" ? `https://hub.docker.com/_/${name}/tags?name=${d.name}` : `https://hub.docker.com/r/${display}/tags?name=${d.name}`,
    };
}

// Reddit gates .json behind a tiny JS challenge that yields a `loid` cookie; the browser's cookie jar keeps it.
let redditReady;
function redditCookie() {
    return (redditReady ||= (async () => {
        // Reddit rejects requests that look like they come from an extension; strip the tell-tale headers for our own fetches.
        await chrome.declarativeNetRequest.updateDynamicRules({
            removeRuleIds: [1],
            addRules: [{ id: 1, priority: 1, action: { type: "modifyHeaders", requestHeaders: ["origin", "sec-fetch-site", "sec-fetch-mode", "sec-fetch-dest", "sec-fetch-user"].map((header) => ({ header, operation: "remove" })) },
                condition: { requestDomains: ["reddit.com"], initiatorDomains: [location.host], resourceTypes: ["xmlhttprequest"] } }],
        }).catch(() => {});
        const r = await fetch("https://www.reddit.com/", { credentials: "include" });
        const body = await r.text();
        const ch = /await\(async \w+\s*=>\s*\w+\s*\+\s*\w+\)\("([^"]+)"\)/.exec(body)?.[1];
        const tok = /name="jsc_token"\s+value="([^"]+)"/.exec(body)?.[1];
        if (!ch || !tok) return; // no challenge (already have a cookie)
        await fetch("https://www.reddit.com/?" + new URLSearchParams({ solution: ch + ch, js_challenge: "1", jsc_token: tok }), { credentials: "include" });
    })().catch(() => {}));
}
