// Production counterpart of the dispatchProxy middleware in vite.config.js.
// Shared by the Workers entry (worker/index.js) and the Pages Function (functions/__proxy.js).
// The target URL comes in the x-dispatch-url header.
const DROP_REQ = new Set(["host", "origin", "referer", "connection", "content-length", "x-dispatch-url"]);
const DROP_RES = new Set(["content-encoding", "content-length", "transfer-encoding", "connection"]);

const fail = (msg) =>
  new Response(JSON.stringify({ error: msg }), {
    status: 502,
    headers: { "content-type": "application/json", "x-dispatch-proxy-error": "1" },
  });

export async function proxy(request) {
  try {
    const target = request.headers.get("x-dispatch-url");
    if (!target || !/^https?:\/\//i.test(target)) throw new Error("Missing or invalid x-dispatch-url");
    const headers = new Headers();
    for (const [k, v] of request.headers) {
      if (!DROP_REQ.has(k) && !k.startsWith("cf-") && !k.startsWith("x-forwarded-")) headers.set(k, v);
    }
    const hasBody = !["GET", "HEAD"].includes(request.method);
    const up = await fetch(target, {
      method: request.method,
      headers,
      body: hasBody ? request.body : undefined,
      redirect: "follow",
    });
    const out = new Headers();
    up.headers.forEach((v, k) => {
      if (!DROP_RES.has(k)) out.set(k, v);
    });
    out.set("x-dispatch-status-text", encodeURIComponent(up.statusText));
    out.set("x-dispatch-final-url", encodeURIComponent(up.url));
    return new Response(up.body, { status: up.status, headers: out });
  } catch (e) {
    const msg = e.cause?.message ? `${e.message}: ${e.cause.message}` : e.message;
    return fail(msg);
  }
}
