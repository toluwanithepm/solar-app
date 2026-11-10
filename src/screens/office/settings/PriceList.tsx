import '../../../styles/settings-auth.css';
import { useRef, useState } from 'react';
import { useCan } from '../../../components/Guards';
import { Icon } from '../../../components/Icon';
import { Dialog, MoneyField, MoneyInput, SelectField, TextField } from '../../../components/forms';
import { Badge, Button, EmptyState, Segmented } from '../../../components/ui';
import { categoryLabel, defaultWarrantyYears, naira } from '../../../data/domain';
import { deletePriceItem, importPriceItems, savePriceItem as saveItem } from '../../../data/settingsActions';
import { uid, useDb } from '../../../data/store';
import type { ItemCategory, PriceItem } from '../../../data/types';
import { downloadCsv, parseCsv } from '../../../lib/export';
import { brandTemplates, type Template } from './brandTemplates';

const categories: ItemCategory[] = ['panel', 'battery', 'inverter', 'accessory', 'service'];
const csvHeader = ['brand', 'model', 'category', 'watts', 'ah', 'volts', 'kwh', 'kva', 'cost', 'price', 'warranty_years'];

const spec = (i: Pick<PriceItem, 'category' | 'watts' | 'ah' | 'volts' | 'kwh' | 'kva'>) =>
  i.category === 'panel' ? `${i.watts ?? '?'} W` : i.category === 'battery' ? [i.kwh && `${i.kwh} kWh`, i.ah && `${i.ah} Ah`, i.volts && `${i.volts} V`].filter(Boolean).join(' · ') : i.category === 'inverter' ? `${i.kva ?? '?'} kVA` : '—';

