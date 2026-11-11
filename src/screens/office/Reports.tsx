import { useState } from "react";
import { Link } from "react-router-dom";
import { useCan } from "../../components/Guards";
import { Icon } from "../../components/Icon";
import { OfficeShell } from "../../components/OfficeShell";
import { Badge, Button, EmptyState, PageHeader } from "../../components/ui";
import {
  DAY,
  fmtDate,
  invoiceBalance,
  naira,
  nairaShort,
  optionCost,
  optionTotal,
  selectedOption,
} from "../../data/domain";
import { useDb } from "../../data/store";
import type { DB, Job } from "../../data/types";
import { downloadExcel } from "../../lib/export";
import "../../styles/office-sales.css";

const pad = (n: number) => String(n).padStart(2, "0");
const monthValue = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;

const minutesOnSite = (j: Job) =>
  j.checkIn && j.checkOut
    ? (new Date(j.checkOut.at).getTime() - new Date(j.checkIn.at).getTime()) /
      60_000
    : null;
const fmtMinutes = (m: number | null) =>
  m === null
    ? "—"
    : `${Math.floor(m / 60)} h ${String(Math.round(m % 60)).padStart(2, "0")} min`;

/** Fault reports on the same system within 30 days of a job a technician finished (E10-2). */
function isCallback(db: DB, j: Job) {
  if (!j.completedAt) return false;
  const insId =
    j.installationId ?? db.installations.find((i) => i.jobId === j.id)?.id;
  if (!insId) return false;
  const done = new Date(j.completedAt).getTime();
  return db.tickets.some(
    (t) =>
      t.installationId === insId &&
      t.id !== j.ticketId &&
      new Date(t.createdAt).getTime() > done &&
      new Date(t.createdAt).getTime() - done <= 30 * DAY,
  );
}

function report(db: DB, month: string, techId: string) {
  const [y, m] = month.split("-").map(Number);
  const from = new Date(y, m - 1, 1).getTime();
  const to = new Date(y, m, 1).getTime();
  const inMonth = (iso?: string) =>
    !!iso && new Date(iso).getTime() >= from && new Date(iso).getTime() < to;
  const byTech = (j?: Job) =>
    !techId || (!!j && j.assigneeIds.includes(techId));

  const accepted = db.quotes.filter(
    (q) => q.status === "Accepted" && inMonth(q.acceptedAt),
  );
  const sales = accepted.map((q) => ({
    q,
    o: selectedOption(q),
    lead: db.leads.find((l) => l.id === q.leadId)!,
  }));
  const jobsDone = db.jobs
    .filter((j) => j.status === "Done" && inMonth(j.completedAt) && byTech(j))
    .sort((a, b) => a.completedAt!.localeCompare(b.completedAt!));
  const jobOf = (invoiceJobId?: string) =>
    db.jobs.find((j) => j.id === invoiceJobId);
  const payments = db.payments
    .filter((p) => p.status === "Confirmed" && inMonth(p.at))
    .filter((p) =>
      byTech(jobOf(db.invoices.find((i) => i.id === p.invoiceId)?.jobId)),
    );
  const owedInvoices = db.invoices.filter(
    (i) =>
      new Date(i.issuedAt).getTime() < to &&
      invoiceBalance(db, i) > 0 &&
      byTech(jobOf(i.jobId)),
  );

  const techs = db.users.filter(
    (u) => u.role === "technician" && (!techId || u.id === techId),
  );
  const productivity = techs.map((t) => {
    const mine = jobsDone.filter((j) => j.assigneeIds.includes(t.id));
    const times = mine
      .map(minutesOnSite)
      .filter((x): x is number => x !== null);
    return {
      tech: t,
      jobs: mine.length,
      installs: mine.filter((j) => j.type === "Installation").length,
      service: mine.filter((j) => j.type !== "Installation").length,
      avg: times.length
        ? times.reduce((s, x) => s + x, 0) / times.length
        : null,
      callbacks: mine.filter((j) => isCallback(db, j)).length,
    };
  });

  return {
    sales,
    salesTotal: sales.reduce((s, x) => s + optionTotal(x.o), 0),
    salesCost: sales.reduce((s, x) => s + optionCost(x.o), 0),
    jobsDone,
    payments,
    collected: payments.reduce((s, p) => s + p.amount, 0),
    owedInvoices,
    owed: owedInvoices.reduce((s, i) => s + invoiceBalance(db, i), 0),
    productivity,
  };
}

