<?php
error_reporting(0);
ini_set('display_errors', 0);
ini_set('log_errors', 0);

header('Content-Type: application/json');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');

// ── helpers ──────────────────────────────────────────────────────────────────

function uuidv4() {
    $data = random_bytes(16);
    $data[6] = chr(ord($data[6]) & 0x0f | 0x40);
    $data[8] = chr(ord($data[8]) & 0x3f | 0x80);
    return vsprintf('%s%s-%s-%s-%s-%s%s%s', str_split(bin2hex($data), 4));
}

function json_out($data, $status = 200) {
    http_response_code($status);
    echo json_encode($data);
    exit;
}

function body() {
    static $parsed = null;
    if ($parsed === null) {
        $raw = file_get_contents('php://input');
        $parsed = json_decode($raw, true) ?? [];
    }
    return $parsed;
}

function is_uuid4($s) {
    return (bool) preg_match(
        '/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i',
        (string)$s
    );
}

// ── config / DB ───────────────────────────────────────────────────────────────

$config_path = __DIR__ . '/config.php';
$config_exists = file_exists($config_path);
$action = $_GET['action'] ?? '';

if (!$config_exists) {
    if ($action !== 'setup') {
        json_out(['error' => 'setup_required'], 503);
    }
}

// ── action: setup ─────────────────────────────────────────────────────────────

if ($action === 'setup') {
    if ($config_exists) {
        json_out(['error' => 'already_configured'], 403);
    }

    $b = body();
    $host = trim((string)($b['host'] ?? ''));
    $port = (int)($b['port'] ?? 3306);
    $name = trim((string)($b['name'] ?? ''));
    $user = trim((string)($b['user'] ?? ''));
    $pass = (string)($b['pass'] ?? '');

    if ($host === '' || $name === '' || $user === '') {
        json_out(['ok' => false, 'error' => 'Missing required fields']);
    }

    try {
        $dsn = "mysql:host={$host};port={$port};dbname={$name};charset=utf8mb4";
        $pdo = new PDO($dsn, $user, $pass, [
            PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES   => false,
        ]);
    } catch (PDOException $e) {
        json_out(['ok' => false, 'error' => $e->getMessage()]);
    }

    // Write config.php
    $cfg = "<?php\n"
         . "define('DB_HOST', " . var_export($host, true) . ");\n"
         . "define('DB_PORT', " . var_export($port, true) . ");\n"
         . "define('DB_NAME', " . var_export($name, true) . ");\n"
         . "define('DB_USER', " . var_export($user, true) . ");\n"
         . "define('DB_PASS', " . var_export($pass, true) . ");\n";

    if (file_put_contents($config_path, $cfg) === false) {
        json_out(['ok' => false, 'error' => 'Could not write config.php — check directory permissions']);
    }

    run_migrations($pdo);
    json_out(['ok' => true]);
}

// ── load config and connect ───────────────────────────────────────────────────

require $config_path;

try {
    $dsn = "mysql:host=" . DB_HOST . ";port=" . DB_PORT . ";dbname=" . DB_NAME . ";charset=utf8mb4";
    $pdo = new PDO($dsn, DB_USER, DB_PASS, [
        PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES   => false,
    ]);
} catch (PDOException $e) {
    json_out(['error' => 'db_connection_failed'], 503);
}

run_migrations($pdo);

// ── migrations ────────────────────────────────────────────────────────────────

function run_migrations(PDO $pdo) {
    $migrations = [
        1 => 'migration_1',
        2 => 'migration_2',
        3 => 'migration_3',
    ];

    // Ensure schema_version table exists
    $pdo->exec("CREATE TABLE IF NOT EXISTS schema_version (
        version    INT      NOT NULL,
        applied_at DATETIME NOT NULL,
        PRIMARY KEY (version)
    )");

    $applied = [];
    $rows = $pdo->query("SELECT version FROM schema_version")->fetchAll();
    foreach ($rows as $r) {
        $applied[] = (int)$r['version'];
    }

    foreach ($migrations as $ver => $fn) {
        if (!in_array($ver, $applied, true)) {
            $fn($pdo);
            $stmt = $pdo->prepare("INSERT INTO schema_version (version, applied_at) VALUES (?, NOW())");
            $stmt->execute([$ver]);
        }
    }
}

