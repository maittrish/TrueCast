/**
 * TrustCast — Voter 2FA Authentication Client (login.js)
 * Implements regex validation, 120s OTP countdown timer, and strict 3-minute session handoff.
 */
(() => {
  'use strict';

  const VOTER_ID_REGEX = /^[A-Z]{2,4}-\d{6,10}$/;
  const OTP_REGEX = /^\d{6}$/;

  const voterForm = document.getElementById('voter-id-form');
  const voterInput = document.getElementById('voter-id-input');
  const requestBtn = document.getElementById('request-otp-btn');

  const otpForm = document.getElementById('otp-form');
  const otpInput = document.getElementById('otp-input');
  const otpTimerEl = document.getElementById('otp-timer');
  const maskedContactEl = document.getElementById('masked-contact');
  const verifyBtn = document.getElementById('verify-otp-btn');
  const resendBtn = document.getElementById('resend-otp-btn');
  const feedbackEl = document.getElementById('auth-feedback');

  let activeVoterId = '';
  let otpIntervalId = null;

  function showAlert(message, type) {
    feedbackEl.innerHTML = `<div class="alert alert-${type}">${escapeHtml(message)}</div>`;
  }

  function clearAlert() {
    feedbackEl.innerHTML = '';
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (ch) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    }[ch]));
  }

  function startOtpCountdown(seconds) {
    if (otpIntervalId) clearInterval(otpIntervalId);
    let remaining = seconds;

    const render = () => {
      const mins = String(Math.floor(remaining / 60)).padStart(2, '0');
      const secs = String(remaining % 60).padStart(2, '0');
      otpTimerEl.textContent = `${mins}:${secs}`;
      otpTimerEl.style.color = remaining <= 20 ? '#f87171' : '#38bdf8';
    };

    render();
    otpIntervalId = setInterval(() => {
      remaining -= 1;
      if (remaining <= 0) {
        clearInterval(otpIntervalId);
        otpTimerEl.textContent = '00:00';
        verifyBtn.disabled = true;
        showAlert('OTP expired. Request a new verification code.', 'error');
        return;
      }
      render();
    }, 1000);
  }

  async function requestOtp(voterId) {
    clearAlert();
    requestBtn.disabled = true;

    try {
      const res = await fetch('login.php', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ action: 'request_otp', voter_id: voterId }),
      });
      const data = await res.json();

      if (!res.ok || !data.success) {
        showAlert(data.error || 'Unable to issue OTP.', 'error');
        requestBtn.disabled = false;
        return;
      }

      activeVoterId = voterId;
      maskedContactEl.textContent = data.contact_masked || 'registered device';
      otpForm.style.display = 'block';
      verifyBtn.disabled = false;
      otpInput.value = '';
      otpInput.focus();
      startOtpCountdown(Number(data.otp_ttl_sec || 120));
      showAlert('2FA verification code dispatched out-of-band to your registered device.', 'success');
    } catch (_err) {
      showAlert('Network error communicating with authentication server.', 'error');
      requestBtn.disabled = false;
    }
  }

  voterInput.addEventListener('input', () => {
    voterInput.value = voterInput.value.toUpperCase().replace(/[^A-Z0-9-]/g, '');
  });

  otpInput.addEventListener('input', () => {
    otpInput.value = otpInput.value.replace(/\D/g, '').slice(0, 6);
  });

  voterForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const candidateId = voterInput.value.trim().toUpperCase();
    if (!VOTER_ID_REGEX.test(candidateId)) {
      showAlert('Invalid Voter ID format. Must match pattern TC-849201.', 'error');
      voterInput.focus();
      return;
    }
    requestOtp(candidateId);
  });

  resendBtn.addEventListener('click', () => {
    if (!VOTER_ID_REGEX.test(activeVoterId)) return;
    requestOtp(activeVoterId);
  });

  otpForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearAlert();

    const otp = otpInput.value.trim();
    if (!OTP_REGEX.test(otp)) {
      showAlert('Please enter the exact 6-digit numeric verification code.', 'error');
      otpInput.focus();
      return;
    }

    verifyBtn.disabled = true;

    try {
      const res = await fetch('login.php', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          action: 'verify_otp',
          voter_id: activeVoterId,
          otp,
        }),
      });
      const data = await res.json();

      if (!res.ok || !data.success) {
        showAlert(data.error || '2FA verification failed.', 'error');
        verifyBtn.disabled = false;
        return;
      }

      if (otpIntervalId) clearInterval(otpIntervalId);

      // Store strictly non-PII session metadata for ballot countdown & CSRF header
      sessionStorage.setItem('tc_csrf_token', data.csrf_token);
      sessionStorage.setItem('tc_expires_at', String(data.expires_at_unix));

      window.location.replace('ballot.html');
    } catch (_err) {
      showAlert('Network error verifying 2FA code.', 'error');
      verifyBtn.disabled = false;
    }
  });
})();
