import { useEffect, useRef, type ReactNode } from 'react';
import { Icon } from './Icon';

type FieldProps = {
  label: string;
  hint?: string;
  children: ReactNode;
  style?: React.CSSProperties;
};

/** Label + control + hint. Pass the control as a child; give it an id matching htmlFor via `id`. */
export function Field({ label, hint, children, style, id }: FieldProps & { id: string }) {
  return (
    <div className="field" style={style}>
      <label htmlFor={id}>{label}</label>
      {children}
      {hint && <span className="t-small muted">{hint}</span>}
    </div>
  );
}

export function TextField({
  id,
  label,
  value,
  onChange,
  type = 'text',
  placeholder,
  hint,
  required,
  inputMode,
  style,
  min,
  step,
}: {
  id: string;
  label: string;
  value: string | number;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
  hint?: string;
  required?: boolean;
  inputMode?: React.HTMLAttributes<HTMLInputElement>['inputMode'];
  style?: React.CSSProperties;
  min?: number;
  step?: number | string;
}) {
  return (
    <Field id={id} label={label} hint={hint} style={style}>
      <input id={id} type={type} value={value} placeholder={placeholder} required={required} inputMode={inputMode} min={min} step={step} onChange={(e) => onChange(e.target.value)} />
    </Field>
  );
}

export function SelectField<T extends string>({
  id,
  label,
  value,
  onChange,
  options,
  hint,
  style,
}: {
  id: string;
  label: string;
  value: T;
  onChange: (v: T) => void;
  options: readonly (T | { value: T; label: string })[];
  hint?: string;
  style?: React.CSSProperties;
}) {
  return (
    <Field id={id} label={label} hint={hint} style={style}>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value as T)}>
        {options.map((o) => {
          const v = typeof o === 'string' ? o : o.value;
          const l = typeof o === 'string' ? o : o.label;
          return (
            <option key={v} value={v}>
              {l}
            </option>
          );
        })}
      </select>
    </Field>
  );
}

export function TextArea({ id, label, value, onChange, rows = 3, placeholder }: { id: string; label: string; value: string; onChange: (v: string) => void; rows?: number; placeholder?: string }) {
  return (
    <Field id={id} label={label}>
      <textarea id={id} rows={rows} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
    </Field>
  );
}

/** Modal dialog on the native <dialog> element (focus trap and Esc for free). */
export function Dialog({ open, onClose, title, children, actions, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; actions?: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);
  return (
    <dialog ref={ref} className={`dialog${wide ? ' dialog--wide' : ''}`} onClose={onClose} onCancel={onClose} aria-labelledby="dialog-title">
      {open && (
        <div className="dialog__body">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <h2 id="dialog-title" className="t-title" style={{ flexGrow: 1 }}>
              {title}
            </h2>
            <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
              <Icon name="close" />
            </button>
          </div>
          {children}
          {actions && <div className="dialog__actions">{actions}</div>}
        </div>
      )}
    </dialog>
  );
}

const group = (n: number) => n.toLocaleString('en-NG', { maximumFractionDigits: 0 });

/** Naira amount: shows "₦" and thousands separators while typing; reports a plain number. */
export function MoneyField({
  id,
  label,
  value,
  onChange,
  hint,
  style,
  required,
}: {
  id: string;
  label: string;
  value: number | '';
  onChange: (v: number) => void;
  hint?: string;
  style?: React.CSSProperties;
  required?: boolean;
}) {
  return (
    <Field id={id} label={label} hint={hint} style={style}>
      <MoneyInput id={id} value={value} onChange={onChange} required={required} />
    </Field>
  );
}

/** The bare money input (for tables and inline edits). Give it an aria-label when there is no <label>. */
export function MoneyInput({ id, value, onChange, required, ariaLabel }: { id?: string; value: number | ''; onChange: (v: number) => void; required?: boolean; ariaLabel?: string }) {
  return (
    <span className="affix">
      <span className="affix__text" aria-hidden="true">
        ₦
      </span>
      <input
        id={id}
        aria-label={ariaLabel}
        inputMode="numeric"
        autoComplete="off"
        required={required}
        value={value === '' ? '' : group(value)}
        onChange={(e) => {
          const digits = e.target.value.replace(/[^\d]/g, '');
          onChange(digits ? Number(digits) : 0);
        }}
      />
    </span>
  );
}
