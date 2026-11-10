import '../../../styles/settings-auth.css';
import { useState } from 'react';
import { SelectField } from '../../../components/forms';
import { Badge, EmptyState } from '../../../components/ui';
import { fmtDateTime } from '../../../data/domain';
import { useDb } from '../../../data/store';
import type { AuditEntity } from '../../../data/types';

const entityLabel: Record<AuditEntity, string> = { quote: 'Quote', price: 'Price', payment: 'Payment', invoice: 'Invoice' };

/** Field-level before/after for flat objects; falls back to whole values. */
function diff(before: unknown, after: unknown) {
  const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
  if (isObj(before) && isObj(after)) {
    return [...new Set([...Object.keys(before), ...Object.keys(after)])]
      .filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]))
      .map((k) => ({ field: k, before: before[k], after: after[k] }));
  }
  return [{ field: '', before, after }];
}

const show = (v: unknown) => (v === undefined ? '—' : typeof v === 'string' || typeof v === 'number' ? String(v) : JSON.stringify(v));

export function AuditLog() {
  const audit = useDb((d) => d.audit);
  const users = useDb((d) => d.users);
  const [entity, setEntity] = useState<AuditEntity | 'all'>('all');
  const shown = audit.filter((a) => entity === 'all' || a.entity === entity).slice(0, 300);
  const userName = (id: string) => users.find((u) => u.id === id)?.name ?? (id === 'system' ? 'System or customer' : id);

  return (
    <div className="stack" style={{ gap: 16 }}>
      <SelectField id="au-ent" label="Show" value={entity} onChange={setEntity} options={[{ value: 'all', label: 'All changes' }, ...(Object.keys(entityLabel) as AuditEntity[]).map((e) => ({ value: e, label: `${entityLabel[e]} changes` }))]} style={{ maxWidth: 260 }} />
      <section className="card set-log" aria-label="Audit log">
        {shown.length === 0 && <EmptyState title="No changes recorded yet">Changes to quotes, prices and payments appear here.</EmptyState>}
        {shown.map((a) => {
          const changes = a.before !== undefined || a.after !== undefined ? diff(a.before, a.after) : [];
          return (
            <article key={a.id} className="row" style={{ alignItems: 'flex-start', gap: 12, flexWrap: 'wrap', padding: '14px 0' }}>
              <span className="t-small faint set-log__time">
                {fmtDateTime(a.at)}
              </span>
              <div className="row__main" style={{ flex: '1 1 300px' }}>
                <span style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <Badge tone="blue">{entityLabel[a.entity]}</Badge>
                  <span className="strong">{a.summary}</span>
                </span>
                <span className="t-caption faint">by {userName(a.userId)}</span>
                {changes.length > 0 && (
                  <details>
                    <summary>Before and after</summary>
                    <table className="table">
                      <thead>
                        <tr>
                          <th scope="col">Field</th>
                          <th scope="col">Before</th>
                          <th scope="col">After</th>
                        </tr>
                      </thead>
                      <tbody>
                        {changes.map((c) => (
                          <tr key={c.field || 'value'}>
                            <td>{c.field || 'Value'}</td>
                            <td className="muted" style={{ wordBreak: 'break-word', maxWidth: 260 }}>
                              {show(c.before)}
                            </td>
                            <td style={{ wordBreak: 'break-word', maxWidth: 260 }}>{show(c.after)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </details>
                )}
              </div>
            </article>
          );
        })}
      </section>
    </div>
  );
}
