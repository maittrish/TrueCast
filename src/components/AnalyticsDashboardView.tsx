import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Chart,
  BarController,
  BarElement,
  CategoryScale,
  LinearScale,
  Tooltip,
  Legend,
} from 'chart.js';
import { Pause, Play, SearchCheck, CheckCircle2, AlertCircle, RefreshCw } from 'lucide-react';
import { ConstituencyHeatmap } from './ConstituencyHeatmap';
import type { ResultsPayload } from '../types/trustcast';

Chart.register(BarController, BarElement, CategoryScale, LinearScale, Tooltip, Legend);

interface AnalyticsDashboardViewProps {
  prefillReceiptHash?: string | null;
}

export const AnalyticsDashboardView: React.FC<AnalyticsDashboardViewProps> = ({
  prefillReceiptHash,
}) => {
  const [results, setResults] = useState<ResultsPayload | null>(null);
  const [polling, setPolling] = useState(true);
  const [loading, setLoading] = useState(true);
  const [selectedConstituency, setSelectedConstituency] = useState<string | null>(null);
  const [receiptQuery, setReceiptQuery] = useState(prefillReceiptHash || '');
  const [verifyState, setVerifyState] = useState<{
    status: 'idle' | 'verified' | 'not_found' | 'error';
    message: string;
    bucket?: string | null;
  }>({ status: 'idle', message: '' });

  const standingsCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const demographicsCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const standingsChartRef = useRef<Chart | null>(null);
  const demographicsChartRef = useRef<Chart | null>(null);

  useEffect(() => {
    if (prefillReceiptHash) {
      setReceiptQuery(prefillReceiptHash);
    }
  }, [prefillReceiptHash]);

  const fetchResults = useCallback(async () => {
    try {
      const res = await fetch('/api/get_results', { cache: 'no-store' });
      const data: ResultsPayload = await res.json();
      if (res.ok && data.success) {
        setResults(data);
      }
    } catch {
      // Silent retry
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchResults();
  }, [fetchResults]);

  useEffect(() => {
    if (!polling) return;
    const id = window.setInterval(fetchResults, 3000);
    return () => window.clearInterval(id);
  }, [polling, fetchResults]);

  useEffect(() => {
    if (!results || !standingsCanvasRef.current || !demographicsCanvasRef.current) return;

    const candidateLabels = results.candidates.map((c) => c.full_name);
    const candidateVotes = results.candidates.map((c) => c.vote_count);

    if (!standingsChartRef.current) {
      standingsChartRef.current = new Chart(standingsCanvasRef.current, {
        type: 'bar',
        data: {
          labels: candidateLabels,
          datasets: [
            {
              label: 'Votes Cast',
              data: candidateVotes,
              backgroundColor: ['#1d4ed8', '#0284c7', '#0d9488', '#d97706'],
              borderRadius: 6,
              maxBarThickness: 48,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: { duration: 220 },
          plugins: {
            legend: { display: false },
            tooltip: {
              backgroundColor: '#0f172a',
              titleColor: '#f8fafc',
              bodyColor: '#e2e8f0',
            },
          },
          scales: {
            x: {
              ticks: { color: '#334155', font: { family: 'DM Sans', size: 12 } },
              grid: { color: 'rgba(15, 23, 42, 0.05)' },
            },
            y: {
              beginAtZero: true,
              ticks: {
                color: '#64748b',
                precision: 0,
                font: { family: 'JetBrains Mono', size: 11 },
              },
              grid: { color: 'rgba(15, 23, 42, 0.08)' },
            },
          },
        },
      });
    } else {
      standingsChartRef.current.data.labels = candidateLabels;
      standingsChartRef.current.data.datasets[0].data = candidateVotes;
      standingsChartRef.current.update();
    }

    const ageLabels = results.demographics.map((d) => d.age_group);
    const ageVoted = results.demographics.map((d) => d.voted);
    const ageRegistered = results.demographics.map((d) => d.registered);

    if (!demographicsChartRef.current) {
      demographicsChartRef.current = new Chart(demographicsCanvasRef.current, {
        type: 'bar',
        data: {
          labels: ageLabels,
          datasets: [
            {
              label: 'Voted',
              data: ageVoted,
              backgroundColor: '#1d4ed8',
              borderRadius: 5,
            },
            {
              label: 'Registered',
              data: ageRegistered,
              backgroundColor: '#cbd5e1',
              borderRadius: 5,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: { duration: 220 },
          plugins: {
            legend: {
              labels: { color: '#334155', font: { family: 'DM Sans', size: 12 } },
            },
            tooltip: {
              backgroundColor: '#0f172a',
              titleColor: '#f8fafc',
              bodyColor: '#e2e8f0',
            },
          },
          scales: {
            x: {
              ticks: { color: '#334155', font: { family: 'JetBrains Mono', size: 12 } },
              grid: { color: 'rgba(15, 23, 42, 0.05)' },
            },
            y: {
              beginAtZero: true,
              ticks: {
                color: '#64748b',
                precision: 0,
                font: { family: 'JetBrains Mono', size: 11 },
              },
              grid: { color: 'rgba(15, 23, 42, 0.08)' },
            },
          },
        },
      });
    } else {
      demographicsChartRef.current.data.labels = ageLabels;
      demographicsChartRef.current.data.datasets[0].data = ageVoted;
      demographicsChartRef.current.data.datasets[1].data = ageRegistered;
      demographicsChartRef.current.update();
    }
  }, [results]);

  useEffect(() => {
    return () => {
      standingsChartRef.current?.destroy();
      demographicsChartRef.current?.destroy();
      standingsChartRef.current = null;
      demographicsChartRef.current = null;
    };
  }, []);

  const verifyReceipt = async (hashInput: string) => {
    const clean = hashInput.trim().toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(clean)) {
      setVerifyState({
        status: 'error',
        message: 'Enter a valid 64-character hexadecimal SHA-256 receipt hash.',
      });
      return;
    }

    try {
      const res = await fetch(`/api/get_results?receipt=${encodeURIComponent(clean)}`, {
        cache: 'no-store',
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setVerifyState({ status: 'error', message: data.error || 'Verification failed.' });
        return;
      }

      if (data.verified) {
        setVerifyState({
          status: 'verified',
          message: data.secrecy_note,
          bucket: data.cast_bucket_ist,
        });
      } else {
        setVerifyState({
          status: 'not_found',
          message: 'Receipt hash was not found in the public ballot ledger.',
        });
      }
    } catch {
      setVerifyState({ status: 'error', message: 'Network error verifying receipt.' });
    }
  };

  useEffect(() => {
    if (prefillReceiptHash && /^[a-f0-9]{64}$/i.test(prefillReceiptHash)) {
      verifyReceipt(prefillReceiptHash);
    }
  }, [prefillReceiptHash]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1">
          <p className="text-xs font-medium text-slate-500">
            Booth State: {results?.booth_status === 'SEALED' ? 'Sealed by Returning Officer' : 'Polling Open'} · Updated{' '}
            <span className="font-mono-tabular text-slate-700">
              {results?.generated_at_ist || '--:--:--'}
            </span>{' '}
            IST
          </p>
          <h1 className="text-2xl font-bold text-slate-900 sm:text-3xl">
            Live Constituency Results &amp; Turnout
          </h1>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={fetchResults}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 whitespace-nowrap"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh
          </button>
          <button
            type="button"
            onClick={() => setPolling((p) => !p)}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 whitespace-nowrap"
          >
            {polling ? <Pause className="h-3.5 w-3.5 text-blue-700" /> : <Play className="h-3.5 w-3.5 text-emerald-700" />}
            {polling ? 'Pause Live Poll' : 'Resume Live Poll'}
          </button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="civic-card rounded-2xl p-5">
          <div className="text-xs font-medium text-slate-500">Total Ballots Recorded</div>
          <div className="font-mono-tabular mt-2 text-3xl font-bold text-slate-900">
            {loading ? '—' : results?.turnout.total_cast ?? 0}
          </div>
          <div className="mt-1 text-xs text-slate-500">Anonymous entries in decoupled ledger</div>
        </div>
        <div className="civic-card rounded-2xl p-5">
          <div className="text-xs font-medium text-slate-500">Enrolled Electorate</div>
          <div className="font-mono-tabular mt-2 text-3xl font-bold text-slate-900">
            {loading ? '—' : results?.turnout.total_registered ?? 0}
          </div>
          <div className="mt-1 text-xs text-slate-500">Verified EPIC holders across constituencies</div>
        </div>
        <div className="civic-card rounded-2xl p-5">
          <div className="text-xs font-medium text-slate-500">Aggregate Voter Turnout</div>
          <div className="font-mono-tabular mt-2 text-3xl font-bold text-blue-700">
            {loading ? '—' : `${(results?.turnout.turnout_pct ?? 0).toFixed(1)}%`}
          </div>
          <div className="mt-1 text-xs text-slate-500">Real-time participation rate</div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="civic-card rounded-2xl p-6">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-base font-semibold text-slate-900">Candidate Standings</h2>
            <span className="text-xs text-slate-500">Live unlinked tally</span>
          </div>
          <div className="h-72 w-full">
            <canvas ref={standingsCanvasRef} />
          </div>
        </section>

        <section className="civic-card rounded-2xl p-6">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-base font-semibold text-slate-900">Demographic Turnout by Age Group</h2>
            <span className="text-xs text-slate-500">Aggregated from electoral roll</span>
          </div>
          <div className="h-72 w-full">
            <canvas ref={demographicsCanvasRef} />
          </div>
        </section>
      </div>

      <ConstituencyHeatmap
        constituencies={results?.constituencies || []}
        matrix={results?.constituency_matrix || []}
        selectedConstituency={selectedConstituency}
        onSelectConstituency={setSelectedConstituency}
      />

      <div className="grid gap-6 lg:grid-cols-12">
        <section className="civic-card rounded-2xl p-6 lg:col-span-7">
          <h2 className="mb-4 text-base font-semibold text-slate-900">Official Candidate Tally</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs text-slate-500">
                  <th className="pb-2.5 font-medium">Candidate</th>
                  <th className="pb-2.5 font-medium">Alliance / Front</th>
                  <th className="pb-2.5 text-right font-medium">Votes</th>
                  <th className="pb-2.5 text-right font-medium">Share</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {(results?.candidates || []).map((c) => (
                  <tr key={c.candidate_id} className="hover:bg-slate-50">
                    <td className="py-3 font-medium text-slate-900">{c.full_name}</td>
                    <td className="py-3 text-slate-600">{c.coalition}</td>
                    <td className="font-mono-tabular py-3 text-right font-semibold text-slate-900">
                      {c.vote_count}
                    </td>
                    <td className="font-mono-tabular py-3 text-right font-medium text-blue-700">
                      {c.share_pct.toFixed(1)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="civic-card rounded-2xl p-6 lg:col-span-5">
          <h2 className="mb-4 text-base font-semibold text-slate-900">Constituency Turnout</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs text-slate-500">
                  <th className="pb-2.5 font-medium">Constituency</th>
                  <th className="pb-2.5 text-right font-medium">Voted</th>
                  <th className="pb-2.5 text-right font-medium">Roll</th>
                  <th className="pb-2.5 text-right font-medium">Turnout</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {(results?.constituencies || []).map((con) => {
                  const isSelected = selectedConstituency === con.constituency;
                  return (
                    <tr
                      key={con.constituency}
                      onClick={() =>
                        setSelectedConstituency(isSelected ? null : con.constituency)
                      }
                      className={`cursor-pointer transition-colors ${
                        isSelected ? 'bg-blue-50/90' : 'hover:bg-slate-50'
                      }`}
                    >
                      <td
                        className={`py-3 font-medium ${
                          isSelected ? 'text-blue-700' : 'text-slate-900'
                        }`}
                      >
                        {con.constituency}
                      </td>
                      <td className="font-mono-tabular py-3 text-right text-slate-800">{con.voted}</td>
                      <td className="font-mono-tabular py-3 text-right text-slate-500">{con.registered}</td>
                      <td className="font-mono-tabular py-3 text-right font-medium text-emerald-700">
                        {con.turnout_pct.toFixed(1)}%
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <section id="receipt-verifier" className="civic-card rounded-2xl p-6">
        <div className="mb-4 space-y-1">
          <h2 className="text-base font-semibold text-slate-900">
            Cryptographic Receipt Inclusion Verifier
          </h2>
          <p className="text-sm text-slate-600">
            Paste your 64-character SHA-256 ballot receipt to confirm ledger inclusion without disclosing your candidate selection or voter identity.
          </p>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            verifyReceipt(receiptQuery);
          }}
          className="flex flex-wrap gap-3"
        >
          <input
            type="text"
            value={receiptQuery}
            onChange={(e) => setReceiptQuery(e.target.value)}
            placeholder="Paste 64-character SHA-256 receipt hash"
            maxLength={64}
            className="font-mono-tabular min-w-[260px] flex-1 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none"
          />
          <button
            type="submit"
            className="inline-flex items-center gap-2 rounded-xl bg-blue-700 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-800 whitespace-nowrap"
          >
            <SearchCheck className="h-4 w-4" />
            Verify Inclusion
          </button>
        </form>

        {verifyState.status !== 'idle' && (
          <div
            role="status"
            className={`mt-4 flex items-start gap-3 rounded-xl border px-4 py-3 text-sm ${
              verifyState.status === 'verified'
                ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
                : 'border-red-200 bg-red-50 text-red-900'
            }`}
          >
            {verifyState.status === 'verified' ? (
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" />
            ) : (
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
            )}
            <div>
              <div>{verifyState.message}</div>
              {verifyState.bucket && (
                <div className="mt-1 text-xs text-emerald-800">
                  Commit Window (IST): <span className="font-mono-tabular">{verifyState.bucket}</span>
                </div>
              )}
            </div>
          </div>
        )}
      </section>
    </div>
  );
};
