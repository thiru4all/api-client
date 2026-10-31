import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Forwards requests server-side so the browser's CORS rules don't apply.
// The target URL comes in the x-dispatch-url header.
const DROP_REQ = new Set(["host", "origin", "referer", "connection", "content-length", "x-dispatch-url"]);
const DROP_RES = new Set(["content-encoding", "content-length", "transfer-encoding", "connection"]);

function dispatchProxy() {
  const handler = async (req, res, next) => {
    if (!req.url.startsWith("/__proxy")) return next();
    try {
      const target = req.headers["x-dispatch-url"];
      if (!target || !/^https?:\/\//i.test(target)) throw new Error("Missing or invalid x-dispatch-url");
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const hasBody = !["GET", "HEAD"].includes(req.method) && chunks.length > 0;
      const headers = {};
      for (const [k, v] of Object.entries(req.headers)) if (!DROP_REQ.has(k)) headers[k] = v;
      const up = await fetch(target, {
        method: req.method,
        headers,
        body: hasBody ? Buffer.concat(chunks) : undefined,
        redirect: "follow",
      });
      const buf = Buffer.from(await up.arrayBuffer());
      res.statusCode = up.status;
      up.headers.forEach((v, k) => {
        if (!DROP_RES.has(k)) res.setHeader(k, v);
      });
      res.setHeader("x-dispatch-status-text", encodeURIComponent(up.statusText));
      res.setHeader("x-dispatch-final-url", encodeURIComponent(up.url));
      res.end(buf);
    } catch (e) {
      const msg = e.cause?.message ? `${e.message}: ${e.cause.message}` : e.message;
      res.statusCode = 502;
      res.setHeader("content-type", "application/json");
      res.setHeader("x-dispatch-proxy-error", "1");
      res.end(JSON.stringify({ error: msg }));
    }
  };
  return {
    name: "dispatch-proxy",
    // Block bodies: a returned function would be treated as a post-middleware hook.
    configureServer(s) {
      s.middlewares.use(handler);
    },
    configurePreviewServer(s) {
      s.middlewares.use(handler);
    },
  };
}

export default defineConfig({
  plugins: [react(), dispatchProxy()],
  server: { port: 5173, open: true },
});
