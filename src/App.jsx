import { useState, useRef, useEffect, useMemo } from "react";
import {
  Send,
  Plus,
  Trash2,
  Copy,
  Check,
  Terminal,
  History,
  Bookmark,
  X,
  Wand2,
  Square,
  Inbox,
  AlertTriangle,
} from "lucide-react";

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

// Random per-load prefix keeps ids unique against rows restored from localStorage.
const _pfx = Math.random().toString(36).slice(2, 6);
let _id = 0;
const uid = () => `r${_pfx}${++_id}`;

const loadJson = (key, fallback) => {
  try {
    const v = JSON.parse(localStorage.getItem(key));
    return v ?? fallback;
  } catch {
    return fallback;
  }
};
const saveJson = (key, value) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage full or unavailable */
  }
};
function usePersistentState(key, initial) {
  const [value, setValue] = useState(() => loadJson(key, initial));
  useEffect(() => saveJson(key, value), [key, value]);
  return [value, setValue];
}
const newRow = (key = "", value = "", enabled = true) => ({ id: uid(), key, value, enabled });

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];
const methodColor = (m) => `var(--m-${m.toLowerCase()})`;
const canHaveBody = (m) => !["GET", "HEAD"].includes(m);

const COMMON_HEADERS = [
  "Accept",
  "Accept-Language",
  "Authorization",
  "Cache-Control",
  "Content-Type",
  "If-None-Match",
  "Origin",
  "Referer",
  "User-Agent",
  "X-API-Key",
  "X-Requested-With",
];
const CONTENT_TYPES = [
  "application/json",
  "application/x-www-form-urlencoded",
  "multipart/form-data",
  "text/plain",
  "text/html",
  "application/xml",
];
const ACCEPT_VALUES = ["application/json", "text/html", "text/plain", "*/*"];

const BODY_TYPES = [
  { id: "none", label: "None" },
  { id: "json", label: "JSON" },
  { id: "text", label: "Text" },
  { id: "urlencoded", label: "Form URL-encoded" },
  { id: "formdata", label: "Form data" },
];

const SAMPLES = [
  {
    label: "GET a todo",
    cmd: "curl https://jsonplaceholder.typicode.com/todos/1",
  },
  {
    label: "POST JSON",
    cmd: `curl -X POST https://jsonplaceholder.typicode.com/posts \\
  -H 'Content-Type: application/json' \\
  -d '{"title":"hello","body":"world","userId":1}'`,
  },
  {
    label: "Headers + query",
    cmd: `curl 'https://httpbin.org/anything?foo=bar&page=2' \\
  -H 'Accept: application/json' \\
  -H 'Authorization: Bearer demo-token'`,
  },
];

const safeDecode = (s) => {
  try {
    return decodeURIComponent(s.replace(/\+/g, " "));
  } catch {
    return s;
  }
};

function parseQuery(url) {
  const qi = url.indexOf("?");
  if (qi < 0) return [];
  let q = url.slice(qi + 1);
  const hi = q.indexOf("#");
  if (hi >= 0) q = q.slice(0, hi);
  if (!q) return [];
  return q
    .split("&")
    .filter(Boolean)
    .map((p) => {
      const e = p.indexOf("=");
      const k = e < 0 ? p : p.slice(0, e);
      const v = e < 0 ? "" : p.slice(e + 1);
      return newRow(safeDecode(k), safeDecode(v));
    });
}

function buildUrl(url, rows) {
  let hash = "";
  let base = url;
  const hi = base.indexOf("#");
  if (hi >= 0) {
    hash = base.slice(hi);
    base = base.slice(0, hi);
  }
  const qi = base.indexOf("?");
  if (qi >= 0) base = base.slice(0, qi);
  const qs = rows
    .filter((r) => r.enabled && r.key.trim())
    .map((r) => `${encodeURIComponent(r.key)}=${encodeURIComponent(r.value)}`)
    .join("&");
  return base + (qs ? `?${qs}` : "") + hash;
}

const normalizeUrl = (u) => {
  const t = u.trim();
  if (!t) return t;
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(t) ? t : `https://${t}`;
};

function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
}

