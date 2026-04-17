// HTTP service that renders a transparent 1920x1080 PNG of the two-line overlay.
//
//   POST /render            JSON body: { upperText, lowerText } → image/png
//   GET  /render            Query string: ?upper=...&lower=... → image/png
//   GET  /healthz           "ok" (liveness; returns once the browser is warm)
//   GET  /readyz            "ready" (readiness; same as healthz right now)
//
// The Remotion bundle is pre-built into ./bundle at Docker build time; a
// single Chromium instance is opened at startup and shared across requests.

import http from "node:http";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { openBrowser, renderStill, selectComposition } from "@remotion/renderer";
import { bundle } from "@remotion/bundler";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");

const PORT = Number(process.env.PORT ?? 3000);
const HOST = process.env.HOST ?? "0.0.0.0";
const BUNDLE_DIR = process.env.REMOTION_BUNDLE ?? path.join(projectRoot, "bundle");
const MAX_BODY = 64 * 1024; // plenty for two strings; reject payloads larger

async function getServeUrl(): Promise<string> {
  try {
    await fs.access(path.join(BUNDLE_DIR, "index.html"));
    console.log(`Using pre-built bundle at ${BUNDLE_DIR}`);
    return BUNDLE_DIR;
  } catch {
    console.log("No pre-built bundle found — bundling now");
    return bundle({
      entryPoint: path.join(projectRoot, "src", "index.ts"),
      outDir: BUNDLE_DIR,
      publicDir: path.join(projectRoot, "public"),
    });
  }
}

type InputProps = { upperText: string; lowerText: string };

function parseQuery(url: string): InputProps | null {
  const u = new URL(url, "http://x");
  const upper = u.searchParams.get("upper");
  const lower = u.searchParams.get("lower");
  if (upper == null || lower == null) return null;
  return { upperText: upper, lowerText: lower };
}

async function readJsonBody(req: http.IncomingMessage): Promise<InputProps> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw new Error(`body too large (>${MAX_BODY}B)`);
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  const body = JSON.parse(raw);
  if (typeof body.upperText !== "string" || typeof body.lowerText !== "string") {
    throw new Error("expected JSON { upperText: string, lowerText: string }");
  }
  return { upperText: body.upperText, lowerText: body.lowerText };
}

async function main() {
  const serveUrl = await getServeUrl();

  console.log("Opening Chromium…");
  const browser = await openBrowser("chrome", {
    indent: false,
    chromiumOptions: {
      ignoreCertificateErrors: true,
      disableWebSecurity: false,
      gl: "swangle",
    },
  });

  // Select composition once — cheap, gives us durationInFrames/fps/etc.
  console.log("Selecting composition…");
  const composition = await selectComposition({
    serveUrl,
    id: "Overlay",
    puppeteerInstance: browser,
  });

  console.log(
    `Ready: ${composition.width}×${composition.height}, ${composition.durationInFrames} frame(s)`
  );

  let inflight = 0;
  const server = http.createServer(async (req, res) => {
    const url = req.url ?? "/";
    const method = req.method ?? "GET";

    const send = (status: number, body: string | Buffer, ctype: string) => {
      res.writeHead(status, {
        "content-type": ctype,
        "content-length": Buffer.byteLength(body as never),
        "cache-control": "no-store",
      });
      res.end(body);
    };

    try {
      if (url === "/healthz" || url === "/readyz") {
        send(200, "ok\n", "text/plain; charset=utf-8");
        return;
      }

      if ((url === "/" || url === "/index.html") && method === "GET") {
        const html = await fs.readFile(path.join(projectRoot, "public", "ui.html"));
        send(200, html, "text/html; charset=utf-8");
        return;
      }

      if (url === "/assets/background.png" && method === "GET") {
        const png = await fs.readFile(
          path.join(projectRoot, "public", "sample-background.png")
        );
        res.writeHead(200, {
          "content-type": "image/png",
          "content-length": png.length,
          "cache-control": "public, max-age=3600",
        });
        res.end(png);
        return;
      }

      if (url.startsWith("/render")) {
        let props: InputProps;
        if (method === "POST") {
          props = await readJsonBody(req);
        } else if (method === "GET") {
          const q = parseQuery(url);
          if (!q) {
            send(
              400,
              "Missing ?upper=...&lower=... query params\n",
              "text/plain; charset=utf-8"
            );
            return;
          }
          props = q;
        } else {
          res.writeHead(405, { allow: "GET, POST" });
          res.end("method not allowed\n");
          return;
        }

        inflight++;
        const tmp = path.join(os.tmpdir(), `overlay-${crypto.randomUUID()}.png`);
        const t0 = Date.now();
        try {
          // renderStill serializes composition.props as the resolved props
          // passed to the React component; inputProps alone is ignored for
          // the resolved-props path. Spread to avoid mutating shared state
          // across concurrent requests.
          await renderStill({
            composition: { ...composition, props },
            serveUrl,
            output: tmp,
            inputProps: props,
            imageFormat: "png",
            puppeteerInstance: browser,
          });
          const buf = await fs.readFile(tmp);
          const dt = Date.now() - t0;
          console.log(
            `rendered ${buf.length}B in ${dt}ms (inflight=${inflight}) upper=${JSON.stringify(
              props.upperText.slice(0, 40)
            )}`
          );
          res.writeHead(200, {
            "content-type": "image/png",
            "content-length": buf.length,
            "x-render-ms": String(dt),
            "cache-control": "no-store",
          });
          res.end(buf);
        } finally {
          inflight--;
          fs.unlink(tmp).catch(() => {});
        }
        return;
      }

      send(404, "not found\n", "text/plain; charset=utf-8");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("request error:", msg);
      if (!res.headersSent) {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: msg }));
      } else {
        res.end();
      }
    }
  });

  server.listen(PORT, HOST, () => {
    console.log(`Listening on http://${HOST}:${PORT}`);
  });

  const shutdown = async (signal: string) => {
    console.log(`${signal} received — shutting down`);
    server.close();
    await browser.close().catch(() => {});
    process.exit(0);
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch((err) => {
  console.error("fatal:", err);
  process.exit(1);
});