export function Reports() {
  const db = useDb();
  const canCost = useCan("view.costs");
  const [month, setMonth] = useState(() => monthValue(new Date()));
  const [techId, setTechId] = useState("");
  const r = report(db, month, techId);
  const techs = db.users.filter((u) => u.role === "technician");
  const lead = (id: string) => db.leads.find((l) => l.id === id)?.name ?? "";
  const name = (id: string) => db.users.find((u) => u.id === id)?.name ?? "";
  const monthLabel = new Date(`${month}-01T00:00`).toLocaleDateString("en-GB", {
    month: "long",
    year: "numeric",
  });
  const margin = r.salesTotal
    ? ((r.salesTotal - r.salesCost) / r.salesTotal) * 100
    : 0;

  const exportXls = () => {
    const filter = techId ? name(techId) : "All technicians";
    downloadExcel(`${db.company.name} report ${month}`, [
      {
        name: "Summary",
        rows: [
          ["Report", `${monthLabel} · ${filter}`],
          ["Sales (accepted quotes)", r.salesTotal],
          ...(canCost ? [["Margin %", +margin.toFixed(1)]] : []),
          ["Jobs completed", r.jobsDone.length],
          ["Money collected", r.collected],
          ["Money owed", r.owed],
        ],
      },
      {
        name: "Technicians",
        rows: [
          [
            "Technician",
            "Jobs completed",
            "Installations",
            "Service and repairs",
            "Average minutes on site",
            "Callbacks within 30 days",
          ],
          ...r.productivity.map((p) => [
            p.tech.name,
            p.jobs,
            p.installs,
            p.service,
            p.avg === null ? "" : Math.round(p.avg),
            p.callbacks,
          ]),
        ],
      },
      {
        name: "Sales",
        rows: [
          [
            "Quote",
            "Customer",
            "Option",
            "Accepted",
            "Price",
            ...(canCost ? ["Cost", "Margin %"] : []),
          ],
          ...r.sales.map(({ q, o, lead: l }) => [
            q.number,
            l.name,
            o.name,
            fmtDate(q.acceptedAt),
            optionTotal(o),
            ...(canCost
              ? [
                  optionCost(o),
                  +(
                    ((optionTotal(o) - optionCost(o)) / optionTotal(o)) *
                    100
                  ).toFixed(1),
                ]
              : []),
          ]),
        ],
      },
      {
        name: "Jobs",
        rows: [
          [
            "Job",
            "Customer",
            "Type",
            "Completed",
            "Technicians",
            "Minutes on site",
          ],
          ...r.jobsDone.map((j) => [
            j.number,
            lead(j.leadId),
            j.type,
            fmtDate(j.completedAt),
            j.assigneeIds.map(name).join(", "),
            minutesOnSite(j) ?? "",
          ]),
        ],
      },
      {
        name: "Payments",
        rows: [
          ["Reference", "Date", "Customer", "Invoice", "Method", "Amount"],
          ...r.payments.map((p) => {
            const inv = db.invoices.find((i) => i.id === p.invoiceId);
            return [
              p.reference,
              fmtDate(p.at),
              lead(inv?.leadId ?? ""),
              inv?.number ?? "",
              p.method,
              p.amount,
            ];
          }),
        ],
      },
      {
        name: "Owed",
        rows: [
          ["Invoice", "Customer", "Description", "Due", "Balance"],
          ...r.owedInvoices.map((i) => [
            i.number,
            lead(i.leadId),
            i.description,
            fmtDate(i.dueAt),
            invoiceBalance(db, i),
          ]),
        ],
      },
    ]);
  };

  const cards = [
    {
      label: "Sales",
      value: nairaShort(r.salesTotal),
      note:
        canCost && r.salesTotal
          ? `${r.sales.length} quotes won · ${margin.toFixed(1)}% margin`
          : `${r.sales.length} quotes won${techId ? " · all technicians" : ""}`,
    },
    {
      label: "Jobs completed",
      value: String(r.jobsDone.length),
      note: `${r.jobsDone.filter((j) => j.type === "Installation").length} installations`,
    },
    {
      label: "Money collected",
      value: nairaShort(r.collected),
      note: `${r.payments.length} payments`,
    },
    {
      label: "Money owed",
      value: nairaShort(r.owed),
      note: `${r.owedInvoices.length} unpaid invoices`,
      danger: r.owed > 0,
    },
  ];

  return (
    <OfficeShell>
      <PageHeader
        title="Reports"
        subtitle={`${monthLabel}${techId ? ` · ${name(techId)}` : ""}`}
        actions={
          <div className="toolbar">
            <div className="field field--inline">
              <label htmlFor="rp-month">Month</label>
              <input
                id="rp-month"
                type="month"
                value={month}
                max={monthValue(new Date())}
                onChange={(e) => e.target.value && setMonth(e.target.value)}
              />
            </div>
            <div className="field field--inline">
              <label htmlFor="rp-tech">Technician</label>
              <select
                id="rp-tech"
                value={techId}
                onChange={(e) => setTechId(e.target.value)}
              >
                <option value="">All</option>
                {techs.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>
            <Button onClick={exportXls}>
              <Icon name="download" size={18} />
              Export to Excel
            </Button>
          </div>
        }
      />

      <section aria-label="Month summary" className="kpi-row">
        <div className="kpi-grid">
          {cards.map((c) => (
            <div key={c.label} className="card kpi">
              <span className="kpi__label">{c.label}</span>
              <span className="kpi__value">{c.value}</span>
              <span
                className={`kpi__note${c.danger ? " kpi__note--down" : ""}`}
              >
                {c.note}
              </span>
            </div>
          ))}
        </div>
      </section>

      <section className="card" aria-labelledby="prod">
        <div className="card__head">
          <h2 id="prod" className="t-section-lg">
            Technician productivity
          </h2>
        </div>
        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Technician</th>
                <th scope="col" className="num">
                  Jobs done
                </th>
                <th scope="col" className="num">
                  Installations
                </th>
                <th scope="col" className="num">
                  Service and repairs
                </th>
                <th scope="col" className="num">
                  Average time on site
                </th>
                <th scope="col" className="num">
                  Callbacks within 30 days
                </th>
              </tr>
            </thead>
            <tbody>
              {r.productivity.map((p) => (
                <tr key={p.tech.id}>
                  <td>
                    <span className="cell-link">{p.tech.name}</span>
                    <span className="cell-sub">{p.tech.title}</span>
                  </td>
                  <td className="num">{p.jobs}</td>
                  <td className="num">{p.installs}</td>
                  <td className="num">{p.service}</td>
                  <td className="num">{fmtMinutes(p.avg)}</td>
                  <td className="num">
                    {p.callbacks ? (
                      <Badge tone="red">{p.callbacks}</Badge>
                    ) : (
                      <span className="muted">0</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {r.productivity.length === 0 && (
          <EmptyState title="No technicians yet">
            Add technicians in Settings to see their numbers here.
          </EmptyState>
        )}
      </section>

      <div className="wrap">
        <section
          className="card"
          style={{ flex: "1 1 420px", minWidth: 0 }}
          aria-labelledby="jd"
        >
          <div className="card__head">
            <h2 id="jd" className="t-section-lg">
              Jobs completed
            </h2>
            <span className="t-small muted num">{r.jobsDone.length}</span>
          </div>
          <div className="card__body stack">
            {r.jobsDone.length === 0 && (
              <EmptyState title="No jobs completed this month" />
            )}
            {r.jobsDone
              .slice(-12)
              .reverse()
              .map((j) => (
                <Link
                  key={j.id}
                  to={`/office/jobs/${j.id}`}
                  className="row"
                  style={{ gap: 12 }}
                >
                  <span className="row__main">
                    <span>{lead(j.leadId)}</span>
                    <span className="t-small muted">
                      {j.type} · {fmtDate(j.completedAt)} ·{" "}
                      {j.assigneeIds
                        .map((id) => name(id).split(" ")[0])
                        .join(", ")}
                    </span>
                  </span>
                  <span
                    className="t-small muted num"
                    style={{ whiteSpace: "nowrap" }}
                  >
                    {fmtMinutes(minutesOnSite(j))}
                  </span>
                </Link>
              ))}
          </div>
        </section>
        <section
          className="card"
          style={{ flex: "1 1 420px", minWidth: 0 }}
          aria-labelledby="ow"
        >
          <div className="card__head">
            <h2 id="ow" className="t-section-lg">
              Largest balances owed
            </h2>
            {r.owed > 0 && (
              <span className="t-small danger num">{naira(r.owed)} total</span>
            )}
          </div>
          <div className="card__body stack">
            {r.owedInvoices.length === 0 && (
              <EmptyState title="Nothing owed">
                Every invoice up to this month is paid.
              </EmptyState>
            )}
            {[...r.owedInvoices]
              .sort((a, b) => invoiceBalance(db, b) - invoiceBalance(db, a))
              .slice(0, 8)
              .map((i) => (
                <div key={i.id} className="row" style={{ gap: 12 }}>
                  <span className="row__main">
                    <span>{lead(i.leadId)}</span>
                    <span className="t-small muted">
                      {i.number} · {i.description} · due {fmtDate(i.dueAt)}
                    </span>
                  </span>
                  <span className="num strong" style={{ whiteSpace: "nowrap" }}>
                    {naira(invoiceBalance(db, i))}
                  </span>
                </div>
              ))}
          </div>
        </section>
      </div>
      <p className="t-caption faint" style={{ margin: 0 }}>
        Exports open in Excel with one sheet each for the summary, technicians,
        sales, jobs, payments and balances owed.
      </p>
    </OfficeShell>
  );
}
