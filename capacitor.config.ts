import type { CapacitorConfig } from '@capacitor/cli';

// Android shell for the technician app (FRD: Android, offline-first). The web build in dist/ is packaged inside the app,
// so it opens with no connection; data and sign-in go to Supabase when there is one.
const config: CapacitorConfig = {
  // Placeholder: the application id can't change once the app is on phones or in the Play Store
  appId: 'com.solarfieldservice.app',
  appName: 'Solar Field Service',
  webDir: 'dist',
  android: {
    // The app only talks to HTTPS services
    allowMixedContent: false,
  },
};

export default config;