function migration_1(PDO $pdo) {
    $pdo->exec("CREATE TABLE IF NOT EXISTS rooms (
        id            CHAR(36)   NOT NULL,
        delete_token  CHAR(64)   NOT NULL,
        retention     TINYINT(1) NOT NULL DEFAULT 2,
        last_used_at  DATETIME   NOT NULL,
        PRIMARY KEY (id)
    )");

    $pdo->exec("CREATE TABLE IF NOT EXISTS messages (
        id            CHAR(36)   NOT NULL,
        room_id       CHAR(36)   NOT NULL,
        sender_tag    CHAR(64)   NOT NULL,
        recipient_tag CHAR(64)   NOT NULL,
        ciphertext    TEXT       NOT NULL,
        created_at    DATETIME   NOT NULL,
        PRIMARY KEY (id),
        INDEX idx_room_recipient (room_id, recipient_tag),
        INDEX idx_created_at (created_at)
    )");

    $pdo->exec("CREATE TABLE IF NOT EXISTS presence (
        room_id    CHAR(36) NOT NULL,
        sender_tag CHAR(64) NOT NULL,
        updated_at DATETIME NOT NULL,
        PRIMARY KEY (room_id, sender_tag)
    )");
}

function migration_2(PDO $pdo) {
    $pdo->exec("ALTER TABLE rooms ADD COLUMN encryption_test TEXT NULL");
}

function migration_3(PDO $pdo) {
    $pdo->exec("ALTER TABLE messages MODIFY ciphertext MEDIUMTEXT NOT NULL");
}

// ── action: ping ──────────────────────────────────────────────────────────────

if ($action === 'ping') {
    json_out(['ok' => true]);
}

// ── action: check ─────────────────────────────────────────────────────────────

if ($action === 'check') {
    $b = body();
    $room_id = trim((string)($b['room_id'] ?? ''));
    if (!is_uuid4($room_id)) {
        json_out(['ok' => false, 'error' => 'Invalid room_id']);
    }
    $stmt = $pdo->prepare("SELECT encryption_test FROM rooms WHERE id = ?");
    $stmt->execute([$room_id]);
    $row = $stmt->fetch();
    if (!$row) {
        json_out(['ok' => true, 'exists' => false, 'encryption_test' => null]);
    }
    json_out(['ok' => true, 'exists' => true, 'encryption_test' => $row['encryption_test']]);
}

// ── action: create ────────────────────────────────────────────────────────────

if ($action === 'create') {
    $b = body();
    $room_id          = trim((string)($b['room_id'] ?? ''));
    $delete_token_hash = trim((string)($b['delete_token_hash'] ?? ''));
    $retention        = isset($b['retention']) ? (int)$b['retention'] : -1;

    if (!is_uuid4($room_id)) {
        json_out(['ok' => false, 'error' => 'Invalid room_id']);
    }
    if (!preg_match('/^[0-9a-f]{64}$/i', $delete_token_hash)) {
        json_out(['ok' => false, 'error' => 'Invalid delete_token_hash']);
    }
    if ($retention < 0 || $retention > 5) {
        json_out(['ok' => false, 'error' => 'Invalid retention value']);
    }

    // Check for duplicate
    $chk = $pdo->prepare("SELECT id FROM rooms WHERE id = ?");
    $chk->execute([$room_id]);
    if ($chk->fetch()) {
        json_out(['ok' => false, 'error' => 'Room already exists']);
    }

    $encryption_test = isset($b['encryption_test']) ? (string)$b['encryption_test'] : null;

    $stmt = $pdo->prepare(
        "INSERT INTO rooms (id, delete_token, retention, encryption_test, last_used_at) VALUES (?, ?, ?, ?, NOW())"
    );
    $stmt->execute([$room_id, strtolower($delete_token_hash), $retention, $encryption_test]);
    json_out(['ok' => true]);
}

// ── action: delete ────────────────────────────────────────────────────────────

if ($action === 'delete') {
    $b = body();
    $room_id      = trim((string)($b['room_id'] ?? ''));
    $delete_token = (string)($b['delete_token'] ?? '');

    if (!is_uuid4($room_id)) {
        json_out(['ok' => false, 'error' => 'Invalid room_id']);
    }

    $stmt = $pdo->prepare("SELECT delete_token FROM rooms WHERE id = ?");
    $stmt->execute([$room_id]);
    $room = $stmt->fetch();

    if (!$room) {
        json_out(['ok' => false, 'error' => 'Room not found']);
    }

    $provided_hash = hash('sha256', $delete_token);
    if (!hash_equals($room['delete_token'], $provided_hash)) {
        json_out(['ok' => false, 'error' => 'Invalid delete token']);
    }

    $pdo->prepare("DELETE FROM messages WHERE room_id = ?")->execute([$room_id]);
    $pdo->prepare("DELETE FROM presence WHERE room_id = ?")->execute([$room_id]);
    $pdo->prepare("DELETE FROM rooms WHERE id = ?")->execute([$room_id]);

    json_out(['ok' => true]);
}

// ── action: sync ──────────────────────────────────────────────────────────────

