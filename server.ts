import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express, { type Request, type Response } from 'express';
import { createServer as createViteServer } from 'vite';

const PORT = 3000;
const SESSION_TTL_SEC = 180; // Strict 3-minute ballot session timeout
const OFFICER_SESSION_TTL_SEC = 1800; // 30-minute Returning Officer session
const LOGIN_LOCKOUT_WINDOW_MS = 15 * 60 * 1000; // 15-minute brute-force lockout window
const MAX_FAILED_LOGIN_ATTEMPTS = 5;
const SERVER_PEPPER = process.env.TRUSTCAST_PEPPER || crypto.randomBytes(32).toString('hex');

// Standard Indian EPIC format: 3 uppercase letters + 7 digits (e.g. DLH8492014)
const EPIC_ID_REGEX = /^[A-Z]{3}\d{7}$/;
// Indian 10-digit mobile number starting with 6-9 (optional +91 prefix)
const INDIAN_MOBILE_REGEX = /^[6-9]\d{9}$/;

const OFFICER_ID = (process.env.OFFICER_ID || 'ECI-RO-2026').trim().toUpperCase();
const OFFICER_PASSKEY = process.env.OFFICER_PASSKEY || 'BHARAT-RO-2026';
const rawOfficerPortalPath = (process.env.OFFICER_PORTAL_PATH || '/eci-ro-portal').trim();
const OFFICER_PORTAL_PATH = rawOfficerPortalPath.startsWith('/')
  ? rawOfficerPortalPath.replace(/\/+$/, '') || '/eci-ro-portal'
  : `/${rawOfficerPortalPath.replace(/\/+$/, '')}`;

type AgeGroup = '18-24' | '25-34' | '35-49' | '50-64' | '65+';
type BoothStatus = 'OPEN' | 'SEALED';

interface VoterRecord {
  epic_id: string;
  full_name: string;
  age_group: AgeGroup;
  constituency: string;
  mobile_hash: string;
  mobile_masked: string;
  has_voted: boolean;
  voted_day: string | null;
}

interface CandidateRecord {
  candidate_id: number;
  full_name: string;
  coalition: string;
  portfolio_focus: string;
  platform_summary: string;
  portrait_path: string;
  display_order: number;
}

interface AnonymousBallot {
  ballot_uuid: string;
  candidate_id: number;
  receipt_hash: string;
  cast_bucket_ist: string;
}

interface LoginAttemptRecord {
  failures: number;
  reset_at_ms: number;
}

interface ActiveSession {
  sid: string;
  epic_id: string;
  auth_time_unix: number;
  expires_at_unix: number;
  csrf_token: string;
}

