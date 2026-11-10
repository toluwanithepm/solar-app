// Dev server in demo mode (browser data, no Supabase), on port 5174, for UI work.
// Empty values here take priority over .env.local, so the app falls back to demo data.
import { createServer } from 'vite';

process.env.VITE_SUPABASE_URL = '';
process.env.VITE_SUPABASE_ANON_KEY = '';
const server = await createServer({ server: { port: 5174, strictPort: true } });
await server.listen();
server.printUrls();
