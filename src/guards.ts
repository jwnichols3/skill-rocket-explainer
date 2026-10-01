import type { IncomingMessage } from 'node:http';

export const MUTATION_HEADER = 'x-explainer';

/**
 * Loopback app, no auth. Defends against DNS rebinding (Host allowlist),
 * cross-site requests (Origin allowlist) and simple-request CSRF
 * (custom header on mutations forces a CORS preflight we never answer).
 */
export function checkRequest(req: IncomingMessage, allowedHosts: Set<string>): string | null {
  const host = (req.headers.host ?? '').toLowerCase();
  if (!allowedHosts.has(host) && !allowedHosts.has(host.replace(/:\d+$/, '') + ':*')) return `host not allowed: ${host}`;
  const origin = req.headers.origin;
  if (origin) {
    let originHost: string;
    try { originHost = new URL(origin).host.toLowerCase(); } catch { return 'bad origin'; }
    if (!allowedHosts.has(originHost) && !allowedHosts.has(originHost.replace(/:\d+$/, '') + ':*')) return `origin not allowed: ${origin}`;
  }
  const method = req.method ?? 'GET';
  if (method !== 'GET' && method !== 'HEAD' && req.headers[MUTATION_HEADER] !== '1') return `missing ${MUTATION_HEADER} header`;
  return null;
}

/** Loopback names on the bound port, plus reverse-proxy hostnames on any port. */
export function allowedHostSet(port: number, publicHostnames: string[]): Set<string> {
  const set = new Set([`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`]);
  for (const h of publicHostnames) {
    const name = h.toLowerCase();
    set.add(name);
    set.add(`${name}:*`);
  }
  return set;
}
