import { useCallback, useEffect, useState } from 'react';
import { VoterAuthView } from './components/VoterAuthView';
import { BallotView } from './components/BallotView';
import { AnalyticsDashboardView } from './components/AnalyticsDashboardView';
import type { ActiveView, VoteReceipt, VotingSession } from './types/trustcast';

export default function App() {
  const [activeView, setActiveView] = useState<ActiveView>('auth');
  const [session, setSession] = useState<VotingSession | null>(null);
  const [receipt, setReceipt] = useState<VoteReceipt | null>(null);
  const [postVoteLocked, setPostVoteLocked] = useState(false);
  const [prefillReceiptHash, setPrefillReceiptHash] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/session', { credentials: 'same-origin', cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data && data.authenticated) {
          setSession({
            session_token: data.session_token,
            csrf_token: data.csrf_token,
            expires_at_unix: data.expires_at_unix,
            constituency: data.constituency,
          });
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!postVoteLocked) return;

    window.history.pushState({ trustcastLocked: true }, '', window.location.href);
    const handlePopState = () => {
      window.history.pushState({ trustcastLocked: true }, '', window.location.href);
      setActiveView((current) => (current === 'ballot' ? 'ballot' : 'dashboard'));
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [postVoteLocked]);

  const handleAuthenticated = useCallback((newSession: VotingSession) => {
    setReceipt(null);
    setPostVoteLocked(false);
    setSession(newSession);
    setActiveView('ballot');
  }, []);

  const handleSessionExpired = useCallback(() => {
    const token = session?.session_token;
    setSession(null);
    try {
      localStorage.clear();
      sessionStorage.clear();
    } catch {
      // Ignore storage errors
    }
    fetch('/api/logout', {
      method: 'POST',
      credentials: 'same-origin',
      headers: token ? { 'X-TrustCast-Session': token } : undefined,
    }).catch(() => {});
    setActiveView('auth');
  }, [session]);

  const handleVoteCommitted = useCallback((newReceipt: VoteReceipt) => {
    setSession(null);
    setReceipt(newReceipt);
    setPostVoteLocked(true);
    try {
      localStorage.clear();
      sessionStorage.clear();
    } catch {
      // Ignore storage errors
    }
  }, []);

  const handleVerifyReceiptOnDashboard = useCallback((hash: string) => {
    setPrefillReceiptHash(hash);
    setActiveView('dashboard');
  }, []);

  const navItems: Array<{ id: ActiveView; label: string }> = [
    { id: 'auth', label: 'Voter Portal' },
    { id: 'ballot', label: 'Cast Ballot' },
    { id: 'dashboard', label: 'Live Results' },
  ];

  return (
    <div className="min-h-screen flex flex-col">
      {/* Subtle 2px Sovereign Accent Hairline */}
      <div className="h-0.5 w-full bg-gradient-to-r from-[#FF9933] via-slate-200 to-[#138808]" />

      {/* 3-Zone Top Bar Contract */}
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/95 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-8 px-6 py-4">
          <button
            type="button"
            onClick={() => setActiveView('auth')}
            className="font-display text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 rounded-md"
          >
            TrustCast
          </button>

          <nav aria-label="Primary Navigation" className="hidden md:flex items-center gap-7">
            {navItems.map((item) => {
              const isActive = activeView === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActiveView(item.id)}
                  className={`text-sm font-medium transition-colors whitespace-nowrap shrink-0 underline-offset-8 ${
                    isActive
                      ? 'text-blue-700 underline decoration-blue-700 decoration-2'
                      : 'text-slate-600 hover:text-slate-900 hover:underline hover:decoration-slate-300'
                  }`}
                >
                  {item.label}
                </button>
              );
            })}
          </nav>

          <div className="flex items-center shrink-0">
            <button
              type="button"
              onClick={() => setActiveView('dashboard')}
              className="rounded-xl bg-blue-700 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-blue-800 whitespace-nowrap shrink-0"
            >
              Verify Receipt
            </button>
          </div>
        </div>

        <div className="flex md:hidden items-center gap-4 overflow-x-auto border-t border-slate-100 px-6 py-2.5">
          {navItems.map((item) => {
            const isActive = activeView === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveView(item.id)}
                className={`text-xs font-medium whitespace-nowrap shrink-0 ${
                  isActive ? 'text-blue-700 font-semibold' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {item.label}
              </button>
            );
          })}
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-10">
        {activeView === 'auth' && (
          <VoterAuthView
            onAuthenticated={handleAuthenticated}
            onOpenDashboard={() => setActiveView('dashboard')}
          />
        )}

        {activeView === 'ballot' && (
          <BallotView
            session={session}
            receipt={receipt}
            onSessionExpired={handleSessionExpired}
            onVoteCommitted={handleVoteCommitted}
            onOpenAuth={() => setActiveView('auth')}
            onVerifyReceiptOnDashboard={handleVerifyReceiptOnDashboard}
          />
        )}

        {activeView === 'dashboard' && (
          <AnalyticsDashboardView prefillReceiptHash={prefillReceiptHash} />
        )}
      </main>

      <footer className="border-t border-slate-200 bg-white py-6">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-6 text-xs text-slate-500">
          <span>TrustCast · Indian Constitutional Electronic Voting Infrastructure · 2026</span>
          <div className="flex items-center gap-5">
            <button
              type="button"
              onClick={() => setActiveView('dashboard')}
              className="hover:text-slate-800 transition-colors"
            >
              Public Ledger Audit
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
}
