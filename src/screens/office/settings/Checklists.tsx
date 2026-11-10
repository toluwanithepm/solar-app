import '../../../styles/settings-auth.css';
import { useState } from 'react';
import { useCan } from '../../../components/Guards';
import { Icon } from '../../../components/Icon';
import { Button, Segmented } from '../../../components/ui';
import { saveChecklistTemplate } from '../../../data/settingsActions';
import { uid, useDb } from '../../../data/store';
import type { ChecklistTemplate, JobType } from '../../../data/types';

const jobTypes: JobType[] = ['Installation', 'Maintenance', 'Fault repair', 'Site survey'];
type Step = ChecklistTemplate['steps'][number];

export function Checklists() {
  const templates = useDb((d) => d.checklistTemplates);
  const canEdit = useCan('manage.settings');
  const [type, setType] = useState<JobType>('Installation');
  return (
    <div className="stack" style={{ gap: 16 }}>
      <Segmented kind="tab" label="Job type" value={type} onChange={setType} options={jobTypes.map((t) => ({ id: t, name: t }))} />
      <Editor key={type} type={type} initial={templates.find((t) => t.jobType === type)?.steps ?? []} canEdit={canEdit} />
    </div>
  );
}

function Editor({ type, initial, canEdit }: { type: JobType; initial: Step[]; canEdit: boolean }) {
  const [steps, setSteps] = useState<Step[]>(initial);
  const [saved, setSaved] = useState(false);
  const dirty = JSON.stringify(steps) !== JSON.stringify(initial);
  const change = (next: Step[]) => {
    setSteps(next);
    setSaved(false);
  };
  const patch = (i: number, p: Partial<Step>) => change(steps.map((s, k) => (k === i ? { ...s, ...p } : s)));
  const move = (i: number, dir: -1 | 1) => {
    const next = [...steps];
    [next[i], next[i + dir]] = [next[i + dir], next[i]];
    change(next);
  };

  return (
    <section className="card" aria-label={`${type} checklist`}>
      <div className="card__head">
        <div className="stack" style={{ gap: 2 }}>
          <h2 className="t-section-lg">{type} checklist</h2>
          <span className="t-small muted">Required steps must be ticked before a technician can complete the job. Changes apply to new jobs.</span>
        </div>
        <span className="t-small muted" style={{ flexShrink: 0 }}>
          {steps.length} step{steps.length === 1 ? '' : 's'}
        </span>
      </div>
      <div className="stack" style={{ padding: '4px 20px 16px', gap: 8 }}>
      <ol className="set-steps">
        {steps.map((s, i) => (
          <li key={s.id} className="set-step">
            <span className="set-step__no" aria-hidden="true">
              {i + 1}
            </span>
            <input className="set-input" aria-label={`Step ${i + 1}`} value={s.label} disabled={!canEdit} onChange={(e) => patch(i, { label: e.target.value })} style={{ flex: '2 1 220px' }} />
            <input className="set-input" aria-label={`Hint for step ${i + 1}`} value={s.hint} disabled={!canEdit} placeholder="Hint" onChange={(e) => patch(i, { hint: e.target.value })} style={{ flex: '2 1 200px' }} />
            <label className="set-check">
              <input type="checkbox" checked={s.required} disabled={!canEdit} onChange={(e) => patch(i, { required: e.target.checked })} />
              Required
            </label>
            {canEdit && (
              <span style={{ display: 'flex' }}>
                <button type="button" className="icon-btn" aria-label={`Move step ${i + 1} up`} disabled={i === 0} onClick={() => move(i, -1)}>
                  <Icon name="chevronLeft" size={18} style={{ transform: 'rotate(90deg)' }} />
                </button>
                <button type="button" className="icon-btn" aria-label={`Move step ${i + 1} down`} disabled={i === steps.length - 1} onClick={() => move(i, 1)}>
                  <Icon name="chevronRight" size={18} style={{ transform: 'rotate(90deg)' }} />
                </button>
                <button type="button" className="icon-btn" aria-label={`Remove step ${i + 1}`} onClick={() => change(steps.filter((_, k) => k !== i))}>
                  <Icon name="delete" size={18} />
                </button>
              </span>
            )}
          </li>
        ))}
      </ol>
      {canEdit && (
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <Button variant="text" onClick={() => change([...steps, { id: uid('st_'), label: '', hint: '', required: true }])}>
            <Icon name="add" size={18} />
            Add step
          </Button>
          <span style={{ flexGrow: 1 }} />
          <span role="status" className="t-small success" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            {saved && <Icon name="checkCircle" size={16} />}
            {saved ? 'Saved' : ''}
          </span>
          <Button
            disabled={!dirty || steps.some((s) => !s.label.trim())}
            onClick={() => {
              const clean = steps.map((s) => ({ ...s, label: s.label.trim(), hint: s.hint.trim() || (s.required ? 'Required' : 'Optional') }));
              saveChecklistTemplate(type, clean);
              setSteps(clean);
              setSaved(true);
            }}
          >
            Save checklist
          </Button>
        </div>
      )}
      </div>
    </section>
  );
}
