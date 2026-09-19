#!/bin/sh
# Assembles the loadable extension into dist/ from the Glance static assets.
set -e
cd "$(dirname "$0")"
S=../internal/glance/static
rm -rf dist && mkdir -p dist/static
cp manifest.json newtab.html options.html *.js dist/
rm -f dist/build.js
cp -r vendor dist/
cp -r $S/fonts $S/icons $S/js $S/app-icon.png $S/favicon.png dist/static/
mkdir -p dist/static/css

# Inline the @import chain of css/main.css (mirrors bundledCSSContents in embed.go).
node -e '
const fs=require("fs"),path=require("path");
const S=process.argv[1];
const load=(f)=>fs.readFileSync(path.join(S,f),"utf8").replace(/\r\n/g,"\n")
  .replace(/^@import "(.*?)";$/gm,(_,p)=>load(path.join(path.dirname(f),p)));
fs.writeFileSync("dist/static/css/bundle.css",load("css/main.css"));
' $S

# Swap the server fetches in page.js for the in-browser renderer.
node -e '
const fs=require("fs"),f="dist/static/js/page.js";
let s=fs.readFileSync(f,"utf8");
s=s.replace(/async function fetchPageContent[\s\S]*?\n}\n/,"async function fetchPageContent() {\n    return window.glancePageContent();\n}\n");
s=s.replace(/const response = await fetch\(`\$\{pageData\.baseURL\}\/api\/set-theme[\s\S]*?const newThemeStyle = await response\.text\(\);/,"const { css: newThemeStyle, scheme } = await window.glanceTheme(key);");
s=s.replace("response.headers.get(\"X-Scheme\")","scheme");
fs.writeFileSync(f,s);
'
grep -q glancePageContent dist/static/js/page.js && grep -q glanceTheme dist/static/js/page.js
echo "Built dist/ — load it at chrome://extensions (Developer mode > Load unpacked)"
