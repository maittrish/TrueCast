import { useEffect, useState } from 'react';
import { Shield, ExternalLink } from 'lucide-react';
import { OfficerConsoleView } from './components/OfficerConsoleView';
import type { OfficerSession } from './types/trustcast';

export default function OfficerApp() {
  const [officerSession, setOfficerSession] = useState<OfficerSession | null>(null);
  const [checkingSession, setCheckingSession] = useState(true);

  useEffect(() => {
    fetch('/api/officer/session', { credentials: 'same-origin', cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data && data.authenticated) {
          setOfficerSession({
            officer_token: data.officer_token,
            officer_id: data.officer_id,
            officer_name: data.officer_name,
          });
        }
      })
      .catch(() => {})
      .finally(() => setCheckingSession(false));
  }, []);

  return (
    <div className="min-h-screen flex flex-col">
      <div className="h-0.5 w-full bg-gradient-to-r from-[#FF9933] via-slate-200 to-[#138808]" />

      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/95 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-6 px-6 py-4">
          <div className="flex items-center gap-2.5">
            <Shield className="h-5 w-5 text-blue-700 shrink-0" />
            <span className="font-display text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap">
              TrustCast · Authority Control
            </span>
          </div>

          <a
            href="/"
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50 whitespace-nowrap shrink-0"
          >
            Public Voter Site
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-10">
        {checkingSession ? (
          <div className="mx-auto max-w-lg civic-card rounded-2xl p-8 text-center text-sm text-slate-500">
            Verifying Returning Officer authority session...
          </div>
        ) : (
          <OfficerConsoleView
            officerSession={officerSession}
            onOfficerAuthenticated={setOfficerSession}
            onOfficerLoggedOut={() => setOfficerSession(null)}
          />
        )}
      </main>

      <footer className="border-t border-slate-200 bg-white py-6">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-6 text-xs text-slate-500">
          <span>TrustCast · Restricted Returning Officer Portal · 2026</span>
          <span>Authorized Election Commission Personnel Only</span>
        </div>
      </footer>
    </div>
  );
}
