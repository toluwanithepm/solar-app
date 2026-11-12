// Links built from stored data (messages, customer links) only ever use these schemes.
// React 19 already neutralises javascript: URLs; this is a second guard that also blocks data: and other schemes.
const ALLOWED = new Set(['http:', 'https:', 'tel:', 'sms:', 'mailto:']);

export function safeHref(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const u = new URL(url.trim(), 'https://invalid.local');
    return ALLOWED.has(u.protocol) ? u.href : undefined;
  } catch {
    return undefined;
  }
}
