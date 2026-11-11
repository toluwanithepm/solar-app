import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useCan } from "../../components/Guards";
import { Icon } from "../../components/Icon";
import { OfficeShell } from "../../components/OfficeShell";
import {
  Badge,
  Button,
  EmptyState,
  PageHeader,
  Segmented,
} from "../../components/ui";
import {
  daysBetween,
  fmtDate,
  naira,
  optionTotal,
  selectedOption,
  whatsappLink,
} from "../../data/domain";
import {
  followUpDue,
  followUpText,
  isExpired,
  recordFollowUp,
} from "../../data/salesActions";
import { useDb } from "../../data/store";
import type { Lead, Quote, QuoteStatus } from "../../data/types";
import "../../styles/office-sales.css";

export const quoteTone = (s: QuoteStatus) =>
  ({
    Draft: "neutral",
    Sent: "blue",
    Accepted: "green",
    Declined: "red",
    Expired: "amber",
  })[s] as "neutral" | "blue" | "green" | "red" | "amber";

type Filter = "all" | "followup" | "Draft" | "Sent" | "Accepted";

export function Quotes() {
  const quotes = useDb((d) => d.quotes);
  const leads = useDb((d) => d.leads);
  const company = useDb((d) => d.company);
  const navigate = useNavigate();
  const [filter, setFilter] = useState<Filter>("all");

  const leadOf = (q: Quote) => leads.find((l) => l.id === q.leadId);
  const due = quotes.filter((q) => followUpDue({ company }, q));
  const shown = quotes
    .filter((q) =>
      filter === "all"
        ? true
        : filter === "followup"
          ? followUpDue({ company }, q)
          : q.status === filter,
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return (
    <OfficeShell>
      <PageHeader
        title="Quotes"
        subtitle={`${quotes.filter((q) => q.status === "Sent").length} waiting for the customer · ${due.length} to follow up`}
        actions={<NewQuoteButton />}
      />

      {due.length > 0 && (
        <section aria-labelledby="fu" className="card">
          <div className="card__head">
            <div className="stack" style={{ gap: 2 }}>
              <h2 id="fu" className="t-section-lg">
                Follow up today
              </h2>
              <span className="t-small muted">
                Sent more than {company.followUpDays} days ago and not accepted
                yet
              </span>
            </div>
            <Badge tone="amber">{due.length} due</Badge>
          </div>
          <div className="card__body stack">
            {due.map((q) => {
              const lead = leadOf(q);
              return lead ? (
                <FollowUpRow key={q.id} quote={q} lead={lead} />
              ) : null;
            })}
          </div>
        </section>
      )}

      <Segmented
        label="Filter quotes"
        value={filter}
        onChange={setFilter}
        options={[
          { id: "all", name: "All" },
          { id: "followup", name: `Follow up (${due.length})` },
          { id: "Draft", name: "Draft" },
          { id: "Sent", name: "Sent" },
          { id: "Accepted", name: "Accepted" },
        ]}
      />

      <section className="card" aria-label="All quotes">
        {shown.length === 0 ? (
          <EmptyState title="No quotes here">
            Try another filter, or start a quote from a lead.
          </EmptyState>
        ) : (
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Quote</th>
                  <th scope="col">Customer</th>
                  <th scope="col">Options</th>
                  <th scope="col" className="num">
                    Total
                  </th>
                  <th scope="col">Sent</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((q) => {
                  const lead = leadOf(q);
                  const opt = selectedOption(q);
                  const expired = isExpired(q);
                  return (
                    <tr
                      key={q.id}
                      className="is-link"
                      onClick={() => navigate(`/office/quotes/${q.id}`)}
                    >
                      <td>
                        <Link
                          to={`/office/quotes/${q.id}`}
                          className="cell-link"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {q.number}
                        </Link>
                      </td>
                      <td>{lead?.name}</td>
                      <td className="muted">
                        {q.options.map((o) => o.name).join(", ")}
                      </td>
                      <td className="num">
                        {opt ? naira(optionTotal(opt)) : "—"}
                      </td>
                      <td className="muted cell-time">
                        {q.sentAt ? fmtDate(q.sentAt) : "—"}
                      </td>
                      <td>
                        <span className="cell-badges">
                          <Badge
                            tone={quoteTone(expired ? "Expired" : q.status)}
                          >
                            {expired ? "Expired" : q.status}
                          </Badge>
                          {followUpDue({ company }, q) && (
                            <Badge tone="amber">Follow up</Badge>
                          )}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </OfficeShell>
  );
}

function NewQuoteButton() {
  const canEdit = useCan("edit.quotes");
  const surveys = useDb((d) => d.surveys);
  const quotes = useDb((d) => d.quotes);
  const leads = useDb((d) => d.leads);
  const [open, setOpen] = useState(false);
  if (!canEdit) return null;
  const ready = surveys.filter(
    (s) => s.status === "submitted" && !quotes.some((q) => q.surveyId === s.id),
  );
  return (
    <div style={{ position: "relative" }}>
      <Button onClick={() => setOpen(!open)}>New quote</Button>
      {open && (
        <div
          className="card popover"
          style={{ width: 320, padding: "12px 16px" }}
        >
          <span className="t-overline">From a site survey</span>
          {ready.length === 0 && (
            <span className="t-small muted" style={{ padding: "8px 0" }}>
              No new surveys waiting for a quote.
            </span>
          )}
          {ready.map((s) => (
            <Link
              key={s.id}
              to={`/office/quotes/new?surveyId=${s.id}`}
              className="row"
            >
              <span className="row__main">
                <span>{leads.find((l) => l.id === s.leadId)?.name}</span>
                <span className="t-small muted">
                  Surveyed {fmtDate(s.createdAt)}
                </span>
              </span>
              <span className="faint" aria-hidden="true">
                <Icon name="chevronRight" size={18} />
              </span>
            </Link>
          ))}
          <span className="t-caption faint" style={{ paddingTop: 8 }}>
            Or open a lead and choose New quote
          </span>
        </div>
      )}
    </div>
  );
}

/** E2-2: one-tap WhatsApp follow-up on a quote the customer hasn't accepted. */
export function FollowUpRow({ quote, lead }: { quote: Quote; lead: Lead }) {
  const company = useDb((d) => d.company);
  const canEdit = useCan("edit.quotes");
  const days = daysBetween(
    quote.lastFollowUpAt ?? quote.sentAt ?? quote.createdAt,
    new Date(),
  );
  return (
    <div className="row" style={{ flexWrap: "wrap", gap: 12 }}>
      <span className="row__main" style={{ minWidth: 200 }}>
        <span>
          <Link to={`/office/quotes/${quote.id}`}>{quote.number}</Link> ·{" "}
          {lead.name}
        </span>
        <span
          className="t-small muted"
          style={{ fontVariantNumeric: "tabular-nums" }}
        >
          {quote.lastFollowUpAt
            ? `Last followed up ${days} days ago`
            : `Sent ${days} days ago`}{" "}
          · {naira(optionTotal(selectedOption(quote)))}
        </span>
      </span>
      {canEdit && (
        <WhatsAppButton
          href={whatsappLink(
            lead.phone,
            followUpText({ company }, quote, lead),
          )}
          onClick={() => recordFollowUp(quote.id)}
        >
          Follow up on WhatsApp
        </WhatsAppButton>
      )}
    </div>
  );
}

/** External wa.me link styled as a button; onClick records that the message went out. */
export function WhatsAppButton({
  href,
  onClick,
  children,
  variant = "tonal",
  size = "sm",
}: {
  href: string;
  onClick?: () => void;
  children: React.ReactNode;
  variant?: "tonal" | "primary" | "text";
  size?: "sm" | "md" | "lg";
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className={`btn btn--${variant} btn--${size}`}
      onClick={onClick}
    >
      <Icon name="whatsapp" size={18} />
      {children}
    </a>
  );
}
