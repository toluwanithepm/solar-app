import { useEffect, useRef, useState } from 'react';
import { Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Dialog } from '../../components/forms';
import { useCan } from '../../components/Guards';
import { Icon } from '../../components/Icon';
import { OfficeShell } from '../../components/OfficeShell';
import { PhotoThumb } from '../../components/PhotoInput';
import { Badge, Button, EmptyState, PageHeader } from '../../components/ui';
import {
  describeSize,
  effectiveSize,
  fmtDate,
  itemLabel,
  lineFromItem,
  naira,
  optionCost,
  optionMarginPct,
  optionTotal,
  quoteValidUntil,
  whatsappLink,
} from '../../data/domain';
import { createQuote, isExpired, saveQuote, setQuoteStatus } from '../../data/salesActions';
import { useShareLink } from '../../data/remote/shareLinks';
import { useDb, uid } from '../../data/store';
import type { Quote, QuoteLine, QuoteOption } from '../../data/types';
import { sendQuote } from '../../data/workflows';
import { quoteTone, WhatsAppButton } from './Quotes';

export function QuoteBuilder() {
  const { quoteId } = useParams();
  if (quoteId === 'new') return <NewQuote />;
  return <QuoteEditor key={quoteId} quoteId={quoteId!} />;
}

/** /office/quotes/new?leadId=…&surveyId=… creates a draft and redirects to it (E4-1). */
function NewQuote() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const canEdit = useCan('edit.quotes');
  const surveys = useDb((d) => d.surveys);
  const created = useRef(false);
  const surveyId = params.get('surveyId') ?? undefined;
  const leadId = params.get('leadId') ?? surveys.find((s) => s.id === surveyId)?.leadId;

  useEffect(() => {
    if (created.current || !canEdit || !leadId) return;
    created.current = true;
    navigate(`/office/quotes/${createQuote(leadId, surveyId)}`, { replace: true });
  }, [canEdit, leadId, surveyId, navigate]);

  if (!canEdit || !leadId) return <Navigate to="/office/quotes" replace />;
  return null;
}

const inputStyle: React.CSSProperties = { height: 40, padding: '0 10px', border: '1px solid var(--border)', borderRadius: 10, background: 'var(--surface)', fontSize: 14, width: '100%' };

