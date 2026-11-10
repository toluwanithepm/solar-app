import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import '@fontsource-variable/inter';
import './styles/global.css';
import './styles/layout.css';

import { BackendGate } from './components/BackendStatus';
import { homeFor, RequirePermission } from './components/Guards';
import { isNativeApp } from './data/remote/secureStore';
import { PublicPage } from './components/PublicPage';
import { isBackend, syncPending, useCurrentUser } from './data/store';
import { runAutomations } from './data/workflows';

import { Landing } from './screens/Landing';
import { SignIn } from './screens/auth/SignIn';
import { SignUp } from './screens/auth/SignUp';

import { Today } from './screens/tech/Today';
import { AllJobs } from './screens/tech/AllJobs';
import { TechCustomers } from './screens/tech/Customers';
import { JobDetail } from './screens/tech/JobDetail';
import { Checklist } from './screens/tech/Checklist';
import { SerialScan } from './screens/tech/SerialScan';
import { Handover } from './screens/tech/Handover';
import { SiteSurvey } from './screens/tech/SiteSurvey';

import { CustomerQuote } from './screens/customer/CustomerQuote';
import { PayInvoice } from './screens/customer/PayInvoice';
import { EnquiryForm } from './screens/customer/EnquiryForm';
import { ReportFault } from './screens/customer/ReportFault';
import { HandoverReport } from './screens/customer/HandoverReport';

import { Dashboard } from './screens/office/Dashboard';
import { Leads } from './screens/office/Leads';
import { LeadDetail } from './screens/office/LeadDetail';
import { Quotes } from './screens/office/Quotes';
import { QuoteBuilder } from './screens/office/QuoteBuilder';
import { Schedule } from './screens/office/Schedule';
import { OfficeJob } from './screens/office/OfficeJob';
import { Service } from './screens/office/Service';
import { Installations } from './screens/office/Installations';
import { InstallationDetail } from './screens/office/InstallationDetail';
import { Payments } from './screens/office/Payments';
import { Reports } from './screens/office/Reports';
import { Settings } from './screens/office/settings/Settings';

// Demo mode stands in for the server: reminders for balances, services and plan renewals (E8-1, E8-2, E9-3).
// In backend mode the database runs them hourly (app.run_automations).
if (!isBackend) {
  runAutomations();
  setInterval(() => runAutomations(), 60 * 60 * 1000);
  syncPending();
}

// Opened from the home-screen icon (installed web app) or inside the Android shell
const isInstalledApp = isNativeApp || window.matchMedia('(display-mode: standalone)').matches || new URLSearchParams(window.location.search).has('app');

/** An installed app has no marketing page: open on the user's work, or on sign-in. */
function NativeStart() {
  const user = useCurrentUser();
  return <Navigate to={user ? homeFor(user.role) : '/signin'} replace />;
}

const tech = (el: React.ReactNode) => <RequirePermission perm="tech.access">{el}</RequirePermission>;
const office = (el: React.ReactNode) => <RequirePermission perm="office.access">{el}</RequirePermission>;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <BackendGate>
      <Routes>
        <Route path="/" element={isInstalledApp ? <NativeStart /> : <Landing />} />
        <Route path="/signin" element={<SignIn />} />
        <Route path="/signup" element={<SignUp />} />

        {/* Technician app (Android, offline-first) */}
        <Route path="/tech" element={tech(<Today />)} />
        <Route path="/tech/jobs" element={tech(<AllJobs />)} />
        <Route path="/tech/customers" element={tech(<TechCustomers />)} />
        <Route path="/tech/jobs/:jobId" element={tech(<JobDetail />)} />
        <Route path="/tech/jobs/:jobId/work" element={tech(<Checklist />)} />
        <Route path="/tech/jobs/:jobId/scan" element={tech(<SerialScan />)} />
        <Route path="/tech/jobs/:jobId/handover" element={tech(<Handover />)} />
        <Route path="/tech/survey/:surveyId" element={tech(<SiteSurvey />)} />

        {/* Customer-facing links (no sign-in) */}
        {/* In backend mode these open from link tokens; see components/PublicPage.tsx */}
        <Route path="/q/:quoteId" element={<PublicPage kind="quote" param="quoteId"><CustomerQuote /></PublicPage>} />
        <Route path="/pay/:invoiceId" element={<PublicPage kind="invoice" param="invoiceId"><PayInvoice /></PublicPage>} />
        <Route path="/enquire" element={<EnquiryForm />} />
        <Route path="/enquire/:firmToken" element={<EnquiryForm />} />
        <Route path="/report/:installationId" element={<PublicPage kind="fault_report" param="installationId"><ReportFault /></PublicPage>} />
        <Route path="/handover/:jobId" element={<PublicPage kind="handover" param="jobId"><HandoverReport /></PublicPage>} />

        {/* Office web app */}
        <Route path="/office" element={office(<Dashboard />)} />
        <Route path="/office/leads" element={office(<Leads />)} />
        <Route path="/office/leads/:leadId" element={office(<LeadDetail />)} />
        <Route path="/office/quotes" element={office(<Quotes />)} />
        <Route path="/office/quotes/:quoteId" element={office(<QuoteBuilder />)} />
        <Route path="/office/schedule" element={office(<Schedule />)} />
        <Route path="/office/jobs/:jobId" element={office(<OfficeJob />)} />
        <Route path="/office/service" element={office(<Service />)} />
        <Route path="/office/installations" element={office(<Installations />)} />
        <Route path="/office/installations/:installationId" element={office(<InstallationDetail />)} />
        <Route path="/office/payments" element={office(<Payments />)} />
        <Route path="/office/reports" element={office(<Reports />)} />
        <Route path="/office/settings/*" element={office(<Settings />)} />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      </BackendGate>
    </BrowserRouter>
  </StrictMode>,
);

// Built app only: keep the app shell on the device so it opens with no connection (NFR-1)
if (import.meta.env.PROD && !isNativeApp && 'serviceWorker' in navigator) {
  window.addEventListener('load', async () => {
    await navigator.serviceWorker.register('/sw.js');
    // Hand the worker everything this visit loaded, so the first visit is enough to open offline
    const reg = await navigator.serviceWorker.ready;
    const urls = [location.origin + '/', ...performance.getEntriesByType('resource').map((e) => e.name)].filter((u) => u.startsWith(location.origin));
    reg.active?.postMessage({ type: 'cache-urls', urls });
  });
}
