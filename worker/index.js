import { proxy } from "./proxy.js";

export default {
  fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname.startsWith("/__proxy")) return proxy(request);
    return env.ASSETS.fetch(request);
  },
};
