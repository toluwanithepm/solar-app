import { useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  Dialog,
  SelectField,
  TextArea,
  TextField,
} from "../../components/forms";
import { useCan } from "../../components/Guards";
import { Icon } from "../../components/Icon";
import { OfficeShell } from "../../components/OfficeShell";
import { Badge, Button, EmptyState, PageHeader } from "../../components/ui";
import { fmtDate, sunHoursByState } from "../../data/domain";
import { createLead, setLeadStage } from "../../data/salesActions";
import { isBackend, useDb } from "../../data/store";
import { journeyFor } from "../../data/journey";
import { InfoTip } from "../../components/Guide";
import type {
  Lead,
  LeadSource,
  LeadStage,
  PropertyType,
} from "../../data/types";
import "../../styles/office-sales.css";

export const stages: LeadStage[] = ["New", "Surveyed", "Quoted", "Won", "Lost"];
const sources: LeadSource[] = [
  "Call",
  "WhatsApp",
  "Walk-in",
  "Web form",
  "Referral",
];
const propertyTypes: PropertyType[] = [
  "Home",
  "Shop",
  "Office",
  "Clinic",
  "School",
  "Other",
];

export const stageTone = (s: LeadStage) =>
  ({
    New: "blue",
    Surveyed: "amber",
    Quoted: "amber",
    Won: "green",
    Lost: "neutral",
  })[s] as "blue" | "amber" | "green" | "neutral";

