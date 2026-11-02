// Cloudflare Pages Function: serves /__proxy for every HTTP method.
import { proxy } from "../worker/proxy.js";

export const onRequest = ({ request }) => proxy(request);