if ($action === 'sync') {
    $b = body();
    $sender_tag = trim((string)($b['sender_tag'] ?? ''));
    $rooms_req  = $b['rooms'] ?? [];

    if (!preg_match('/^[0-9a-f]{64}$/i', $sender_tag)) {
        json_out(['error' => 'Invalid sender_tag']);
    }
    if (!is_array($rooms_req)) {
        json_out(['error' => 'Invalid rooms']);
    }

    // Rate limit: count messages inserted by this sender_tag in the last 60 seconds
    $rate_stmt = $pdo->prepare(
        "SELECT COUNT(*) AS cnt FROM messages WHERE sender_tag = ? AND created_at > (NOW() - INTERVAL 60 SECOND)"
    );
    $rate_stmt->execute([$sender_tag]);
    $rate_row = $rate_stmt->fetch();
    $rate_count = (int)$rate_row['cnt'];

    $response_rooms = [];

    foreach ($rooms_req as $room_req) {
        $room_id = trim((string)($room_req['room_id'] ?? ''));
        $outbox  = $room_req['outbox'] ?? [];

        if (!is_uuid4($room_id)) {
            $response_rooms[] = ['room_id' => $room_id, 'error' => 'invalid_room_id'];
            continue;
        }

        // Validate room exists
        $room_stmt = $pdo->prepare("SELECT id, retention FROM rooms WHERE id = ?");
        $room_stmt->execute([$room_id]);
        $room = $room_stmt->fetch();

        if (!$room) {
            $response_rooms[] = ['room_id' => $room_id, 'error' => 'not_found'];
            continue;
        }

        $retention = (int)$room['retention'];

        // Update last_used_at
        $pdo->prepare("UPDATE rooms SET last_used_at = NOW() WHERE id = ?")->execute([$room_id]);

        $outbox_errors = [];
        $inserted_items = [];

        if (is_array($outbox)) {
            foreach ($outbox as $item) {
                $msg_id       = trim((string)($item['id'] ?? ''));
                $recipient_tag = trim((string)($item['recipient_tag'] ?? ''));
                $ciphertext   = (string)($item['ciphertext'] ?? '');

                if (!is_uuid4($msg_id)) {
                    $outbox_errors[] = ['id' => $msg_id, 'error' => 'invalid_id'];
                    continue;
                }
                if (!preg_match('/^[0-9a-f]{64}$/i', $recipient_tag)) {
                    $outbox_errors[] = ['id' => $msg_id, 'error' => 'invalid_recipient_tag'];
                    continue;
                }
                if (strlen($ciphertext) > 2097152) {
                    $outbox_errors[] = ['id' => $msg_id, 'error' => 'message_too_large'];
                    continue;
                }

                // Rate limit check
                if ($rate_count >= 60) {
                    $outbox_errors[] = ['id' => $msg_id, 'error' => 'rate_limited'];
                    continue;
                }

                // Check for duplicate message id
                $dup_stmt = $pdo->prepare("SELECT id FROM messages WHERE id = ?");
                $dup_stmt->execute([$msg_id]);
                if ($dup_stmt->fetch()) {
                    // Already inserted (retry scenario) — still generate ACK concept but don't duplicate
                    $inserted_items[] = ['id' => $msg_id, 'sender_tag' => $sender_tag];
                    continue;
                }

                $ins = $pdo->prepare(
                    "INSERT INTO messages (id, room_id, sender_tag, recipient_tag, ciphertext, created_at)
                     VALUES (?, ?, ?, ?, ?, NOW())"
                );
                $ins->execute([$msg_id, $room_id, $sender_tag, $recipient_tag, $ciphertext]);
                $rate_count++;
                $inserted_items[] = ['id' => $msg_id, 'sender_tag' => $sender_tag];

                // Server-generated delivery ACK
                $ack_id = uuidv4();
                $ack_payload = json_encode(['type' => 'ack_delivered', 'message_id' => $msg_id]);
                $ack_ciphertext = base64_encode($ack_payload);
                $server_ack_tag = '0000000000000000000000000000000000000000000000000000000000000000';

                $ack_ins = $pdo->prepare(
                    "INSERT INTO messages (id, room_id, sender_tag, recipient_tag, ciphertext, created_at)
                     VALUES (?, ?, ?, ?, ?, NOW())"
                );
                $ack_ins->execute([$ack_id, $room_id, $server_ack_tag, $sender_tag, $ack_ciphertext]);
            }
        }

        // Presence: remove on leave, upsert otherwise (skip for single-view rooms)
        $is_leaving = !empty($room_req['leave']);
        if ($is_leaving) {
            $pdo->prepare("DELETE FROM presence WHERE room_id = ? AND sender_tag = ?")->execute([$room_id, $sender_tag]);
        } elseif ($retention !== 4) {
            $pres_stmt = $pdo->prepare(
                "INSERT INTO presence (room_id, sender_tag, updated_at) VALUES (?, ?, NOW())
                 ON DUPLICATE KEY UPDATE updated_at = NOW()"
            );
            $pres_stmt->execute([$room_id, $sender_tag]);
        }

        // Fetch inbox (messages addressed to this sender_tag), then delete them
        $inbox_stmt = $pdo->prepare(
            "SELECT id, sender_tag, ciphertext FROM messages
             WHERE room_id = ? AND recipient_tag = ?
             ORDER BY created_at ASC"
        );
        $inbox_stmt->execute([$room_id, $sender_tag]);
        $inbox_rows = $inbox_stmt->fetchAll();

        if (!empty($inbox_rows)) {
            $del_stmt = $pdo->prepare(
                "DELETE FROM messages WHERE room_id = ? AND recipient_tag = ?"
            );
            $del_stmt->execute([$room_id, $sender_tag]);

            // Server-generated ack_received: notify each original sender that
            // their message was fetched from the server by this recipient.
            $recv_ack_tag = '0000000000000000000000000000000000000000000000000000000000000000';
            $recv_ins = $pdo->prepare(
                "INSERT INTO messages (id, room_id, sender_tag, recipient_tag, ciphertext, created_at)
                 VALUES (?, ?, ?, ?, ?, NOW())"
            );
            foreach ($inbox_rows as $ack_row) {
                // Skip server-generated ACKs and self-addressed messages
                if ($ack_row['sender_tag'] === $recv_ack_tag) continue;
                if ($ack_row['sender_tag'] === $sender_tag) continue;
                $recv_id = uuidv4();
                $recv_payload = json_encode([
                    'type'          => 'ack_received',
                    'message_id'    => $ack_row['id'],
                    'recipient_tag' => $sender_tag,
                ]);
                $recv_ins->execute([$recv_id, $room_id, $recv_ack_tag, $ack_row['sender_tag'], base64_encode($recv_payload)]);
            }
        }

        $inbox = [];
        foreach ($inbox_rows as $row) {
            $inbox[] = [
                'id'         => $row['id'],
                'sender_tag' => $row['sender_tag'],
                'ciphertext' => $row['ciphertext'],
            ];
        }

        // Fetch presence (excluding this sender_tag)
        $presence = [];
        if ($retention !== 4) {
            $retention_interval = retention_interval($retention);
            $pres_fetch = $pdo->prepare(
                "SELECT sender_tag FROM presence
                 WHERE room_id = ? AND sender_tag != ? AND updated_at > (NOW() - INTERVAL {$retention_interval})"
            );
            $pres_fetch->execute([$room_id, $sender_tag]);
            foreach ($pres_fetch->fetchAll() as $pr) {
                $presence[] = $pr['sender_tag'];
            }
        }

        // Lazy expiry
        lazy_expiry($pdo, $room_id, $retention);

        $room_response = [
            'room_id'  => $room_id,
            'inbox'    => $inbox,
            'presence' => $presence,
        ];
        if (!empty($outbox_errors)) {
            $room_response['outbox_errors'] = $outbox_errors;
        }

        $response_rooms[] = $room_response;
    }

    // Global abandoned room expiry
    global_expiry($pdo);

    json_out(['rooms' => $response_rooms]);
}

