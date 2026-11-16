/**
 * TrustCast — Secure Ballot Client (ballot.js)
 * Enforces 3-minute session countdown, explicit two-step vote confirmation,
 * instant storage wipe on commit, and history locking to disable Back button post-vote.
 */
(() => {
  'use strict';

  const csrfToken = sessionStorage.getItem('tc_csrf_token');
  const expiresAtUnix = Number(sessionStorage.getItem('tc_expires_at') || 0);

  if (!csrfToken || !expiresAtUnix) {
    window.location.replace('index.html');
    return;
  }

  const countdownEl = document.getElementById('session-countdown');
  const candidateListEl = document.getElementById('candidate-list');
  const reviewBtn = document.getElementById('review-ballot-btn');
  const feedbackEl = document.getElementById('ballot-feedback');

  const confirmModal = document.getElementById('confirm-modal');
  const confirmNameEl = document.getElementById('confirm-candidate-name');
  const confirmCoalitionEl = document.getElementById('confirm-candidate-coalition');
  const confirmCheckbox = document.getElementById('confirm-checkbox');
  const cancelConfirmBtn = document.getElementById('cancel-confirm-btn');
  const submitVoteBtn = document.getElementById('submit-vote-btn');

  const ballotStage = document.getElementById('ballot-stage');
  const receiptStage = document.getElementById('receipt-stage');
  const receiptHashEl = document.getElementById('receipt-hash-display');
  const receiptBucketEl = document.getElementById('receipt-bucket-display');
  const copyReceiptBtn = document.getElementById('copy-receipt-btn');

  let candidates = [];
  let selectedCandidateId = null;
  let voteCommitted = false;

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (ch) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    }[ch]));
  }

  function lockHistoryPostVote() {
    window.history.pushState({ trustcastLocked: true }, '', window.location.href);
    window.addEventListener('popstate', () => {
      if (voteCommitted) {
        window.history.pushState({ trustcastLocked: true }, '', window.location.href);
      }
    });
  }

  function wipeClientSession() {
    try {
      localStorage.clear();
      sessionStorage.clear();
    } catch (_e) {
      // Ignore storage errors in restricted contexts
    }
  }

  // Strict 3-minute session countdown
  const sessionTimer = setInterval(() => {
    if (voteCommitted) {
      clearInterval(sessionTimer);
      return;
    }
    const remaining = Math.max(0, expiresAtUnix - Math.floor(Date.now() / 1000));
    const mins = String(Math.floor(remaining / 60)).padStart(2, '0');
    const secs = String(remaining % 60).padStart(2, '0');
    countdownEl.textContent = `Session: ${mins}:${secs}`;
    countdownEl.style.color = remaining <= 30 ? '#f87171' : '#38bdf8';

    if (remaining <= 0) {
      clearInterval(sessionTimer);
      wipeClientSession();
      window.location.replace('index.html');
    }
  }, 500);

  async function loadCandidates() {
    try {
      const res = await fetch('get_results.php', { credentials: 'same-origin' });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Failed to load ballot');

      candidates = data.candidates || [];
      candidateListEl.innerHTML = candidates.map((c) => `
        <button
          type="button"
          class="glass-panel candidate-option"
          data-id="${Number(c.candidate_id)}"
          role="radio"
          aria-checked="false"
          style="text-align: left; cursor: pointer; transition: border-color 150ms ease;"
        >
          <div style="font-size: 0.8rem; color: var(--text-secondary); margin-bottom: 0.35rem;">
            ${escapeHtml(c.coalition)} · ${escapeHtml(c.portfolio_focus)}
          </div>
          <div style="font-family: 'Plus Jakarta Sans', sans-serif; font-size: 1.15rem; font-weight: 700; margin-bottom: 0.5rem;">
            ${escapeHtml(c.full_name)}
          </div>
          <p style="font-size: 0.875rem; color: var(--text-secondary);">
            ${escapeHtml(c.platform_summary)}
          </p>
        </button>
      `).join('');

      candidateListEl.querySelectorAll('.candidate-option').forEach((btn) => {
        btn.addEventListener('click', () => {
          selectedCandidateId = Number(btn.dataset.id);
          candidateListEl.querySelectorAll('.candidate-option').forEach((other) => {
            const isSelected = Number(other.dataset.id) === selectedCandidateId;
            other.setAttribute('aria-checked', String(isSelected));
            other.style.borderColor = isSelected ? '#38bdf8' : 'rgba(148, 163, 184, 0.18)';
          });
          reviewBtn.disabled = false;
        });
      });
    } catch (err) {
      feedbackEl.innerHTML = `<div class="alert alert-error">${escapeHtml(err.message)}</div>`;
    }
  }

  reviewBtn.addEventListener('click', () => {
    const cand = candidates.find((c) => Number(c.candidate_id) === selectedCandidateId);
    if (!cand) return;
    confirmNameEl.textContent = cand.full_name;
    confirmCoalitionEl.textContent = `${cand.coalition} · ${cand.portfolio_focus}`;
    confirmCheckbox.checked = false;
    submitVoteBtn.disabled = true;
    confirmModal.classList.add('open');
  });

  confirmCheckbox.addEventListener('change', () => {
    submitVoteBtn.disabled = !confirmCheckbox.checked;
  });

  cancelConfirmBtn.addEventListener('click', () => {
    confirmModal.classList.remove('open');
  });

  submitVoteBtn.addEventListener('click', async () => {
    if (!selectedCandidateId || !confirmCheckbox.checked) return;
    submitVoteBtn.disabled = true;

    try {
      const res = await fetch('cast_vote.php', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          candidate_id: selectedCandidateId,
          csrf_token: csrfToken,
        }),
      });
      const data = await res.json();

      if (!res.ok || !data.success) {
        confirmModal.classList.remove('open');
        feedbackEl.innerHTML = `<div class="alert alert-error">${escapeHtml(data.error || 'Ballot submission failed.')}</div>`;
        return;
      }

      // Immediately destroy client state & lock browser back button
      voteCommitted = true;
      clearInterval(sessionTimer);
      wipeClientSession();
      lockHistoryPostVote();

      confirmModal.classList.remove('open');
      ballotStage.style.display = 'none';
      receiptStage.style.display = 'block';
      countdownEl.textContent = 'Session Closed';
      countdownEl.style.color = '#94a3b8';

      receiptHashEl.textContent = data.receipt_hash;
      receiptBucketEl.textContent = data.cast_bucket_utc;
    } catch (_err) {
      confirmModal.classList.remove('open');
      feedbackEl.innerHTML = '<div class="alert alert-error">Network failure while recording ballot.</div>';
    }
  });

  copyReceiptBtn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(receiptHashEl.textContent || '');
      copyReceiptBtn.textContent = 'Copied';
      setTimeout(() => {
        copyReceiptBtn.textContent = 'Copy Receipt Hash';
      }, 1500);
    } catch (_e) {
      // Fallback ignored
    }
  });

  loadCandidates();
})();
