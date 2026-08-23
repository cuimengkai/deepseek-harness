# `@deepseek-ai/dsh-host-frontend-static`

English | [中文](README.zh.md)

SPA dist server for the Web shell: a function plugin (config `{distIndex}`) that claims the [webserver](../webserver/README.md)'s single fallback seat and serves the built frontend directory with explicit index entry points. While `distIndex` is readable, the dist root and configured index path render `index.html` with HTTP 200; other existing files are served directly. A missing route-like path that accepts HTML also renders the shell, so History API deep links survive a refresh; missing static assets (`.js`/`.css`/…) and any miss under a non-HTML accept return an empty 404. Traversal outside the dist root returns 403, unknown extensions ship as `application/octet-stream`, and non-GET/HEAD without a matching named route returns 405. Every successful index response is rendered through the webserver's `renderIndex` — structured injection rows first, then the raw index taps — which is how the boot manifest reaches the page. `distIndex` is an assembly fact of the composing application: [`dsh-web-app`](../../bundle/web-app/README.md) resolves it through the frontend package's exports and mounts this plugin; a deployment never hardcodes it.

The fallback seat is single-owner (a second claim throws) and effect-scoped: disposing the plugin's fiber releases the seat, after which the unclaimed webserver answers 404.

## Model Experience

None, as the package serves browser assets; nothing here reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **The starter MIME table is minimal** — it covers the Vite-emitted asset set plus the shipped PWA manifest; other extensions fall back to `application/octet-stream` until an asset class actually ships.
- **The deep-link fallback is gate-kept** — only a miss that accepts HTML *and* carries no static-asset extension serves the shell (a missing bundle stays a hard 404); a future route whose path contains a dot would not fall back and needs this rule revisited.
