// E1-3: common equipment sold in Nigeria with specs pre-filled. Prices are typical Lagos trade prices (Nov 2026) and are meant to be edited.
import type { PriceItem } from '../../../data/types';

export type Template = Omit<PriceItem, 'id'>;

export const brandTemplates: Template[] = [
  { category: 'panel', brand: 'Jinko', model: 'Tiger Neo 450', watts: 450, cost: 68_000, price: 82_000, warrantyYears: 10 },
  { category: 'panel', brand: 'Longi', model: 'Hi-MO 6 550', watts: 550, cost: 80_000, price: 97_000, warrantyYears: 10 },
  { category: 'panel', brand: 'Canadian Solar', model: 'HiKu6 400', watts: 400, cost: 60_000, price: 74_000, warrantyYears: 10 },
  { category: 'panel', brand: 'JA Solar', model: 'JAM72 540', watts: 540, cost: 77_000, price: 93_000, warrantyYears: 10 },
  { category: 'battery', brand: 'Felicity', model: 'LPBF24200', ah: 200, volts: 24, kwh: 5, cost: 690_000, price: 850_000, warrantyYears: 5 },
  { category: 'battery', brand: 'Felicity', model: 'LPBF48200', ah: 200, volts: 48, kwh: 10, cost: 1_300_000, price: 1_580_000, warrantyYears: 5 },
  { category: 'battery', brand: 'Pylontech', model: 'US5000', ah: 100, volts: 48, kwh: 4.8, cost: 720_000, price: 880_000, warrantyYears: 7 },
  { category: 'battery', brand: 'Cworth', model: 'CW-LFP 2.5 kWh', ah: 100, volts: 25.6, kwh: 2.5, cost: 380_000, price: 470_000, warrantyYears: 3 },
  { category: 'inverter', brand: 'Felicity', model: 'IVEM3024', kva: 3, cost: 520_000, price: 650_000, warrantyYears: 2 },
  { category: 'inverter', brand: 'Growatt', model: 'SPF 5000 ES', kva: 5, cost: 760_000, price: 950_000, warrantyYears: 2 },
  { category: 'inverter', brand: 'Luminous', model: 'Cruze 2 kVA', kva: 2, cost: 310_000, price: 390_000, warrantyYears: 2 },
  { category: 'inverter', brand: 'Deye', model: 'SUN-8K-SG', kva: 7.5, cost: 1_350_000, price: 1_650_000, warrantyYears: 5 },
  { category: 'inverter', brand: 'Victron', model: 'MultiPlus-II 48/5000', kva: 5, cost: 1_900_000, price: 2_300_000, warrantyYears: 5 },
];
