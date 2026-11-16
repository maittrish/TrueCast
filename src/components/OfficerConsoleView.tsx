import React, { useCallback, useEffect, useState } from 'react';
import {
  Shield,
  UserPlus,
  Download,
  Lock,
  Unlock,
  LogOut,
  AlertCircle,
  CheckCircle2,
  RefreshCw,
  MapPin,
} from 'lucide-react';
import type { OfficerOverviewPayload, OfficerSession } from '../types/trustcast';

interface OfficerConsoleViewProps {
  officerSession: OfficerSession | null;
  onOfficerAuthenticated: (session: OfficerSession) => void;
  onOfficerLoggedOut: () => void;
}

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

export const OfficerConsoleView: React.FC<OfficerConsoleViewProps> = ({
  officerSession,
  onOfficerAuthenticated,
  onOfficerLoggedOut,
}) => {
  const [officerIdInput, setOfficerIdInput] = useState('');
  const [passkeyInput, setPasskeyInput] = useState('');
  const [authError, setAuthError] = useState<string | null>(null);
  const [authLoading, setAuthLoading] = useState(false);

  const [overview, setOverview] = useState<OfficerOverviewPayload | null>(null);
  const [loadingOverview, setLoadingOverview] = useState(false);
  const [actionFeedback, setActionFeedback] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);

  // Citizen Enrollment Form State
  const [newEpic, setNewEpic] = useState('');
  const [newName, setNewName] = useState('');
  const [newMobile, setNewMobile] = useState('');
  const [newConstituency, setNewConstituency] = useState('New Delhi');
  const [newAgeGroup, setNewAgeGroup] = useState('25-34');
  const [enrolling, setEnrolling] = useState(false);

  // Electoral Roll Filter
  const [searchTerm, setSearchTerm] = useState('');

  const fetchOverview = useCallback(async () => {
    if (!officerSession) return;
    setLoadingOverview(true);
    try {
      const res = await fetch('/api/officer/overview', {
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { 'X-Officer-Session': officerSession.officer_token },
      });
      if (res.status === 401) {
        onOfficerLoggedOut();
        return;
      }
      const data: OfficerOverviewPayload = await res.json();
      if (res.ok && data.success) {
        setOverview(data);
      }
    } catch {
      // Ignore transient refresh failure
    } finally {
      setLoadingOverview(false);
    }
  }, [officerSession, onOfficerLoggedOut]);

  useEffect(() => {
    fetchOverview();
    if (!officerSession) return;
    const id = window.setInterval(fetchOverview, 4000);
    return () => window.clearInterval(id);
  }, [fetchOverview, officerSession]);

  const handleOfficerLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    setAuthLoading(true);
    try {
      const res = await fetch('/api/officer/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          officer_id: officerIdInput.trim().toUpperCase(),
          passkey: passkeyInput,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setAuthError(data.error || 'Officer authorization failed.');
        return;
      }
      setPasskeyInput('');
      onOfficerAuthenticated({
        officer_token: data.officer_token,
        officer_id: data.officer_id,
        officer_name: data.officer_name,
      });
    } catch {
      setAuthError('Network error authenticating Returning Officer.');
    } finally {
      setAuthLoading(false);
    }
  };

  const handleEnrollVoter = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!officerSession) return;
    setActionFeedback(null);
    setEnrolling(true);

    try {
      const res = await fetch('/api/officer/voters', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Officer-Session': officerSession.officer_token,
        },
        credentials: 'same-origin',
        body: JSON.stringify({
          epic_id: newEpic.trim().toUpperCase(),
          full_name: newName.trim(),
          mobile: newMobile.replace(/\D/g, '').slice(-10),
          constituency: newConstituency,
          age_group: newAgeGroup,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setActionFeedback({ type: 'error', message: data.error || 'Unable to enroll voter.' });
        return;
      }

      setActionFeedback({ type: 'success', message: data.message });
      setNewEpic('');
      setNewName('');
      setNewMobile('');
      fetchOverview();
    } catch {
      setActionFeedback({ type: 'error', message: 'Network error updating electoral roll.' });
    } finally {
      setEnrolling(false);
    }
  };

  const handleToggleBooth = async () => {
    if (!officerSession || !overview) return;
    const nextStatus = overview.booth_status === 'OPEN' ? 'SEALED' : 'OPEN';
    setActionFeedback(null);
    try {
      const res = await fetch('/api/officer/booth_status', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Officer-Session': officerSession.officer_token,
        },
        credentials: 'same-origin',
        body: JSON.stringify({ status: nextStatus }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setActionFeedback({
          type: 'success',
          message: `Polling booth status updated to ${data.booth_status}.`,
        });
        fetchOverview();
      }
    } catch {
      setActionFeedback({ type: 'error', message: 'Failed to update polling booth status.' });
    }
  };

  const handleExportCsv = async () => {
    if (!officerSession) return;
    try {
      const res = await fetch('/api/officer/export_csv', {
        credentials: 'same-origin',
        headers: { 'X-Officer-Session': officerSession.officer_token },
      });
      if (!res.ok) return;
      const csvText = await res.text();
      const blob = new Blob([csvText], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'trustcast_certified_tally.csv';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      setActionFeedback({ type: 'error', message: 'Unable to export certified CSV tally.' });
    }
  };

  const handleLogout = async () => {
    if (officerSession) {
      await fetch('/api/officer/logout', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'X-Officer-Session': officerSession.officer_token },
      }).catch(() => {});
    }
    onOfficerLoggedOut();
  };

  if (!officerSession) {
    return (
      <div className="mx-auto max-w-lg">
        <section className="civic-card rounded-2xl p-6 sm:p-8 space-y-6">
          <div className="space-y-1.5 border-b border-slate-200 pb-4">
            <div className="flex items-center gap-2 text-blue-700">
              <Shield className="h-5 w-5" />
              <span className="text-xs font-semibold">Election Authority Access</span>
            </div>
            <h1 className="text-2xl font-bold text-slate-900">
              Returning Officer Sign-In
            </h1>
            <p className="text-sm text-slate-600">
              Authorized Presiding and Returning Officers may sign in to enroll EPIC +91 voters, seal polling booths, inspect gateway dispatches, and export certified tallies.
            </p>
          </div>

          <form onSubmit={handleOfficerLogin} className="space-y-4">
            <div>
              <label htmlFor="officer-id" className="mb-1.5 block text-sm font-medium text-slate-700">
                Officer Badge ID
              </label>
              <input
                id="officer-id"
                type="text"
                value={officerIdInput}
                onChange={(e) => setOfficerIdInput(e.target.value.toUpperCase())}
                placeholder="ECI-RO-2026"
                required
                className="font-mono-tabular w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm text-slate-900 focus:border-blue-600 focus:outline-none"
              />
            </div>

            <div>
              <label htmlFor="officer-passkey" className="mb-1.5 block text-sm font-medium text-slate-700">
                Authorization Passkey
              </label>
              <input
                id="officer-passkey"
                type="password"
                value={passkeyInput}
                onChange={(e) => setPasskeyInput(e.target.value)}
                placeholder="Enter Returning Officer passkey"
                required
                className="font-mono-tabular w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm text-slate-900 focus:border-blue-600 focus:outline-none"
              />
            </div>

            {authError && (
              <div
                role="alert"
                className="flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs text-red-800"
              >
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
                <span>{authError}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={authLoading}
              className="w-full rounded-xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-slate-800 disabled:opacity-50"
            >
              {authLoading ? 'Authenticating...' : 'Authenticate Returning Officer'}
            </button>
          </form>
        </section>
      </div>
    );
  }

  const filteredVoters = (overview?.voters || []).filter((v) => {
    const q = searchTerm.trim().toLowerCase();
    if (!q) return true;
    return (
      v.epic_id.toLowerCase().includes(q) ||
      v.full_name.toLowerCase().includes(q) ||
      v.constituency.toLowerCase().includes(q)
    );
  });

  return (
    <div className="space-y-6">
      {/* Officer Header Toolbar */}
      <div className="civic-card flex flex-wrap items-center justify-between gap-4 rounded-2xl px-6 py-4">
        <div>
          <p className="text-xs font-medium text-slate-500">
            {officerSession.officer_name} · Badge {officerSession.officer_id} · Auth Mode: Multi-Factor Roll Verification
          </p>
          <h1 className="text-xl font-bold text-slate-900 sm:text-2xl">
            Returning Officer Control Console
          </h1>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={fetchOverview}
            disabled={loadingOverview}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Sync
          </button>
          <button
            type="button"
            onClick={handleToggleBooth}
            className={`inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-semibold text-white transition-colors whitespace-nowrap ${
              overview?.booth_status === 'OPEN'
                ? 'bg-amber-600 hover:bg-amber-700'
                : 'bg-emerald-700 hover:bg-emerald-800'
            }`}
          >
            {overview?.booth_status === 'OPEN' ? (
              <>
                <Lock className="h-3.5 w-3.5" />
                Seal Polling Booth
              </>
            ) : (
              <>
                <Unlock className="h-3.5 w-3.5" />
                Re-Open Polling Booth
              </>
            )}
          </button>
          <button
            type="button"
            onClick={handleExportCsv}
            className="inline-flex items-center gap-1.5 rounded-xl bg-blue-700 px-3.5 py-2 text-xs font-semibold text-white hover:bg-blue-800 whitespace-nowrap"
          >
            <Download className="h-3.5 w-3.5" />
            Export Certified CSV
          </button>
          <button
            type="button"
            onClick={handleLogout}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
          >
            <LogOut className="h-3.5 w-3.5" />
            Sign Out
          </button>
        </div>
      </div>

      {actionFeedback && (
        <div
          role="status"
          className={`flex items-start gap-2.5 rounded-xl border px-4 py-3 text-sm ${
            actionFeedback.type === 'success'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
              : 'border-red-200 bg-red-50 text-red-900'
          }`}
        >
          {actionFeedback.type === 'success' ? (
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" />
          ) : (
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
          )}
          <span>{actionFeedback.message}</span>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-12">
        {/* Enroll / Bind Indian +91 Mobile Number */}
        <section className="civic-card rounded-2xl p-6 lg:col-span-5 space-y-4">
          <div className="flex items-center gap-2">
            <UserPlus className="h-4 w-4 text-blue-700" />
            <h2 className="text-base font-semibold text-slate-900">
              Enroll Citizen / Bind +91 Mobile
            </h2>
          </div>
          <p className="text-xs text-slate-600">
            Register an Indian citizen&apos;s EPIC ID and +91 mobile number into the active constituency roll. Already-voted records remain permanently locked.
          </p>

          <form onSubmit={handleEnrollVoter} className="space-y-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-700">EPIC ID (3 Letters + 7 Digits)</label>
              <input
                type="text"
                value={newEpic}
                onChange={(e) => setNewEpic(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10))}
                placeholder="DEL9012345"
                required
                className="font-mono-tabular w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-slate-700">Citizen Full Name</label>
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Rohan Deshmukh"
                required
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-slate-700">Indian Mobile (+91)</label>
              <div className="flex overflow-hidden rounded-lg border border-slate-300 bg-white focus-within:border-blue-600">
                <span className="border-r border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-700 font-mono-tabular">
                  +91
                </span>
                <input
                  type="tel"
                  inputMode="numeric"
                  value={newMobile}
                  onChange={(e) => setNewMobile(e.target.value.replace(/\D/g, '').slice(0, 10))}
                  placeholder="9876543210"
                  required
                  className="font-mono-tabular w-full px-3 py-2 text-sm text-slate-900 focus:outline-none"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-700">Constituency</label>
                <select
                  value={newConstituency}
                  onChange={(e) => setNewConstituency(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none"
                >
                  {CONSTITUENCY_OPTIONS.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-slate-700">Age Group</label>
                <select
                  value={newAgeGroup}
                  onChange={(e) => setNewAgeGroup(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none"
                >
                  <option value="18-24">18-24</option>
                  <option value="25-34">25-34</option>
                  <option value="35-49">35-49</option>
                  <option value="50-64">50-64</option>
                  <option value="65+">65+</option>
                </select>
              </div>
            </div>

            <button
              type="submit"
              disabled={enrolling}
              className="w-full rounded-xl bg-blue-700 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-800 disabled:opacity-50"
            >
              {enrolling ? 'Updating Electoral Roll...' : 'Save to Electoral Roll'}
            </button>
          </form>
        </section>

        {/* Constituency Roll & Turnout Summary */}
        <section className="civic-card rounded-2xl p-6 lg:col-span-7 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <MapPin className="h-4 w-4 text-blue-700" />
              <h2 className="text-base font-semibold text-slate-900">
                Constituency Roll &amp; Turnout Summary
              </h2>
            </div>
            <span className="text-xs text-slate-500">Live electoral roll breakdown</span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs sm:text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs text-slate-500">
                  <th className="pb-2 font-medium">Constituency</th>
                  <th className="pb-2 text-right font-medium">Voted</th>
                  <th className="pb-2 text-right font-medium">Enrolled</th>
                  <th className="pb-2 text-right font-medium">Turnout</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {(overview?.constituencies || []).map((con) => (
                  <tr key={con.constituency} className="hover:bg-slate-50">
                    <td className="py-2.5 font-medium text-slate-900">{con.constituency}</td>
                    <td className="font-mono-tabular py-2.5 text-right text-slate-700">{con.voted}</td>
                    <td className="font-mono-tabular py-2.5 text-right text-slate-500">{con.registered}</td>
                    <td className="font-mono-tabular py-2.5 text-right font-semibold text-emerald-700">
                      {con.turnout_pct.toFixed(1)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      {/* Electoral Roll Status Table (Zero Vote Linkage) */}
      <section className="civic-card rounded-2xl p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              Electoral Roll Participation Status
            </h2>
            <p className="text-xs text-slate-500">
              Displays only ballot issuance state (Pending / Voted). Candidate choice is mathematically unlinked.
            </p>
          </div>
          <input
            type="search"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Filter by EPIC, name, or constituency..."
            className="w-full sm:w-72 rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none"
          />
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-xs text-slate-500">
                <th className="pb-2.5 font-medium">EPIC ID</th>
                <th className="pb-2.5 font-medium">Citizen Name</th>
                <th className="pb-2.5 font-medium">Constituency</th>
                <th className="pb-2.5 font-medium">Registered Mobile</th>
                <th className="pb-2.5 text-right font-medium">Ballot Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredVoters.map((v) => (
                <tr key={v.epic_id} className="hover:bg-slate-50">
                  <td className="font-mono-tabular py-2.5 font-semibold text-slate-900">{v.epic_id}</td>
                  <td className="py-2.5 text-slate-800">{v.full_name}</td>
                  <td className="py-2.5 text-slate-600">{v.constituency}</td>
                  <td className="font-mono-tabular py-2.5 text-slate-600">{v.mobile_masked}</td>
                  <td className="py-2.5 text-right font-medium">
                    {v.has_voted ? (
                      <span className="text-emerald-700">Voted</span>
                    ) : (
                      <span className="text-slate-500">Pending</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};
