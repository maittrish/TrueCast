<?php
/**
 * TrustCast — Live Polling & Receipt Verification Endpoint (get_results.php)
 *
 * Returns strictly JSON:
 * - Candidate standings (aggregated strictly from anonymized `votes` table)
 * - Turnout & demographic breakdown (aggregated strictly from `voters` table)
 * - Optional `?receipt=<64-hex>` check verifying ledger inclusion without exposing candidate choice
 */

declare(strict_types=1);

require_once __DIR__ . '/db.php';

tc_send_security_headers();

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    tc_json_response(['success' => false, 'error' => 'Method not allowed.'], 405);
}

try {
    $pdo = tc_get_pdo();

    // Optional Cryptographic Receipt Verification
    if (isset($_GET['receipt'])) {
        $receipt = strtolower(trim((string) $_GET['receipt']));
        if (!preg_match('/^[a-f0-9]{64}$/', $receipt)) {
            tc_json_response(['success' => false, 'error' => 'Invalid SHA-256 receipt format.'], 422);
        }

        $check = $pdo->prepare(
            'SELECT cast_bucket FROM votes WHERE receipt_hash = :receipt LIMIT 1'
        );
        $check->execute([':receipt' => $receipt]);
        $row = $check->fetch();

        tc_json_response([
            'success'         => true,
            'verified'        => (bool) $row,
            'receipt_hash'    => $receipt,
            'cast_bucket_utc' => $row['cast_bucket'] ?? null,
            'secrecy_note'    => 'Ledger inclusion confirmed. Candidate choice remains mathematically unlinked.',
        ], 200);
    }

    // 1. Candidate Tally (Aggregated from decoupled `votes` table)
    $standingsStmt = $pdo->query(
        'SELECT c.candidate_id, c.full_name, c.coalition, c.portfolio_focus, c.platform_summary,
                COUNT(v.ballot_uuid) AS vote_count
         FROM candidates c
         LEFT JOIN votes v ON c.candidate_id = v.candidate_id
         WHERE c.is_active = 1
         GROUP BY c.candidate_id, c.full_name, c.coalition, c.portfolio_focus, c.platform_summary, c.display_order
         ORDER BY vote_count DESC, c.display_order ASC'
    );
    $candidates = $standingsStmt->fetchAll();

    // 2. Overall Turnout (From `voters` table)
    $turnoutRow = $pdo->query(
        'SELECT COUNT(*) AS total_registered, SUM(has_voted) AS total_cast FROM voters'
    )->fetch();

    $totalRegistered = (int) ($turnoutRow['total_registered'] ?? 0);
    $totalCast       = (int) ($turnoutRow['total_cast'] ?? 0);

    // 3. Demographic Turnout by Age Group
    $ageStmt = $pdo->query(
        'SELECT age_group, COUNT(*) AS registered, SUM(has_voted) AS voted
         FROM voters
         GROUP BY age_group
         ORDER BY FIELD(age_group, "18-24", "25-34", "35-49", "50-64", "65+")'
    );
    $demographics = $ageStmt->fetchAll();

    // 4. District Turnout
    $districtStmt = $pdo->query(
        'SELECT district, COUNT(*) AS registered, SUM(has_voted) AS voted
         FROM voters
         GROUP BY district
         ORDER BY district ASC'
    );
    $districts = $districtStmt->fetchAll();

    tc_json_response([
        'success'          => true,
        'generated_at_utc' => gmdate('Y-m-d H:i:s'),
        'turnout'          => [
            'total_registered' => $totalRegistered,
            'total_cast'       => $totalCast,
            'turnout_pct'      => $totalRegistered > 0 ? round(($totalCast / $totalRegistered) * 100, 2) : 0.0,
        ],
        'candidates'       => array_map(static function (array $row) use ($totalCast): array {
            $votes = (int) $row['vote_count'];
            return [
                'candidate_id'     => (int) $row['candidate_id'],
                'full_name'        => $row['full_name'],
                'coalition'        => $row['coalition'],
                'portfolio_focus'  => $row['portfolio_focus'],
                'platform_summary' => $row['platform_summary'],
                'vote_count'       => $votes,
                'share_pct'        => $totalCast > 0 ? round(($votes / $totalCast) * 100, 2) : 0.0,
            ];
        }, $candidates),
        'demographics'     => array_map(static function (array $row): array {
            $reg = (int) $row['registered'];
            $vot = (int) $row['voted'];
            return [
                'age_group'   => $row['age_group'],
                'registered'  => $reg,
                'voted'       => $vot,
                'turnout_pct' => $reg > 0 ? round(($vot / $reg) * 100, 1) : 0.0,
            ];
        }, $demographics),
        'districts'        => array_map(static function (array $row): array {
            $reg = (int) $row['registered'];
            $vot = (int) $row['voted'];
            return [
                'district'    => $row['district'],
                'registered'  => $reg,
                'voted'       => $vot,
                'turnout_pct' => $reg > 0 ? round(($vot / $reg) * 100, 1) : 0.0,
            ];
        }, $districts),
    ], 200);
} catch (Throwable $e) {
    tc_json_response(['success' => false, 'error' => 'Unable to compute live standings.'], 500);
}