// ── expiry helpers ────────────────────────────────────────────────────────────

function retention_interval(int $retention): string {
    switch ($retention) {
        case 0: return '1 HOUR';
        case 1: return '6 HOUR';
        case 2: return '24 HOUR';
        case 3: return '12 HOUR';
        case 4: return '24 HOUR';
        case 5: return '100 YEAR'; // permanent
        default: return '24 HOUR';
    }
}

function lazy_expiry(PDO $pdo, string $room_id, int $retention): void {
    if ($retention === 5) return;

    $interval = retention_interval($retention);

    $pdo->prepare(
        "DELETE FROM messages WHERE room_id = ? AND created_at < (NOW() - INTERVAL {$interval})"
    )->execute([$room_id]);

    $pdo->prepare(
        "DELETE FROM presence WHERE room_id = ? AND updated_at < (NOW() - INTERVAL {$interval})"
    )->execute([$room_id]);
}

function global_expiry(PDO $pdo): void {
    // Find abandoned rooms
    $old_rooms = $pdo->query(
        "SELECT id FROM rooms WHERE last_used_at < (NOW() - INTERVAL 7 DAY)"
    )->fetchAll();

    foreach ($old_rooms as $r) {
        $rid = $r['id'];
        $pdo->prepare("DELETE FROM messages WHERE room_id = ?")->execute([$rid]);
        $pdo->prepare("DELETE FROM presence WHERE room_id = ?")->execute([$rid]);
        $pdo->prepare("DELETE FROM rooms WHERE id = ?")->execute([$rid]);
    }
}

// ── unknown action ────────────────────────────────────────────────────────────

json_out(['error' => 'unknown_action'], 400);
