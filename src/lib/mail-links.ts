/** Validate without rewriting signed URLs or fetching their destinations. */
export function safeWebUrl(value: string): string | null {
  if (!/^https?:\/\//i.test(value) || /[\s\u0000-\u001f\u007f\\]/u.test(value)) return null;
  try {
    const url = new URL(value);
    if ((url.protocol !== 'https:' && url.protocol !== 'http:') || !url.hostname || url.username || url.password) return null;
    // An explicit authority is required; URL() would otherwise repair https:///host.
    const authority = value.slice(value.indexOf('://') + 3).split(/[/?#]/, 1)[0];
    if (!authority || authority.includes('@')) return null;
    return value;
  } catch { return null; }
}
