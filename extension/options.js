import { DEFAULT_YAML, loadStored, buildConfig } from "./config.js";
import { clearCache } from "./render.js";

const $ = (id) => document.getElementById(id);
let includes = {};

const say = (t, err) => { $("msg").textContent = t; $("msg").className = err ? "err" : "ok"; };
const listIncludes = () => {
    $("incList").innerHTML = "";
    for (const name of Object.keys(includes)) {
        const li = document.createElement("li");
        li.textContent = name;
        const b = document.createElement("button");
        b.textContent = "remove";
        b.onclick = () => { delete includes[name]; listIncludes(); };
        li.append(b);
        $("incList").append(li);
    }
};

const s = await loadStored();
$("yaml").value = s.yaml; $("env").value = s.env; includes = s.includes; listIncludes();

$("file").onchange = async (e) => {
    const f = e.target.files[0];
    if (f) { $("yaml").value = await f.text(); say("Loaded " + f.name + ". Review and press Save."); }
};
$("inc").onchange = async (e) => {
    for (const f of e.target.files) includes[f.webkitRelativePath || f.name] = await f.text();
    listIncludes();
    e.target.value = "";
};
$("export").onclick = () => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([$("yaml").value], { type: "text/yaml" }));
    a.download = "glance.yml";
    a.click();
};
$("save").onclick = async () => {
    const data = { yaml: $("yaml").value, env: $("env").value, includes };
    try { buildConfig(data); } catch (e) { say("Not saved, config is invalid:\n" + e.message, true); return; }
    await chrome.storage.local.set(data);
    await clearCache();
    say("Saved. Open a new tab.");
};
$("reset").onclick = () => { $("yaml").value = DEFAULT_YAML; $("env").value = ""; includes = {}; listIncludes(); say("Default loaded. Press Save to apply."); };
$("cache").onclick = async () => { await clearCache(); say("Widget cache cleared."); };
