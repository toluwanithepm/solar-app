import type { ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useCan } from "../../components/Guards";
import { Icon } from "../../components/Icon";
import { OfficeShell } from "../../components/OfficeShell";
import { Badge, Button, PageHeader } from "../../components/ui";
import { JourneyBar, NextStepCard } from "../../components/Guide";
import { journeyFor } from "../../data/journey";
import {
  describeSize,
  effectiveSize,
  fmtDate,
  fmtDateTime,
  invoiceBalance,
  invoiceStatus,
  leadMoney,
  naira,
  optionTotal,
  selectedOption,
  whatsappLink,
} from "../../data/domain";
import { bookSurvey, followUpDue } from "../../data/salesActions";
import { useDb } from "../../data/store";
import { StageControl } from "./Leads";
import { FollowUpRow, quoteTone, WhatsAppButton } from "./Quotes";
import "../../styles/office-sales.css";

export function LeadDetail() {
  const { leadId } = useParams();
  const navigate = useNavigate();
  const db = useDb();
  const canLeads = useCan("edit.leads");
  const canQuote = useCan("edit.quotes");
  const lead = db.leads.find((l) => l.id === leadId);

  if (!lead) {
    return (
      <OfficeShell>
        <PageHeader
          title="Lead not found"
          back={{ to: "/office/leads", label: "Customers" }}
        />
      </OfficeShell>
    );
  }

  const surveys = db.surveys.filter((s) => s.leadId === lead.id);
  const quotes = db.quotes.filter((q) => q.leadId === lead.id);
  const jobs = db.jobs
    .filter((j) => j.leadId === lead.id)
    .sort((a, b) =>
      (b.start ?? b.updatedAt).localeCompare(a.start ?? a.updatedAt),
    );
  const invoices = db.invoices.filter((i) => i.leadId === lead.id);
  const installations = db.installations.filter((i) => i.leadId === lead.id);
  const money = leadMoney(db, lead.id);
  const followUps = quotes.filter((q) => followUpDue(db, q));
  const openSurvey = jobs.find(
    (j) =>
      j.type === "Site survey" &&
      j.status !== "Done" &&
      j.status !== "Cancelled",
  );

  const journey = journeyFor(db, lead);

  return (
    <OfficeShell>
      <PageHeader
        title={lead.name}
        back={{ to: "/office/leads", label: "Customers" }}
        subtitle={
          <>
            <a href={`tel:${lead.phone}`}>{lead.phone}</a> · {lead.propertyType} · {lead.address} · from {lead.source}, {fmtDate(lead.createdAt)}
          </>
        }
        actions={
          <>
            <StageControl lead={lead} />
            <WhatsAppButton
              href={whatsappLink(lead.phone, `Hello ${lead.name}, `)}
              size="md"
            >
              WhatsApp
            </WhatsAppButton>
            {canQuote && journey.next.kind !== "new-quote" && !journey.lost && (
              <Button
                variant="tonal"
                to={`/office/quotes/new?leadId=${lead.id}${surveys[0] ? `&surveyId=${surveys[surveys.length - 1].id}` : ""}`}
              >
                New quote
              </Button>
            )}
          </>
        }
      />

      <section className="card card--pad" aria-label="Where this customer is">
        <JourneyBar journey={journey} />
      </section>
      <NextStepCard
        journey={journey}
        canAct={journey.next.kind === "new-quote" ? canQuote : canLeads || canQuote}
        onBookSurvey={() => {
          if (openSurvey) return;
          navigate(`/office/jobs/${bookSurvey(lead.id)}`);
        }}
      />

      {money.billed > 0 && (
      <div className="kpi-row">
        <div className="kpi-grid">
          <div className="card stat-tile">
            <span className="t-small muted">Billed</span>
            <span className="stat-tile__value">{naira(money.billed)}</span>
          </div>
          <div className="card stat-tile">
            <span className="t-small muted">Paid</span>
            <span className="stat-tile__value">{naira(money.paid)}</span>
          </div>
          <div className="card stat-tile">
            <span className="t-small muted">Owed</span>
            <span
              className={`stat-tile__value${money.owed > 0 ? " danger" : ""}`}
            >
              {naira(money.owed)}
            </span>
          </div>
        </div>
      </div>
      )}

      {lead.notes && (
        <section className="card card--pad" aria-label="Notes">
          <h2 className="t-overline" style={{ marginBottom: 6 }}>
            Notes
          </h2>
          <p className="t-body" style={{ margin: 0, whiteSpace: "pre-wrap" }}>
            {lead.notes}
          </p>
        </section>
      )}
      {!lead.whatsappConsent && (
        <div className="notice notice--warning" role="note">
          <Icon name="warning" size={18} />
          No WhatsApp consent recorded. Ask before sending quotes or reminders
          on WhatsApp.
        </div>
      )}

      {followUps.length > 0 && (
        <Section title="Follow up">
          {followUps.map((q) => (
            <FollowUpRow key={q.id} quote={q} lead={lead} />
          ))}
        </Section>
      )}

      {quotes.length + jobs.length + invoices.length + surveys.length + installations.length === 0 && (
        <p className="t-small muted" style={{ margin: 0 }}>
          Surveys, quotes, jobs and invoices for {lead.name} will appear here as you go.
        </p>
      )}

      <div className="wrap">
        <div
          className="stack"
          style={{ flex: "2 1 480px", minWidth: 0, gap: 24 }}
        >
          <Section title="Quotes" empty={quotes.length === 0}>
            {quotes.map((q) => (
              <Link key={q.id} to={`/office/quotes/${q.id}`} className="row">
                <span className="row__main">
                  <span>
                    {q.number} · {selectedOption(q).name}
                  </span>
                  <span className="t-small muted">
                    {naira(optionTotal(selectedOption(q)))} · created{" "}
                    {fmtDate(q.createdAt)}
                  </span>
                </span>
                <Badge tone={quoteTone(q.status)}>{q.status}</Badge>
              </Link>
            ))}
          </Section>

          <Section title="Jobs" empty={jobs.length === 0}>
            {jobs.map((j) => (
              <Link key={j.id} to={`/office/jobs/${j.id}`} className="row">
                <span className="row__main">
                  <span>
                    {j.number} · {j.type}
                  </span>
                  <span className="t-small muted">
                    {j.start ? fmtDateTime(j.start) : "Not scheduled"}
                  </span>
                </span>
                <Badge
                  tone={
                    j.status === "Done"
                      ? "green"
                      : j.status === "Unscheduled"
                        ? "amber"
                        : j.status === "Cancelled"
                          ? "neutral"
                          : "blue"
                  }
                >
                  {j.status}
                </Badge>
              </Link>
            ))}
          </Section>

          <Section title="Invoices" empty={invoices.length === 0}>
            {invoices.map((inv) => {
              const st = invoiceStatus(db, inv);
              return (
                <div key={inv.id} className="row">
                  <span className="row__main">
                    <span>
                      {inv.number} · {inv.description}
                    </span>
                    <span className="t-small muted">
                      {naira(inv.amount)} · due {fmtDate(inv.dueAt)}
                      {st !== "Paid" &&
                        ` · ${naira(invoiceBalance(db, inv))} left`}
                    </span>
                  </span>
                  <Badge
                    tone={
                      st === "Paid"
                        ? "green"
                        : st === "Overdue"
                          ? "red"
                          : "amber"
                    }
                  >
                    {st}
                  </Badge>
                </div>
              );
            })}
          </Section>
        </div>

        <div
          className="stack"
          style={{ flex: "1 1 300px", minWidth: 0, gap: 24 }}
        >
          <Section title="Site surveys" empty={surveys.length === 0}>
            {surveys.map((s) => (
              <div
                key={s.id}
                className="row"
                style={{ alignItems: "flex-start" }}
              >
                <span className="row__main">
                  <span>{fmtDate(s.createdAt)}</span>
                  <span className="t-small muted">
                    {s.peakW.toLocaleString("en-NG")} W peak ·{" "}
                    {(s.dailyWh / 1000).toFixed(1)} kWh/day
                  </span>
                  <span className="t-small muted">
                    {describeSize(effectiveSize(s.recommended, s.override))}
                  </span>
                </span>
                {s.status === "draft" && <Badge tone="amber">Draft</Badge>}
              </div>
            ))}
          </Section>

          <Section title="Installed systems" empty={installations.length === 0}>
            {installations.map((ins) => (
              <Link
                key={ins.id}
                to={`/office/installations/${ins.id}`}
                className="row"
              >
                <span className="row__main">
                  <span>Installed {fmtDate(ins.installedAt)}</span>
                  <span className="t-small muted">
                    {ins.items.length} items · next service{" "}
                    {fmtDate(ins.nextServiceAt)}
                  </span>
                </span>
                <span className="faint" aria-hidden="true">
                  <Icon name="chevronRight" size={18} />
                </span>
              </Link>
            ))}
          </Section>
        </div>
      </div>
    </OfficeShell>
  );
}

/** Empty sections stay out of the way until there is something to show (selective attention). */
function Section({ title, children, empty }: { title: string; children: ReactNode; empty?: boolean }) {
  if (empty) return null;
  return (
    <section className="card" aria-label={title}>
      <div className="card__head">
        <h2 className="t-section-lg">{title}</h2>
      </div>
      <div className="card__body stack">{children}</div>
    </section>
  );
}