interface OfficerSession {
  sid: string;
  officer_id: string;
  officer_name: string;
  expires_at_unix: number;
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------
function sha256Hex(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function timingSafeTextEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function normalizeIndianMobile(raw: string): string | null {
  const digits = raw.replace(/[\s\-()]/g, '').replace(/^\+?91/, '');
  if (!INDIAN_MOBILE_REGEX.test(digits)) return null;
  return digits;
}

function maskIndianMobile(tenDigit: string): string {
  return `+91 ***** ${tenDigit.slice(-5)}`;
}

function formatIstTimestamp(date = new Date()): string {
  const istMs = date.getTime() + 5.5 * 60 * 60 * 1000;
  return new Date(istMs).toISOString().replace('T', ' ').slice(0, 19);
}

function getQuantizedIstBucket(date = new Date()): string {
  const istMs = date.getTime() + 5.5 * 60 * 60 * 1000;
  const bucketMs = Math.floor(istMs / (15 * 60 * 1000)) * (15 * 60 * 1000);
  return new Date(bucketMs).toISOString().replace('T', ' ').slice(0, 19);
}

function seedVoter(
  epic_id: string,
  full_name: string,
  age_group: AgeGroup,
  constituency: string,
  tenDigitMobile: string,
  has_voted: boolean,
  voted_day: string | null = null
): [string, VoterRecord] {
  return [
    epic_id,
    {
      epic_id,
      full_name,
      age_group,
      constituency,
      mobile_hash: sha256Hex(`${tenDigitMobile}|${SERVER_PEPPER}`),
      mobile_masked: maskIndianMobile(tenDigitMobile),
      has_voted,
      voted_day,
    },
  ];
}

// -----------------------------------------------------------------------------
// Decoupled Election Stores (Indian Parliamentary & Assembly Constituencies)
// -----------------------------------------------------------------------------
let boothStatus: BoothStatus = 'OPEN';
const electionTitle = 'Lok Sabha & Constitutional Digital Council — General Poll 2026';

const candidates: CandidateRecord[] = [
  {
    candidate_id: 1,
    full_name: 'Rajeshwar Kulkarni',
    coalition: 'Rashtriya Vikas Morcha',
    portfolio_focus: 'Railways, Freight Corridors & Urban Mobility',
    platform_summary:
      'High-speed regional rail links, transparent e-procurement tenders, and solar-powered public transit depots.',
    portrait_path: '/src/assets/images/candidate_rajeshwar_kulkarni_1794807686785.jpg',
    display_order: 1,
  },
  {
    candidate_id: 2,
    full_name: 'Priya Nair',
    coalition: 'Constitutional Digital Front',
    portfolio_focus: 'Public Healthcare & Citizen Data Privacy',
    platform_summary:
      '24-hour primary health centres across every taluka, statutory Aadhaar-data minimization, and open district budgets.',
    portrait_path: '/src/assets/images/candidate_priya_nair_1794774572754.jpg',
    display_order: 2,
  },
  {
    candidate_id: 3,
    full_name: 'Vikramaditya Rao',
    coalition: 'Swadeshi Grid & Agri Alliance',
    portfolio_focus: 'Rural Microgrids & Watershed Resilience',
    platform_summary:
      'Decentralized solar cold-storage for mandis, river-basin telemetry, and zero-collateral MSME credit.',
    portrait_path: '/src/assets/images/candidate_vikramaditya_rao_1794807687631.jpg',
    display_order: 3,
  },
  {
    candidate_id: 4,
    full_name: 'Meenakshi Sundaram',
    coalition: 'Janata Shiksha & Reform Front',
    portfolio_focus: 'Public Universities & Judicial Digitization',
    platform_summary:
      'Multilingual digital classrooms in government schools, fast-track district courts, and municipal accountability.',
    portrait_path: '/src/assets/images/candidate_meenakshi_sundaram_1794807689247.jpg',
    display_order: 4,
  },
];

const voters = new Map<string, VoterRecord>([
  // Eligible voters (has_voted = false) with Indian +91 numbers
  seedVoter('DLH8492014', 'Aarav Sharma', '25-34', 'New Delhi', '9811048210', false),
  seedVoter('MUM5120943', 'Kavita Deshpande', '35-49', 'Mumbai South', '9820190345', false),
  seedVoter('BLR3048129', 'Siddharth Hegde', '18-24', 'Bengaluru Central', '9900111782', false),
  seedVoter('VAR7741205', 'Rameshwar Tiwari', '65+', 'Varanasi', '9415066421', false),
  seedVoter('HYD6193052', 'Fatima Begum', '50-64', 'Hyderabad', '9849023904', false),
  seedVoter('KOL9021148', 'Anirban Chatterjee', '25-34', 'Kolkata North', '9830077196', false),
  seedVoter('CHN4489103', 'Karthik Subramanian', '35-49', 'Chennai Central', '9840055032', false),
  seedVoter('PUN2295047', 'Sneha Joshi', '50-64', 'Pune', '9822031849', false),

  // Initial baseline votes cast (completely decoupled from `votes` array)
  seedVoter('DLH1004011', 'Neha Kapoor', '25-34', 'New Delhi', '9811219021', true, '2026-11-15'),
  seedVoter('MUM1004022', 'Prakash Sawant', '50-64', 'Mumbai South', '9820384209', true, '2026-11-15'),
  seedVoter('BLR1004033', 'Deepika Menon', '35-49', 'Bengaluru Central', '9900461348', true, '2026-11-15'),
  seedVoter('VAR1004044', 'Vivek Pandey', '18-24', 'Varanasi', '9415594112', true, '2026-11-15'),
  seedVoter('HYD1004055', 'Lakshmi Narayana', '65+', 'Hyderabad', '9849620857', true, '2026-11-15'),
  seedVoter('KOL1004066', 'Subhashish Bose', '35-49', 'Kolkata North', '9830773294', true, '2026-11-15'),
  seedVoter('CHN1004077', 'Divya Krishnan', '25-34', 'Chennai Central', '9840850481', true, '2026-11-15'),
  seedVoter('PUN1004088', 'Milind Gokhale', '65+', 'Pune', '9822947730', true, '2026-11-15'),
  seedVoter('DLH1004099', 'Riya Verma', '18-24', 'New Delhi', '9811338905', true, '2026-11-15'),
  seedVoter('MUM1004101', 'Suresh Kulkarni', '50-64', 'Mumbai South', '9820412567', true, '2026-11-15'),
  seedVoter('BLR1004112', 'Nandini Rao', '35-49', 'Bengaluru Central', '9900588431', true, '2026-11-15'),
  seedVoter('HYD1004123', 'Arjun Reddy', '25-34', 'Hyderabad', '9849767018', true, '2026-11-15'),
  seedVoter('KOL1004134', 'Maitreyi Sen', '50-64', 'Kolkata North', '9830844126', true, '2026-11-15'),
  seedVoter('CHN1004145', 'Aravind Natarajan', '18-24', 'Chennai Central', '9840999803', true, '2026-11-15'),
]);

// Completely unlinked anonymous ballots matching the 14 initial `has_voted: true` voters
const initialCandidateDistribution = [1, 2, 3, 1, 4, 2, 1, 4, 2, 3, 1, 2, 4, 1];
const votes: AnonymousBallot[] = initialCandidateDistribution.map((candidateId, idx) => {
  const nonce = crypto.createHash('sha256').update(`seed-india-ballot-${idx}-${SERVER_PEPPER}`).digest('hex');
  return {
    ballot_uuid: crypto.randomUUID(),
    candidate_id: candidateId,
    receipt_hash: crypto.createHash('sha256').update(`${nonce}|${SERVER_PEPPER}`).digest('hex'),
    cast_bucket_ist: '2026-11-16 10:30:00',
  };
});

const loginAttempts = new Map<string, LoginAttemptRecord>();
const sessions = new Map<string, ActiveSession>();
const officerSessions = new Map<string, OfficerSession>();
const voterLocks = new Map<string, Promise<void>>();

// -----------------------------------------------------------------------------
// Security & Cookie Helpers
// -----------------------------------------------------------------------------
function parseCookies(req: Request): Record<string, string> {
  const header = req.headers.cookie;
  if (!header) return {};
  const result: Record<string, string> = {};
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const val = decodeURIComponent(part.slice(idx + 1).trim());
    result[key] = val;
  }
  return result;
}

function isHttpsRequest(req: Request): boolean {
  return Boolean(req.secure || req.headers['x-forwarded-proto'] === 'https');
}

function setCookie(req: Request, res: Response, name: string, value: string, maxAgeSec: number): void {
  const sameSiteFlags = isHttpsRequest(req) ? 'SameSite=None; Secure' : 'SameSite=Lax';
  res.append(
    'Set-Cookie',
    `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; ${sameSiteFlags}; Max-Age=${maxAgeSec}`
  );
}

function clearCookie(req: Request, res: Response, name: string): void {
  const sameSiteFlags = isHttpsRequest(req) ? 'SameSite=None; Secure' : 'SameSite=Lax';
  res.append(
    'Set-Cookie',
    `${name}=; Path=/; HttpOnly; ${sameSiteFlags}; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT`
  );
}

function getActiveSession(req: Request, res: Response): ActiveSession | null {
  const cookies = parseCookies(req);
  const headerSid =
    typeof req.headers['x-trustcast-session'] === 'string'
      ? req.headers['x-trustcast-session'].trim()
      : '';
  const sid = cookies.TRUSTCAST_SID || headerSid;
  if (!sid) return null;

  const session = sessions.get(sid);
  if (!session) {
    clearCookie(req, res, 'TRUSTCAST_SID');
    return null;
  }

  const nowUnix = Math.floor(Date.now() / 1000);
  if (nowUnix >= session.expires_at_unix) {
    sessions.delete(sid);
    clearCookie(req, res, 'TRUSTCAST_SID');
    return null;
  }

  return session;
}

function getActiveOfficerSession(req: Request, res: Response): OfficerSession | null {
  const cookies = parseCookies(req);
  const headerSid =
    typeof req.headers['x-officer-session'] === 'string'
      ? req.headers['x-officer-session'].trim()
      : '';
  const sid = cookies.TRUSTCAST_OFFICER_SID || headerSid;
  if (!sid) return null;

  const session = officerSessions.get(sid);
  if (!session) {
    clearCookie(req, res, 'TRUSTCAST_OFFICER_SID');
    return null;
  }

  const nowUnix = Math.floor(Date.now() / 1000);
  if (nowUnix >= session.expires_at_unix) {
    officerSessions.delete(sid);
    clearCookie(req, res, 'TRUSTCAST_OFFICER_SID');
    return null;
  }

  return session;
}

async function withVoterLock<T>(epicId: string, work: () => Promise<T>): Promise<T> {
  const previous = voterLocks.get(epicId) || Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  voterLocks.set(epicId, previous.then(() => current));

  await previous;
  try {
    return await work();
  } finally {
    release();
    if (voterLocks.get(epicId) === current) {
      voterLocks.delete(epicId);
    }
  }
}

function noStoreHeaders(res: Response): void {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('X-Content-Type-Options', 'nosniff');
}

function buildResultsSnapshot() {
  const totalCast = votes.length;
  const allVoters = Array.from(voters.values());
  const totalRegistered = allVoters.length;

  const standings = candidates
    .map((c) => {
      const count = votes.reduce((acc, v) => (v.candidate_id === c.candidate_id ? acc + 1 : acc), 0);
      return {
        ...c,
        vote_count: count,
        share_pct: totalCast > 0 ? Number(((count / totalCast) * 100).toFixed(2)) : 0,
      };
    })
    .sort((a, b) => b.vote_count - a.vote_count || a.display_order - b.display_order);

  const ageOrder: AgeGroup[] = ['18-24', '25-34', '35-49', '50-64', '65+'];
  const demographics = ageOrder.map((age) => {
    const group = allVoters.filter((v) => v.age_group === age);
    const voted = group.filter((v) => v.has_voted).length;
    return {
      age_group: age,
      registered: group.length,
      voted,
      turnout_pct: group.length > 0 ? Number(((voted / group.length) * 100).toFixed(1)) : 0,
    };
  });

  const constituencyNames = Array.from(new Set(allVoters.map((v) => v.constituency))).sort();
  const constituencies = constituencyNames.map((constituency) => {
    const group = allVoters.filter((v) => v.constituency === constituency);
    const voted = group.filter((v) => v.has_voted).length;
    return {
      constituency,
      registered: group.length,
      voted,
      turnout_pct: group.length > 0 ? Number(((voted / group.length) * 100).toFixed(1)) : 0,
    };
  });

  const constituency_matrix = constituencyNames.flatMap((constituency) =>
    ageOrder.map((age) => {
      const group = allVoters.filter((v) => v.constituency === constituency && v.age_group === age);
      const voted = group.filter((v) => v.has_voted).length;
      return {
        constituency,
        age_group: age,
        registered: group.length,
        voted,
        turnout_pct: group.length > 0 ? Number(((voted / group.length) * 100).toFixed(1)) : 0,
      };
    })
  );

  return {
    booth_status: boothStatus,
    election_title: electionTitle,
    generated_at_ist: formatIstTimestamp(),
    turnout: {
      total_registered: totalRegistered,
      total_cast: totalCast,
      turnout_pct: totalRegistered > 0 ? Number(((totalCast / totalRegistered) * 100).toFixed(2)) : 0,
    },
    candidates: standings,
    demographics,
    constituencies,
    constituency_matrix,
  };
}

// -----------------------------------------------------------------------------
// Express Server & API Routes
// -----------------------------------------------------------------------------
async function startServer() {
  const app = express();
  app.use(express.json({ limit: '64kb' }));

  // 1. Citizen Direct Multi-Factor Roll Login (EPIC + Registered Indian +91 Mobile + Constituency)
  app.post('/api/login', async (req, res) => {
    noStoreHeaders(res);

    if (boothStatus === 'SEALED') {
      res.status(403).json({
        success: false,
        error: 'Polling booth is currently sealed by the Returning Officer. New sessions are paused.',
      });
      return;
    }

    const epicId = String(req.body?.epic_id || req.body?.voter_id || '').trim().toUpperCase();
    const mobileNorm = normalizeIndianMobile(String(req.body?.mobile || ''));
    const constituency = String(req.body?.constituency || '').trim();

    if (!EPIC_ID_REGEX.test(epicId)) {
      res.status(422).json({
        success: false,
        error: 'Invalid EPIC Voter ID format. Expected 3 letters followed by 7 digits (e.g. DLH8492014).',
      });
      return;
    }

    if (!mobileNorm) {
      res.status(422).json({
        success: false,
        error: 'Enter a valid 10-digit Indian mobile number (+91, starting with 6–9).',
      });
      return;
    }

    if (!constituency) {
      res.status(422).json({
        success: false,
        error: 'Select your registered parliamentary constituency.',
      });
      return;
    }

    await withVoterLock(epicId, async () => {
      const nowMs = Date.now();
      const attempt = loginAttempts.get(epicId);
      if (attempt && nowMs < attempt.reset_at_ms && attempt.failures >= MAX_FAILED_LOGIN_ATTEMPTS) {
        const waitMin = Math.ceil((attempt.reset_at_ms - nowMs) / 60000);
        res.status(429).json({
          success: false,
          error: `Too many failed verification attempts for this EPIC ID. Retry in ${waitMin} minute(s).`,
        });
        return;
      }

      const voter = voters.get(epicId);
      const expectedMobileHash = sha256Hex(`${mobileNorm}|${SERVER_PEPPER}`);
      const constituencyMatches =
        voter && voter.constituency.toLowerCase() === constituency.toLowerCase();

      if (!voter || !timingSafeTextEqual(voter.mobile_hash, expectedMobileHash) || !constituencyMatches) {
        const current =
          attempt && nowMs < attempt.reset_at_ms
            ? attempt
            : { failures: 0, reset_at_ms: nowMs + LOGIN_LOCKOUT_WINDOW_MS };
        current.failures += 1;
        loginAttempts.set(epicId, current);

        const remaining = Math.max(0, MAX_FAILED_LOGIN_ATTEMPTS - current.failures);
        res.status(401).json({
          success: false,
          error:
            remaining > 0
              ? `EPIC ID, +91 mobile number, or constituency did not match electoral roll records (${remaining} attempt${remaining === 1 ? '' : 's'} remaining).`
              : 'Maximum verification attempts exceeded. EPIC ID temporarily locked for 15 minutes.',
        });
        return;
      }

      if (voter.has_voted) {
        res.status(409).json({
          success: false,
          error: 'A ballot has already been recorded for this EPIC ID. Duplicate voting is strictly prohibited.',
        });
        return;
      }

      loginAttempts.delete(epicId);

      const sid = crypto.randomBytes(32).toString('hex');
      const csrfToken = crypto.randomBytes(32).toString('hex');
      const nowUnix = Math.floor(Date.now() / 1000);
      const expiresAtUnix = nowUnix + SESSION_TTL_SEC;

      sessions.set(sid, {
        sid,
        epic_id: voter.epic_id,
        auth_time_unix: nowUnix,
        expires_at_unix: expiresAtUnix,
        csrf_token: csrfToken,
      });

      setCookie(req, res, 'TRUSTCAST_SID', sid, SESSION_TTL_SEC);
      res.json({
        success: true,
        message: 'Electoral roll verified. Secure 3-minute ballot session initialized.',
        session_token: sid,
        csrf_token: csrfToken,
        session_ttl_sec: SESSION_TTL_SEC,
        expires_at_unix: expiresAtUnix,
        constituency: voter.constituency,
      });
    });
  });

  // 2. Citizen Ballot Session Status & Logout
  app.get('/api/session', (req, res) => {
    noStoreHeaders(res);
    const session = getActiveSession(req, res);
    if (!session) {
      res.status(401).json({ authenticated: false });
      return;
    }

    const voter = voters.get(session.epic_id);
    if (!voter || voter.has_voted) {
      sessions.delete(session.sid);
      clearCookie(req, res, 'TRUSTCAST_SID');
      res.status(401).json({ authenticated: false });
      return;
    }

    const nowUnix = Math.floor(Date.now() / 1000);
    res.json({
      authenticated: true,
      session_token: session.sid,
      expires_at_unix: session.expires_at_unix,
      remaining_sec: Math.max(0, session.expires_at_unix - nowUnix),
      csrf_token: session.csrf_token,
      constituency: voter.constituency,
    });
  });

  app.post('/api/logout', (req, res) => {
    noStoreHeaders(res);
    const cookies = parseCookies(req);
    const headerSid =
      typeof req.headers['x-trustcast-session'] === 'string'
        ? req.headers['x-trustcast-session'].trim()
        : '';
    if (cookies.TRUSTCAST_SID) sessions.delete(cookies.TRUSTCAST_SID);
    if (headerSid) sessions.delete(headerSid);
    clearCookie(req, res, 'TRUSTCAST_SID');
    res.json({ success: true, session_destroyed: true });
  });

  // 3. Atomic Ballot Casting Endpoint
  app.post('/api/cast_vote', async (req, res) => {
    noStoreHeaders(res);
    if (boothStatus === 'SEALED') {
      res.status(403).json({
        success: false,
        error: 'Polling booth has been sealed by the Returning Officer.',
      });
      return;
    }

    const session = getActiveSession(req, res);
    if (!session) {
      res.status(401).json({
        success: false,
        error: 'Session missing or 3-minute timeout elapsed. Re-authenticate via 2FA.',
      });
      return;
    }

    const csrfToken = String(req.body?.csrf_token || '');
    if (!csrfToken || !timingSafeTextEqual(session.csrf_token, csrfToken)) {
      sessions.delete(session.sid);
      clearCookie(req, res, 'TRUSTCAST_SID');
      res.status(403).json({
        success: false,
        error: 'Invalid CSRF security token. Session terminated.',
      });
      return;
    }

    const candidateId = Number(req.body?.candidate_id);
    const candidate = candidates.find((c) => c.candidate_id === candidateId);
    if (!Number.isInteger(candidateId) || !candidate) {
      res.status(422).json({
        success: false,
        error: 'Invalid candidate selection.',
      });
      return;
    }

    await withVoterLock(session.epic_id, async () => {
      const voter = voters.get(session.epic_id);
      if (!voter) {
        sessions.delete(session.sid);
        clearCookie(req, res, 'TRUSTCAST_SID');
        res.status(404).json({ success: false, error: 'Voter record not found.' });
        return;
      }

      if (voter.has_voted) {
        sessions.delete(session.sid);
        clearCookie(req, res, 'TRUSTCAST_SID');
        res.status(409).json({
          success: false,
          error: 'Double-voting blocked: a ballot has already been recorded for this EPIC ID.',
        });
        return;
      }

      // 1) Mark voter as having voted (coarse IST date only)
      voter.has_voted = true;
      voter.voted_day = formatIstTimestamp().slice(0, 10);

      // 2) Insert completely decoupled anonymous ballot into `votes`
      const nonce = crypto.randomBytes(32).toString('hex');
      const receiptHash = sha256Hex(`${nonce}|${SERVER_PEPPER}`);
      const castBucketIst = getQuantizedIstBucket();

      votes.push({
        ballot_uuid: crypto.randomUUID(),
        candidate_id: candidate.candidate_id,
        receipt_hash: receiptHash,
        cast_bucket_ist: castBucketIst,
      });

      // 3) Immediately destroy server session & expire cookie
      sessions.delete(session.sid);
      clearCookie(req, res, 'TRUSTCAST_SID');

      res.status(201).json({
        success: true,
        message: 'Secret ballot recorded atomically. Session destroyed.',
        receipt_hash: receiptHash,
        cast_bucket_ist: castBucketIst,
        session_destroyed: true,
      });
    });
  });

  // 4. Real-Time Public Results & Receipt Verification Endpoint
  app.get('/api/get_results', (req, res) => {
    noStoreHeaders(res);

    const receiptParam = req.query.receipt;
    if (typeof receiptParam === 'string') {
      const clean = receiptParam.trim().toLowerCase();
      if (!/^[a-f0-9]{64}$/.test(clean)) {
        res.status(422).json({
          success: false,
          error: 'Invalid SHA-256 receipt format (must be 64 hex characters).',
        });
        return;
      }

      const match = votes.find((v) => v.receipt_hash === clean);
      res.json({
        success: true,
        verified: Boolean(match),
        receipt_hash: clean,
        cast_bucket_ist: match ? match.cast_bucket_ist : null,
        secrecy_note: match
          ? 'Ballot inclusion confirmed in the anonymous ledger. Candidate choice remains mathematically unlinked.'
          : 'No matching ballot receipt found in the ledger.',
      });
      return;
    }

    res.json({
      success: true,
      ...buildResultsSnapshot(),
    });
  });

  // 5. Authenticated Returning Officer (Government Authority) API
  app.post('/api/officer/login', (req, res) => {
    noStoreHeaders(res);
    const officerId = String(req.body?.officer_id || '').trim().toUpperCase();
    const passkey = String(req.body?.passkey || '');

    if (
      !officerId ||
      !passkey ||
      !timingSafeTextEqual(officerId, OFFICER_ID) ||
      !timingSafeTextEqual(passkey, OFFICER_PASSKEY)
    ) {
      res.status(401).json({
        success: false,
        error: 'Invalid Returning Officer ID or authorization passkey.',
      });
      return;
    }

    const sid = crypto.randomBytes(32).toString('hex');
    const expiresAtUnix = Math.floor(Date.now() / 1000) + OFFICER_SESSION_TTL_SEC;
    officerSessions.set(sid, {
      sid,
      officer_id: officerId,
      officer_name: 'Chief Returning Officer (ECI Division)',
      expires_at_unix: expiresAtUnix,
    });

    setCookie(req, res, 'TRUSTCAST_OFFICER_SID', sid, OFFICER_SESSION_TTL_SEC);
    res.json({
      success: true,
      officer_token: sid,
      officer_id: officerId,
      officer_name: 'Chief Returning Officer (ECI Division)',
    });
  });

  app.get('/api/officer/session', (req, res) => {
    noStoreHeaders(res);
    const officer = getActiveOfficerSession(req, res);
    if (!officer) {
      res.status(401).json({ authenticated: false });
      return;
    }
    res.json({
      authenticated: true,
      officer_token: officer.sid,
      officer_id: officer.officer_id,
      officer_name: officer.officer_name,
    });
  });

  app.post('/api/officer/logout', (req, res) => {
    noStoreHeaders(res);
    const cookies = parseCookies(req);
    const headerSid =
      typeof req.headers['x-officer-session'] === 'string'
        ? req.headers['x-officer-session'].trim()
        : '';
    if (cookies.TRUSTCAST_OFFICER_SID) officerSessions.delete(cookies.TRUSTCAST_OFFICER_SID);
    if (headerSid) officerSessions.delete(headerSid);
    clearCookie(req, res, 'TRUSTCAST_OFFICER_SID');
    res.json({ success: true });
  });

  app.get('/api/officer/overview', (req, res) => {
    noStoreHeaders(res);
    const officer = getActiveOfficerSession(req, res);
    if (!officer) {
      res.status(401).json({ success: false, error: 'Returning Officer authentication required.' });
      return;
    }

    const snapshot = buildResultsSnapshot();
    const rollList = Array.from(voters.values()).map((v) => ({
      epic_id: v.epic_id,
      full_name: v.full_name,
      age_group: v.age_group,
      constituency: v.constituency,
      mobile_masked: v.mobile_masked,
      has_voted: v.has_voted,
      voted_day: v.voted_day,
    }));

    res.json({
      success: true,
      booth_status: boothStatus,
      voters: rollList,
      constituencies: snapshot.constituencies,
      turnout: snapshot.turnout,
    });
  });

  app.post('/api/officer/voters', (req, res) => {
    noStoreHeaders(res);
    const officer = getActiveOfficerSession(req, res);
    if (!officer) {
      res.status(401).json({ success: false, error: 'Returning Officer authentication required.' });
      return;
    }

    const epicId = String(req.body?.epic_id || '').trim().toUpperCase();
    const fullName = String(req.body?.full_name || '').trim();
    const constituency = String(req.body?.constituency || '').trim();
    const ageGroup = String(req.body?.age_group || '').trim() as AgeGroup;
    const mobileNorm = normalizeIndianMobile(String(req.body?.mobile || ''));

    if (!EPIC_ID_REGEX.test(epicId)) {
      res.status(422).json({
        success: false,
        error: 'EPIC ID must match 3 uppercase letters + 7 digits (e.g. DLH9012345).',
      });
      return;
    }
    if (fullName.length < 2 || fullName.length > 100) {
      res.status(422).json({ success: false, error: 'Enter full citizen name (2–100 characters).' });
      return;
    }
    if (!mobileNorm) {
      res.status(422).json({
        success: false,
        error: 'Enter a valid 10-digit Indian mobile number (+91, starting with 6–9).',
      });
      return;
    }
    if (!['18-24', '25-34', '35-49', '50-64', '65+'].includes(ageGroup)) {
      res.status(422).json({ success: false, error: 'Select a valid age bracket.' });
      return;
    }
    if (constituency.length < 2 || constituency.length > 80) {
      res.status(422).json({ success: false, error: 'Specify a valid parliamentary constituency.' });
      return;
    }

    const existing = voters.get(epicId);
    if (existing?.has_voted) {
      res.status(409).json({
        success: false,
        error: 'Cannot modify an EPIC record that has already cast a ballot.',
      });
      return;
    }

    const [, record] = seedVoter(epicId, fullName, ageGroup, constituency, mobileNorm, false, null);
    voters.set(epicId, record);

    res.status(existing ? 200 : 201).json({
      success: true,
      message: existing
        ? `Updated +91 mobile & constituency for ${epicId}.`
        : `Enrolled citizen ${epicId} into electoral roll.`,
      voter: {
        epic_id: record.epic_id,
        full_name: record.full_name,
        age_group: record.age_group,
        constituency: record.constituency,
        mobile_masked: record.mobile_masked,
        has_voted: record.has_voted,
        voted_day: record.voted_day,
      },
    });
  });

  app.post('/api/officer/booth_status', (req, res) => {
    noStoreHeaders(res);
    const officer = getActiveOfficerSession(req, res);
    if (!officer) {
      res.status(401).json({ success: false, error: 'Returning Officer authentication required.' });
      return;
    }

    const nextStatus = String(req.body?.status || '').toUpperCase();
    if (nextStatus !== 'OPEN' && nextStatus !== 'SEALED') {
      res.status(422).json({ success: false, error: 'Status must be OPEN or SEALED.' });
      return;
    }

    boothStatus = nextStatus;
    res.json({ success: true, booth_status: boothStatus });
  });

  app.get('/api/officer/export_csv', (req, res) => {
    noStoreHeaders(res);
    const officer = getActiveOfficerSession(req, res);
    if (!officer) {
      res.status(401).json({ success: false, error: 'Returning Officer authentication required.' });
      return;
    }

    const snap = buildResultsSnapshot();
    const lines: string[] = [
      'Section,Name,Detail,Votes_Or_Voted,Registered_Or_Share',
      ...snap.candidates.map(
        (c) =>
          `"Candidate","${c.full_name.replace(/"/g, '""')}","${c.coalition.replace(/"/g, '""')}",${c.vote_count},${c.share_pct}%`
      ),
      ...snap.constituencies.map(
        (con) =>
          `"Constituency","${con.constituency.replace(/"/g, '""')}","Turnout ${con.turnout_pct}%",${con.voted},${con.registered}`
      ),
    ];

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="trustcast_certified_tally.csv"');
    res.send(lines.join('\n'));
  });

  app.all('/api/*', (_req, res) => {
    noStoreHeaders(res);
    res.status(404).json({ success: false, error: 'Endpoint not found.' });
  });

  // 6. Isolated Officer Authority Route + Vite Dev Middleware / Static Production Assets
  app.all(['/officer.html', '/officer.html/*'], (_req, res) => {
    noStoreHeaders(res);
    res.status(404).send('Not Found');
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });

    app.get([OFFICER_PORTAL_PATH, `${OFFICER_PORTAL_PATH}/`], async (req, res, next) => {
      try {
        noStoreHeaders(res);
        res.setHeader('X-Robots-Tag', 'noindex, nofollow');
        const templatePath = path.resolve(process.cwd(), 'officer.html');
        const rawHtml = await fs.promises.readFile(templatePath, 'utf-8');
        const transformedHtml = await vite.transformIndexHtml(req.originalUrl, rawHtml);
        res.status(200).setHeader('Content-Type', 'text/html; charset=utf-8').send(transformedHtml);
      } catch (err) {
        next(err);
      }
    });

    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');

    app.get([OFFICER_PORTAL_PATH, `${OFFICER_PORTAL_PATH}/`], (_req, res) => {
      noStoreHeaders(res);
      res.setHeader('X-Robots-Tag', 'noindex, nofollow');
      res.sendFile(path.join(distDir, 'officer.html'));
    });

    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(
      `TrustCast India Election Server listening on http://0.0.0.0:${PORT} (Restricted Officer Portal: ${OFFICER_PORTAL_PATH})`
    );
  });
}

startServer();