function QuoteEditor({ quoteId }: { quoteId: string }) {
  // Customer link (a revocable token in backend mode)
  const link = useShareLink('quote', quoteId);
  const stored = useDb((d) => d.quotes.find((q) => q.id === quoteId));
  const leads = useDb((d) => d.leads);
  const surveys = useDb((d) => d.surveys);
  const priceItems = useDb((d) => d.priceItems);
  const company = useDb((d) => d.company);
  const canEdit = useCan('edit.quotes');
  const canSeeCost = useCan('view.costs');

  const [draft, setDraft] = useState<Quote | undefined>(stored);
  const [tab, setTab] = useState(() => stored?.selectedOptionId ?? stored?.options[Math.min(1, (stored?.options.length ?? 1) - 1)]?.id);
  const [sentOpen, setSentOpen] = useState(false);

  // Pick up changes saved elsewhere (customer accepted, status changed) when there are no local edits
  const dirty = !!draft && !!stored && JSON.stringify(draft) !== JSON.stringify(stored);
  useEffect(() => {
    if (!dirty) setDraft(stored);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stored]);

  if (!stored || !draft) {
    return (
      <OfficeShell>
        <PageHeader title="Quote not found" back={{ to: '/office/quotes', label: 'Quotes' }} />
      </OfficeShell>
    );
  }

  const lead = leads.find((l) => l.id === draft.leadId);
  const survey = surveys.find((s) => s.id === draft.surveyId);
  const editable = canEdit && (draft.status === 'Draft' || draft.status === 'Sent');
  const option = draft.options.find((o) => o.id === tab) ?? draft.options[0];
  const total = option ? optionTotal(option) : 0;
  const deposit = Math.round((total * draft.depositPct) / 100);
  const expired = isExpired(stored);

  const patch = (fn: (q: Quote) => void) =>
    setDraft((q) => {
      const next = structuredClone(q!);
      fn(next);
      return next;
    });
  const patchOption = (fn: (o: QuoteOption) => void) => patch((q) => fn(q.options.find((o) => o.id === option.id)!));
  const patchLine = (lineId: string, fn: (l: QuoteLine) => void) => patchOption((o) => fn(o.lines.find((l) => l.id === lineId)!));

  const addOption = () => {
    const id = uid('o_');
    patch((q) => {
      const base = q.options.find((o) => o.id === option.id);
      q.options.push({ id, name: q.options.length === 1 ? 'Premium' : 'Basic', backupHours: base?.backupHours ?? 8, lines: structuredClone(base?.lines ?? []).map((l) => ({ ...l, id: uid('l_') })) });
    });
    setTab(id);
  };

  const send = () => {
    saveQuote(draft);
    sendQuote(draft.id);
    setSentOpen(true);
  };

  return (
    <OfficeShell>
      <PageHeader
        title={lead?.name ?? 'Quote'}
        back={{ to: '/office/quotes', label: 'Quotes' }}
        subtitle={
          <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            {draft.number} <Badge tone={quoteTone(expired ? 'Expired' : stored.status)}>{expired ? 'Expired' : stored.status}</Badge>
            {survey && `from the site survey on ${fmtDate(survey.createdAt)}`}
            {stored.sentAt && ` · sent ${fmtDate(stored.sentAt)}, valid until ${fmtDate(quoteValidUntil(stored))}`}
          </span>
        }
        actions={
          <>
            <Button variant="tonal" href={`/q/${draft.id}`}>
              Preview
            </Button>
            {editable && dirty && (
              <Button variant="tonal" onClick={() => saveQuote(draft)}>
                Save changes
              </Button>
            )}
            {editable && (
              <Button onClick={send} disabled={!total}>
                {stored.status === 'Sent' ? 'Resend to customer' : 'Send to customer'}
              </Button>
            )}
          </>
        }
      />

      {!canEdit && <div className="card t-small muted" style={{ padding: '12px 20px' }}>You have view-only access to quotes.</div>}
      {stored.status === 'Accepted' && (
        <div className="card t-body" style={{ padding: '14px 20px', background: 'var(--success-tint)', color: 'var(--on-success-tint)' }}>
          Accepted {fmtDate(stored.acceptedAt)} · {draft.options.find((o) => o.id === stored.selectedOptionId)?.name} option. A job was created for scheduling.
        </div>
      )}

      <div className="wrap">
        <div className="stack" style={{ flex: '999 1 600px', minWidth: 0, gap: 16 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <div role="tablist" aria-label="Quote options" className="segmented">
              {draft.options.map((o) => (
                <button key={o.id} type="button" role="tab" aria-selected={o.id === option.id} className="segmented__item" onClick={() => setTab(o.id)}>
                  {o.name}
                </button>
              ))}
            </div>
            {editable && draft.options.length < 3 && (
              <Button variant="text" size="sm" onClick={addOption}>
                <Icon name="add" size={18} />
                Add option
              </Button>
            )}
          </div>

          {option && (
            <section aria-label={`${option.name} option`} className="card" style={{ padding: '20px 24px', display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'flex-end' }}>
              <div className="field" style={{ flex: '1 1 200px' }}>
                <label htmlFor="opt-name">Option name</label>
                <input id="opt-name" value={option.name} disabled={!editable} onChange={(e) => patchOption((o) => (o.name = e.target.value))} />
              </div>
              <div className="field" style={{ flex: '0 1 160px' }}>
                <label htmlFor="opt-backup">Night backup (hours)</label>
                <input id="opt-backup" type="number" min={0} value={option.backupHours} disabled={!editable} onChange={(e) => patchOption((o) => (o.backupHours = Math.max(0, +e.target.value)))} />
              </div>
              {editable && draft.options.length > 1 && (
                <Button
                  variant="text"
                  onClick={() => {
                    patch((q) => (q.options = q.options.filter((o) => o.id !== option.id)));
                    setTab(draft.options.find((o) => o.id !== option.id)?.id);
                  }}
                >
                  Remove option
                </Button>
              )}
            </section>
          )}

          <section aria-label="Line items" className="card table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col" style={{ paddingTop: 16 }}>
                    Item
                  </th>
                  <th scope="col" className="num" style={{ paddingTop: 16, width: 90 }}>
                    Qty
                  </th>
                  <th scope="col" className="num" style={{ paddingTop: 16, width: 150 }}>
                    Unit price
                  </th>
                  {canSeeCost && (
                    <th scope="col" className="num" style={{ paddingTop: 16 }}>
                      Unit cost
                    </th>
                  )}
                  <th scope="col" className="num" style={{ paddingTop: 16 }}>
                    Amount
                  </th>
                  {editable && <th scope="col" aria-label="Remove" style={{ width: 48 }} />}
                </tr>
              </thead>
              <tbody>
                {option?.lines.map((l) => (
                  <tr key={l.id}>
                    <td>
                      {editable && !l.itemId ? (
                        <input aria-label="Description" style={inputStyle} value={l.description} onChange={(e) => patchLine(l.id, (x) => (x.description = e.target.value))} />
                      ) : (
                        l.description
                      )}
                    </td>
                    <td className="num">
                      {editable ? (
                        <input aria-label={`Quantity of ${l.description}`} type="number" min={1} style={{ ...inputStyle, textAlign: 'right' }} value={l.qty} onChange={(e) => patchLine(l.id, (x) => (x.qty = Math.max(1, Math.round(+e.target.value))))} />
                      ) : (
                        l.qty
                      )}
                    </td>
                    <td className="num muted">
                      {editable ? (
                        <input aria-label={`Unit price of ${l.description}`} type="number" min={0} step={1000} style={{ ...inputStyle, textAlign: 'right' }} value={l.unitPrice} onChange={(e) => patchLine(l.id, (x) => (x.unitPrice = Math.max(0, +e.target.value)))} />
                      ) : (
                        naira(l.unitPrice)
                      )}
                    </td>
                    {canSeeCost && <td className="num muted">{naira(l.unitCost)}</td>}
                    <td className="num">{naira(l.qty * l.unitPrice)}</td>
                    {editable && (
                      <td>
                        <button type="button" className="icon-btn" style={{ width: 40, height: 40, color: 'var(--muted)' }} aria-label={`Remove ${l.description}`} onClick={() => patchOption((o) => (o.lines = o.lines.filter((x) => x.id !== l.id)))}>
                          <Icon name="delete" size={20} />
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
                {option?.lines.length === 0 && (
                  <tr>
                    <td colSpan={6}>
                      <EmptyState title="No items yet">Add equipment from your price list, labour and transport.</EmptyState>
                    </td>
                  </tr>
                )}
                <tr>
                  <td colSpan={2} style={{ padding: '8px 16px' }}>
                    {editable && (
                      <select
                        aria-label="Add item"
                        value=""
                        style={{ ...inputStyle, width: 'auto', maxWidth: 320, color: 'var(--primary)', fontWeight: 500 }}
                        onChange={(e) => {
                          const v = e.target.value;
                          const item = priceItems.find((p) => p.id === v);
                          patchOption((o) =>
                            o.lines.push(
                              item
                                ? lineFromItem(item, 1)
                                : v === 'labour'
                                  ? { id: uid('l_'), category: 'service', description: 'Installation labour', qty: 1, unitPrice: company.labourPrice, unitCost: Math.round(company.labourPrice * 0.6) }
                                  : v === 'transport'
                                    ? { id: uid('l_'), category: 'service', description: 'Transport', qty: 1, unitPrice: company.transportPrice, unitCost: company.transportPrice }
                                    : { id: uid('l_'), category: 'service', description: 'Other item', qty: 1, unitPrice: 0, unitCost: 0 },
                            ),
                          );
                        }}
                      >
                        <option value="" disabled>
                          + Add item
                        </option>
                        <optgroup label="Price list">
                          {priceItems.map((p) => (
                            <option key={p.id} value={p.id}>
                              {itemLabel(p)} · {naira(p.price)}
                            </option>
                          ))}
                        </optgroup>
                        <optgroup label="Services">
                          <option value="labour">Installation labour</option>
                          <option value="transport">Transport</option>
                          <option value="custom">Other (type a description)</option>
                        </optgroup>
                      </select>
                    )}
                  </td>
                  <td className="num" style={{ fontWeight: 500 }}>
                    Total
                  </td>
                  {canSeeCost && <td />}
                  <td className="num" style={{ fontSize: 16, fontWeight: 500 }}>
                    {naira(total)}
                  </td>
                  {editable && <td />}
                </tr>
              </tbody>
            </table>
          </section>

          <section aria-labelledby="payplan" className="card stack" style={{ padding: '20px 24px 24px', gap: 16 }}>
            <h2 id="payplan" className="t-section-lg">
              Payment terms
            </h2>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
              <div className="field" style={{ flex: '1 1 200px' }}>
                <label htmlFor="dep">Deposit (%)</label>
                <input id="dep" type="number" min={0} max={100} value={draft.depositPct} disabled={!editable} onChange={(e) => patch((q) => (q.depositPct = Math.min(100, Math.max(0, +e.target.value))))} />
              </div>
              <div className="field" style={{ flex: '1 1 200px' }}>
                <label htmlFor="valid">Valid for (days)</label>
                <input id="valid" type="number" min={1} value={draft.validDays} disabled={!editable} onChange={(e) => patch((q) => (q.validDays = Math.max(1, +e.target.value)))} />
              </div>
            </div>
            <span className="t-small muted">
              Customer pays {naira(deposit)} to accept and {naira(total - deposit)} at handover.
            </span>
          </section>
        </div>

        <aside className="stack" style={{ flex: '1 1 300px', minWidth: 0, gap: 16 }}>
          <section aria-labelledby="sum" className="card stack" style={{ padding: 24, gap: 16 }}>
            <h2 id="sum" className="muted" style={{ fontSize: 14, lineHeight: '20px' }}>
              Customer pays · {option?.name}
            </h2>
            <span style={{ fontSize: 32, lineHeight: '40px', fontWeight: 500, letterSpacing: -0.3 }}>{naira(total)}</span>
            <div className="stack" style={{ gap: 12, paddingTop: 16, borderTop: '1px solid var(--divider)', fontSize: 14, lineHeight: '20px' }}>
              <SumRow label="Deposit" value={naira(deposit)} />
              <SumRow label="Night backup" value={`${option?.backupHours ?? 0} hours`} />
              {canSeeCost && option && (
                <>
                  <SumRow label="Your cost" value={naira(optionCost(option))} />
                  <SumRow label="Margin" value={<span style={{ fontWeight: 500, color: optionMarginPct(option) < 10 ? 'var(--danger)' : 'var(--success)' }}>{optionMarginPct(option).toFixed(1)}%</span>} />
                </>
              )}
            </div>
            {canSeeCost && <span className="muted" style={{ fontSize: 12, lineHeight: '16px' }}>Cost and margin are only visible to owners</span>}
          </section>

          {canSeeCost && draft.options.length > 1 && (
            <section aria-label="Margin by option" className="card stack" style={{ padding: '16px 24px' }}>
              {draft.options.map((o) => (
                <div key={o.id} className="row row--between" style={{ fontSize: 14 }}>
                  <span>{o.name}</span>
                  <span className="muted">
                    {naira(optionTotal(o))} · {optionMarginPct(o).toFixed(1)}%
                  </span>
                </div>
              ))}
            </section>
          )}

          {survey && (
            <section aria-labelledby="survey" className="card stack" style={{ padding: 24, gap: 12 }}>
              <h2 id="survey" className="muted" style={{ fontSize: 14, lineHeight: '20px', marginBottom: 4 }}>
                Site survey
              </h2>
              <SumRow label="Peak load" value={`${survey.peakW.toLocaleString('en-NG')} W`} />
              <SumRow label="Daily energy" value={`${(survey.dailyWh / 1000).toFixed(1)} kWh`} />
              <SumRow label="Sun hours" value={`${survey.sunHours} h · ${survey.state}`} />
              <SumRow label="Suggested" value={describeSize(effectiveSize(survey.recommended, survey.override))} />
              {survey.photos.length > 0 && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8, paddingTop: 8 }}>
                  {survey.photos.map((p) => (
                    <PhotoThumb key={p.id} photo={p} label={`Survey photo: ${p.kind}`} style={{ borderRadius: 12 }} />
                  ))}
                </div>
              )}
            </section>
          )}

          {(stored.status === 'Sent' || stored.status === 'Accepted') && (
            <section className="card stack" style={{ padding: 24, gap: 12 }} aria-label="Customer link">
              <span className="muted" style={{ fontSize: 14 }}>
                Customer link
              </span>
              <a href={link || undefined} target="_blank" rel="noreferrer" style={{ wordBreak: 'break-all', fontSize: 14 }}>
                {link || 'Creating link…'}
              </a>
              {canEdit && stored.status === 'Sent' && (
                <Button variant="text" size="sm" onClick={() => setQuoteStatus(draft.id, 'Declined')}>
                  Mark as declined
                </Button>
              )}
            </section>
          )}
        </aside>
      </div>

      <Dialog
        open={sentOpen}
        onClose={() => setSentOpen(false)}
        title="Quote sent"
        actions={
          <>
            <Button variant="text" onClick={() => setSentOpen(false)}>
              Done
            </Button>
            {lead && (
              <WhatsAppButton variant="primary" size="md" href={whatsappLink(lead.phone, `Hello ${lead.name}, here is your solar quote ${draft.number} from ${company.name}: ${link}`)}>
                Open in WhatsApp
              </WhatsAppButton>
            )}
          </>
        }
      >
        <p className="t-body" style={{ margin: 0 }}>
          {lead?.name} gets the branded proposal on WhatsApp. They can save it as a PDF, accept it and pay the deposit from the link.
        </p>
        <a href={link || undefined} target="_blank" rel="noreferrer" style={{ wordBreak: 'break-all' }}>
          {link || 'Creating link…'}
        </a>
      </Dialog>
    </OfficeShell>
  );
}

function SumRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 14, lineHeight: '20px' }}>
      <span className="muted">{label}</span>
      <span style={{ textAlign: 'right' }}>{value}</span>
    </div>
  );
}
