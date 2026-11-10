// Customer links staff copy or send. Backend mode asks the database for a revocable token (RPC share_link);
// demo mode links straight to the record id.
import { useEffect, useState } from 'react';
import { isBackend } from '../store';
import { customerUrl, type LinkKind } from './publicApi';
import { supabase } from './sync';

const cache = new Map<string, Promise<string>>();

/** Customer URL for a record; resolves to a token link in backend mode. */
export function shareLink(kind: LinkKind, targetId: string): Promise<string> {
  if (!isBackend) return Promise.resolve(customerUrl(kind, targetId));
  const key = `${kind}:${targetId}`;
  let p = cache.get(key);
  if (!p) {
    p = (async () => {
      const { data, error } = await supabase().rpc('share_link', { p_kind: kind, p_target: targetId });
      if (error || !data) throw new Error(error?.message ?? 'Could not create the link');
      return customerUrl(kind, String(data));
    })();
    p.catch(() => cache.delete(key));
    cache.set(key, p);
  }
  return p;
}

/** The customer URL, or '' while the token is being fetched (backend mode). */
export function useShareLink(kind: LinkKind, targetId: string | undefined): string {
  const [url, setUrl] = useState(() => (!isBackend && targetId ? customerUrl(kind, targetId) : ''));
  useEffect(() => {
    if (!targetId) return setUrl('');
    if (!isBackend) return setUrl(customerUrl(kind, targetId));
    let live = true;
    setUrl('');
    shareLink(kind, targetId)
      .then((u) => live && setUrl(u))
      .catch(() => live && setUrl(''));
    return () => {
      live = false;
    };
  }, [kind, targetId]);
  return url;
}
