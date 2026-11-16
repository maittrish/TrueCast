<?php
/**
 * TrustCast — Two-Factor Authentication Endpoint (login.php)
 *
 * Step 1 (action=request_otp): Validates Voter ID via regex, verifies eligibility
 *   (has_voted = 0), and issues a 120-second time-sensitive 6-digit OTP.
 * Step 2 (action=verify_otp): Verifies OTP hash with constant-time comparison,
 *   regenerates PHP session ID, and initiates a strict 180-second ballot session.
 */

declare(strict_types=1);

require_once __DIR__ . '/db.php';

tc_send_security_headers();

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    tc_json_response(['success' => false, 'error' => 'Method not allowed.'], 405);
}

$rawBody = file_get_contents('php://input');
$input   = json_decode($rawBody ?: '{}', true);

if (!is_array($input)) {
    tc_json_response(['success' => false, 'error' => 'Malformed JSON payload.'], 400);
}

$action  = (string) ($input['action'] ?? '');
$voterId = strtoupper(trim((string) ($input['voter_id'] ?? '')));

// Strict Voter ID format enforcement
if (!preg_match('/^[A-Z]{2,4}-\d{6,10}$/', $voterId)) {
    tc_json_response([
        'success' => false,
        'error'   => 'Invalid Voter ID format. Expected pattern such as TC-849201.',
    ], 422);
}

