import '../../../styles/settings-auth.css';
import { useState } from 'react';
import { Icon } from '../../../components/Icon';
import { SelectField } from '../../../components/forms';
import { Badge, EmptyState } from '../../../components/ui';
import { fmtDateTime } from '../../../data/domain';
import { useDb } from '../../../data/store';
import { safeHref } from '../../../lib/safeUrl';

const topicLabel: Record<string, string> = {
  quote: 'Quotes',
  'quote-follow-up': 'Quote follow-ups',
  receipt: 'Receipts',
  'payment-link': 'Payment links',
  'payment-reminder': 'Payment reminders',
  'service-reminder': 'Service reminders',
  'plan-renewal': 'Plan renewals',
  plan: 'Plans',
  handover: 'Handover reports',
  ticket: 'Fault reports',
  otp: 'Sign-in codes',
};

export function Messages() {
  const messages = useDb((d) => d.messages);
  const [topic, setTopic] = useState('all');
  const [channel, setChannel] = useState<'all' | 'WhatsApp' | 'SMS'>('all');
  const topics = [...new Set(messages.map((m) => m.topic))];
  const shown = messages.filter((m) => (topic === 'all' || m.topic === topic) && (channel === 'all' || m.channel === channel)).slice(0, 200);

  return (
    <div className="stack" style={{ gap: 16 }}>
      <p className="t-small muted" style={{ margin: 0 }}>
        Every WhatsApp and SMS the platform sends to customers and staff. Sending is simulated in this version; in production these go through the WhatsApp Business API and an SMS provider, only to customers who gave consent.
      </p>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <SelectField id="msg-topic" label="Topic" value={topic} onChange={setTopic} options={[{ value: 'all', label: 'All topics' }, ...topics.map((t) => ({ value: t, label: topicLabel[t] ?? t }))]} style={{ flex: '0 1 240px' }} />
        <SelectField id="msg-ch" label="Channel" value={channel} onChange={setChannel} options={[{ value: 'all', label: 'All channels' }, 'WhatsApp', 'SMS'] as const} style={{ flex: '0 1 200px' }} />
      </div>
      <section className="card set-log" aria-label="Sent messages">
        {shown.length === 0 && <EmptyState title="No messages yet" />}
        {shown.map((m) => (
          <article key={m.id} className="row" style={{ alignItems: 'flex-start', gap: 12, padding: '14px 0' }}>
            <span className={`set-chan${m.channel === 'WhatsApp' ? ' set-chan--wa' : ''}`} role="img" aria-label={m.channel}>
              <Icon name={m.channel === 'WhatsApp' ? 'whatsapp' : 'message'} size={16} />
            </span>
            <div className="row__main">
              <span style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <span className="strong">{m.toName}</span>
                <span className="t-small muted">{m.to}</span>
                <Badge>{topicLabel[m.topic] ?? m.topic}</Badge>
              </span>
              <span className="muted">{m.text}</span>
              {m.link && (
                <a href={safeHref(m.link)} target="_blank" rel="noreferrer" className="t-small" style={{ wordBreak: 'break-all' }}>
                  {m.link}
                </a>
              )}
            </div>
            <span className="t-caption faint" style={{ flexShrink: 0 }}>
              {fmtDateTime(m.at)}
            </span>
          </article>
        ))}
      </section>
    </div>
  );
}
