import React, { useEffect, useState } from 'react';
import { Check, Clock, ShieldAlert, Copy, ArrowRight, AlertCircle, Loader2 } from 'lucide-react';
import type { CandidateStanding, VoteReceipt, VotingSession } from '../types/trustcast';

interface BallotViewProps {
  session: VotingSession | null;
  receipt: VoteReceipt | null;
  onSessionExpired: () => void;
  onVoteCommitted: (receipt: VoteReceipt) => void;
  onOpenAuth: () => void;
  onVerifyReceiptOnDashboard: (receiptHash: string) => void;
}

export const BallotView: React.FC<BallotViewProps> = ({
  session,
  receipt,
  onSessionExpired,
  onVoteCommitted,
  onOpenAuth,
  onVerifyReceiptOnDashboard,
}) => {
  const [candidates, setCandidates] = useState<CandidateStanding[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmChecked, setConfirmChecked] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [remainingSec, setRemainingSec] = useState<number>(() =>
    session ? Math.max(0, session.expires_at_unix - Math.floor(Date.now() / 1000)) : 0
  );
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fetch('/api/get_results', { cache: 'no-store' })
      .then((res) => res.json())
      .then((data) => {
        if (data.success && Array.isArray(data.candidates)) {
          setCandidates(
            [...data.candidates].sort((a, b) => a.display_order - b.display_order)
          );
        }
      })
      .catch(() => {
        setError('Unable to load official candidate slate.');
      });
  }, []);

  useEffect(() => {
    if (!session || receipt) return;

    const tick = () => {
      const rem = Math.max(0, session.expires_at_unix - Math.floor(Date.now() / 1000));
      setRemainingSec(rem);
      if (rem <= 0) {
        onSessionExpired();
      }
    };

    tick();
    const id = window.setInterval(tick, 500);
    return () => window.clearInterval(id);
  }, [session, receipt, onSessionExpired]);

  const formatMmSs = (sec: number) => {
    const m = String(Math.floor(sec / 60)).padStart(2, '0');
    const s = String(sec % 60).padStart(2, '0');
    return `${m}:${s}`;
  };

  if (receipt) {
    return (
      <div className="mx-auto max-w-3xl space-y-6">
        <section className="civic-card rounded-2xl p-6 sm:p-8 space-y-6">
          <div className="space-y-2 border-b border-slate-200 pb-5">
            <p className="text-xs font-semibold text-emerald-700">
              Secret Ballot Sealed · Session Destroyed · Storage Cleared · Back Navigation Locked
            </p>
            <h1 className="text-2xl font-bold text-slate-900 sm:text-3xl">
              Cryptographic Vote Receipt (VVPAT Hash)
            </h1>
            <p className="text-sm leading-relaxed text-slate-600">
              Your vote has been recorded atomically in the unlinked ballot ledger and your authentication session has been permanently destroyed. Keep this SHA-256 receipt to verify inclusion on the public ledger—it discloses nothing about your candidate selection.
            </p>
          </div>

          <div className="civic-subcard rounded-xl p-5 space-y-3">
            <div className="text-xs font-medium text-slate-500">SHA-256 Ballot Inclusion Hash</div>
            <div className="font-mono-tabular break-all text-sm font-semibold text-blue-800 sm:text-base">
              {receipt.receipt_hash}
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pt-1 text-xs text-slate-600">
              <span>
                Quantized Commit Window (IST):{' '}
                <strong className="font-mono-tabular text-slate-900">{receipt.cast_bucket_ist}</strong>
              </span>
              <span aria-hidden="true">·</span>
              <span>Voter Identity Link: None</span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(receipt.receipt_hash);
                  setCopied(true);
                  window.setTimeout(() => setCopied(false), 1800);
                } catch {
                  // Ignore clipboard failure
                }
              }}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-800 transition-colors hover:bg-slate-50 whitespace-nowrap"
            >
              {copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
              {copied ? 'Copied Hash' : 'Copy Receipt Hash'}
            </button>

            <button
              type="button"
              onClick={() => onVerifyReceiptOnDashboard(receipt.receipt_hash)}
              className="inline-flex items-center gap-2 rounded-xl bg-blue-700 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-800 whitespace-nowrap"
            >
              Verify on Live Results
              <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        </section>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="mx-auto max-w-2xl">
        <section className="civic-card rounded-2xl p-8 text-center space-y-4">
          <ShieldAlert className="mx-auto h-9 w-9 text-amber-600" />
          <h1 className="text-2xl font-bold text-slate-900">EPIC +91 2FA Session Required</h1>
          <p className="text-sm leading-relaxed text-slate-600">
            Entering the electronic secret ballot booth requires a verified Indian EPIC Voter ID and 6-digit SMS OTP challenge. Sessions remain active for 3 minutes and terminate immediately after voting.
          </p>
          <div className="pt-2">
            <button
              type="button"
              onClick={onOpenAuth}
              className="inline-flex items-center gap-2 rounded-xl bg-blue-700 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-800 whitespace-nowrap"
            >
              Authenticate via Voter Portal
              <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        </section>
      </div>
    );
  }

  const selectedCandidate = candidates.find((c) => c.candidate_id === selectedId) || null;

  const validatePreSubmission = (): { valid: boolean; reason: string | null } => {
    if (candidates.length === 0) {
      return { valid: false, reason: 'Official candidate slate is still loading.' };
    }
    if (selectedId === null || !Number.isInteger(selectedId) || !selectedCandidate) {
      return {
        valid: false,
        reason: 'Please select a valid candidate before confirming your vote.',
      };
    }
    if (remainingSec <= 0 || !session?.session_token || !session?.csrf_token) {
      return {
        valid: false,
        reason: 'Active 2FA voting session is required before casting a ballot.',
      };
    }
    return { valid: true, reason: null };
  };

  const preSubmissionCheck = validatePreSubmission();
  const canConfirmVote = preSubmissionCheck.valid && confirmChecked && !submitting;

  const handleOpenReview = () => {
    const check = validatePreSubmission();
    if (!check.valid) {
      setError(check.reason);
      return;
    }
    setError(null);
    setConfirmChecked(false);
    setConfirmOpen(true);
  };

  const handleCastBallot = async () => {
    const check = validatePreSubmission();
    if (!check.valid || !selectedCandidate) {
      setError(check.reason || 'Select a candidate before confirming your vote.');
      setConfirmOpen(false);
      return;
    }
    if (!confirmChecked || submitting) {
      setError('Please check the confirmation box to proceed.');
      return;
    }
    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch('/api/cast_vote', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-TrustCast-Session': session.session_token,
        },
        credentials: 'same-origin',
        body: JSON.stringify({
          candidate_id: selectedCandidate.candidate_id,
          csrf_token: session.csrf_token,
        }),
      });
      const data = await res.json();

      if (!res.ok || !data.success) {
        setError(data.error || 'Ballot submission failed.');
        if (res.status === 401 || res.status === 403 || res.status === 409) {
          setConfirmOpen(false);
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }
        return;
      }

      try {
        localStorage.clear();
        sessionStorage.clear();
      } catch {
        // Ignore storage errors
      }

      setConfirmOpen(false);
      window.scrollTo({ top: 0, behavior: 'smooth' });
      onVoteCommitted({
        receipt_hash: data.receipt_hash,
        cast_bucket_ist: data.cast_bucket_ist,
      });
    } catch {
      setError('Network failure while submitting secret ballot.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="civic-card flex flex-wrap items-center justify-between gap-4 rounded-2xl px-6 py-4">
        <div>
          <p className="text-xs font-medium text-slate-500">
            Constituency: {session.constituency} · Electronic Secret Ballot
          </p>
          <h1 className="text-xl font-bold text-slate-900 sm:text-2xl">
            Official Candidate Ballot Slate
          </h1>
        </div>
        <div
          className={`flex items-center gap-2 rounded-xl border px-4 py-2 font-mono-tabular text-sm font-semibold ${
            remainingSec <= 30
              ? 'border-red-200 bg-red-50 text-red-700'
              : 'border-blue-200 bg-blue-50 text-blue-800'
          }`}
        >
          <Clock className="h-4 w-4" />
          <span>Session Timeout: {formatMmSs(remainingSec)}</span>
        </div>
      </div>

      {error && (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
          <span>{error}</span>
        </div>
      )}

      <div role="radiogroup" aria-label="Official Candidates" className="grid gap-5 md:grid-cols-2">
        {candidates.map((cand) => {
          const isSelected = selectedId === cand.candidate_id;
          return (
            <button
              key={cand.candidate_id}
              type="button"
              role="radio"
              aria-checked={isSelected}
              onClick={() => {
                setSelectedId(cand.candidate_id);
                setError(null);
              }}
              className={`civic-card group flex items-start gap-4 rounded-2xl p-5 text-left transition-all ${
                isSelected
                  ? 'border-blue-700 ring-2 ring-blue-700/20 bg-blue-50/30'
                  : 'hover:border-slate-300'
              }`}
            >
              <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-xl border border-slate-200 bg-slate-100">
                <img
                  src={cand.portrait_path}
                  alt={cand.full_name}
                  referrerPolicy="no-referrer"
                  className="h-full w-full object-cover"
                />
              </div>

              <div className="min-w-0 flex-1 space-y-1.5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-xs font-medium text-slate-500">
                      {cand.coalition} · {cand.portfolio_focus}
                    </div>
                    <h2 className="mt-0.5 text-lg font-bold text-slate-900">
                      {cand.full_name}
                    </h2>
                  </div>
                  <div
                    className={`mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${
                      isSelected
                        ? 'border-blue-700 bg-blue-700 text-white'
                        : 'border-slate-300 bg-white'
                    }`}
                  >
                    {isSelected && <Check className="h-3.5 w-3.5 stroke-[3]" />}
                  </div>
                </div>
                <p className="text-sm leading-relaxed text-slate-600">
                  {cand.platform_summary}
                </p>
              </div>
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-4 border-t border-slate-200 pt-5">
        <p className="text-sm text-slate-600">
          {selectedCandidate
            ? `Selected: ${selectedCandidate.full_name} (${selectedCandidate.coalition})`
            : 'Select one candidate to proceed to final ballot confirmation.'}
        </p>
        <button
          type="button"
          disabled={!preSubmissionCheck.valid}
          onClick={handleOpenReview}
          className="inline-flex items-center gap-2 rounded-xl bg-blue-700 px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-45 whitespace-nowrap"
        >
          Review &amp; Confirm Selection
          <ArrowRight className="h-4 w-4" />
        </button>
      </div>

      {confirmOpen && selectedCandidate && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-modal-title"
          className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-slate-950/55 p-4 backdrop-blur-sm"
        >
          <div className="civic-card my-auto w-full max-w-lg rounded-2xl bg-white p-6 sm:p-7 space-y-5 shadow-xl">
            <div className="space-y-1">
              <h2 id="confirm-modal-title" className="text-xl font-bold text-slate-900">
                Confirm Final Ballot Submission
              </h2>
              <p className="text-sm text-slate-600">
                Verify your candidate choice before sealing this irreversible, anonymous vote.
              </p>
            </div>

            <div className="civic-subcard flex items-center gap-4 rounded-xl p-4">
              <img
                src={selectedCandidate.portrait_path}
                alt={selectedCandidate.full_name}
                referrerPolicy="no-referrer"
                className="h-14 w-14 rounded-lg object-cover border border-slate-200"
              />
              <div>
                <div className="text-base font-bold text-slate-900">
                  {selectedCandidate.full_name}
                </div>
                <div className="text-xs text-slate-600">
                  {selectedCandidate.coalition} · {selectedCandidate.portfolio_focus}
                </div>
              </div>
            </div>

            <label
              className={`flex cursor-pointer items-start gap-3.5 rounded-xl border p-4 text-sm transition-colors ${
                confirmChecked
                  ? 'border-blue-600 bg-blue-50/70 text-slate-900'
                  : 'border-slate-300 bg-slate-50 text-slate-700 hover:border-slate-400'
              }`}
            >
              <input
                type="checkbox"
                checked={confirmChecked}
                disabled={submitting}
                onChange={(e) => setConfirmChecked(e.target.checked)}
                className="mt-0.5 h-5 w-5 shrink-0 cursor-pointer rounded border-slate-400 accent-blue-700 focus:ring-2 focus:ring-blue-600 disabled:cursor-not-allowed disabled:opacity-60"
              />
              <span>
                <strong className="block text-slate-900">
                  Check to confirm final ballot submission
                </strong>
                <span className="mt-0.5 block text-xs leading-relaxed text-slate-600">
                  Submitting atomically records my secret ballot, wipes browser storage, and permanently closes this session.
                </span>
              </span>
            </label>

            {error && (
              <div
                role="alert"
                className="flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs text-red-800"
              >
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
                <span>{error}</span>
              </div>
            )}

            <div className="flex flex-wrap items-center justify-end gap-3 pt-1">
              <button
                type="button"
                disabled={submitting}
                onClick={() => setConfirmOpen(false)}
                className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-45 whitespace-nowrap"
              >
                Go Back
              </button>
              <button
                type="button"
                disabled={!canConfirmVote}
                aria-busy={submitting}
                onClick={handleCastBallot}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-700 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-45 whitespace-nowrap"
              >
                {submitting && (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                )}
                <span>{submitting ? 'Sealing Ballot...' : 'Confirm Vote'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
