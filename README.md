# Overlay service

HTTP service that renders a transparent **1920×1080 PNG** of a text overlay.

Long upper titles are truncated to 43 characters with an ellipsis so they never
collide with the lower block. Lower text wraps naturally inside a 1218 px column.

Composed ahead of time into `./bundle` at Docker build; Chromium boots once at
container start and is shared across requests. This docker container can only render one image at a time, so it's pretty slow. If you need to render lots of images or render in parallel, then either run multiple containers, or change the code to be parallel. It uses a decent amount of resources too, for the remotion browser.

---

## Quick start

```bash
# docker build -t lizlovelace/tim-welcome-text-overlay . # do this if you want to recompile the docker image
docker pull lizlovelace/tim-welcome-text-overlay
docker run --rm -p 127.0.0.1:3000:3000 lizlovelace/tim-welcome-text-overlay

curl -X POST http://localhost:3000/render \
  -H 'content-type: application/json' \
  -d '{"upperText":"Kaindy lake Almaty",
       "lowerText":"a quiet signal drifts through the city at night"}' \
  -o overlay.png
```

The PNG comes back in the response body with `content-type: image/png`.

---

## API

### `POST /render`

JSON body:

```json
{ "upperText": "string", "lowerText": "string" }
```

### `GET /render?upper=...&lower=...`

URL-encoded variant; useful for debugging from a browser.

### Response

- `200 image/png` with the RGBA PNG as the body (transparent background).
- `x-render-ms` header — server-side render time (useful for SLO tracking).
- `400 application/json` with `{ "error": "…" }` on malformed input or body > 64 KB.

### `GET /healthz` · `GET /readyz`

`200 ok` once Chromium is warm and composition is selected. Use either as a
Kubernetes liveness / readiness probe. The Dockerfile also registers a
`HEALTHCHECK` that hits `/healthz`.

---

## Behaviour

| Input                          | What happens                                          |
| ------------------------------ | ----------------------------------------------------- |
| Empty string                   | Renders a fully transparent PNG (no text).            |
| Upper text > 43 chars          | Truncated with `…` — upper line never wraps.          |
| Lower text (long)              | Wraps inside a 1218 px column; no truncation.         |
| Emoji / CJK / Arabic           | Renders via system fallback fonts (shape may vary).   |
| HTML (`<script>`, `&`, etc.)   | Treated as literal text; React escapes all content.   |
| Concurrent requests            | Serialised through one Chromium; throughput ~2 req/s. |

### Observed edge cases

- **Arabic / RTL text** renders right-to-left; shaping uses Chromium's fallback.
  Inter itself ships no Arabic glyphs, so you get DejaVu or similar. Set your
  own font if you need a specific Arabic face.
- **Emoji** render as coloured glyphs via the system emoji font; the text-shadow
  halo does *not* follow emoji alpha (Chromium limitation).
- **Empty-both** render is a 1920×1080 fully transparent PNG (~44 KB). Safe to
  composite over anything.
- **HTML-ish input** is rendered as literal text — React escapes it. No XSS
  risk since the only rendered context is the offscreen Chromium that is
  thrown away each request.

---

## Tuning

Env vars the server reads:

| Var                | Default            | Purpose                                 |
| ------------------ | ------------------ | --------------------------------------- |
| `PORT`             | `3000`             | HTTP listen port.                       |
| `HOST`             | `0.0.0.0`          | HTTP bind address.                      |
| `ENABLE_UI`        | unset (off)        | Set to `1` to expose `GET /` — a browser test form that hits `/render` and previews the output on a checkerboard + on the sample background. **Leave off in prod.** |

---

## Performance

Measured on the build host (amd64, overlay2):

| Metric                                  | Value          |
| --------------------------------------- | -------------- |
| `docker build` (cold)                   | ~110 s         |
| Container cold start → `/healthz` 200   | **~2 s**       |
| First render                            | ~900 ms        |
| Warm render (single request)            | ~500–700 ms    |
| 8 concurrent requests → all done        | ~2.3 s wall    |
| Image size                              | ~1.24 GB       |

Cold start is dominated by Chromium launch + `selectComposition()`; rendering
is mostly Chromium page.screenshot(). Horizontal scale by running more replicas.

---

## What's inside the image

- `node:22-bookworm-slim` base
- Chromium headless-shell **pre-downloaded** at build time (via
  `@remotion/renderer#ensureBrowser`), so first request doesn't pay the
  ~90 MB download.
- Pre-built Remotion bundle at `/app/bundle` (skip webpack at runtime).
- `tini` as PID 1 for clean signal forwarding (Ctrl-C / SIGTERM).

---

## Development (outside Docker)

```bash
npm install
npm run prebundle         # builds ./bundle/
npm run server            # node --experimental-strip-types src/server.ts

# or, full Remotion studio for iterating on the overlay design:
npm run studio
```

Requires Node 22+ (uses `--experimental-strip-types` to run `.ts` directly).

---

## Layout

```
src/
  Overlay.tsx       — React component; Figma-matched positions, font, halo
  Root.tsx          — Registers the 1920×1080 "Overlay" composition
  index.ts          — Remotion entry point
  prebundle.ts      — Build-time: bundles composition into ./bundle/
  server.ts         — Runtime: HTTP server + shared Chromium
public/
  fonts/            — Inter-Bold.otf, Inter-Medium.otf (loaded via FontFace)
```
