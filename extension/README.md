# Glance as a Chrome new-tab extension

    ./build.sh   # copies Glance's CSS/JS/fonts into dist/ and patches page.js
    # chrome://extensions > Developer mode > Load unpacked > extension/dist

Then open the extension's Options page: upload your `glance.yml`, add env vars/secrets
(`${NAME}`, `${secret:name}`) and any `!include` files, and Save.

Everything runs in the browser; the Go server is not used.

Not possible in a browser: docker unix socket (use an http(s) docker-socket-proxy URL in `sock-path`),
`server-stats` `type: local` (use `type: remote` with a glance agent), `allow-insecure` TLS, per-request `proxy`.
