// Plain-language meanings of the solar and app terms, shared by the tooltips and the Help page,
// so each term is explained the same way everywhere.
export const glossary = {
  kva: { term: 'kVA (inverter size)', text: 'How much power the inverter can supply at once. Add up the appliances that run together; a 5 kVA inverter handles about 4,000 W.' },
  kwh: { term: 'kWh (battery size)', text: 'How much energy the batteries store. A 10 kWh battery runs a 1,000 W load for about 10 hours (less in practice, as batteries are not fully drained).' },
  backup: { term: 'Night backup', text: 'Roughly how many hours the batteries keep the chosen appliances running with no sun and no grid.' },
  peakLoad: { term: 'Peak load', text: 'The most power used at the same moment, in watts. It sets the inverter size.' },
  dailyEnergy: { term: 'Daily energy', text: 'Total energy used in a day (watts × hours for every appliance). It sets the battery and panel sizes.' },
  sunHours: { term: 'Sun hours', text: 'Hours of strong sunlight a day in that state. Fewer sun hours need more panels.' },
  deposit: { term: 'Deposit', text: 'The part the customer pays when they accept the quote online. Accepting creates the installation job, ready to schedule.' },
  balance: { term: 'Balance', text: 'What is left after the deposit. It is due at handover, and reminders go out automatically if it is late.' },
  margin: { term: 'Margin', text: 'Profit as a share of the selling price: (price − cost) ÷ price. Only owners can see costs and margins.' },
  unitCost: { term: 'Unit cost', text: 'What one item costs you. Set it in the price list; it is used for margins and is never shown to customers or technicians.' },
  options: { term: 'Quote options', text: 'Up to three versions of the same quote (for example Basic, Recommended, Premium). The customer picks one when they accept.' },
  pendingApproval: { term: 'Awaiting approval', text: 'Cash or bank payments recorded by staff wait for the owner to confirm the money arrived. Card and online payments are confirmed automatically.' },
  collected: { term: 'Collected', text: 'Money received this month, from all invoices.' },
  owed: { term: 'Owed by customers', text: 'Everything invoiced and not yet paid, including balances that are not due yet.' },
  winRate: { term: 'Win rate', text: 'Accepted quotes as a share of all quotes sent in the last 90 days.' },
  plan: { term: 'Maintenance plan', text: 'A yearly service package. Customers on a plan get their visits scheduled and reminded; you get recurring income.' },
  installedSystem: { term: 'Installed system', text: 'Each finished installation is recorded with its serial numbers and warranty dates, so you can handle faults and warranty claims.' },
  faultReport: { term: 'Fault report', text: 'Customers report problems from the link on their handover report. Each report becomes a ticket you can book a repair for.' },
  survey: { term: 'Site survey', text: 'A visit to record the appliances, roof and wiring. The app turns it into a suggested system size for the quote.' },
  enquiryLink: { term: 'Enquiry form link', text: 'A web form for your website or social pages. Every enquiry sent through it becomes a new customer here and notifies your team.' },
  sync: { term: 'Sync', text: 'Technicians can work with no signal. Their changes are kept on the phone and sent when the signal returns.' },
  stage: { term: 'Stage', text: 'Where a customer is: New, Surveyed, Quoted, Won or Lost. It moves on by itself as you survey, quote and get paid.' },
} as const;

export type GlossaryKey = keyof typeof glossary;