export function PriceList() {
  const items = useDb((d) => d.priceItems);
  const canEdit = useCan('edit.prices');
  const canCost = useCan('view.costs');
  const [filter, setFilter] = useState<ItemCategory | 'all'>('all');
  const [editing, setEditing] = useState<PriceItem | null>(null);
  const [library, setLibrary] = useState(false);
  const [importRows, setImportRows] = useState<{ items: PriceItem[]; errors: string[] } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const shown = items.filter((i) => filter === 'all' || i.category === filter);

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
        <Segmented label="Category" value={filter} onChange={setFilter} options={[{ id: 'all' as const, name: 'All' }, ...categories.filter((c) => c !== 'service').map((c) => ({ id: c, name: `${categoryLabel[c]}s` }))]} />
        <span style={{ flexGrow: 1 }} />
        {canEdit && (
          <>
            <Button variant="text" onClick={() => downloadCsv('price-list-template.csv', [csvHeader, ['Longi', 'Hi-MO 5 550', 'panel', 550, '', '', '', '', 78000, 95000, 10]])}>
              <Icon name="download" size={18} />
              CSV template
            </Button>
            <Button variant="tonal" onClick={() => fileRef.current?.click()}>
              <Icon name="upload" size={18} />
              Import CSV
            </Button>
            <Button variant="tonal" onClick={() => setLibrary(true)}>
              Brand library
            </Button>
            <Button onClick={() => setEditing({ id: uid('p_'), category: 'panel', brand: '', model: '', cost: 0, price: 0, warrantyYears: defaultWarrantyYears.panel })}>Add item</Button>
          </>
        )}
        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv"
          hidden
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) setImportRows(parseImport(await f.text()));
          }}
        />
      </div>

      <section className="card" aria-label="Price list">
        {shown.length === 0 ? (
          <EmptyState title="No items yet">Add items, import a CSV or start from the brand library.</EmptyState>
        ) : (
          <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Item</th>
                <th scope="col">Category</th>
                <th scope="col">Specs</th>
                {canCost && (
                  <th scope="col" className="num">
                    Cost
                  </th>
                )}
                <th scope="col" className="num">
                  Selling price
                </th>
                {canCost && (
                  <th scope="col" className="num">
                    Margin
                  </th>
                )}
                <th scope="col">Warranty</th>
                {canEdit && <th scope="col" aria-label="Actions" />}
              </tr>
            </thead>
            <tbody>
              {shown.map((i) => (
                <tr key={i.id}>
                  <td>
                    <span className="strong">{i.brand}</span> {i.model}
                  </td>
                  <td>
                    <Badge tone="neutral">{categoryLabel[i.category]}</Badge>
                  </td>
                  <td className="muted">{spec(i)}</td>
                  {canCost && <td className="num muted">{naira(i.cost)}</td>}
                  <td className="num strong">{naira(i.price)}</td>
                  {canCost && <td className="num muted">{i.price ? `${(((i.price - i.cost) / i.price) * 100).toFixed(0)}%` : '—'}</td>}
                  <td className="muted">{i.warrantyYears} yr</td>
                  {canEdit && (
                    <td className="num">
                      <button type="button" className="icon-btn" aria-label={`Edit ${i.brand} ${i.model}`} onClick={() => setEditing(i)} style={{ width: 32, height: 32 }}>
                        <Icon name="edit" size={16} />
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </section>
      {!canCost && <span className="t-small muted">Costs and margins are visible to owners only.</span>}

      {editing && <ItemDialog item={editing} isNew={!items.some((i) => i.id === editing.id)} onClose={() => setEditing(null)} />}
      {library && <LibraryDialog onClose={() => setLibrary(false)} />}
      {importRows && (
        <Dialog
          open
          onClose={() => setImportRows(null)}
          title="Import price list"
          actions={
            <Button
              disabled={!importRows.items.length}
              onClick={() => {
                importPriceItems(importRows.items);
                setImportRows(null);
              }}
            >
              Import {importRows.items.length} item{importRows.items.length === 1 ? '' : 's'}
            </Button>
          }
        >
          <span className="t-body">{importRows.items.length} rows ready to import.</span>
          {importRows.errors.length > 0 && (
            <div className="stack" style={{ gap: 4 }}>
              <span className="t-small danger">{importRows.errors.length} rows skipped:</span>
              <ul className="t-small muted" style={{ margin: 0, paddingLeft: 20, maxHeight: 160, overflowY: 'auto' }}>
                {importRows.errors.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            </div>
          )}
        </Dialog>
      )}
    </div>
  );
}

function parseImport(text: string) {
  const rows = parseCsv(text);
  const head = (rows.shift() ?? []).map((h) => h.trim().toLowerCase());
  const col = (r: string[], k: string) => r[head.indexOf(k)]?.trim() ?? '';
  const n = (v: string) => (v === '' ? undefined : Number(v.replace(/[₦,\s]/g, '')));
  const items: PriceItem[] = [];
  const errors: string[] = [];
  if (!head.includes('brand') || !head.includes('price')) return { items, errors: ['The first row must be the header: ' + csvHeader.join(',')] };
  rows.forEach((r, i) => {
    const category = col(r, 'category').toLowerCase() as ItemCategory;
    const price = n(col(r, 'price'));
    const cost = n(col(r, 'cost')) ?? 0;
    if (!categories.includes(category)) return errors.push(`Row ${i + 2}: category must be one of ${categories.join(', ')}`);
    if (!col(r, 'brand') || !col(r, 'model')) return errors.push(`Row ${i + 2}: brand and model are required`);
    if (price === undefined || Number.isNaN(price) || Number.isNaN(cost)) return errors.push(`Row ${i + 2}: price must be a number`);
    items.push({
      id: uid('p_'),
      category,
      brand: col(r, 'brand'),
      model: col(r, 'model'),
      watts: n(col(r, 'watts')),
      ah: n(col(r, 'ah')),
      volts: n(col(r, 'volts')),
      kwh: n(col(r, 'kwh')),
      kva: n(col(r, 'kva')),
      cost,
      price,
      warrantyYears: n(col(r, 'warranty_years')) ?? defaultWarrantyYears[category],
    });
  });
  return { items, errors };
}

function ItemDialog({ item, isNew, onClose }: { item: PriceItem; isNew: boolean; onClose: () => void }) {
  const canCost = useCan('view.costs');
  const [it, setIt] = useState(item);
  const field = (k: 'watts' | 'ah' | 'volts' | 'kwh' | 'kva' | 'warrantyYears') => ({
    value: it[k] === undefined ? '' : String(it[k]),
    onChange: (v: string) => setIt({ ...it, [k]: v === '' ? undefined : Number(v) }),
  });
  const valid = it.brand.trim() && it.model.trim() && it.price > 0;
  return (
    <Dialog
      open
      onClose={onClose}
      title={isNew ? 'Add item' : 'Edit item'}
      actions={
        <>
          {!isNew && (
            <Button
              variant="text"
              onClick={() => {
                deletePriceItem(item);
                onClose();
              }}
            >
              Delete
            </Button>
          )}
          <Button
            disabled={!valid}
            onClick={() => {
              saveItem({ ...it, brand: it.brand.trim(), model: it.model.trim(), cost: it.cost || 0, warrantyYears: it.warrantyYears || 0 });
              onClose();
            }}
          >
            Save
          </Button>
        </>
      }
    >
      <div className="grid-auto" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(180px, 100%), 1fr))' }}>
        <SelectField id="it-cat" label="Category" value={it.category} onChange={(c) => setIt({ ...it, category: c, warrantyYears: isNew ? defaultWarrantyYears[c] : it.warrantyYears })} options={categories.map((c) => ({ value: c, label: categoryLabel[c] }))} />
        <TextField id="it-brand" label="Brand" value={it.brand} onChange={(v) => setIt({ ...it, brand: v })} />
        <TextField id="it-model" label="Model" value={it.model} onChange={(v) => setIt({ ...it, model: v })} />
        {it.category === 'panel' && <TextField id="it-w" label="Power (W)" type="number" min={0} {...field('watts')} />}
        {it.category === 'battery' && (
          <>
            <TextField id="it-kwh" label="Capacity (kWh)" type="number" min={0} step="0.1" {...field('kwh')} />
            <TextField id="it-ah" label="Capacity (Ah)" type="number" min={0} {...field('ah')} />
            <TextField id="it-v" label="Voltage (V)" type="number" min={0} {...field('volts')} />
          </>
        )}
        {it.category === 'inverter' && <TextField id="it-kva" label="Rating (kVA)" type="number" min={0} step="0.5" {...field('kva')} />}
        {canCost && <MoneyField id="it-cost" label="Cost" value={it.cost ?? ''} onChange={(v) => setIt({ ...it, cost: v })} />}
        <MoneyField id="it-price" label="Selling price" value={it.price ?? ''} onChange={(v) => setIt({ ...it, price: v })} />
        <TextField id="it-war" label="Warranty (years)" type="number" min={0} {...field('warrantyYears')} />
      </div>
      {canCost && it.price > 0 && <span className="t-small muted">Margin {(((it.price - (it.cost || 0)) / it.price) * 100).toFixed(1)}%</span>}
    </Dialog>
  );
}

function LibraryDialog({ onClose }: { onClose: () => void }) {
  const items = useDb((d) => d.priceItems);
  const canCost = useCan('view.costs');
  const [prices, setPrices] = useState<Record<number, { cost: string; price: string }>>(() => Object.fromEntries(brandTemplates.map((t, i) => [i, { cost: String(t.cost), price: String(t.price) }])));
  const has = (t: Template) => items.some((i) => i.brand === t.brand && i.model === t.model);

  return (
    <Dialog open onClose={onClose} title="Brand library" wide>
      <span className="t-small muted" style={{ marginTop: -8 }}>Common panels, batteries and inverters with specs filled in. Check the prices, then add them to your list.</span>
      <div className="table-scroll card" style={{ maxHeight: '55vh', overflowY: 'auto', marginRight: 8 }}>
        <table className="table" style={{ minWidth: 620 }}>
          <thead>
            <tr>
              <th scope="col">Item</th>
              <th scope="col">Specs</th>
              {canCost && (
                <th scope="col" className="num">
                  Cost
                </th>
              )}
              <th scope="col" className="num">
                Price
              </th>
              <th scope="col" aria-label="Add" />
            </tr>
          </thead>
          <tbody>
            {brandTemplates.map((t, i) => (
              <tr key={`${t.brand}-${t.model}`}>
                <td>
                  <span className="strong">{t.brand}</span> {t.model}
                  <div className="t-caption faint">{categoryLabel[t.category]}</div>
                </td>
                <td className="muted">{spec(t)}</td>
                {canCost && (
                  <td className="num">
                    <span className="set-money" style={{ display: 'inline-block' }}>
                      <MoneyInput ariaLabel={`Cost of ${t.brand} ${t.model}`} value={prices[i].cost === '' ? '' : Number(prices[i].cost)} onChange={(v) => setPrices({ ...prices, [i]: { ...prices[i], cost: String(v) } })} />
                    </span>
                  </td>
                )}
                <td className="num">
                  <span className="set-money" style={{ display: 'inline-block' }}>
                    <MoneyInput ariaLabel={`Price of ${t.brand} ${t.model}`} value={prices[i].price === '' ? '' : Number(prices[i].price)} onChange={(v) => setPrices({ ...prices, [i]: { ...prices[i], price: String(v) } })} />
                  </span>
                </td>
                <td className="num">
                  {has(t) ? (
                    <Badge tone="green">Added</Badge>
                  ) : (
                    <Button size="sm" variant="tonal" onClick={() => saveItem({ ...t, id: uid('p_'), cost: Number(prices[i].cost) || 0, price: Number(prices[i].price) || t.price })}>
                      Add
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Dialog>
  );
}
