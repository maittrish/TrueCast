/**
 * TrustCast — Live Polling Analytics Dashboard (dashboard.js)
 * Polls get_results.php via fetch() and updates Chart.js instances without page refresh.
 */
(() => {
  'use strict';

  const POLL_MS = 3000;
  const kpiCastEl = document.getElementById('kpi-cast');
  const kpiRegisteredEl = document.getElementById('kpi-registered');
  const kpiTurnoutEl = document.getElementById('kpi-turnout');
  const lastUpdatedEl = document.getElementById('last-updated');
  const togglePollBtn = document.getElementById('toggle-poll-btn');

  const verifyForm = document.getElementById('verify-receipt-form');
  const receiptInput = document.getElementById('receipt-input');
  const verifyResultEl = document.getElementById('receipt-verify-result');

  let polling = true;
  let timerId = null;

  const standingsChart = new Chart(document.getElementById('standings-chart'), {
    type: 'bar',
    data: {
      labels: [],
      datasets: [{
        label: 'Votes Cast',
        data: [],
        backgroundColor: ['#2563eb', '#0ea5e9', '#14b8a6', '#6366f1'],
        borderRadius: 6,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 250 },
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: '#cbd5e1' }, grid: { color: 'rgba(148,163,184,0.08)' } },
        y: { beginAtZero: true, ticks: { color: '#94a3b8', precision: 0 }, grid: { color: 'rgba(148,163,184,0.12)' } },
      },
    },
  });

  const demographicsChart = new Chart(document.getElementById('demographics-chart'), {
    type: 'bar',
    data: {
      labels: [],
      datasets: [
        { label: 'Voted', data: [], backgroundColor: '#0ea5e9', borderRadius: 5 },
        { label: 'Registered', data: [], backgroundColor: 'rgba(148, 163, 184, 0.25)', borderRadius: 5 },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 250 },
      plugins: { legend: { labels: { color: '#cbd5e1' } } },
      scales: {
        x: { ticks: { color: '#cbd5e1' }, grid: { color: 'rgba(148,163,184,0.08)' } },
        y: { beginAtZero: true, ticks: { color: '#94a3b8', precision: 0 }, grid: { color: 'rgba(148,163,184,0.12)' } },
      },
    },
  });

  async function refreshTelemetry() {
    try {
      const res = await fetch('get_results.php', { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok || !data.success) return;

      kpiCastEl.textContent = String(data.turnout.total_cast);
      kpiRegisteredEl.textContent = String(data.turnout.total_registered);
      kpiTurnoutEl.textContent = `${Number(data.turnout.turnout_pct).toFixed(1)}%`;
      lastUpdatedEl.textContent = (data.generated_at_utc || '').split(' ')[1] || '--:--:--';

      standingsChart.data.labels = data.candidates.map((c) => c.full_name);
      standingsChart.data.datasets[0].data = data.candidates.map((c) => c.vote_count);
      standingsChart.update();

      demographicsChart.data.labels = data.demographics.map((d) => d.age_group);
      demographicsChart.data.datasets[0].data = data.demographics.map((d) => d.voted);
      demographicsChart.data.datasets[1].data = data.demographics.map((d) => d.registered);
      demographicsChart.update();
    } catch (_err) {
      // Silent retry on next poll interval
    }
  }

  function startPolling() {
    refreshTelemetry();
    if (timerId) clearInterval(timerId);
    timerId = setInterval(() => {
      if (polling) refreshTelemetry();
    }, POLL_MS);
  }

  togglePollBtn.addEventListener('click', () => {
    polling = !polling;
    togglePollBtn.textContent = polling ? 'Pause Live Poll' : 'Resume Live Poll';
    if (polling) refreshTelemetry();
  });

  verifyForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const hash = receiptInput.value.trim().toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(hash)) {
      verifyResultEl.innerHTML = '<div class="alert alert-error">Enter a valid 64-character hexadecimal SHA-256 hash.</div>';
      return;
    }

    try {
      const res = await fetch(`get_results.php?receipt=${encodeURIComponent(hash)}`, { cache: 'no-store' });
      const data = await res.json();
      if (data.success && data.verified) {
        verifyResultEl.innerHTML = `<div class="alert alert-success">Verified in anonymous ledger (Commit Window: <span class="mono">${data.cast_bucket_utc}</span> UTC). Candidate choice remains unlinked.</div>`;
      } else {
        verifyResultEl.innerHTML = '<div class="alert alert-error">Receipt hash not found in the ballot ledger.</div>';
      }
    } catch (_err) {
      verifyResultEl.innerHTML = '<div class="alert alert-error">Verification request failed.</div>';
    }
  });

  startPolling();
})();
