import React, { useState } from 'react';
import {
  Lock,
  ShieldCheck,
  KeyRound,
  AlertCircle,
  ArrowRight,
  Smartphone,
  MapPin,
  Loader2,
} from 'lucide-react';
import type { VotingSession } from '../types/trustcast';

interface VoterAuthViewProps {
  onAuthenticated: (session: VotingSession) => void;
  onOpenDashboard: () => void;
}

const EPIC_ID_REGEX = /^[A-Z]{3}\d{7}$/;
const INDIAN_MOBILE_REGEX = /^[6-9]\d{9}$/;

const CONSTITUENCY_OPTIONS = [
  'New Delhi',
  'Mumbai South',
  'Bengaluru Central',
  'Varanasi',
  'Hyderabad',
  'Kolkata North',
  'Chennai Central',
  'Pune',
];

export const VoterAuthView: React.FC<VoterAuthViewProps> = ({
  onAuthenticated,
  onOpenDashboard,
}) => {
  const [epicId, setEpicId] = useState('');
  const [mobile, setMobile] = useState('');
  const [constituency, setConstituency] = useState('New Delhi');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleVerifyAndOpenBooth = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    const normalizedEpic = epicId.trim().toUpperCase();
    const normalizedMobile = mobile.replace(/\D/g, '').slice(-10);

    if (!EPIC_ID_REGEX.test(normalizedEpic)) {
      setErrorMsg(
        'Invalid EPIC Voter ID format. Expected 3 uppercase letters followed by 7 digits (e.g. DLH8492014).'
      );
      return;
    }

    if (!INDIAN_MOBILE_REGEX.test(normalizedMobile)) {
      setErrorMsg('Enter a valid 10-digit Indian mobile number (+91, starting with 6–9).');
      return;
    }

    if (!constituency) {
      setErrorMsg('Select your registered parliamentary constituency.');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          epic_id: normalizedEpic,
          mobile: `+91${normalizedMobile}`,
          constituency,
        }),
      });
      const data = await res.json();

      if (!res.ok || !data.success) {
        setErrorMsg(data.error || 'Electoral roll verification failed.');
        return;
      }

      onAuthenticated({
        session_token: data.session_token,
        csrf_token: data.csrf_token,
        expires_at_unix: data.expires_at_unix,
        constituency: data.constituency,
      });
    } catch {
      setErrorMsg('Network error communicating with authentication server.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-8">
      <div className="max-w-3xl space-y-2.5">
        <p className="text-xs font-medium text-slate-600">
          Lok Sabha &amp; Constitutional Digital Council · General Poll 2026 · Electoral Roll Verification
        </p>
        <h1 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
          Verify your EPIC Voter ID and roll details to open the ballot booth
        </h1>
        <p className="text-base leading-relaxed text-slate-600">
          Enter your Election Photo Identity Card (EPIC) number, registered{' '}
          <span className="font-mono-tabular font-medium text-slate-800">+91</span> mobile number, and parliamentary constituency. Once cross-verified against the electoral roll, a single-use 3-minute ballot session opens and terminates automatically on vote commit.
        </p>
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-12">
        <section className="civic-card rounded-2xl p-6 sm:p-8 lg:col-span-7">
          <div className="mb-6 border-b border-slate-200 pb-4">
            <h2 className="text-lg font-semibold text-slate-900">
              Multi-Factor Electoral Roll Check
            </h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Direct verification without external SMS OTP delays (5-attempt lockout protection active)
            </p>
          </div>

          <form onSubmit={handleVerifyAndOpenBooth} noValidate className="space-y-4">
            <div>
              <label htmlFor="epic-id-input" className="mb-1.5 block text-sm font-medium text-slate-700">
                EPIC Voter ID Number
              </label>
              <input
                id="epic-id-input"
                type="text"
                value={epicId}
                onChange={(e) => {
                  const clean = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10);
                  setEpicId(clean);
                }}
                placeholder="DLH8492014"
                maxLength={10}
                autoComplete="off"
                className="font-mono-tabular w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-base text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:ring-2 focus:ring-blue-600/15 focus:outline-none"
              />
              <p className="mt-1.5 text-xs text-slate-500">
                10-character Election Commission EPIC format: 3 letters + 7 digits.
              </p>
            </div>

            <div>
              <label htmlFor="indian-mobile-input" className="mb-1.5 block text-sm font-medium text-slate-700">
                Registered Indian Mobile Number
              </label>
              <div className="flex overflow-hidden rounded-xl border border-slate-300 bg-white focus-within:border-blue-600 focus-within:ring-2 focus-within:ring-blue-600/15">
                <span className="inline-flex items-center gap-1.5 border-r border-slate-200 bg-slate-50 px-3.5 text-sm font-semibold text-slate-700 font-mono-tabular select-none">
                  <Smartphone className="h-4 w-4 text-slate-500" />
                  +91
                </span>
                <input
                  id="indian-mobile-input"
                  type="tel"
                  inputMode="numeric"
                  value={mobile}
                  onChange={(e) => {
                    const digits = e.target.value.replace(/\D/g, '').slice(0, 10);
                    setMobile(digits);
                  }}
                  placeholder="9811048210"
                  maxLength={10}
                  autoComplete="tel-national"
                  className="font-mono-tabular w-full bg-white px-4 py-3 text-base text-slate-900 placeholder:text-slate-400 focus:outline-none"
                />
              </div>
              <p className="mt-1.5 text-xs text-slate-500">
                Verified against salted SHA-256 hash stored on the electoral roll.
              </p>
            </div>

            <div>
              <label htmlFor="constituency-select" className="mb-1.5 block text-sm font-medium text-slate-700">
                Parliamentary Constituency
              </label>
              <div className="flex items-center overflow-hidden rounded-xl border border-slate-300 bg-white focus-within:border-blue-600 focus-within:ring-2 focus-within:ring-blue-600/15">
                <span className="inline-flex items-center border-r border-slate-200 bg-slate-50 px-3.5 py-3.5 text-slate-500">
                  <MapPin className="h-4 w-4" />
                </span>
                <select
                  id="constituency-select"
                  value={constituency}
                  onChange={(e) => setConstituency(e.target.value)}
                  className="w-full bg-white px-4 py-3 text-base text-slate-900 focus:outline-none"
                >
                  {CONSTITUENCY_OPTIONS.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="pt-2">
              <button
                type="submit"
                disabled={loading}
                aria-busy={loading}
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-blue-700 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-60 whitespace-nowrap"
              >
                {loading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Verifying Electoral Roll...
                  </>
                ) : (
                  <>
                    <KeyRound className="h-4 w-4" />
                    Verify &amp; Open Ballot Booth
                    <ArrowRight className="h-4 w-4" />
                  </>
                )}
              </button>
            </div>
          </form>

          {errorMsg && (
            <div
              role="alert"
              className="mt-5 flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
            >
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
              <span>{errorMsg}</span>
            </div>
          )}
        </section>

        <aside className="civic-card rounded-2xl p-6 sm:p-8 lg:col-span-5 space-y-6">
          <div className="flex items-center gap-2.5">
            <ShieldCheck className="h-5 w-5 text-blue-700 shrink-0" />
            <h2 className="text-lg font-semibold text-slate-900">Constitutional Safeguards</h2>
          </div>

          <div className="space-y-5 text-sm text-slate-600">
            <div className="border-b border-slate-200 pb-4">
              <h3 className="font-semibold text-slate-900">Decoupled Secret Ballot</h3>
              <p className="mt-1 leading-relaxed">
                Electoral roll records (<code className="font-mono-tabular text-slate-800">voters</code>) and anonymized ballots (<code className="font-mono-tabular text-slate-800">votes</code>) share zero foreign keys. Commit windows are quantized to 15-minute IST buckets.
              </p>
            </div>

            <div className="border-b border-slate-200 pb-4">
              <h3 className="font-semibold text-slate-900">3-Factor Roll Binding &amp; Throttling</h3>
              <p className="mt-1 leading-relaxed">
                Access requires matching EPIC ID, salted <span className="font-mono-tabular">+91</span> mobile hash, and constituency assignment, backed by a 5-attempt lockout to block guessing or roll scraping.
              </p>
            </div>

            <div>
              <h3 className="font-semibold text-slate-900">Atomic Lock &amp; 3-Minute Expiry</h3>
              <p className="mt-1 leading-relaxed">
                Exclusive row-level transaction locks block duplicate submissions. The session, cookies, and browser history lock automatically upon ballot commit.
              </p>
            </div>
          </div>

          <div className="border-t border-slate-200 pt-5">
            <button
              type="button"
              onClick={onOpenDashboard}
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-slate-300 bg-slate-50 px-4 py-2.5 text-sm font-medium text-slate-800 transition-colors hover:bg-slate-100 whitespace-nowrap"
            >
              <Lock className="h-4 w-4 text-blue-700" />
              Inspect Live Constituency Tally &amp; Receipts
            </button>
          </div>
        </aside>
      </div>
    </div>
  );
};
