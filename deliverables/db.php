<?php
/**
 * TrustCast — Hardened PDO Database & Security Bootstrap
 * Enforces strict JSON responses, emulated-prepare disabling, and secure session cookies.
 */

declare(strict_types=1);

define('TRUSTCAST_DB_HOST', getenv('TRUSTCAST_DB_HOST') ?: '127.0.0.1');
define('TRUSTCAST_DB_NAME', getenv('TRUSTCAST_DB_NAME') ?: 'trustcast_voting');
define('TRUSTCAST_DB_USER', getenv('TRUSTCAST_DB_USER') ?: 'trustcast_app');
define('TRUSTCAST_DB_PASS', getenv('TRUSTCAST_DB_PASS') ?: 'CHANGE_ME_STRONG_SECRET');
define('TRUSTCAST_PEPPER',  getenv('TRUSTCAST_PEPPER')  ?: 'REPLACE_WITH_64_BYTE_HSM_PEPPER');
define('TRUSTCAST_SESSION_TTL', 180); // Strict 3-minute session lifetime

function tc_send_security_headers(): void
{
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
    header('Pragma: no-cache');
    header('X-Content-Type-Options: nosniff');
    header('X-Frame-Options: DENY');
    header('Referrer-Policy: no-referrer');
}

function tc_json_response(array $payload, int $statusCode = 200): never
{
    http_response_code($statusCode);
    echo json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
    exit;
}

function tc_start_hardened_session(): void
{
    if (session_status() === PHP_SESSION_ACTIVE) {
        return;
    }

    $isHttps = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
        || (($_SERVER['SERVER_PORT'] ?? null) === '443');

    session_name('TRUSTCAST_SID');
    session_set_cookie_params([
        'lifetime' => TRUSTCAST_SESSION_TTL,
        'path'     => '/',
        'domain'   => '',
        'secure'   => $isHttps,
        'httponly' => true,
        'samesite' => 'Strict',
    ]);

    ini_set('session.use_strict_mode', '1');
    ini_set('session.use_only_cookies', '1');
    ini_set('session.gc_maxlifetime', (string) TRUSTCAST_SESSION_TTL);

    session_start();
}

function tc_destroy_session(): void
{
    if (session_status() !== PHP_SESSION_ACTIVE) {
        tc_start_hardened_session();
    }

    $_SESSION = [];

    if (ini_get('session.use_cookies')) {
        $params = session_get_cookie_params();
        setcookie(
            session_name(),
            '',
            [
                'expires'  => time() - 42000,
                'path'     => $params['path'],
                'domain'   => $params['domain'],
                'secure'   => $params['secure'],
                'httponly' => $params['httponly'],
                'samesite' => $params['samesite'] ?? 'Strict',
            ]
        );
    }

    session_destroy();
}

function tc_get_pdo(): PDO
{
    static $pdo = null;
    if ($pdo instanceof PDO) {
        return $pdo;
    }

    $dsn = sprintf(
        'mysql:host=%s;dbname=%s;charset=utf8mb4',
        TRUSTCAST_DB_HOST,
        TRUSTCAST_DB_NAME
    );

    $pdo = new PDO($dsn, TRUSTCAST_DB_USER, TRUSTCAST_DB_PASS, [
        PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES   => false,
    ]);

    return $pdo;
}
