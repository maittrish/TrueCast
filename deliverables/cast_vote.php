<?php
/**
 * TrustCast — Atomic Ballot Casting Endpoint (cast_vote.php)
 *
 * Security Invariants:
 * 1. Enforces strict 180-second (3-minute) session expiry & CSRF token validation.
 * 2. Executes InnoDB transaction with `SELECT ... FOR UPDATE` row-level lock on `voters`
 *    to make concurrent double-voting mathematically impossible.
 * 3. Inserts anonymized ballot into `votes` with ZERO voter identity linkage and a
 *    15-minute rounded timestamp bucket to defeat timing correlation attacks.
 * 4. Generates an opaque SHA-256 cryptographic receipt (`receipt_hash`).
 * 5. Destroys the PHP session & expires the session cookie the exact millisecond
 *    the transaction commits.
 */

declare(strict_types=1);

require_once __DIR__ . '/db.php';

tc_send_security_headers();
tc_start_hardened_session();

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    tc_json_response(['success' => false, 'error' => 'Method not allowed.'], 405);
}

// 1. Verify active session & strict 3-minute timeout
if (empty($_SESSION['voter_id']) || empty($_SESSION['auth_time']) || empty($_SESSION['expires_at'])) {
    tc_destroy_session();
    tc_json_response(['success' => false, 'error' => 'No active voting session. Please authenticate via 2FA.'], 401);
}

if (time() > (int) $_SESSION['expires_at']) {
    tc_destroy_session();
    tc_json_response(['success' => false, 'error' => '3-minute ballot session expired for your security.'], 401);
}

$rawBody = file_get_contents('php://input');
$input   = json_decode($rawBody ?: '{}', true);

if (!is_array($input)) {
    tc_json_response(['success' => false, 'error' => 'Malformed JSON payload.'], 400);
}

// 2. Verify CSRF token
$csrfToken = (string) ($input['csrf_token'] ?? '');
if (empty($_SESSION['csrf_token']) || !hash_equals($_SESSION['csrf_token'], $csrfToken)) {
    tc_destroy_session();
    tc_json_response(['success' => false, 'error' => 'Invalid CSRF security token. Session terminated.'], 403);
}

$candidateId = filter_var($input['candidate_id'] ?? null, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
if ($candidateId === false) {
    tc_json_response(['success' => false, 'error' => 'Invalid candidate selection.'], 422);
}

$voterId = (string) $_SESSION['voter_id'];

try {
    $pdo = tc_get_pdo();
    $pdo->beginTransaction();

    // 3. Pessimistic row-level lock prevents race conditions & double-clicks
    $lockStmt = $pdo->prepare(
        'SELECT voter_id, has_voted FROM voters WHERE voter_id = :voter_id FOR UPDATE'
    );
    $lockStmt->execute([':voter_id' => $voterId]);
    $voter = $lockStmt->fetch();

    if (!$voter) {
        $pdo->rollBack();
        tc_destroy_session();
        tc_json_response(['success' => false, 'error' => 'Voter record not found.'], 404);
    }

    if ((int) $voter['has_voted'] === 1) {
        $pdo->rollBack();
        tc_destroy_session();
        tc_json_response(['success' => false, 'error' => 'Double-voting blocked: ballot already recorded.'], 409);
    }

    // 4. Verify candidate exists and is active
    $candStmt = $pdo->prepare(
        'SELECT candidate_id FROM candidates WHERE candidate_id = :cid AND is_active = 1 LIMIT 1'
    );
    $candStmt->execute([':cid' => $candidateId]);
    if (!$candStmt->fetch()) {
        $pdo->rollBack();
        tc_json_response(['success' => false, 'error' => 'Selected candidate is not active on this ballot.'], 404);
    }

    // 5. Mark voter as voted (coarse date only — zero linkage to ballot UUID)
    $markVoter = $pdo->prepare(
        'UPDATE voters SET has_voted = 1, voted_day = UTC_DATE() WHERE voter_id = :voter_id AND has_voted = 0'
    );
    $markVoter->execute([':voter_id' => $voterId]);

    if ($markVoter->rowCount() !== 1) {
        $pdo->rollBack();
        tc_destroy_session();
        tc_json_response(['success' => false, 'error' => 'Atomic lock failure. Vote rejected.'], 409);
    }

    // 6. Generate UUIDv4, 15-minute quantized timestamp, and opaque SHA-256 receipt
    $uuidBytes    = random_bytes(16);
    $uuidBytes[6] = chr((ord($uuidBytes[6]) & 0x0f) | 0x40);
    $uuidBytes[8] = chr((ord($uuidBytes[8]) & 0x3f) | 0x80);
    $ballotUuid   = vsprintf('%s%s-%s-%s-%s-%s%s%s', str_split(bin2hex($uuidBytes), 4));

    $receiptNonce = bin2hex(random_bytes(32));
    $receiptHash  = hash('sha256', $receiptNonce . '|' . TRUSTCAST_PEPPER);

    $nowTs        = time();
    $bucketTs     = (int) (floor($nowTs / 900) * 900);
    $castBucket   = gmdate('Y-m-d H:i:s', $bucketTs);

    $insertBallot = $pdo->prepare(
        'INSERT INTO votes (ballot_uuid, candidate_id, receipt_hash, cast_bucket)
         VALUES (:ballot_uuid, :candidate_id, :receipt_hash, :cast_bucket)'
    );
    $insertBallot->execute([
        ':ballot_uuid'  => $ballotUuid,
        ':candidate_id' => $candidateId,
        ':receipt_hash' => $receiptHash,
        ':cast_bucket'  => $castBucket,
    ]);

    $pdo->commit();

    // 7. Immediately destroy session upon commit
    tc_destroy_session();

    tc_json_response([
        'success'           => true,
        'message'           => 'Secret ballot recorded atomically. Session destroyed.',
        'receipt_hash'      => $receiptHash,
        'cast_bucket_utc'   => $castBucket,
        'session_destroyed' => true,
    ], 201);
} catch (Throwable $e) {
    if (isset($pdo) && $pdo->inTransaction()) {
        $pdo->rollBack();
    }
    tc_json_response(['success' => false, 'error' => 'Ballot recording failed safely; no vote was cast.'], 500);
}
