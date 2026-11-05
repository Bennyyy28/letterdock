/** Trust the operator-configured origin, never an arbitrary Host/forwarded header. */
export function appOrigin(): string {
  const raw = process.env.LETTERDOCK_ORIGIN;
  if (!raw) throw new Error('Set LETTERDOCK_ORIGIN before starting Letterdock.');
  const url = new URL(raw);
  const loopback = ['localhost','127.0.0.1','[::1]'].includes(url.hostname);
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/' ||
      (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback))) {
    throw new Error('LETTERDOCK_ORIGIN must be an HTTPS origin, or loopback HTTP for local use.');
  }
  return url.origin;
}
export function sameOrigin(request: Request): boolean {
  try {
    const expected = appOrigin();
    if (request.headers.get('sec-fetch-site') === 'cross-site') return false;
    const origin = request.headers.get('origin');
    if (!origin) return request.method === 'GET' || request.method === 'HEAD';
    // Exact serialization prevents credentials, paths, and deceptive suffixes.
    return origin === expected;
  } catch { return false; }
}