try {
    $pdo = tc_get_pdo();

    if ($action === 'request_otp') {
        $stmt = $pdo->prepare(
            'SELECT voter_id, contact_masked, has_voted FROM voters WHERE voter_id = :voter_id LIMIT 1'
        );
        $stmt->execute([':voter_id' => $voterId]);
        $voter = $stmt->fetch();

        if (!$voter) {
            tc_json_response(['success' => false, 'error' => 'Voter ID not found in active electoral roll.'], 404);
        }

        if ((int) $voter['has_voted'] === 1) {
            tc_json_response([
                'success' => false,
                'error'   => 'A ballot has already been recorded for this Voter ID. Duplicate voting is prohibited.',
            ], 409);
        }

        // Invalidate any prior unconsumed challenges for this voter
        $invalidate = $pdo->prepare(
            'UPDATE otp_challenges SET consumed = 1 WHERE voter_id = :voter_id AND consumed = 0'
        );
        $invalidate->execute([':voter_id' => $voterId]);

        // Cryptographically secure 6-digit OTP
        $otpCode   = str_pad((string) random_int(0, 999999), 6, '0', STR_PAD_LEFT);
        $otpHash   = hash('sha256', $otpCode . '|' . TRUSTCAST_PEPPER);
        $expiresAt = (new DateTimeImmutable('now', new DateTimeZone('UTC')))
            ->modify('+120 seconds')
            ->format('Y-m-d H:i:s');

        $insert = $pdo->prepare(
            'INSERT INTO otp_challenges (voter_id, otp_hash, expires_at) VALUES (:voter_id, :otp_hash, :expires_at)'
        );
        $insert->execute([
            ':voter_id'   => $voterId,
            ':otp_hash'   => $otpHash,
            ':expires_at' => $expiresAt,
        ]);

        // Dispatch $otpCode strictly via out-of-band SMS/Authenticator gateway (never in HTTP JSON).
        if (getenv('TRUSTCAST_ENV') === 'development') {
            error_log(sprintf('[TrustCast 2FA] OTP for %s: %s', $voterId, $otpCode));
        }

        tc_json_response([
            'success'        => true,
            'message'        => 'Verification OTP dispatched to registered device.',
            'contact_masked' => $voter['contact_masked'],
            'otp_ttl_sec'    => 120,
        ], 200);
    }

    if ($action === 'verify_otp') {
        $otpInput = trim((string) ($input['otp'] ?? ''));
        if (!preg_match('/^\d{6}$/', $otpInput)) {
            tc_json_response(['success' => false, 'error' => 'OTP must be a 6-digit numeric code.'], 422);
        }

        $pdo->beginTransaction();

        $voterStmt = $pdo->prepare(
            'SELECT voter_id, district, has_voted FROM voters WHERE voter_id = :voter_id FOR UPDATE'
        );
        $voterStmt->execute([':voter_id' => $voterId]);
        $voter = $voterStmt->fetch();

        if (!$voter || (int) $voter['has_voted'] === 1) {
            $pdo->rollBack();
            tc_json_response(['success' => false, 'error' => 'Voter is ineligible or has already voted.'], 409);
        }

        $challengeStmt = $pdo->prepare(
            'SELECT challenge_id, otp_hash, expires_at, attempts
             FROM otp_challenges
             WHERE voter_id = :voter_id AND consumed = 0
             ORDER BY challenge_id DESC
             LIMIT 1
             FOR UPDATE'
        );
        $challengeStmt->execute([':voter_id' => $voterId]);
        $challenge = $challengeStmt->fetch();

        if (!$challenge) {
            $pdo->rollBack();
            tc_json_response(['success' => false, 'error' => 'No active OTP challenge found. Request a new code.'], 400);
        }

        if ((int) $challenge['attempts'] >= 5) {
            $pdo->prepare('UPDATE otp_challenges SET consumed = 1 WHERE challenge_id = :id')
                ->execute([':id' => $challenge['challenge_id']]);
            $pdo->commit();
            tc_json_response(['success' => false, 'error' => 'Maximum OTP attempts exceeded. Request a new code.'], 429);
        }

        $nowUtc    = new DateTimeImmutable('now', new DateTimeZone('UTC'));
        $expiresAt = new DateTimeImmutable($challenge['expires_at'], new DateTimeZone('UTC'));

        if ($nowUtc > $expiresAt) {
            $pdo->prepare('UPDATE otp_challenges SET consumed = 1 WHERE challenge_id = :id')
                ->execute([':id' => $challenge['challenge_id']]);
            $pdo->commit();
            tc_json_response(['success' => false, 'error' => 'OTP expired. Please request a fresh code.'], 401);
        }

        $expectedHash = $challenge['otp_hash'];
        $actualHash   = hash('sha256', $otpInput . '|' . TRUSTCAST_PEPPER);

        if (!hash_equals($expectedHash, $actualHash)) {
            $pdo->prepare('UPDATE otp_challenges SET attempts = attempts + 1 WHERE challenge_id = :id')
                ->execute([':id' => $challenge['challenge_id']]);
            $pdo->commit();
            tc_json_response(['success' => false, 'error' => 'Incorrect verification code.'], 401);
        }

        // Consume OTP and establish hardened 3-minute voting session
        $pdo->prepare('UPDATE otp_challenges SET consumed = 1 WHERE challenge_id = :id')
            ->execute([':id' => $challenge['challenge_id']]);
        $pdo->commit();

        tc_start_hardened_session();
        session_regenerate_id(true);

        $now = time();
        $_SESSION['voter_id']   = $voter['voter_id'];
        $_SESSION['district']   = $voter['district'];
        $_SESSION['auth_time']  = $now;
        $_SESSION['expires_at'] = $now + TRUSTCAST_SESSION_TTL;
        $_SESSION['csrf_token'] = bin2hex(random_bytes(32));

        tc_json_response([
            'success'         => true,
            'message'         => '2FA verified. Secure ballot session initialized.',
            'csrf_token'      => $_SESSION['csrf_token'],
            'session_ttl_sec' => TRUSTCAST_SESSION_TTL,
            'expires_at_unix' => $_SESSION['expires_at'],
        ], 200);
    }

    tc_json_response(['success' => false, 'error' => 'Unsupported action.'], 400);
} catch (Throwable $e) {
    if (isset($pdo) && $pdo->inTransaction()) {
        $pdo->rollBack();
    }
    tc_json_response(['success' => false, 'error' => 'Authentication service error.'], 500);
}