export function Leads() {
  const db = useDb();
  const leads = db.leads;
  const canEdit = useCan("edit.leads");
  const navigate = useNavigate();
  const [stage, setStage] = useState<LeadStage | "All">("All");
  const [q, setQ] = useState("");
  // ?new=1 (from Home or Help) opens the enquiry form straight away
  const [params] = useSearchParams();
  const [adding, setAdding] = useState(params.get("new") === "1");

  const counts = useMemo(
    () =>
      Object.fromEntries(
        stages.map((s) => [s, leads.filter((l) => l.stage === s).length]),
      ),
    [leads],
  );
  const shown = leads
    .filter((l) => stage === "All" || l.stage === stage)
    .filter(
      (l) =>
        !q ||
        `${l.name} ${l.phone} ${l.location}`
          .toLowerCase()
          .includes(q.toLowerCase()),
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return (
    <OfficeShell>
      <PageHeader
        title="Customers"
        subtitle={`${leads.length} customers · ${counts.New} new enquiries. Open one to see its next step.`}
        actions={
          <>
            <span className="term">
              <Button variant="tonal" {...(isBackend ? { to: "/office/settings/company" } : { href: "/enquire" })}>
                Enquiry form link
              </Button>
              <InfoTip term="enquiryLink" />
            </span>
            {canEdit && (
              <Button onClick={() => setAdding(true)}>Log enquiry</Button>
            )}
          </>
        }
      />

      <div className="toolbar">
        <div role="group" aria-label="Filter by stage" className="filter-chips">
          {(["All", ...stages] as const).map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={stage === s}
              onClick={() => setStage(s)}
              className="filter-chip"
            >
              {s}
              <span className="filter-chip__count">
                {s === "All" ? leads.length : counts[s]}
              </span>
            </button>
          ))}
        </div>
        <label className="search toolbar__end">
          <span className="search__icon" aria-hidden="true">
            <Icon name="search" size={18} />
          </span>
          <input
            type="search"
            aria-label="Search leads"
            placeholder="Search name, phone or area"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </label>
      </div>

      <section className="card" aria-label="Customers">
        {shown.length === 0 ? (
          <EmptyState title="No customers here">
            {q
              ? `Nothing matches “${q}”. Try another search or stage.`
              : "Try another stage, or log a new enquiry."}
          </EmptyState>
        ) : (
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Customer</th>
                  <th scope="col">Phone</th>
                  <th scope="col">
                    <span className="term">
                      Stage
                      <InfoTip term="stage" />
                    </span>
                  </th>
                  <th scope="col">Next step</th>
                  <th scope="col">Added</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((l) => (
                  <tr
                    key={l.id}
                    className="is-link"
                    onClick={() => navigate(`/office/leads/${l.id}`)}
                  >
                    <td>
                      <Link
                        to={`/office/leads/${l.id}`}
                        className="cell-link"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {l.name}
                      </Link>
                      <span className="cell-sub">
                        {l.location} · {l.propertyType} · via {l.source}
                      </span>
                    </td>
                    <td className="muted cell-time">{l.phone}</td>
                    <td>
                      <Badge tone={stageTone(l.stage)}>{l.stage}</Badge>
                    </td>
                    <td className="muted">{journeyFor(db, l).next.label}</td>
                    <td className="muted cell-time">{fmtDate(l.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <LeadDialog
        open={adding}
        onClose={() => setAdding(false)}
        onSaved={(id) => navigate(`/office/leads/${id}`)}
      />
    </OfficeShell>
  );
}

const emptyLead = {
  name: "",
  phone: "",
  location: "",
  address: "",
  state: "Lagos",
  source: "Call" as LeadSource,
  propertyType: "Home" as PropertyType,
  notes: "",
  whatsappConsent: true,
};

/** E2-1: log an enquiry from a call, WhatsApp or walk-in. */
export function LeadDialog({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: (id: string) => void;
}) {
  const [f, setF] = useState(emptyLead);
  const set =
    <K extends keyof typeof f>(k: K) =>
    (v: (typeof f)[K]) =>
      setF((x) => ({ ...x, [k]: v }));
  const valid =
    f.name.trim() &&
    f.phone.replace(/\D/g, "").length >= 10 &&
    f.location.trim();

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Log enquiry"
      wide
      actions={
        <>
          <Button variant="text" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!valid}
            onClick={() => {
              const id = createLead({
                ...f,
                address: f.address || f.location,
                notes: f.notes || undefined,
              });
              setF(emptyLead);
              onClose();
              onSaved(id);
            }}
          >
            Save lead
          </Button>
        </>
      }
    >
      <div className="grid-auto">
        <TextField
          id="ld-name"
          label="Name"
          value={f.name}
          onChange={set("name")}
          required
        />
        <TextField
          id="ld-phone"
          label="Phone"
          type="tel"
          inputMode="tel"
          value={f.phone}
          onChange={set("phone")}
          required
        />
        <TextField
          id="ld-loc"
          label="Area"
          value={f.location}
          onChange={set("location")}
          placeholder="e.g. Lekki Phase 1"
          required
        />
        <TextField
          id="ld-addr"
          label="Address"
          value={f.address}
          onChange={set("address")}
        />
        <SelectField
          id="ld-state"
          label="State"
          value={f.state}
          onChange={set("state")}
          options={Object.keys(sunHoursByState)}
        />
        <SelectField
          id="ld-src"
          label="Source"
          value={f.source}
          onChange={set("source")}
          options={sources}
        />
        <SelectField
          id="ld-prop"
          label="Property type"
          value={f.propertyType}
          onChange={set("propertyType")}
          options={propertyTypes}
        />
      </div>
      <TextArea
        id="ld-notes"
        label="Notes"
        value={f.notes}
        onChange={set("notes")}
        rows={2}
      />
      <ConsentCheckbox
        checked={f.whatsappConsent}
        onChange={set("whatsappConsent")}
      />
    </Dialog>
  );
}

export function ConsentCheckbox({
  checked,
  onChange,
  label = "Customer agrees to receive quotes and updates on WhatsApp",
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label?: string;
}) {
  return (
    <label
      style={{
        display: "flex",
        gap: 12,
        alignItems: "center",
        cursor: "pointer",
        minHeight: 44,
      }}
      className="t-body"
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        style={{
          width: 20,
          height: 20,
          accentColor: "var(--primary)",
          margin: 0,
        }}
      />
      {label}
    </label>
  );
}

/** Change stage; Lost asks for a reason. */
export function StageControl({ lead }: { lead: Lead }) {
  const canEdit = useCan("edit.leads");
  const [lostOpen, setLostOpen] = useState(false);
  const [reason, setReason] = useState("");
  if (!canEdit) return <Badge tone={stageTone(lead.stage)}>{lead.stage}</Badge>;
  return (
    <>
      <div className="field stage-select">
        <label htmlFor="stage">Stage</label>
        <select
          id="stage"
          value={lead.stage}
          onChange={(e) => {
            const s = e.target.value as LeadStage;
            if (s === "Lost") setLostOpen(true);
            else setLeadStage(lead.id, s);
          }}
        >
          {stages.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
      </div>
      <Dialog
        open={lostOpen}
        onClose={() => setLostOpen(false)}
        title="Mark as lost"
        actions={
          <>
            <Button variant="text" onClick={() => setLostOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                setLeadStage(
                  lead.id,
                  "Lost",
                  reason ? `Lost: ${reason}` : undefined,
                );
                setReason("");
                setLostOpen(false);
              }}
            >
              Mark lost
            </Button>
          </>
        }
      >
        <TextArea
          id="lost-reason"
          label="Why was it lost?"
          value={reason}
          onChange={setReason}
          placeholder="e.g. Chose a cheaper installer"
        />
      </Dialog>
    </>
  );
}