function highlightJson(str) {
  const esc = str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return esc.replace(
    /("(\\u[a-fA-F0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+-]?\d+)?)/g,
    (m) => {
      let cls = "num";
      if (m.startsWith('"')) cls = m.endsWith(":") ? "key" : "str";
      else if (m === "true" || m === "false") cls = "bool";
      else if (m === "null") cls = "null";
      return `<span class="j-${cls}">${m}</span>`;
    }
  );
}

/* ------------------------------------------------------------------ */
/* cURL parsing                                                        */
/* ------------------------------------------------------------------ */

function tokenize(input) {
  const s = input.replace(/\\\r?\n/g, " ").replace(/\^\r?\n/g, " ").trim();
  const tokens = [];
  let cur = "";
  let inTok = false;
  let i = 0;
  const ansi = { n: "\n", t: "\t", r: "\r", "'": "'", '"': '"', "\\": "\\" };
  while (i < s.length) {
    const c = s[i];
    if (c === "'") {
      inTok = true;
      i++;
      while (i < s.length && s[i] !== "'") cur += s[i++];
      i++;
    } else if (c === "$" && s[i + 1] === "'") {
      inTok = true;
      i += 2;
      while (i < s.length && s[i] !== "'") {
        if (s[i] === "\\" && i + 1 < s.length) {
          const n = s[i + 1];
          cur += ansi[n] !== undefined ? ansi[n] : n;
          i += 2;
        } else cur += s[i++];
      }
      i++;
    } else if (c === '"') {
      inTok = true;
      i++;
      while (i < s.length && s[i] !== '"') {
        if (s[i] === "\\" && i + 1 < s.length && /["\\$`]/.test(s[i + 1])) {
          cur += s[i + 1];
          i += 2;
        } else cur += s[i++];
      }
      i++;
    } else if (/\s/.test(c)) {
      if (inTok) {
        tokens.push(cur);
        cur = "";
        inTok = false;
      }
      i++;
    } else if (c === "\\" && i + 1 < s.length) {
      cur += s[i + 1];
      inTok = true;
      i += 2;
    } else {
      cur += c;
      inTok = true;
      i++;
    }
  }
  if (inTok) tokens.push(cur);
  return tokens;
}

const SKIP_LONG = new Set([
  "--output", "--max-time", "--connect-timeout", "--proxy", "--cacert", "--cert", "--key",
  "--retry", "--write-out", "--upload-file", "--resolve", "--interface", "--config",
  "--limit-rate", "--max-redirs", "--proxy-user", "--cookie-jar", "--retry-delay",
]);
const SHORT_VALUED = "XHdFuAbeomxwTKcE";

function parseCurl(cmd) {
  const tokens = tokenize(cmd);
  if (!tokens.length || tokens[0].toLowerCase() !== "curl") {
    throw new Error("The command needs to start with “curl”.");
  }
  const o = {
    method: null, url: "", headers: [], data: [], urlenc: [], form: [],
    user: null, cookie: null, ua: null, referer: null, get: false, head: false, json: false,
  };
  const pushHeader = (h) => {
    const idx = h.indexOf(":");
    if (idx < 1) return;
    o.headers.push([h.slice(0, idx).trim(), h.slice(idx + 1).trim()]);
  };

  for (let i = 1; i < tokens.length; i++) {
    const t = tokens[i];
    const next = () => tokens[++i] ?? "";
    if (t.startsWith("--")) {
      let name = t;
      let inline = null;
      const eq = t.indexOf("=");
      if (eq > 0) {
        name = t.slice(0, eq);
        inline = t.slice(eq + 1);
      }
      const v = () => (inline !== null ? inline : next());
      switch (name) {
        case "--request": o.method = v().toUpperCase(); break;
        case "--header": pushHeader(v()); break;
        case "--data": case "--data-raw": case "--data-binary": case "--data-ascii": o.data.push(v()); break;
        case "--data-urlencode": o.urlenc.push(v()); break;
        case "--form": o.form.push(v()); break;
        case "--user": o.user = v(); break;
        case "--user-agent": o.ua = v(); break;
        case "--cookie": o.cookie = v(); break;
        case "--referer": o.referer = v(); break;
        case "--url": o.url = v(); break;
        case "--json": o.data.push(v()); o.json = true; break;
        case "--get": o.get = true; break;
        case "--head": o.head = true; break;
        default: if (SKIP_LONG.has(name)) v();
      }
    } else if (t.startsWith("-") && t.length > 1) {
      const flag = t[1];
      if (SHORT_VALUED.includes(flag)) {
        const val = t.slice(2) || next();
        switch (flag) {
          case "X": o.method = val.toUpperCase(); break;
          case "H": pushHeader(val); break;
          case "d": o.data.push(val); break;
          case "F": o.form.push(val); break;
          case "u": o.user = val; break;
          case "A": o.ua = val; break;
          case "b": o.cookie = val; break;
          case "e": o.referer = val; break;
          default: break;
        }
      } else {
        for (const ch of t.slice(1)) {
          if (ch === "G") o.get = true;
          if (ch === "I") o.head = true;
        }
      }
    } else if (!o.url) {
      o.url = t;
    }
  }

  if (!o.url) throw new Error("No URL found in the command.");

  const headers = [...o.headers];
  const hasHeader = (n) => headers.some(([k]) => k.toLowerCase() === n);
  if (o.json) {
    if (!hasHeader("content-type")) headers.push(["Content-Type", "application/json"]);
    if (!hasHeader("accept")) headers.push(["Accept", "application/json"]);
  }
  if (o.cookie) headers.push(["Cookie", o.cookie]);
  if (o.ua) headers.push(["User-Agent", o.ua]);
  if (o.referer) headers.push(["Referer", o.referer]);

  let auth = { type: "none", token: "", user: "", pass: "" };
  if (o.user !== null) {
    const ci = o.user.indexOf(":");
    auth = {
      type: "basic",
      token: "",
      user: ci < 0 ? o.user : o.user.slice(0, ci),
      pass: ci < 0 ? "" : o.user.slice(ci + 1),
    };
  }

  let url = o.url;
  const hasData = o.data.length > 0 || o.urlenc.length > 0;
  let bodyType = "none";
  let body = "";
  let fields = [];

  if (o.get && hasData) {
    const qs = [
      ...o.data,
      ...o.urlenc.map((u) => {
        const e = u.indexOf("=");
        return e < 0 ? encodeURIComponent(u) : `${u.slice(0, e)}=${encodeURIComponent(u.slice(e + 1))}`;
      }),
    ].join("&");
    url += (url.includes("?") ? "&" : "?") + qs;
  } else if (o.form.length) {
    bodyType = "formdata";
    fields = o.form.map((f) => {
      const e = f.indexOf("=");
      return e < 0 ? newRow(f, "") : newRow(f.slice(0, e), f.slice(e + 1));
    });
  } else if (hasData) {
    const ctHeader = headers.find(([k]) => k.toLowerCase() === "content-type");
    const ct = (ctHeader ? ctHeader[1] : "").toLowerCase();
    const raw = o.data.join("&");
    let jsonOk = false;
    let parsed;
    if (/^\s*[{[]/.test(raw)) {
      try {
        parsed = JSON.parse(raw);
        jsonOk = true;
      } catch {
        jsonOk = false;
      }
    }
    if (ct.includes("json") || (jsonOk && !ct)) {
      bodyType = "json";
      body = jsonOk ? JSON.stringify(parsed, null, 2) : raw;
    } else if (ct.includes("x-www-form-urlencoded") || !ct) {
      bodyType = "urlencoded";
      fields = [
        ...(raw
          ? raw.split("&").filter(Boolean).map((p) => {
              const e = p.indexOf("=");
              return e < 0 ? newRow(safeDecode(p), "") : newRow(safeDecode(p.slice(0, e)), safeDecode(p.slice(e + 1)));
            })
          : []),
        ...o.urlenc.map((u) => {
          const e = u.indexOf("=");
          return e < 0 ? newRow("", u) : newRow(u.slice(0, e), u.slice(e + 1));
        }),
      ];
    } else {
      bodyType = "text";
      body = raw;
    }
  }

  const method = o.method || (o.head ? "HEAD" : bodyType !== "none" ? "POST" : "GET");
  const cleanHeaders = headers.filter(
    ([k, v]) => !(bodyType === "formdata" && k.toLowerCase() === "content-type" && /multipart/i.test(v))
  );

  return {
    method,
    url,
    params: parseQuery(url),
    headers: cleanHeaders.map(([k, v]) => newRow(k, v)),
    auth,
    bodyType,
    body,
    fields,
  };
}

/* ------------------------------------------------------------------ */
/* Request building                                                    */
/* ------------------------------------------------------------------ */

function manualHeaders(req) {
  return req.headers.filter((h) => h.enabled && h.key.trim()).map((h) => [h.key.trim(), h.value]);
}

function effectiveHeaders(req) {
  const list = manualHeaders(req);
  const has = (n) => list.some(([k]) => k.toLowerCase() === n);
  if (req.auth.type === "bearer" && req.auth.token && !has("authorization")) {
    list.push(["Authorization", `Bearer ${req.auth.token}`]);
  }
  if (req.auth.type === "basic" && (req.auth.user || req.auth.pass) && !has("authorization")) {
    const raw = `${req.auth.user}:${req.auth.pass}`;
    list.push(["Authorization", `Basic ${btoa(unescape(encodeURIComponent(raw)))}`]);
  }
  if (!has("content-type") && canHaveBody(req.method)) {
    const map = {
      json: "application/json",
      urlencoded: "application/x-www-form-urlencoded",
      text: "text/plain",
    };
    if (map[req.bodyType]) list.push(["Content-Type", map[req.bodyType]]);
  }
  return list;
}

function toCurl(req) {
  const q = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
  const parts = ["curl"];
  if (req.method === "HEAD") parts.push("-I");
  else if (req.method !== "GET") parts.push(`-X ${req.method}`);
  parts.push(q(normalizeUrl(req.url) || "https://"));
  let headers = effectiveHeaders(req);
  if (req.bodyType === "formdata") headers = headers.filter(([k]) => k.toLowerCase() !== "content-type");
  headers.forEach(([k, v]) => parts.push(`-H ${q(`${k}: ${v}`)}`));
  if (canHaveBody(req.method)) {
    const rows = req.fields.filter((r) => r.enabled && r.key.trim());
    if ((req.bodyType === "json" || req.bodyType === "text") && req.body) parts.push(`--data-raw ${q(req.body)}`);
    if (req.bodyType === "urlencoded") rows.forEach((r) => parts.push(`--data-urlencode ${q(`${r.key}=${r.value}`)}`));
    if (req.bodyType === "formdata") rows.forEach((r) => parts.push(`-F ${q(`${r.key}=${r.value}`)}`));
  }
  return parts.join(" \\\n  ");
}

/* ------------------------------------------------------------------ */
/* Small components                                                    */
/* ------------------------------------------------------------------ */

function CopyButton({ text, label = "Copy", onDone }) {
  const [done, setDone] = useState(false);
  return (
    <button
      className="btn ghost sm"
      onClick={async () => {
        const ok = await copyText(typeof text === "function" ? text() : text);
        if (ok) {
          setDone(true);
          onDone?.();
          setTimeout(() => setDone(false), 1400);
        }
      }}
    >
      {done ? <Check size={14} /> : <Copy size={14} />}
      {done ? "Copied" : label}
    </button>
  );
}

function KVEditor({ rows, onChange, keyList, valueListFor, keyPlaceholder = "Key", valuePlaceholder = "Value" }) {
  const update = (id, patch) => onChange(rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const remove = (id) => onChange(rows.filter((r) => r.id !== id));
  return (
    <div className="kv">
      <div className="kv-head">
        <span />
        <span>{keyPlaceholder}</span>
        <span>{valuePlaceholder}</span>
        <span />
      </div>
      {rows.map((r) => (
        <div className={`kv-row${r.enabled ? "" : " off"}`} key={r.id}>
          <input
            type="checkbox"
            aria-label="Enable row"
            checked={r.enabled}
            onChange={(e) => update(r.id, { enabled: e.target.checked })}
          />
          <input
            className="cell"
            value={r.key}
            placeholder={keyPlaceholder}
            list={keyList}
            spellCheck={false}
            onChange={(e) => update(r.id, { key: e.target.value })}
          />
          <input
            className="cell"
            value={r.value}
            placeholder={valuePlaceholder}
            list={valueListFor ? valueListFor(r.key) : undefined}
            spellCheck={false}
            onChange={(e) => update(r.id, { value: e.target.value })}
          />
          <button className="icon-btn" aria-label="Remove row" onClick={() => remove(r.id)}>
            <Trash2 size={15} />
          </button>
        </div>
      ))}
      <button className="btn ghost sm add" onClick={() => onChange([...rows, newRow()])}>
        <Plus size={14} /> Add row
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Main app                                                            */
/* ------------------------------------------------------------------ */

const initialReq = () => ({
  method: "GET",
  url: "https://jsonplaceholder.typicode.com/todos/1",
  params: [newRow()],
  headers: [newRow("Accept", "application/json"), newRow()],
  auth: { type: "none", token: "", user: "", pass: "" },
  bodyType: "none",
  body: "",
  fields: [newRow()],
});

const newTab = (req ={ ...initialReq(), url: "" }) => ({
  id: uid(),
  req,
  res: null,
  subTab: "params",
  resTab: "body",
  view: "pretty",
  useProxy: false,
});

// Open tabs survive reloads (requests only; responses are dropped).
const loadTabs = () => {
  const saved = loadJson("dispatch.tabs", null);
  if (saved?.tabs?.length) {
    const tabs = saved.tabs.map((t) => ({ ...newTab(t.req), ...t, res: null }));
    return { tabs, activeId: tabs.some((t) => t.id === saved.activeId) ? saved.activeId : tabs[0].id };
  }
  const t = newTab(initialReq());
  return { tabs: [t], activeId: t.id };
};

const tabLabel = (req) => (req.url.trim() ? req.url.replace(/^https?:\/\//i, "") : "New request");

export default function ApiClient() {
  const [boot] = useState(loadTabs);
  const [reqTabs, setReqTabs] = useState(boot.tabs);
  const [activeId, setActiveId] = useState(boot.activeId);
  const cur = reqTabs.find((t) => t.id === activeId) || reqTabs[0];
  const { req, res, subTab: tab, resTab, view, useProxy } = cur;

  const updateTab = (id, fn) => setReqTabs((ts) => ts.map((t) => (t.id === id ? { ...t, ...fn(t) } : t)));
  const field = (key) => (v) =>
    updateTab(cur.id, (t) => ({ [key]: typeof v === "function" ? v(t[key]) : v }));
  const setReq = field("req");
  const setRes = field("res");
  const setTab = field("subTab");
  const setResTab = field("resTab");
  const setView = field("view");
  const setUseProxy = field("useProxy");

  const [history, setHistory] = usePersistentState("dispatch.history", []);
  const [saved, setSaved] = usePersistentState("dispatch.saved", []);
  const [showSaved, setShowSaved] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [importText, setImportText] = useState("");
  const [importError, setImportError] = useState("");
  const [toast, setToast] = useState("");
  const abortRef = useRef(new Map());
  const toastTimer = useRef(null);

  useEffect(() => {
    saveJson("dispatch.tabs", {
      activeId,
      tabs: reqTabs.map(({ res: _res, ...t }) => t),
    });
  }, [reqTabs, activeId]);

  const addTab = (req) => {
    const t = newTab(req);
    setReqTabs((ts) => [...ts, t]);
    setActiveId(t.id);
  };
  const closeTab = (id) => {
    abortRef.current.get(id)?.abort();
    abortRef.current.delete(id);
    if (reqTabs.length === 1) {
      const t = newTab();
      setReqTabs([t]);
      setActiveId(t.id);
      return;
    }
    const i = reqTabs.findIndex((t) => t.id === id);
    const rest = reqTabs.filter((t) => t.id !== id);
    setReqTabs(rest);
    if (id === activeId) setActiveId(rest[Math.min(i, rest.length - 1)].id);
  };

  const patch = (p) => setReq((r) => ({ ...r, ...p }));
  const say = (msg) => {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 2200);
  };

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") {
        setShowImport(false);
        setShowHistory(false);
        setShowSaved(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  /* URL <-> params sync */
  const onUrlChange = (value) => {
    setReq((r) => {
      const fromUrl = parseQuery(value);
      const disabled = r.params.filter((p) => !p.enabled);
      const rows = [...fromUrl, ...disabled];
      return { ...r, url: value, params: rows.length ? rows : [newRow()] };
    });
  };
  const onParamsChange = (rows) => {
    setReq((r) => ({ ...r, params: rows, url: buildUrl(r.url, rows) }));
  };

  /* Import cURL */
  const applyCurl = (text, sendNow) => {
    try {
      const parsed = parseCurl(text);
      const next = {
        ...parsed,
        params: parsed.params.length ? [...parsed.params, newRow()] : [newRow()],
        headers: [...parsed.headers, newRow()],
        fields: parsed.fields.length ? [...parsed.fields, newRow()] : [newRow()],
      };
      setReq(next);
      setImportError("");
      setShowImport(false);
      setImportText("");
      if (parsed.bodyType !== "none") setTab("body");
      else if (parsed.params.length) setTab("params");
      else setTab("headers");
      say("cURL imported");
      if (sendNow) send(next);
      return true;
    } catch (e) {
      setImportError(e.message);
      return false;
    }
  };

  const onUrlPaste = (e) => {
    const text = e.clipboardData?.getData("text") || "";
    if (/^\s*curl\s/i.test(text)) {
      e.preventDefault();
      if (!applyCurl(text, true)) {
        setImportText(text);
        setShowImport(true);
      }
    }
  };

  /* Send */
  const send = async (r = req) => {
    if (!r.url.trim()) {
      say("Enter a URL first");
      return;
    }
    // Results go to the tab that sent the request, even if the user switches away.
    const tabId = cur.id;
    const setRes = (v) => updateTab(tabId, () => ({ res: v }));
    abortRef.current.get(tabId)?.abort();
    const ctrl = new AbortController();
    abortRef.current.set(tabId, ctrl);
    updateTab(tabId, () => ({ resTab: "body" }));
    setRes({ loading: true });

    const url = normalizeUrl(r.url);
    let init;
    try {
      const headers = new Headers();
      let list = effectiveHeaders(r);
      if (r.bodyType === "formdata") list = list.filter(([k]) => k.toLowerCase() !== "content-type");
      list.forEach(([k, v]) => headers.append(k, v));
      let body;
      if (canHaveBody(r.method)) {
        const rows = r.fields.filter((x) => x.enabled && x.key.trim());
        if ((r.bodyType === "json" || r.bodyType === "text") && r.body) body = r.body;
        if (r.bodyType === "urlencoded") body = new URLSearchParams(rows.map((x) => [x.key, x.value])).toString();
        if (r.bodyType === "formdata") {
          body = new FormData();
          rows.forEach((x) => body.append(x.key, x.value));
        }
      }
      init = { method: r.method, headers, body, signal: ctrl.signal, redirect: "follow" };
    } catch (e) {
      setRes({ error: `Invalid request: ${e.message}` });
      return;
    }

    const t0 = performance.now();
    try {
      let resp;
      let finalUrl = url;
      if (useProxy) {
        const ph = new Headers(init.headers);
        ph.set("x-dispatch-url", url);
        const pr = await fetch("/__proxy", { ...init, headers: ph });
        if (pr.headers.get("x-dispatch-proxy-error")) {
          const j = await pr.json().catch(() => ({}));
          setRes({ error: j.error || "Proxy request failed" });
          return;
        }
        const st = pr.headers.get("x-dispatch-status-text");
        const fu = pr.headers.get("x-dispatch-final-url");
        if (fu) finalUrl = decodeURIComponent(fu);
        resp = {
          status: pr.status,
          statusText: st ? decodeURIComponent(st) : "",
          headers: pr.headers,
          url: finalUrl,
          arrayBuffer: () => pr.arrayBuffer(),
        };
      } else {
        resp = await fetch(url, init);
      }
      const buf = await resp.arrayBuffer();
      const time = Math.round(performance.now() - t0);
      const text = new TextDecoder().decode(buf);
      let pretty = null;
      if (/^\s*[{[]/.test(text) || (resp.headers.get("content-type") || "").includes("json")) {
        try {
          pretty = JSON.stringify(JSON.parse(text), null, 2);
        } catch {
          pretty = null;
        }
      }
      const hdrs = [];
      resp.headers.forEach((v, k) => hdrs.push([k, v]));
      setRes({
        status: resp.status,
        statusText: resp.statusText,
        time,
        size: buf.byteLength,
        headers: hdrs,
        text,
        pretty,
        url: resp.url || url,
      });
      setHistory((h) =>
        [{ id: uid(), req: structuredClone(r), status: resp.status, time, at: Date.now() }, ...h].slice(0, 30)
      );
      if (resp.status >= 200 && resp.status < 300) {
        const curl = toCurl(r);
        setSaved((s) =>
          [
            { id: uid(), curl, req: structuredClone(r), status: resp.status, time, at: Date.now() },
            ...s.filter((x) => x.curl !== curl),
          ].slice(0, 200)
        );
      }
    } catch (e) {
      if (e.name === "AbortError") {
        setRes({ cancelled: true });
      } else {
        setRes({
          error: e.message || "Request failed",
          hint: "The browser couldn’t complete this request. Common causes: the server doesn’t allow cross-origin (CORS) requests, the host can’t be reached, or the URL is invalid. Browsers can’t bypass CORS — turn on “Proxy” next to Send to route the request through the server.",
        });
      }
    } finally {
      if (abortRef.current.get(tabId) === ctrl) abortRef.current.delete(tabId);
    }
  };

  const cancel = () => abortRef.current.get(cur.id)?.abort();
  const loading = res?.loading;

  const curlText = useMemo(() => toCurl(req), [req]);
  const countRows = (rows) => rows.filter((r) => r.enabled && r.key.trim()).length;
  const autoHeaders = effectiveHeaders(req).slice(manualHeaders(req).length);

  const jsonInvalid = useMemo(() => {
    if (req.bodyType !== "json" || !req.body.trim()) return null;
    try {
      JSON.parse(req.body);
      return false;
    } catch (e) {
      return e.message;
    }
  }, [req.bodyType, req.body]);

  const beautify = () => {
    try {
      patch({ body: JSON.stringify(JSON.parse(req.body), null, 2) });
    } catch {
      say("Body isn’t valid JSON");
    }
  };

  const statusClass = res?.status >= 500 ? "bad" : res?.status >= 400 ? "bad" : res?.status >= 300 ? "warn" : "good";

  const tabs = [
    { id: "params", label: "Params", count: countRows(req.params) },
    { id: "auth", label: "Auth", dot: req.auth.type !== "none" },
    { id: "headers", label: "Headers", count: countRows(req.headers) },
    { id: "body", label: "Body", dot: req.bodyType !== "none" },
    { id: "curl", label: "cURL" },
  ];

  return (
    <div className="pm">
      <style>{css}</style>

      <datalist id="dl-headers">
        {COMMON_HEADERS.map((h) => <option key={h} value={h} />)}
      </datalist>
      <datalist id="dl-ct">
        {CONTENT_TYPES.map((h) => <option key={h} value={h} />)}
      </datalist>
      <datalist id="dl-accept">
        {ACCEPT_VALUES.map((h) => <option key={h} value={h} />)}
      </datalist>

      {/* Top bar */}
      <header className="top">
        <div className="brand">
          <span className="mark" aria-hidden="true">
            <Send size={15} />
          </span>
          <span className="brand-name">Dispatch</span>
        </div>
        <div className="top-actions">
          <button className="btn ghost" onClick={() => setShowSaved(true)}>
            <Bookmark size={16} /> Saved
            {saved.length > 0 && <span className="pill">{saved.length}</span>}
          </button>
          <button className="btn ghost" onClick={() => setShowHistory(true)}>
            <History size={16} /> History
            {history.length > 0 && <span className="pill">{history.length}</span>}
          </button>
          <button
            className="btn outline"
            onClick={() => {
              setImportError("");
              setShowImport(true);
            }}
          >
            <Terminal size={16} /> Import cURL
          </button>
        </div>
      </header>

      {/* Request tabs */}
      <div className="tabbar" role="tablist" aria-label="Requests">
        {reqTabs.map((t) => (
          <div
            key={t.id}
            role="tab"
            aria-selected={t.id === activeId}
            tabIndex={0}
            className={`tab-item ${t.id === activeId ? "active" : ""}`}
            title={t.req.url || "New request"}
            onClick={() => setActiveId(t.id)}
            onKeyDown={(e) => e.key === "Enter" && setActiveId(t.id)}
            onAuxClick={(e) => e.button === 1 && closeTab(t.id)}
          >
            <span className="mtag" style={{ color: methodColor(t.req.method) }}>{t.req.method}</span>
            <span className="tab-label">{tabLabel(t.req)}</span>
            {t.res?.loading && <span className="tab-dot" aria-label="Loading" />}
            <button
              className="icon-btn tab-close"
              aria-label="Close tab"
              onClick={(e) => {
                e.stopPropagation();
                closeTab(t.id);
              }}
            >
              <X size={13} />
            </button>
          </div>
        ))}
        <button className="icon-btn tab-add" aria-label="New tab" title="New tab" onClick={() => addTab()}>
          <Plus size={16} />
        </button>
      </div>

      {/* Request bar */}
      <div className="bar">
        <div className="method-wrap" style={{ "--mc": methodColor(req.method) }}>
          <select
            className="method"
            value={req.method}
            aria-label="HTTP method"
            onChange={(e) => patch({ method: e.target.value })}
          >
            {METHODS.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        </div>
        <input
          className="url"
          value={req.url}
          placeholder="Enter a URL, or paste a cURL command"
          spellCheck={false}
          aria-label="Request URL"
          onChange={(e) => onUrlChange(e.target.value)}
          onPaste={onUrlPaste}
          onKeyDown={(e) => e.key === "Enter" && (loading ? null : send())}
        />
        <label className="proxy-toggle" title="Send via the server-side proxy to bypass CORS">
          <input type="checkbox" checked={useProxy} onChange={(e) => setUseProxy(e.target.checked)} /> Proxy
        </label>
        {loading ? (
          <button className="btn danger send" onClick={cancel}>
            <Square size={14} /> Cancel
          </button>
        ) : (
          <button className="btn primary send" onClick={() => send()}>
            <Send size={15} /> Send
          </button>
        )}
      </div>

      <main className="grid">
        {/* Request panel */}
        <section className="card">
          <div className="tabs" role="tablist">
            {tabs.map((t) => (
              <button
                key={t.id}
                role="tab"
                aria-selected={tab === t.id}
                className={`tab${tab === t.id ? " on" : ""}`}
                onClick={() => setTab(t.id)}
              >
                {t.label}
                {t.count > 0 && <span className="count">{t.count}</span>}
                {t.dot && <span className="dot" />}
              </button>
            ))}
          </div>

          <div className="panel">
            {tab === "params" && (
              <>
                <p className="hint">Query parameters stay in sync with the URL above.</p>
                <KVEditor rows={req.params} onChange={onParamsChange} keyPlaceholder="Parameter" />
              </>
            )}

            {tab === "auth" && (
              <div className="auth">
                <label className="field">
                  <span>Type</span>
                  <select
                    className="input"
                    value={req.auth.type}
                    onChange={(e) => patch({ auth: { ...req.auth, type: e.target.value } })}
                  >
                    <option value="none">No auth</option>
                    <option value="bearer">Bearer token</option>
                    <option value="basic">Basic auth</option>
                  </select>
                </label>
                {req.auth.type === "bearer" && (
                  <label className="field">
                    <span>Token</span>
                    <input
                      className="input mono"
                      value={req.auth.token}
                      placeholder="eyJhbGciOi…"
                      spellCheck={false}
                      onChange={(e) => patch({ auth: { ...req.auth, token: e.target.value } })}
                    />
                  </label>
                )}
                {req.auth.type === "basic" && (
                  <>
                    <label className="field">
                      <span>Username</span>
                      <input
                        className="input"
                        value={req.auth.user}
                        onChange={(e) => patch({ auth: { ...req.auth, user: e.target.value } })}
                      />
                    </label>
                    <label className="field">
                      <span>Password</span>
                      <input
                        className="input"
                        type="password"
                        value={req.auth.pass}
                        onChange={(e) => patch({ auth: { ...req.auth, pass: e.target.value } })}
                      />
                    </label>
                  </>
                )}
                {req.auth.type === "none" && (
                  <p className="hint">Choose a type to add an Authorization header automatically.</p>
                )}
              </div>
            )}

            {tab === "headers" && (
              <>
                <KVEditor
                  rows={req.headers}
                  onChange={(rows) => patch({ headers: rows })}
                  keyList="dl-headers"
                  keyPlaceholder="Header"
                  valueListFor={(k) => {
                    const l = k.trim().toLowerCase();
                    if (l === "content-type") return "dl-ct";
                    if (l === "accept") return "dl-accept";
                    return undefined;
                  }}
                />
                {autoHeaders.length > 0 && (
                  <div className="auto">
                    <div className="auto-title">Added automatically</div>
                    {autoHeaders.map(([k, v]) => (
                      <div className="auto-row" key={k}>
                        <span>{k}</span>
                        <span className="mono">{v.length > 48 ? `${v.slice(0, 48)}…` : v}</span>
                      </div>
                    ))}
                  </div>
                )}
                <p className="hint">Browsers ignore some headers, such as Cookie, Host and Origin.</p>
              </>
            )}

            {tab === "body" && (
              <>
                <div className="seg" role="radiogroup" aria-label="Body type">
                  {BODY_TYPES.map((b) => (
                    <button
                      key={b.id}
                      role="radio"
                      aria-checked={req.bodyType === b.id}
                      className={req.bodyType === b.id ? "on" : ""}
                      onClick={() => patch({ bodyType: b.id })}
                    >
                      {b.label}
                    </button>
                  ))}
                </div>

                {!canHaveBody(req.method) && req.bodyType !== "none" && (
                  <p className="hint warn-text">
                    {req.method} requests don’t send a body. Switch the method to POST, PUT or PATCH.
                  </p>
                )}

                {req.bodyType === "none" && <p className="hint">This request has no body.</p>}

                {(req.bodyType === "json" || req.bodyType === "text") && (
                  <div className="editor">
                    <textarea
                      className="code-area"
                      value={req.body}
                      spellCheck={false}
                      placeholder={req.bodyType === "json" ? '{\n  "name": "Ada"\n}' : "Plain text body"}
                      onChange={(e) => patch({ body: e.target.value })}
                    />
                    {req.bodyType === "json" && (
                      <div className="editor-foot">
                        <span className={`validity ${jsonInvalid === false ? "ok" : jsonInvalid ? "err" : ""}`}>
                          {jsonInvalid === false && "Valid JSON"}
                          {jsonInvalid && `Invalid JSON: ${jsonInvalid}`}
                        </span>
                        <button className="btn ghost sm" onClick={beautify}>
                          <Wand2 size={14} /> Beautify
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {(req.bodyType === "urlencoded" || req.bodyType === "formdata") && (
                  <KVEditor rows={req.fields} onChange={(rows) => patch({ fields: rows })} keyPlaceholder="Field" />
                )}
              </>
            )}

            {tab === "curl" && (
              <>
                <div className="row-between">
                  <p className="hint nm">The request as a cURL command.</p>
                  <CopyButton text={curlText} />
                </div>
                <pre className="code">{curlText}</pre>
              </>
            )}
          </div>
        </section>

        {/* Response panel */}
        <section className="card">
          <div className="res-head">
            <div className="tabs" role="tablist">
              <button className={`tab${resTab === "body" ? " on" : ""}`} onClick={() => setResTab("body")}>
                Body
              </button>
              <button className={`tab${resTab === "headers" ? " on" : ""}`} onClick={() => setResTab("headers")}>
                Headers
                {res?.headers && <span className="count">{res.headers.length}</span>}
              </button>
            </div>
            {res?.status !== undefined && (
              <div className="meta">
                <span className={`status ${statusClass}`}>
                  {res.status} {res.statusText}
                </span>
                <span>{res.time} ms</span>
                <span>{formatBytes(res.size)}</span>
              </div>
            )}
          </div>

          <div className="panel res-panel">
            {!res && (
              <div className="empty">
                <Inbox size={28} strokeWidth={1.5} />
                <h3>No response yet</h3>
                <p>Press Send, or paste a cURL command into the URL bar to run it right away.</p>
                <div className="chips">
                  {SAMPLES.map((s) => (
                    <button key={s.label} className="chip" onClick={() => applyCurl(s.cmd, true)}>
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {loading && (
              <div className="empty">
                <span className="spinner" />
                <p>Waiting for a response…</p>
              </div>
            )}

            {res?.cancelled && (
              <div className="empty">
                <p>Request cancelled.</p>
              </div>
            )}

            {res?.error && (
              <div className="error">
                <AlertTriangle size={18} />
                <div>
                  <strong>{res.error}</strong>
                  {res.hint && <p>{res.hint}</p>}
                </div>
              </div>
            )}

            {res?.status !== undefined && resTab === "body" && (
              <>
                <div className="row-between">
                  <div className="seg small">
                    <button className={view === "pretty" ? "on" : ""} onClick={() => setView("pretty")}>Pretty</button>
                    <button className={view === "raw" ? "on" : ""} onClick={() => setView("raw")}>Raw</button>
                  </div>
                  <CopyButton text={() => (view === "pretty" && res.pretty ? res.pretty : res.text)} />
                </div>
                {res.text === "" ? (
                  <p className="hint">The response has no body.</p>
                ) : view === "pretty" && res.pretty ? (
                  <pre
                    className="code scroll"
                    dangerouslySetInnerHTML={{
                      __html: res.pretty.length > 400000 ? res.pretty.replace(/</g, "&lt;") : highlightJson(res.pretty),
                    }}
                  />
                ) : (
                  <pre className="code scroll">{res.text}</pre>
                )}
              </>
            )}

            {res?.status !== undefined && resTab === "headers" && (
              <div className="hdr-table">
                {res.headers.length === 0 && (
                  <p className="hint">No readable headers. Cross-origin responses only expose headers the server allows.</p>
                )}
                {res.headers.map(([k, v]) => (
                  <div className="hdr-row" key={k}>
                    <span className="hdr-k">{k}</span>
                    <span className="hdr-v mono">{v}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      </main>

      {/* Saved drawer */}
      {showSaved && (
        <div className="overlay" onClick={() => setShowSaved(false)}>
          <aside className="drawer" onClick={(e) => e.stopPropagation()}>
            <div className="drawer-head">
              <h2>Saved cURLs</h2>
              <div>
                {saved.length > 0 && (
                  <button className="btn ghost sm" onClick={() => setSaved([])}>Clear</button>
                )}
                <button className="icon-btn" aria-label="Close saved" onClick={() => setShowSaved(false)}>
                  <X size={18} />
                </button>
              </div>
            </div>
            {saved.length === 0 ? (
              <p className="hint pad">Requests that succeed (2xx) are saved here and kept in this browser.</p>
            ) : (
              <ul className="hist">
                {saved.map((s) => (
                  <li key={s.id}>
                    <button
                      onClick={() => {
                        setReq(structuredClone(s.req));
                        setShowSaved(false);
                      }}
                    >
                      <span className="mtag" style={{ color: methodColor(s.req.method) }}>{s.req.method}</span>
                      <span className="hist-url">{s.req.url}</span>
                      <span className="hist-status good">{s.status} · {s.time} ms</span>
                    </button>
                    <div className="saved-actions">
                      <button
                        className="btn ghost sm"
                        onClick={() => {
                          addTab(structuredClone(s.req));
                          setShowSaved(false);
                        }}
                      >
                        <Plus size={14} /> New tab
                      </button>
                      <CopyButton text={s.curl} label="Copy cURL" />
                      <button
                        className="btn ghost sm"
                        aria-label="Delete saved request"
                        onClick={() => setSaved((x) => x.filter((y) => y.id !== s.id))}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </aside>
        </div>
      )}

      {/* History drawer */}
      {showHistory && (
        <div className="overlay" onClick={() => setShowHistory(false)}>
          <aside className="drawer" onClick={(e) => e.stopPropagation()}>
            <div className="drawer-head">
              <h2>History</h2>
              <div>
                {history.length > 0 && (
                  <button className="btn ghost sm" onClick={() => setHistory([])}>Clear</button>
                )}
                <button className="icon-btn" aria-label="Close history" onClick={() => setShowHistory(false)}>
                  <X size={18} />
                </button>
              </div>
            </div>
            {history.length === 0 ? (
              <p className="hint pad">Requests you send appear here and are kept in this browser.</p>
            ) : (
              <ul className="hist">
                {history.map((h) => (
                  <li key={h.id}>
                    <button
                      onClick={() => {
                        setReq(h.req);
                        setShowHistory(false);
                      }}
                    >
                      <span className="mtag" style={{ color: methodColor(h.req.method) }}>{h.req.method}</span>
                      <span className="hist-url">{h.req.url}</span>
                      <span className={`hist-status ${h.status >= 400 ? "bad" : h.status >= 300 ? "warn" : "good"}`}>
                        {h.status} · {h.time} ms
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </aside>
        </div>
      )}

      {/* Import modal */}
      {showImport && (
        <div className="overlay center" onClick={() => setShowImport(false)}>
          <div className="modal" role="dialog" aria-label="Import cURL" onClick={(e) => e.stopPropagation()}>
            <div className="drawer-head">
              <h2>Import cURL</h2>
              <button className="icon-btn" aria-label="Close" onClick={() => setShowImport(false)}>
                <X size={18} />
              </button>
            </div>
            <p className="hint nm">
              Paste a cURL command. The method, URL, params, headers and body are filled in for you.
            </p>
            <textarea
              className="code-area tall"
              autoFocus
              value={importText}
              spellCheck={false}
              placeholder={`curl -X POST https://api.example.com/users \\\n  -H 'Content-Type: application/json' \\\n  -d '{"name":"Ada"}'`}
              onChange={(e) => {
                setImportText(e.target.value);
                setImportError("");
              }}
            />
            {importError && <p className="hint err-text">{importError}</p>}
            <div className="chips left">
              {SAMPLES.map((s) => (
                <button key={s.label} className="chip" onClick={() => setImportText(s.cmd)}>
                  {s.label}
                </button>
              ))}
            </div>
            <div className="modal-foot">
              <button className="btn ghost" onClick={() => setShowImport(false)}>Cancel</button>
              <button className="btn outline" disabled={!importText.trim()} onClick={() => applyCurl(importText, false)}>
                Import
              </button>
              <button className="btn primary" disabled={!importText.trim()} onClick={() => applyCurl(importText, true)}>
                <Send size={14} /> Import and send
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Styles                                                              */
/* ------------------------------------------------------------------ */

const css = `
@import url('https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap');

.pm {
  --bg: #F1F4F8;
  --surface: #FFFFFF;
  --soft: #F6F8FB;
  --ink: #131A26;
  --muted: #667085;
  --line: #E2E7EF;
  --line-strong: #CBD3DF;
  --accent: #0F6E7A;
  --accent-hover: #0B5963;
  --accent-soft: #E1F0F2;
  --good: #11805B;
  --good-bg: #E2F4EC;
  --warn: #A66A0A;
  --warn-bg: #FBF0DA;
  --bad: #C73636;
  --bad-bg: #FBE6E6;
  --m-get: #11805B;
  --m-post: #B7791F;
  --m-put: #2563EB;
  --m-patch: #7C3AED;
  --m-delete: #C73636;
  --m-head: #667085;
  --m-options: #667085;
  --mono: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-family: 'Manrope', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif;
  font-size: 14px;
  line-height: 1.5;
  color: var(--ink);
  background: var(--bg);
  min-height: 100vh;
  padding: 16px 20px 28px;
  box-sizing: border-box;
}
.pm *, .pm *::before, .pm *::after { box-sizing: border-box; }
.pm button, .pm input, .pm select, .pm textarea { font: inherit; color: inherit; }
.pm :focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.pm .mono { font-family: var(--mono); font-size: 12.5px; }

/* Top */
.pm .top { display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px; }
.pm .brand { display: flex; align-items: center; gap: 10px; }
.pm .mark { width: 28px; height: 28px; border-radius: 8px; background: var(--accent); color: #fff; display: grid; place-items: center; }
.pm .brand-name { font-weight: 700; font-size: 16px; letter-spacing: -0.01em; }
.pm .top-actions { display: flex; gap: 8px; }

/* Buttons */
.pm .btn { display: inline-flex; align-items: center; gap: 7px; height: 36px; padding: 0 14px; border-radius: 8px; border: 1px solid transparent; background: none; cursor: pointer; font-weight: 600; white-space: nowrap; transition: background .12s, border-color .12s; }
.pm .btn:disabled { opacity: .45; cursor: not-allowed; }
.pm .btn.sm { height: 30px; padding: 0 10px; font-size: 13px; }
.pm .btn.primary { background: var(--accent); color: #fff; }
.pm .btn.primary:hover:not(:disabled) { background: var(--accent-hover); }
.pm .btn.danger { background: var(--bad); color: #fff; }
.pm .btn.outline { border-color: var(--line-strong); background: var(--surface); }
.pm .btn.outline:hover:not(:disabled) { background: var(--soft); }
.pm .btn.ghost { color: var(--muted); }
.pm .btn.ghost:hover:not(:disabled) { background: rgba(19,26,38,.06); color: var(--ink); }
.pm .btn.add { margin-top: 6px; }
.pm .pill { background: var(--accent-soft); color: var(--accent); font-size: 11.5px; font-weight: 700; padding: 0 7px; border-radius: 99px; }
.pm .icon-btn { display: grid; place-items: center; width: 30px; height: 30px; border: 0; background: none; border-radius: 6px; color: var(--muted); cursor: pointer; }
.pm .icon-btn:hover { background: rgba(19,26,38,.07); color: var(--ink); }

/* Request bar */
.pm .bar { display: flex; gap: 0; background: var(--surface); border: 1px solid var(--line-strong); border-radius: 10px; padding: 5px; align-items: stretch; margin-bottom: 14px; box-shadow: 0 1px 2px rgba(19,26,38,.04); }
.pm .bar:focus-within { border-color: var(--accent); }
.pm .method-wrap { position: relative; border-right: 1px solid var(--line); padding-right: 4px; margin-right: 4px; display: flex; }
.pm .method { appearance: none; -webkit-appearance: none; border: 0; background: transparent; font-weight: 700; color: var(--mc); padding: 0 28px 0 12px; height: 38px; cursor: pointer; border-radius: 6px; font-size: 14px; letter-spacing: .01em;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23667085' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E");
  background-repeat: no-repeat; background-position: right 9px center; }
.pm .method:hover { background-color: var(--soft); }
.pm .method option { color: var(--ink); font-weight: 500; }
.pm .url { flex: 1; min-width: 0; border: 0; background: transparent; padding: 0 10px; font-family: var(--mono); font-size: 13.5px; outline: none; }
.pm .url::placeholder { color: #98A2B3; font-family: 'Manrope', system-ui, sans-serif; }
.pm .send { height: 38px; padding: 0 20px; }
.pm .proxy-toggle { display: flex; align-items: center; gap: 5px; font-size: 12.5px; font-weight: 600; color: var(--mute, #667085); cursor: pointer; user-select: none; padding: 0 4px; }

/* Layout */
.pm .grid { display: grid; grid-template-columns: 1fr; gap: 14px; align-items: start; }
@media (min-width: 1040px) { .pm .grid { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); } }
.pm .card { background: var(--surface); border: 1px solid var(--line); border-radius: 12px; overflow: hidden; min-height: 420px; display: flex; flex-direction: column; }
.pm .panel { padding: 16px; flex: 1; }

/* Tabs */
.pm .tabs { display: flex; gap: 2px; padding: 0 10px; border-bottom: 1px solid var(--line); overflow-x: auto; }
.pm .res-head .tabs { border-bottom: 0; padding: 0; }
.pm .res-head { display: flex; justify-content: space-between; align-items: center; padding: 0 16px 0 10px; border-bottom: 1px solid var(--line); gap: 12px; flex-wrap: wrap; }
.pm .tab { position: relative; display: inline-flex; align-items: center; gap: 6px; height: 44px; padding: 0 12px; border: 0; background: none; color: var(--muted); font-weight: 600; cursor: pointer; white-space: nowrap; }
.pm .tab:hover { color: var(--ink); }
.pm .tab.on { color: var(--ink); }
.pm .tab.on::after { content: ""; position: absolute; left: 10px; right: 10px; bottom: -1px; height: 2px; background: var(--accent); border-radius: 2px; }
.pm .count { background: var(--accent-soft); color: var(--accent); font-size: 11.5px; font-weight: 700; padding: 0 6px; border-radius: 99px; line-height: 18px; }
.pm .dot { width: 6px; height: 6px; border-radius: 50%; background: var(--accent); }

/* Key/value editor */
.pm .kv-head, .pm .kv-row { display: grid; grid-template-columns: 22px 1fr 1fr 30px; gap: 8px; align-items: center; }
.pm .kv-head { font-size: 12px; color: var(--muted); font-weight: 600; padding: 0 0 6px; }
.pm .kv-row { margin-bottom: 6px; }
.pm .kv-row.off .cell { opacity: .5; }
.pm .kv input[type="checkbox"] { width: 16px; height: 16px; accent-color: var(--accent); margin: 0 3px; cursor: pointer; }
.pm .cell, .pm .input { width: 100%; height: 36px; padding: 0 10px; border: 1px solid var(--line); border-radius: 7px; background: var(--surface); font-family: var(--mono); font-size: 12.5px; }
.pm .input { font-family: inherit; font-size: 14px; }
.pm .input.mono { font-family: var(--mono); font-size: 12.5px; }
.pm .cell:hover, .pm .input:hover { border-color: var(--line-strong); }
.pm .cell:focus, .pm .input:focus { border-color: var(--accent); outline: none; box-shadow: 0 0 0 3px var(--accent-soft); }
.pm .cell::placeholder { color: #A3ACBA; font-family: 'Manrope', system-ui, sans-serif; }

.pm .hint { color: var(--muted); font-size: 13px; margin: 0 0 12px; }
.pm .hint.nm { margin: 0; }
.pm .hint.pad { padding: 16px; }
.pm .hint.warn-text { color: var(--warn); }
.pm .hint.err-text { color: var(--bad); margin: 8px 0 0; }
.pm .row-between { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; gap: 10px; }

.pm .auto { margin-top: 14px; padding: 10px 12px; background: var(--soft); border-radius: 8px; }
.pm .auto-title { font-size: 12px; font-weight: 600; color: var(--muted); margin-bottom: 4px; }
.pm .auto-row { display: grid; grid-template-columns: 150px 1fr; gap: 8px; padding: 3px 0; font-size: 13px; }
.pm .auto + .hint { margin-top: 12px; }
.pm .kv + .hint { margin-top: 14px; }

/* Auth */
.pm .auth { display: grid; gap: 14px; max-width: 420px; }
.pm .field { display: grid; gap: 5px; }
.pm .field > span { font-size: 12.5px; font-weight: 600; color: var(--muted); }

/* Segmented control */
.pm .seg { display: inline-flex; background: var(--soft); border: 1px solid var(--line); border-radius: 9px; padding: 3px; margin-bottom: 14px; flex-wrap: wrap; }
.pm .seg button { border: 0; background: none; padding: 5px 12px; border-radius: 6px; font-weight: 600; font-size: 13px; color: var(--muted); cursor: pointer; }
.pm .seg button:hover { color: var(--ink); }
.pm .seg button.on { background: var(--surface); color: var(--ink); box-shadow: 0 1px 2px rgba(19,26,38,.12); }
.pm .seg.small { margin-bottom: 0; }
.pm .seg.small button { padding: 3px 10px; }

/* Editors & code */
.pm .editor { border: 1px solid var(--line); border-radius: 8px; overflow: hidden; }
.pm .editor:focus-within { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
.pm .code-area { width: 100%; min-height: 220px; border: 0; padding: 12px; font-family: var(--mono); font-size: 12.5px; line-height: 1.6; resize: vertical; background: var(--surface); outline: none; display: block; }
.pm .code-area.tall { min-height: 170px; border: 1px solid var(--line); border-radius: 8px; }
.pm .code-area.tall:focus { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
.pm .editor-foot { display: flex; justify-content: space-between; align-items: center; padding: 6px 8px 6px 12px; border-top: 1px solid var(--line); background: var(--soft); min-height: 42px; }
.pm .validity { font-size: 12.5px; font-weight: 600; }
.pm .validity.ok { color: var(--good); }
.pm .validity.err { color: var(--bad); }
.pm .code { margin: 0; padding: 14px; background: var(--soft); border: 1px solid var(--line); border-radius: 8px; font-family: var(--mono); font-size: 12.5px; line-height: 1.65; white-space: pre-wrap; word-break: break-word; overflow: auto; }
.pm .code.scroll { max-height: 520px; }
.pm .j-key { color: #0B5F8A; }
.pm .j-str { color: #1B7F4B; }
.pm .j-num { color: #B4540A; }
.pm .j-bool { color: #7C3AED; }
.pm .j-null { color: #98A2B3; }

/* Response */
.pm .meta { display: flex; gap: 14px; align-items: center; color: var(--muted); font-size: 13px; font-weight: 500; padding: 8px 0; }
.pm .status { font-weight: 700; padding: 2px 9px; border-radius: 6px; }
.pm .status.good { background: var(--good-bg); color: var(--good); }
.pm .status.warn { background: var(--warn-bg); color: var(--warn); }
.pm .status.bad { background: var(--bad-bg); color: var(--bad); }
.pm .res-panel { min-height: 300px; }
.pm .empty { display: grid; justify-items: center; text-align: center; gap: 6px; padding: 48px 16px; color: var(--muted); }
.pm .empty h3 { margin: 6px 0 0; color: var(--ink); font-size: 15px; }
.pm .empty p { margin: 0; max-width: 340px; }
.pm .chips { display: flex; gap: 8px; flex-wrap: wrap; justify-content: center; margin-top: 12px; }
.pm .chips.left { justify-content: flex-start; margin: 12px 0 0; }
.pm .chip { border: 1px solid var(--line-strong); background: var(--surface); border-radius: 99px; padding: 4px 12px; font-size: 13px; font-weight: 600; cursor: pointer; }
.pm .chip:hover { border-color: var(--accent); color: var(--accent); }
.pm .spinner { width: 22px; height: 22px; border: 2.5px solid var(--line); border-top-color: var(--accent); border-radius: 50%; animation: pm-spin .7s linear infinite; }
@keyframes pm-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .pm .spinner { animation-duration: 2s; } }
.pm .error { display: flex; gap: 12px; padding: 14px; background: var(--bad-bg); color: #7E1D1D; border-radius: 8px; }
.pm .error svg { flex-shrink: 0; margin-top: 2px; color: var(--bad); }
.pm .error p { margin: 4px 0 0; font-size: 13px; line-height: 1.55; }

.pm .hdr-table { border: 1px solid var(--line); border-radius: 8px; overflow: hidden; }
.pm .hdr-row { display: grid; grid-template-columns: minmax(120px, 200px) 1fr; gap: 12px; padding: 8px 12px; border-bottom: 1px solid var(--line); }
.pm .hdr-row:last-child { border-bottom: 0; }
.pm .hdr-row:nth-child(even) { background: var(--soft); }
.pm .hdr-k { font-weight: 600; word-break: break-word; }
.pm .hdr-v { word-break: break-all; }

/* Drawer & modal */
.pm .overlay { position: fixed; inset: 0; background: rgba(19,26,38,.35); z-index: 50; display: flex; }
.pm .overlay.center { align-items: center; justify-content: center; padding: 16px; }
.pm .drawer { width: min(380px, 100%); background: var(--surface); height: 100%; overflow-y: auto; box-shadow: 4px 0 24px rgba(19,26,38,.18); }
.pm .drawer-head { display: flex; justify-content: space-between; align-items: center; padding: 14px 16px; }
.pm .modal .drawer-head { padding: 0 0 8px; }
.pm .drawer-head h2 { font-size: 16px; margin: 0; }
.pm .hist { list-style: none; margin: 0; padding: 0 8px 16px; }
.pm .hist li > button { width: 100%; display: grid; grid-template-columns: auto 1fr; gap: 2px 10px; text-align: left; padding: 10px; border: 0; background: none; border-radius: 8px; cursor: pointer; }
.pm .hist li > button:hover { background: var(--soft); }
.pm .mtag { font-weight: 700; font-size: 12px; grid-row: 1; }
.pm .hist-url { font-family: var(--mono); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pm .hist-status { grid-column: 2; font-size: 12px; font-weight: 600; }
.pm .hist-status.good { color: var(--good); }
.pm .hist-status.warn { color: var(--warn); }
.pm .hist-status.bad { color: var(--bad); }
.pm .saved-actions { display: flex; gap: 4px; padding: 0 10px 8px; justify-content: flex-end; }

/* Request tabs */
.pm .tabbar { display: flex; align-items: center; gap: 4px; margin-bottom: 8px; overflow-x: auto; }
.pm .tab-item { display: flex; align-items: center; gap: 7px; max-width: 220px; min-width: 120px; height: 34px; padding: 0 4px 0 12px; border: 1px solid var(--line); border-radius: 8px; background: var(--soft); cursor: pointer; flex: 0 0 auto; font-size: 12.5px; }
.pm .tab-item:hover { background: var(--surface); }
.pm .tab-item.active { background: var(--surface); border-color: var(--line-strong); box-shadow: 0 1px 2px rgba(19,26,38,.06); }
.pm .tab-item .mtag { grid-row: auto; font-size: 11px; }
.pm .tab-label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: var(--mono); }
.pm .tab-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--accent); flex: none; }
.pm .tab-close { width: 22px; height: 22px; flex: none; }
.pm .tab-add { flex: none; }
.pm .modal { width: min(640px, 100%); background: var(--surface); border-radius: 14px; padding: 18px; box-shadow: 0 20px 60px rgba(19,26,38,.3); max-height: 92vh; overflow-y: auto; }
.pm .modal .hint { margin-bottom: 12px; }
.pm .modal-foot { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; flex-wrap: wrap; }
.pm .toast { position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%); background: var(--ink); color: #fff; padding: 9px 16px; border-radius: 8px; font-weight: 600; font-size: 13px; z-index: 60; }

@media (max-width: 640px) {
  .pm { padding: 12px; }
  .pm .bar { flex-wrap: wrap; gap: 6px; }
  .pm .url { flex-basis: 100%; order: 3; height: 38px; border-top: 1px solid var(--line); border-radius: 0; }
  .pm .method-wrap { border-right: 0; }
  .pm .send { margin-left: auto; }
  .pm .kv-head, .pm .kv-row { grid-template-columns: 20px 1fr 1fr 28px; gap: 6px; }
  .pm .hdr-row { grid-template-columns: 1fr; gap: 2px; }
  .pm .auto-row { grid-template-columns: 1fr; }
}
`;
