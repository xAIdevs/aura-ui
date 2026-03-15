# Authentication Service

> **Service:** `authentication-service`  
> **Version:** 1.0.0  
> **Tech Stack:** Java 21 · Spring Boot 4.0.1 · PostgreSQL 16 · Redis 7.x · Kafka 3.x  
> **Owner:** Platform — Identity & Security Team  
> **SLA:** 99.99% uptime · p99 < 200 ms

---

## Table of Contents

1. [Service Overview & Architecture](#1-service-overview--architecture)
2. [Complete Database Design](#2-complete-database-design)
3. [API Endpoints](#3-api-endpoints)
4. [User Stories & Acceptance Criteria](#4-user-stories--acceptance-criteria)
5. [Kafka Events](#5-kafka-events)
6. [Redis Caching Strategy](#6-redis-caching-strategy)
7. [Security & Compliance](#7-security--compliance)
8. [Monitoring & Observability](#8-monitoring--observability)
9. [Testing Strategy](#9-testing-strategy)

---

## 1. Service Overview & Architecture

### 1.1 Purpose

The Authentication Service is the **trust boundary** of the entire platform. It is the sole issuer of JWT access tokens and refresh tokens, and the only service that stores or validates credentials. Every other service trusts a valid JWT from this service — they never touch raw passwords, OTP codes, or OAuth tokens.

**Core responsibilities:**
- Email + password registration and login
- Phone number + OTP registration and login
- Magic-link (passwordless) login
- OAuth 2.0 / OpenID Connect (Google, Apple, Facebook)
- Multi-factor authentication (TOTP via Google Authenticator / Authy)
- JWT access token issuance (RS256, 15-minute TTL)
- Refresh token rotation with family invalidation on reuse detection
- Device fingerprinting and trusted device management
- Session management (list, revoke single, revoke all)
- Brute-force protection (exponential backoff + account lockout)
- Risk scoring per login attempt (IP reputation, device, velocity)
- GDPR right-to-erasure request intake
- Password reset and change flows
- Audit logging for every auth event

### 1.2 Technology Stack

| Component | Technology | Version |
|-----------|-----------|---------|
| Runtime | Java (OpenJDK) | 21 LTS |
| Framework | Spring Boot | 4.0.1 |
| Web layer | Spring WebFlux (reactive) | 6.2.x |
| Database | PostgreSQL | 16 |
| JDBC layer | Spring Data R2DBC | 3.x |
| Cache | Redis | 7.x |
| Reactive Redis | Lettuce (via Spring Data Reactive Redis) | 6.x |
| Messaging | Apache Kafka | 3.x |
| JWT | nimbus-jose-jwt | 9.x |
| OTP | Google TOTP (java-otp) | 0.4.x |
| Password hashing | Argon2id (Bouncy Castle) | 1.78 |
| Encryption | AES-256-GCM (Bouncy Castle) | 1.78 |
| HTTP client | Spring WebClient | 6.2.x |
| Observability | Micrometer + OpenTelemetry | 1.13.x |
| Build | Gradle | 8.x |
| Container | Docker | 27.x |

### 1.3 Architecture Diagram

```
                         ┌─────────────────────────────────────────────────┐
                         │            authentication-service                │
                         │                                                 │
  REST/TLS               │  ┌──────────────────────────────────────────┐  │
 ─────────────────────►  │  │           Controller Layer               │  │
 API Gateway / clients   │  │  AuthController  ·  OAuthController      │  │
                         │  │  SessionController · TOTPController       │  │
                         │  │  PasswordController · AccountController   │  │
                         │  └────────────────────┬─────────────────────┘  │
                         │                       │ validates DTOs          │
                         │  ┌────────────────────▼─────────────────────┐  │
                         │  │            Service Layer                 │  │
                         │  │  RegistrationService · LoginService       │  │
                         │  │  TokenService      · OtpService           │  │
                         │  │  OAuthService      · SessionService       │  │
                         │  │  RiskService       · MfaService           │  │
                         │  │  PasswordService   · AuditService         │  │
                         │  └──┬─────────┬───────────┬──────────────────┘  │
                         │    │         │           │                      │
                         │  ┌─▼───┐  ┌──▼────┐  ┌──▼────┐               │
                         │  │Repo │  │Redis  │  │Kafka  │               │
                         │  │Layer│  │Client │  │Producer               │
                         │  └──┬──┘  └──┬────┘  └──┬────┘               │
                         └─────┼─────────┼───────────┼────────────────────┘
                               │         │           │
                    ┌──────────▼──┐ ┌────▼──────┐ ┌─▼──────────────────┐
                    │ PostgreSQL  │ │  Redis 7  │ │   Kafka 3.x        │
                    │     16      │ │           │ │   user.* topics    │
                    │  auth_db    │ │ sessions  │ │                    │
                    │  (R2DBC)    │ │ otp codes │ │                    │
                    └─────────────┘ │ rate limit│ └────────────────────┘
                                    └───────────┘
                         │
        External providers called by OAuthService / OtpService:
        ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────┐
        │  Google OIDC │  │  Apple OIDC  │  │ Facebook Graph API       │
        └──────────────┘  └──────────────┘  └──────────────────────────┘
        ┌──────────────┐  ┌──────────────┐
        │ Twilio (SMS) │  │SendGrid(Mail)│
        └──────────────┘  └──────────────┘
```

### 1.4 Inter-Service Communication

| Direction | Protocol | Target / Source | Purpose |
|-----------|----------|-----------------|---------|
| **Publishes** | Kafka | `user.registered` | Trigger profile creation in User Service |
| **Publishes** | Kafka | `user.login` | Analytics, risk evaluation |
| **Publishes** | Kafka | `user.logout` | Session cleanup |
| **Publishes** | Kafka | `user.account.suspended` | Notify moderation pipeline |
| **Publishes** | Kafka | `user.account.banned` | Push notification, cleanup |
| **Publishes** | Kafka | `user.password.changed` | Revoke all sessions, notify user |
| **Publishes** | Kafka | `user.mfa.enabled` | Analytics |
| **Publishes** | Kafka | `user.gdpr.deletion.requested` | Trigger data erasure across all services |
| **Reads** | Redis | Rate limit counters | Enforce per-IP and per-user throttling |
| **Reads** | Redis | Session blacklist | Validate revoked JTIs on token refresh |
| **Calls (HTTP)** | REST | Trust & Safety Service | Verify account ban status on login |
| **Calls (HTTP)** | REST | Notification Service | Send OTP, magic link, password reset emails |

### 1.5 Deployment Configuration

```yaml
# Kubernetes HPA + Deployment excerpt
replicas:
  min: 3
  max: 5
resources:
  requests:
    cpu: "500m"
    memory: "1Gi"
  limits:
    cpu: "1000m"      # 1 vCPU
    memory: "2Gi"
hpa:
  targetCPUUtilizationPercentage: 70
  targetMemoryUtilizationPercentage: 80
livenessProbe:  GET /actuator/health/liveness  (initialDelay: 30s, period: 10s)
readinessProbe: GET /actuator/health/readiness (initialDelay: 10s, period: 5s)
```

---

## 2. Complete Database Design

### 2.1 Schema: `auth_db`

#### Table: `users`

```sql
CREATE TABLE users (
    id                        BIGSERIAL         PRIMARY KEY,
    public_id                 UUID              NOT NULL DEFAULT gen_random_uuid(),
    email                     VARCHAR(320),                          -- AES-256-GCM encrypted
    email_hash                VARCHAR(64),                           -- SHA-256 of normalised email (lowercase + trim)
    email_verified            BOOLEAN           NOT NULL DEFAULT FALSE,
    email_verified_at         TIMESTAMPTZ,
    phone_number              VARCHAR(20),                           -- AES-256-GCM encrypted (E.164 format)
    phone_hash                VARCHAR(64),                           -- SHA-256 for lookup
    phone_verified            BOOLEAN           NOT NULL DEFAULT FALSE,
    phone_verified_at         TIMESTAMPTZ,
    password_hash             VARCHAR(255),                          -- Argon2id (time=3, mem=65536KB, p=4)
    account_status            VARCHAR(25)       NOT NULL DEFAULT 'PENDING_VERIFICATION'
                              CHECK (account_status IN (
                                  'PENDING_VERIFICATION',
                                  'ACTIVE',
                                  'INACTIVE',
                                  'SUSPENDED',
                                  'BANNED',
                                  'SOFT_DELETED',
                                  'HARD_DELETED'
                              )),
    role                      VARCHAR(20)       NOT NULL DEFAULT 'USER'
                              CHECK (role IN ('USER','PREMIUM','MODERATOR','ADMIN','SUPER_ADMIN')),
    subscription_tier         VARCHAR(20)       NOT NULL DEFAULT 'FREE'
                              CHECK (subscription_tier IN ('FREE','PREMIUM','PREMIUM_PLUS')),
    risk_score                SMALLINT          NOT NULL DEFAULT 0
                              CHECK (risk_score BETWEEN 0 AND 100),
    trust_score               SMALLINT          NOT NULL DEFAULT 50
                              CHECK (trust_score BETWEEN 0 AND 100),
    failed_login_attempts     SMALLINT          NOT NULL DEFAULT 0,
    locked_until              TIMESTAMPTZ,
    last_login_at             TIMESTAMPTZ,
    last_login_ip             INET,
    totp_secret               VARCHAR(64),                           -- AES-256-GCM encrypted Base32 seed
    totp_enabled              BOOLEAN           NOT NULL DEFAULT FALSE,
    totp_enabled_at           TIMESTAMPTZ,
    backup_codes              TEXT[],                                -- Array of AES-256-GCM encrypted codes
    backup_codes_remaining    SMALLINT          NOT NULL DEFAULT 0,
    tos_accepted              BOOLEAN           NOT NULL DEFAULT FALSE,
    tos_accepted_at           TIMESTAMPTZ,
    tos_version               VARCHAR(20),
    privacy_policy_accepted   BOOLEAN           NOT NULL DEFAULT FALSE,
    privacy_policy_version    VARCHAR(20),
    gdpr_deletion_requested_at TIMESTAMPTZ,
    gdpr_deletion_scheduled_at TIMESTAMPTZ,
    soft_deleted_at           TIMESTAMPTZ,
    hard_deleted_at           TIMESTAMPTZ,
    registration_method       VARCHAR(20)       NOT NULL DEFAULT 'EMAIL'
                              CHECK (registration_method IN ('EMAIL','PHONE','GOOGLE','APPLE','FACEBOOK')),
    registration_ip           INET,
    registration_country      CHAR(2),
    version                   INTEGER           NOT NULL DEFAULT 0,  -- Optimistic locking
    created_at                TIMESTAMPTZ       NOT NULL DEFAULT NOW(),
    updated_at                TIMESTAMPTZ       NOT NULL DEFAULT NOW(),

    CONSTRAINT users_email_hash_unique UNIQUE (email_hash),
    CONSTRAINT users_phone_hash_unique UNIQUE (phone_hash),
    CONSTRAINT users_public_id_unique  UNIQUE (public_id)
);

-- Trigger: auto-update updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Indexes
CREATE INDEX idx_users_public_id         ON users (public_id);
CREATE INDEX idx_users_email_hash        ON users (email_hash) WHERE email_hash IS NOT NULL;
CREATE INDEX idx_users_phone_hash        ON users (phone_hash) WHERE phone_hash IS NOT NULL;
CREATE INDEX idx_users_account_status    ON users (account_status);
CREATE INDEX idx_users_created_at        ON users (created_at DESC);
CREATE INDEX idx_users_last_login_at     ON users (last_login_at DESC) WHERE last_login_at IS NOT NULL;
CREATE INDEX idx_users_gdpr_deletion     ON users (gdpr_deletion_scheduled_at)
    WHERE gdpr_deletion_requested_at IS NOT NULL AND hard_deleted_at IS NULL;
```

---

#### Table: `sessions`

```sql
CREATE TABLE sessions (
    id                BIGSERIAL     PRIMARY KEY,
    public_id         UUID          NOT NULL DEFAULT gen_random_uuid(),
    user_id           BIGINT        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    jti               UUID          NOT NULL DEFAULT gen_random_uuid(),  -- JWT ID (unique per access token)
    device_id         UUID,
    device_name       VARCHAR(200),
    device_os         VARCHAR(50),
    device_os_version VARCHAR(30),
    app_version       VARCHAR(20),
    ip_address        INET          NOT NULL,
    country           CHAR(2),
    city              VARCHAR(100),
    user_agent        TEXT,
    is_active         BOOLEAN       NOT NULL DEFAULT TRUE,
    revoked_at        TIMESTAMPTZ,
    revoke_reason     VARCHAR(50)
                      CHECK (revoke_reason IN (
                          'USER_LOGOUT','PASSWORD_CHANGE','ADMIN_REVOKE',
                          'SECURITY_EVENT','SESSION_EXPIRED','MFA_CHANGE'
                      )),
    last_active_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    expires_at        TIMESTAMPTZ   NOT NULL,                           -- Refresh token expiry
    created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

    CONSTRAINT sessions_jti_unique    UNIQUE (jti),
    CONSTRAINT sessions_public_id_unique UNIQUE (public_id)
);

CREATE INDEX idx_sessions_user_id      ON sessions (user_id, is_active) WHERE is_active = TRUE;
CREATE INDEX idx_sessions_jti          ON sessions (jti);
CREATE INDEX idx_sessions_device_id    ON sessions (device_id) WHERE device_id IS NOT NULL;
CREATE INDEX idx_sessions_expires_at   ON sessions (expires_at) WHERE is_active = TRUE;
CREATE INDEX idx_sessions_created_at   ON sessions (created_at DESC);

-- Partition by created_at for large tables (optional, activate at ~1B rows)
-- PARTITION BY RANGE (created_at)
```

---

#### Table: `refresh_tokens`

```sql
CREATE TABLE refresh_tokens (
    id              BIGSERIAL     PRIMARY KEY,
    session_id      BIGINT        NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    user_id         BIGINT        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash      VARCHAR(64)   NOT NULL,                    -- SHA-256 of the actual token (never stored plain)
    family_id       UUID          NOT NULL DEFAULT gen_random_uuid(),  -- Rotation family — reuse = revoke whole family
    is_used         BOOLEAN       NOT NULL DEFAULT FALSE,
    is_revoked      BOOLEAN       NOT NULL DEFAULT FALSE,
    revoked_at      TIMESTAMPTZ,
    used_at         TIMESTAMPTZ,
    issued_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    expires_at      TIMESTAMPTZ   NOT NULL,

    CONSTRAINT refresh_tokens_token_hash_unique UNIQUE (token_hash)
);

CREATE INDEX idx_rt_token_hash   ON refresh_tokens (token_hash);
CREATE INDEX idx_rt_family_id    ON refresh_tokens (family_id);
CREATE INDEX idx_rt_user_id      ON refresh_tokens (user_id, is_revoked) WHERE is_revoked = FALSE;
CREATE INDEX idx_rt_expires_at   ON refresh_tokens (expires_at) WHERE is_revoked = FALSE;
```

---

#### Table: `devices`

```sql
CREATE TABLE devices (
    id                BIGSERIAL     PRIMARY KEY,
    public_id         UUID          NOT NULL DEFAULT gen_random_uuid(),
    user_id           BIGINT        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    device_fingerprint VARCHAR(128) NOT NULL,                  -- Hashed canvas/hardware fingerprint
    device_name       VARCHAR(200),
    device_os         VARCHAR(50),
    device_os_version VARCHAR(30),
    push_token        TEXT,                                     -- FCM or APNs token (encrypted)
    platform          VARCHAR(10)   CHECK (platform IN ('IOS','ANDROID','WEB')),
    is_trusted        BOOLEAN       NOT NULL DEFAULT FALSE,
    trusted_at        TIMESTAMPTZ,
    last_seen_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    last_seen_ip      INET,
    created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

    CONSTRAINT devices_public_id_unique  UNIQUE (public_id),
    CONSTRAINT devices_user_fingerprint  UNIQUE (user_id, device_fingerprint)
);

CREATE INDEX idx_devices_user_id     ON devices (user_id);
CREATE INDEX idx_devices_fingerprint ON devices (device_fingerprint);
CREATE INDEX idx_devices_push_token  ON devices (push_token) WHERE push_token IS NOT NULL;
```

---

#### Table: `otp_challenges`

```sql
CREATE TABLE otp_challenges (
    id              BIGSERIAL     PRIMARY KEY,
    challenge_id    UUID          NOT NULL DEFAULT gen_random_uuid(),
    user_id         BIGINT        REFERENCES users(id) ON DELETE CASCADE,
    target          VARCHAR(320)  NOT NULL,                    -- email or phone (encrypted)
    target_hash     VARCHAR(64)   NOT NULL,                    -- SHA-256 for lookup
    purpose         VARCHAR(30)   NOT NULL
                    CHECK (purpose IN (
                        'EMAIL_VERIFICATION','PHONE_VERIFICATION',
                        'LOGIN','MAGIC_LINK','PHONE_REGISTRATION'
                    )),
    code_hash       VARCHAR(64)   NOT NULL,                    -- SHA-256 of the 6-digit code
    attempts        SMALLINT      NOT NULL DEFAULT 0,
    max_attempts    SMALLINT      NOT NULL DEFAULT 3,
    is_used         BOOLEAN       NOT NULL DEFAULT FALSE,
    used_at         TIMESTAMPTZ,
    expires_at      TIMESTAMPTZ   NOT NULL,
    created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    ip_address      INET,

    CONSTRAINT otp_challenges_challenge_id_unique UNIQUE (challenge_id)
);

CREATE INDEX idx_otp_challenge_id    ON otp_challenges (challenge_id);
CREATE INDEX idx_otp_target_purpose  ON otp_challenges (target_hash, purpose, is_used)
    WHERE is_used = FALSE;
CREATE INDEX idx_otp_expires_at      ON otp_challenges (expires_at) WHERE is_used = FALSE;
```

---

#### Table: `password_reset_tokens`

```sql
CREATE TABLE password_reset_tokens (
    id              BIGSERIAL     PRIMARY KEY,
    token_id        UUID          NOT NULL DEFAULT gen_random_uuid(),
    user_id         BIGINT        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash      VARCHAR(64)   NOT NULL,                    -- SHA-256 of the URL-safe random token
    is_used         BOOLEAN       NOT NULL DEFAULT FALSE,
    used_at         TIMESTAMPTZ,
    expires_at      TIMESTAMPTZ   NOT NULL,                    -- 1 hour TTL
    requested_from_ip INET,
    created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

    CONSTRAINT prt_token_id_unique   UNIQUE (token_id),
    CONSTRAINT prt_token_hash_unique UNIQUE (token_hash)
);

CREATE INDEX idx_prt_user_id    ON password_reset_tokens (user_id, is_used) WHERE is_used = FALSE;
CREATE INDEX idx_prt_token_hash ON password_reset_tokens (token_hash);
CREATE INDEX idx_prt_expires_at ON password_reset_tokens (expires_at) WHERE is_used = FALSE;
```

---

#### Table: `magic_link_tokens`

```sql
CREATE TABLE magic_link_tokens (
    id              BIGSERIAL     PRIMARY KEY,
    token_id        UUID          NOT NULL DEFAULT gen_random_uuid(),
    user_id         BIGINT        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash      VARCHAR(64)   NOT NULL,
    device_hint     VARCHAR(200),
    is_used         BOOLEAN       NOT NULL DEFAULT FALSE,
    used_at         TIMESTAMPTZ,
    expires_at      TIMESTAMPTZ   NOT NULL,                    -- 15 minute TTL
    created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    ip_address      INET,

    CONSTRAINT mlt_token_id_unique   UNIQUE (token_id),
    CONSTRAINT mlt_token_hash_unique UNIQUE (token_hash)
);

CREATE INDEX idx_mlt_token_hash ON magic_link_tokens (token_hash);
CREATE INDEX idx_mlt_expires_at ON magic_link_tokens (expires_at) WHERE is_used = FALSE;
```

---

#### Table: `oauth_connections`

```sql
CREATE TABLE oauth_connections (
    id                BIGSERIAL     PRIMARY KEY,
    user_id           BIGINT        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider          VARCHAR(20)   NOT NULL CHECK (provider IN ('GOOGLE','APPLE','FACEBOOK')),
    provider_user_id  VARCHAR(255)  NOT NULL,
    provider_email    VARCHAR(320),                            -- AES-256-GCM encrypted
    provider_email_hash VARCHAR(64),
    access_token      TEXT,                                    -- AES-256-GCM encrypted (if stored)
    refresh_token     TEXT,                                    -- AES-256-GCM encrypted
    token_expires_at  TIMESTAMPTZ,
    scopes            TEXT[],
    raw_profile       JSONB,                                   -- Sanitised provider profile snapshot
    is_active         BOOLEAN       NOT NULL DEFAULT TRUE,
    created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

    CONSTRAINT oauth_provider_user_unique UNIQUE (provider, provider_user_id)
);

CREATE INDEX idx_oauth_user_id          ON oauth_connections (user_id);
CREATE INDEX idx_oauth_provider_user    ON oauth_connections (provider, provider_user_id);
CREATE INDEX idx_oauth_provider_email   ON oauth_connections (provider_email_hash)
    WHERE provider_email_hash IS NOT NULL;
```

---

#### Table: `risk_events`

```sql
CREATE TABLE risk_events (
    id              BIGSERIAL     PRIMARY KEY,
    user_id         BIGINT        REFERENCES users(id) ON DELETE SET NULL,
    event_type      VARCHAR(50)   NOT NULL
                    CHECK (event_type IN (
                        'FAILED_LOGIN','ACCOUNT_LOCKED','SUSPICIOUS_IP',
                        'CREDENTIAL_STUFFING_DETECTED','IMPOSSIBLE_TRAVEL',
                        'NEW_DEVICE','MULTIPLE_FAILURES_GLOBAL'
                    )),
    severity        VARCHAR(10)   NOT NULL CHECK (severity IN ('LOW','MEDIUM','HIGH','CRITICAL')),
    ip_address      INET,
    country         CHAR(2),
    device_id       UUID,
    metadata        JSONB,
    resolved        BOOLEAN       NOT NULL DEFAULT FALSE,
    resolved_at     TIMESTAMPTZ,
    created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_risk_user_id    ON risk_events (user_id, created_at DESC);
CREATE INDEX idx_risk_ip         ON risk_events (ip_address, created_at DESC);
CREATE INDEX idx_risk_event_type ON risk_events (event_type, created_at DESC);
CREATE INDEX idx_risk_severity   ON risk_events (severity) WHERE resolved = FALSE;
```

---

#### Table: `audit_logs`

```sql
CREATE TABLE audit_logs (
    id              BIGSERIAL     PRIMARY KEY,
    user_id         BIGINT        REFERENCES users(id) ON DELETE SET NULL,
    actor_id        BIGINT        REFERENCES users(id) ON DELETE SET NULL,  -- Admin performing action
    action          VARCHAR(60)   NOT NULL
                    CHECK (action IN (
                        'REGISTER','LOGIN','LOGOUT','LOGIN_FAILED',
                        'PASSWORD_CHANGED','PASSWORD_RESET_REQUESTED','PASSWORD_RESET',
                        'EMAIL_VERIFIED','PHONE_VERIFIED',
                        'MFA_ENABLED','MFA_DISABLED','MFA_VERIFIED','MFA_FAILED',
                        'ACCOUNT_LOCKED','ACCOUNT_UNLOCKED',
                        'ACCOUNT_SUSPENDED','ACCOUNT_BANNED','ACCOUNT_DELETED',
                        'SESSION_REVOKED','ALL_SESSIONS_REVOKED',
                        'OAUTH_CONNECTED','OAUTH_DISCONNECTED',
                        'GDPR_DELETION_REQUESTED','ADMIN_ACTION'
                    )),
    ip_address      INET,
    user_agent      TEXT,
    device_id       UUID,
    country         CHAR(2),
    result          VARCHAR(10)   NOT NULL CHECK (result IN ('SUCCESS','FAILURE')),
    failure_reason  VARCHAR(100),
    metadata        JSONB,                                     -- Additional context (never PII in plain)
    created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
)
PARTITION BY RANGE (created_at);

-- Create monthly partitions (automate via pg_partman in production)
-- Example: partition for the current and next two months; pg_partman
-- handles creation automatically in production — these are illustrative.
CREATE TABLE audit_logs_2026_03 PARTITION OF audit_logs
    FOR VALUES FROM ('2026-03-01') TO ('2026-04-01');
CREATE TABLE audit_logs_2026_04 PARTITION OF audit_logs
    FOR VALUES FROM ('2026-04-01') TO ('2026-05-01');
CREATE TABLE audit_logs_2026_05 PARTITION OF audit_logs
    FOR VALUES FROM ('2026-05-01') TO ('2026-06-01');
-- pg_partman config (add to postgresql.conf / background worker):
-- SELECT partman.create_parent('public.audit_logs','created_at','native','monthly');

CREATE INDEX idx_audit_user_id   ON audit_logs (user_id, created_at DESC);
CREATE INDEX idx_audit_action    ON audit_logs (action, created_at DESC);
CREATE INDEX idx_audit_ip        ON audit_logs (ip_address, created_at DESC);
CREATE INDEX idx_audit_created   ON audit_logs (created_at DESC);
```

---

#### Table: `banned_users`

```sql
CREATE TABLE banned_users (
    id              BIGSERIAL     PRIMARY KEY,
    user_id         BIGINT        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    banned_by       BIGINT        REFERENCES users(id) ON DELETE SET NULL,  -- Admin user ID
    ban_type        VARCHAR(20)   NOT NULL CHECK (ban_type IN ('TEMPORARY','PERMANENT','SHADOW')),
    reason          VARCHAR(500)  NOT NULL,
    internal_notes  TEXT,
    appeal_allowed  BOOLEAN       NOT NULL DEFAULT TRUE,
    appeal_deadline TIMESTAMPTZ,
    appealed_at     TIMESTAMPTZ,
    appeal_resolved_at TIMESTAMPTZ,
    appeal_result   VARCHAR(20)   CHECK (appeal_result IN ('UPHELD','OVERTURNED')),
    expires_at      TIMESTAMPTZ,                               -- NULL = permanent
    created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

    CONSTRAINT banned_users_user_id_unique UNIQUE (user_id)    -- One active ban record per user
);

CREATE INDEX idx_banned_user_id  ON banned_users (user_id);
CREATE INDEX idx_banned_expires  ON banned_users (expires_at) WHERE expires_at IS NOT NULL;
```

---

### 2.2 Entity Relationship Diagram

```
users (1) ──────< sessions (N)
  │                   │
  │                   └──< refresh_tokens (N)
  │
  ├──────< devices (N)
  ├──────< otp_challenges (N)
  ├──────< password_reset_tokens (N)
  ├──────< magic_link_tokens (N)
  ├──────< oauth_connections (N)
  ├──────< risk_events (N)
  ├──────< audit_logs (N)  [user_id + actor_id]
  └──────── banned_users (1)   [at most one active ban]
```

### 2.3 Data Retention & Scale Estimates

| Table | Rows at 100M users | Retention Policy |
|-------|-------------------|-----------------|
| users | 100M | Indefinite (GDPR: hard delete within 30 days of request) |
| sessions | ~300M (3 per active user) | Purge expired rows after 90 days |
| refresh_tokens | ~300M | Purge used/revoked after 90 days |
| devices | ~250M | Purge unseen >180 days |
| otp_challenges | ~50M/day peak | Purge used/expired after 24 hours |
| password_reset_tokens | Low volume | Purge used/expired after 7 days |
| magic_link_tokens | Low volume | Purge used/expired after 24 hours |
| oauth_connections | ~150M | Purge on account deletion |
| risk_events | ~5M/day peak | Archive after 90 days |
| audit_logs | ~20M/day | Archive after 1 year; delete after 7 years |
| banned_users | < 1M | Indefinite |

**Storage estimate (PostgreSQL, uncompressed):**
- `users` at 100M rows ≈ 40 GB
- `sessions` at 300M rows ≈ 60 GB
- `audit_logs` at 7B rows (7yr retention) ≈ 3.5 TB (partitioned, compressed in cold storage)

---

## 3. API Endpoints

**Base URL:** `https://api.app.com/auth`  
**API Version:** `v1`  
**Content-Type:** `application/json`  
**Auth:** Bearer JWT (RS256) — specified per endpoint  

### 3.1 POST /v1/auth/register

Register a new user with email and password.

- **Auth:** None
- **Rate Limit:** 5 requests / hour / IP

**Request:**
```json
{
  "email": "alice@example.com",
  "password": "MySecurePass1!",
  "tos_accepted": true,
  "privacy_policy_accepted": true,
  "tos_version": "2025-01",
  "referral_code": "FRIEND123"
}
```

**Success Response — 201 Created:**
```json
{
  "status": "PENDING_VERIFICATION",
  "user_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "message": "Verification email sent. Please verify your email to continue.",
  "verification_expires_at": "2025-07-15T10:25:00Z"
}
```

**Error Responses:**
```json
// 409 Conflict — email already registered
{
  "error": "EMAIL_ALREADY_EXISTS",
  "message": "An account with this email already exists.",
  "status": 409
}

// 422 Unprocessable — weak password
{
  "error": "PASSWORD_TOO_WEAK",
  "message": "Password must be at least 8 characters and contain uppercase, lowercase, digit, and special character.",
  "status": 422
}

// 429 Too Many Requests
{
  "error": "RATE_LIMIT_EXCEEDED",
  "message": "Too many registration attempts. Try again in 55 minutes.",
  "retry_after": 3300,
  "status": 429
}
```

---

### 3.2 POST /v1/auth/register/phone

Register a new user with phone number.

- **Auth:** None
- **Rate Limit:** 3 requests / hour / IP

**Request:**
```json
{
  "phone_number": "+14155552671",
  "tos_accepted": true,
  "privacy_policy_accepted": true,
  "tos_version": "2025-01"
}
```

**Success Response — 200 OK:**
```json
{
  "challenge_id": "c7d8e9f0-1234-5678-abcd-000000000001",
  "message": "OTP sent via SMS.",
  "expires_at": "2025-07-15T10:20:00Z",
  "masked_phone": "+1•••••2671"
}
```

**Error Responses:**
```json
// 409 Conflict
{
  "error": "PHONE_ALREADY_EXISTS",
  "message": "An account with this phone number already exists.",
  "status": 409
}
```

---

### 3.3 POST /v1/auth/verify/email

Verify email address with OTP sent during registration.

- **Auth:** None
- **Rate Limit:** 10 requests / hour / IP

**Request:**
```json
{
  "challenge_id": "c7d8e9f0-1234-5678-abcd-000000000002",
  "code": "482917"
}
```

**Success Response — 200 OK:**
```json
{
  "access_token": "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCIsImtpZCI6InJzYS0yMDI1MDEifQ...",
  "refresh_token": "dGhpcyBpcyBhIHNhbXBsZSByZWZyZXNoIHRva2Vu",
  "token_type": "Bearer",
  "expires_in": 900,
  "user_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "account_status": "ACTIVE",
  "requires_profile_setup": true
}
```

**Error Responses:**
```json
// 400 Bad Request — invalid code
{
  "error": "INVALID_OTP",
  "message": "The verification code is incorrect.",
  "attempts_remaining": 2,
  "status": 400
}

// 410 Gone — expired
{
  "error": "OTP_EXPIRED",
  "message": "The verification code has expired. Please request a new one.",
  "status": 410
}
```

---

### 3.4 POST /v1/auth/verify/phone

Verify phone number with OTP.

- **Auth:** None
- **Rate Limit:** 10 requests / hour / IP

**Request:**
```json
{
  "challenge_id": "c7d8e9f0-1234-5678-abcd-000000000001",
  "code": "739204",
  "device_fingerprint": "fp_abc123def456"
}
```

**Success Response — 200 OK:**
```json
{
  "access_token": "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refresh_token": "c2Vjb25kIHNhbXBsZSByZWZyZXNoIHRva2Vu",
  "token_type": "Bearer",
  "expires_in": 900,
  "user_id": "b2c3d4e5-f6a7-8901-bcde-f12345678901",
  "account_status": "ACTIVE",
  "requires_profile_setup": true
}
```

---

### 3.5 POST /v1/auth/login

Email + password login.

- **Auth:** None
- **Rate Limit:** 10 requests / 15 min / IP; 5 requests / 15 min / account

**Request:**
```json
{
  "email": "alice@example.com",
  "password": "MySecurePass1!",
  "device_fingerprint": "fp_abc123def456",
  "device_name": "Alice's iPhone 15",
  "device_os": "iOS",
  "device_os_version": "17.4",
  "app_version": "3.2.1"
}
```

**Success Response — 200 OK (no MFA):**
```json
{
  "access_token": "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refresh_token": "dGhpcmQgc2FtcGxlIHJlZnJlc2ggdG9rZW4",
  "token_type": "Bearer",
  "expires_in": 900,
  "session_id": "s1e2s3s4-i5o6-n7i8-d900-000000000001",
  "user_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "account_status": "ACTIVE",
  "role": "USER",
  "subscription_tier": "FREE",
  "mfa_required": false
}
```

**Success Response — 200 OK (MFA required):**
```json
{
  "mfa_required": true,
  "mfa_method": "TOTP",
  "mfa_challenge_token": "eyJtZmFfY2hhbGxlbmdlIjoidHJ1ZSJ9...",
  "message": "Please provide your two-factor authentication code."
}
```

**Error Responses:**
```json
// 401 Unauthorized
{
  "error": "INVALID_CREDENTIALS",
  "message": "Email or password is incorrect.",
  "attempts_remaining": 4,
  "status": 401
}

// 423 Locked
{
  "error": "ACCOUNT_LOCKED",
  "message": "Account temporarily locked due to too many failed attempts.",
  "locked_until": "2025-07-15T10:30:00Z",
  "status": 423
}

// 403 Forbidden — banned
{
  "error": "ACCOUNT_BANNED",
  "message": "Your account has been permanently suspended.",
  "appeal_url": "https://app.com/appeal",
  "status": 403
}
```

---

### 3.6 POST /v1/auth/login/phone

Phone number + OTP login.

- **Auth:** None
- **Rate Limit:** 5 requests / 15 min / IP

**Request:**
```json
{
  "phone_number": "+14155552671",
  "device_fingerprint": "fp_abc123def456"
}
```

**Success Response — 200 OK:**
```json
{
  "challenge_id": "c7d8e9f0-1234-5678-abcd-000000000003",
  "message": "OTP sent via SMS.",
  "expires_at": "2025-07-15T10:30:00Z",
  "masked_phone": "+1•••••2671"
}
```

---

### 3.7 POST /v1/auth/login/magic-link

Send a magic link for passwordless login.

- **Auth:** None
- **Rate Limit:** 3 requests / hour / email

**Request:**
```json
{
  "email": "alice@example.com",
  "device_hint": "Chrome on MacBook"
}
```

**Success Response — 200 OK:**
```json
{
  "message": "Magic link sent to your email. Valid for 15 minutes.",
  "expires_at": "2025-07-15T10:30:00Z",
  "masked_email": "a•••e@example.com"
}
```

---

### 3.8 POST /v1/auth/oauth/google

Authenticate via Google OAuth 2.0 (PKCE flow).

- **Auth:** None
- **Rate Limit:** 20 requests / min / IP

**Request:**
```json
{
  "id_token": "eyJhbGciOiJSUzI1NiIsImtpZCI6IjEifQ...",
  "device_fingerprint": "fp_abc123def456",
  "device_name": "Alice's MacBook",
  "device_os": "macOS"
}
```

**Success Response — 200 OK:**
```json
{
  "access_token": "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refresh_token": "Zm91cnRoIHNhbXBsZSByZWZyZXNoIHRva2Vu",
  "token_type": "Bearer",
  "expires_in": 900,
  "user_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "account_status": "ACTIVE",
  "is_new_user": false,
  "requires_profile_setup": false
}
```

---

### 3.9 POST /v1/auth/oauth/apple

Authenticate via Apple Sign-In.

- **Auth:** None
- **Rate Limit:** 20 requests / min / IP

**Request:**
```json
{
  "identity_token": "eyJraWQiOiJZdXlYb1kiLCJhbGciOiJSUzI1NiJ9...",
  "authorization_code": "c0ada4c0c2c4e4fdb8e8c3e2b5a9d7f3",
  "given_name": "Alice",
  "family_name": "Smith",
  "device_fingerprint": "fp_abc123def456"
}
```

**Success Response — 200 OK:**
```json
{
  "access_token": "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refresh_token": "ZmlmdGggc2FtcGxlIHJlZnJlc2ggdG9rZW4",
  "token_type": "Bearer",
  "expires_in": 900,
  "user_id": "c3d4e5f6-a7b8-9012-cdef-234567890123",
  "account_status": "ACTIVE",
  "is_new_user": true,
  "requires_profile_setup": true
}
```

---

### 3.10 POST /v1/auth/token/refresh

Refresh an expired access token using a valid refresh token.

- **Auth:** Refresh token in body (not Authorization header)
- **Rate Limit:** 60 requests / hour / user

**Request:**
```json
{
  "refresh_token": "dGhpcyBpcyBhIHNhbXBsZSByZWZyZXNoIHRva2Vu"
}
```

**Success Response — 200 OK:**
```json
{
  "access_token": "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refresh_token": "bmV3IHJlZnJlc2ggdG9rZW4gcm90YXRlZA==",
  "token_type": "Bearer",
  "expires_in": 900
}
```

**Error Responses:**
```json
// 401 — reused/revoked refresh token (triggers family invalidation)
{
  "error": "REFRESH_TOKEN_REUSE_DETECTED",
  "message": "Security alert: possible token theft detected. All sessions have been revoked.",
  "status": 401
}
```

---

### 3.11 DELETE /v1/auth/token/revoke

Logout — revoke current session and refresh token.

- **Auth:** Bearer JWT required
- **Rate Limit:** 30 requests / hour / user

**Request:**
```json
{
  "refresh_token": "dGhpcyBpcyBhIHNhbXBsZSByZWZyZXNoIHRva2Vu"
}
```

**Success Response — 204 No Content**

---

### 3.12 POST /v1/auth/totp/setup

Initiate TOTP (2FA) setup — returns QR code seed.

- **Auth:** Bearer JWT required
- **Rate Limit:** 10 requests / hour / user

**Request:**
```json
{}
```

**Success Response — 200 OK:**
```json
{
  "totp_uri": "otpauth://totp/[APP_NAME]:alice%40example.com?secret=JBSWY3DPEHPK3PXP&issuer=[APP_NAME]&algorithm=SHA1&digits=6&period=30",
  "secret": "JBSWY3DPEHPK3PXP",
  "qr_code_url": "https://api.app.com/auth/v1/totp/qr/tmp_abc123",
  "backup_codes": [
    "83920-47261", "19274-83620", "72836-19204",
    "48271-93820", "93820-47261", "20394-81726",
    "72640-92836", "19283-64728", "82736-19204", "48291-37620"
  ],
  "message": "Scan the QR code in your authenticator app, then verify with a code to activate 2FA."
}
```

---

### 3.13 POST /v1/auth/totp/verify

Confirm TOTP setup or complete MFA login challenge.

- **Auth:** Bearer JWT or MFA challenge token
- **Rate Limit:** 10 requests / 15 min / user

**Request:**
```json
{
  "totp_code": "482917",
  "mfa_challenge_token": "eyJtZmFfY2hhbGxlbmdlIjoidHJ1ZSJ9..."
}
```

**Success Response — 200 OK (MFA login):**
```json
{
  "access_token": "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refresh_token": "c2l4dGggc2FtcGxlIHJlZnJlc2ggdG9rZW4",
  "token_type": "Bearer",
  "expires_in": 900,
  "session_id": "s9e8s7s6-i5o4-n3i2-d100-000000000002"
}
```

**Success Response — 200 OK (TOTP setup confirmation):**
```json
{
  "message": "Two-factor authentication enabled successfully.",
  "totp_enabled": true,
  "enabled_at": "2025-07-15T10:15:00Z"
}
```

**Error Responses:**
```json
// 401 — wrong code
{
  "error": "INVALID_TOTP_CODE",
  "message": "The authentication code is incorrect or has expired.",
  "status": 401
}
```

---

### 3.14 POST /v1/auth/password/forgot

Request a password reset email.

- **Auth:** None
- **Rate Limit:** 3 requests / hour / email

**Request:**
```json
{
  "email": "alice@example.com"
}
```

**Success Response — 200 OK** *(always 200 to prevent email enumeration):*
```json
{
  "message": "If an account exists for this email, a password reset link has been sent.",
  "expires_in": 3600
}
```

---

### 3.15 POST /v1/auth/password/reset

Reset password using the token from the reset email.

- **Auth:** None
- **Rate Limit:** 5 requests / hour / IP

**Request:**
```json
{
  "token": "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2",
  "new_password": "NewSecurePass2@"
}
```

**Success Response — 200 OK:**
```json
{
  "message": "Password reset successfully. Please log in with your new password.",
  "all_sessions_revoked": true
}
```

---

### 3.16 PUT /v1/auth/password/change

Change password (authenticated user, knows current password).

- **Auth:** Bearer JWT required
- **Rate Limit:** 5 requests / hour / user

**Request:**
```json
{
  "current_password": "MySecurePass1!",
  "new_password": "NewSecurePass2@",
  "revoke_other_sessions": true
}
```

**Success Response — 200 OK:**
```json
{
  "message": "Password changed successfully.",
  "sessions_revoked": 3
}
```

---

### 3.17 GET /v1/auth/sessions

List all active sessions for the authenticated user.

- **Auth:** Bearer JWT required
- **Rate Limit:** 30 requests / hour / user

**Success Response — 200 OK:**
```json
{
  "sessions": [
    {
      "session_id": "s1e2s3s4-i5o6-n7i8-d900-000000000001",
      "device_name": "Alice's iPhone 15",
      "device_os": "iOS 17.4",
      "app_version": "3.2.1",
      "ip_address": "203.0.113.42",
      "country": "US",
      "city": "San Francisco",
      "last_active_at": "2025-07-15T09:50:00Z",
      "created_at": "2025-07-10T14:30:00Z",
      "is_current": true
    },
    {
      "session_id": "s2e3s4s5-i6o7-n8i9-d001-000000000002",
      "device_name": "Alice's MacBook",
      "device_os": "macOS 14.2",
      "app_version": "web-2.1.0",
      "ip_address": "203.0.113.42",
      "country": "US",
      "city": "San Francisco",
      "last_active_at": "2025-07-14T18:20:00Z",
      "created_at": "2025-07-12T09:00:00Z",
      "is_current": false
    }
  ],
  "total": 2
}
```

---

### 3.18 DELETE /v1/auth/sessions/{sessionId}

Revoke a specific session.

- **Auth:** Bearer JWT required (can only revoke own sessions unless ADMIN)
- **Rate Limit:** 20 requests / hour / user

**Success Response — 204 No Content**

---

### 3.19 GET /v1/auth/profile

Get the authenticated user's auth profile (non-sensitive fields only).

- **Auth:** Bearer JWT required
- **Rate Limit:** 60 requests / min / user

**Success Response — 200 OK:**
```json
{
  "user_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "email_verified": true,
  "phone_verified": false,
  "account_status": "ACTIVE",
  "role": "USER",
  "subscription_tier": "FREE",
  "totp_enabled": true,
  "registration_method": "EMAIL",
  "oauth_providers": ["GOOGLE"],
  "masked_email": "a•••e@example.com",
  "masked_phone": null,
  "tos_accepted_at": "2025-06-01T12:00:00Z",
  "tos_version": "2025-01",
  "last_login_at": "2025-07-15T09:50:00Z",
  "created_at": "2025-06-01T12:00:00Z"
}
```

---

### 3.20 DELETE /v1/auth/account

Submit a GDPR right-to-erasure request.

- **Auth:** Bearer JWT required
- **Rate Limit:** 3 requests / day / user

**Request:**
```json
{
  "password": "MyCurrentPassword1!",
  "reason": "I no longer wish to use this service.",
  "confirm": true
}
```

**Success Response — 200 OK:**
```json
{
  "message": "Your account deletion request has been received.",
  "deletion_scheduled_at": "2025-08-14T10:15:00Z",
  "data_export_url": "https://api.app.com/user/v1/data-export/a1b2c3d4",
  "data_export_expires_at": "2025-07-22T10:15:00Z",
  "appeal_deadline": "2025-07-29T10:15:00Z"
}
```

---

## 4. User Stories & Acceptance Criteria

### Story 1 — New User Registration (Email)

> **As a** new visitor,  
> **I want to** create an account using my email and password,  
> **so that** I can start using the dating platform.

**Acceptance Criteria:**
- [ ] System rejects duplicate email addresses (case-insensitive comparison via `email_hash`)
- [ ] Password must meet minimum complexity: ≥8 chars, uppercase, lowercase, digit, special character
- [ ] System sends a 6-digit OTP to the email within 10 seconds
- [ ] OTP expires after 10 minutes
- [ ] Registration is rate-limited to 5 attempts/hour/IP
- [ ] TOS and Privacy Policy acceptance recorded with version + timestamp
- [ ] System publishes `user.registered` Kafka event on successful account creation
- [ ] Account status is `PENDING_VERIFICATION` until email is verified

**Business Rules:**
- Email is stored AES-256-GCM encrypted; only `email_hash` is used for uniqueness check
- If registration IP is in a sanctioned country, registration is rejected with `GEO_BLOCKED` error
- If IP risk score (from MaxMind) > 80, challenge with CAPTCHA before proceeding

---

### Story 2 — Secure Login with Brute-Force Protection

> **As a** registered user,  
> **I want to** log in securely,  
> **so that** only I can access my account.

**Acceptance Criteria:**
- [ ] Correct credentials produce access + refresh tokens within 200 ms (p99)
- [ ] Each consecutive failed attempt increments `failed_login_attempts`
- [ ] After 5 failed attempts, account is locked for 15 minutes
- [ ] Lockout duration doubles with each subsequent lockout (exponential backoff, max 24h)
- [ ] Successful login resets `failed_login_attempts` to 0
- [ ] New device login triggers a `NEW_DEVICE` risk event
- [ ] Impossible travel detection (login from geographically distant IP within short window) triggers risk event
- [ ] System publishes `user.login` Kafka event with risk score

**Edge Cases:**
- User with `SUSPENDED` status: return `403 ACCOUNT_SUSPENDED` with appeal link
- User with `BANNED` status: return `403 ACCOUNT_BANNED`
- User with `HARD_DELETED` status: return `404 ACCOUNT_NOT_FOUND` (no information leakage)

---

### Story 3 — MFA / TOTP Enrollment

> **As a** security-conscious user,  
> **I want to** enable two-factor authentication on my account,  
> **so that** my account is protected even if my password is compromised.

**Acceptance Criteria:**
- [ ] TOTP secret generated using cryptographically secure random source
- [ ] QR code URI follows `otpauth://totp/` standard format (RFC 6238)
- [ ] 10 single-use backup codes generated at setup time (stored Argon2id hashed)
- [ ] TOTP is activated only after user successfully verifies with a valid code
- [ ] System publishes `user.mfa.enabled` Kafka event
- [ ] TOTP setup invalidates any temporary setup tokens after 5 minutes of inactivity

---

### Story 4 — Refresh Token Rotation with Reuse Detection

> **As a** platform security engineer,  
> **I want** refresh tokens to be rotated on each use and detect reuse attacks,  
> **so that** stolen refresh tokens cannot be silently exploited.

**Acceptance Criteria:**
- [ ] Every `/token/refresh` call issues a new refresh token and marks the old one `is_used = TRUE`
- [ ] Reuse of an already-used refresh token (from same family) revokes ALL tokens in that family
- [ ] On family revocation, all active sessions for that family are invalidated
- [ ] Session blacklist in Redis is updated within 100 ms of revocation
- [ ] User receives notification (push + email) of security incident

---

### Story 5 — GDPR Right to Erasure

> **As a** user exercising my legal rights,  
> **I want to** request deletion of all my data,  
> **so that** the platform removes my personal information within 30 days.

**Acceptance Criteria:**
- [ ] Request requires password re-confirmation (or OAuth re-consent) to prevent accidental deletion
- [ ] Deletion is scheduled 30 days in the future (grace period + legal hold)
- [ ] User receives a data export download link valid for 7 days
- [ ] System publishes `user.gdpr.deletion.requested` Kafka event immediately
- [ ] All downstream services (User, Profile, Chat, etc.) consume the event and schedule erasure
- [ ] `account_status` set to `SOFT_DELETED` immediately; tokens are revoked
- [ ] User can cancel the request within 30 days (grace period)

---

## 5. Kafka Events

**Kafka cluster:** `kafka.internal:9092`  
**Default replication factor:** 3  
**Min ISR:** 2  

### 5.1 Topic: `user.registered`

```json
{
  "schema_version": "1.0",
  "event_id": "evt-a1b2c3d4-e5f6-7890-0001",
  "event_type": "user.registered",
  "timestamp": "2025-07-15T10:15:00.000Z",
  "source": "authentication-service",
  "payload": {
    "user_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "email_verified": false,
    "phone_verified": false,
    "registration_method": "EMAIL",
    "registration_country": "US",
    "subscription_tier": "FREE",
    "tos_version": "2025-01",
    "referral_code": "FRIEND123"
  }
}
```

**Partitioning:** By `user_id` (ensures ordering per user)  
**Consumer Groups:** `user-service-consumer`, `notification-service-consumer`, `analytics-service-consumer`  
**Retention:** 7 days  

---

### 5.2 Topic: `user.login`

```json
{
  "schema_version": "1.0",
  "event_id": "evt-b2c3d4e5-f6a7-8901-0002",
  "event_type": "user.login",
  "timestamp": "2025-07-15T10:20:00.000Z",
  "source": "authentication-service",
  "payload": {
    "user_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "session_id": "s1e2s3s4-i5o6-n7i8-d900-000000000001",
    "device_id": "d1e2v3i4-c5e6-7890-abcd-000000000001",
    "device_os": "iOS",
    "login_method": "EMAIL_PASSWORD",
    "ip_address": "203.0.113.42",
    "country": "US",
    "risk_score": 12,
    "is_new_device": false
  }
}
```

**Consumer Groups:** `analytics-service-consumer`, `trust-safety-service-consumer`  

---

### 5.3 Topic: `user.logout`

```json
{
  "schema_version": "1.0",
  "event_id": "evt-c3d4e5f6-a7b8-9012-0003",
  "event_type": "user.logout",
  "timestamp": "2025-07-15T11:00:00.000Z",
  "source": "authentication-service",
  "payload": {
    "user_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "session_id": "s1e2s3s4-i5o6-n7i8-d900-000000000001",
    "reason": "USER_LOGOUT",
    "all_sessions": false
  }
}
```

---

### 5.4 Topic: `user.account.suspended`

```json
{
  "schema_version": "1.0",
  "event_id": "evt-d4e5f6a7-b8c9-0123-0004",
  "event_type": "user.account.suspended",
  "timestamp": "2025-07-15T12:00:00.000Z",
  "source": "authentication-service",
  "payload": {
    "user_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "reason": "POLICY_VIOLATION",
    "suspended_by": "admin-00000000-0000-0000-0000-000000000001",
    "suspended_until": "2025-07-22T12:00:00.000Z",
    "ban_type": "TEMPORARY"
  }
}
```

**Consumer Groups:** `notification-service-consumer`, `chat-service-consumer`, `analytics-service-consumer`  

---

### 5.5 Topic: `user.account.banned`

```json
{
  "schema_version": "1.0",
  "event_id": "evt-e5f6a7b8-c9d0-1234-0005",
  "event_type": "user.account.banned",
  "timestamp": "2025-07-15T13:00:00.000Z",
  "source": "authentication-service",
  "payload": {
    "user_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "reason": "REPEATED_HARASSMENT",
    "banned_by": "admin-00000000-0000-0000-0000-000000000001",
    "ban_type": "PERMANENT",
    "appeal_allowed": true,
    "appeal_deadline": "2025-08-14T13:00:00.000Z"
  }
}
```

---

### 5.6 Topic: `user.password.changed`

```json
{
  "schema_version": "1.0",
  "event_id": "evt-f6a7b8c9-d0e1-2345-0006",
  "event_type": "user.password.changed",
  "timestamp": "2025-07-15T14:00:00.000Z",
  "source": "authentication-service",
  "payload": {
    "user_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "change_method": "USER_INITIATED",
    "sessions_revoked": 3,
    "ip_address": "203.0.113.42"
  }
}
```

**Consumer Groups:** `notification-service-consumer`  

---

### 5.7 Topic: `user.mfa.enabled`

```json
{
  "schema_version": "1.0",
  "event_id": "evt-a7b8c9d0-e1f2-3456-0007",
  "event_type": "user.mfa.enabled",
  "timestamp": "2025-07-15T15:00:00.000Z",
  "source": "authentication-service",
  "payload": {
    "user_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "method": "TOTP",
    "backup_codes_count": 10
  }
}
```

---

### 5.8 Topic: `user.gdpr.deletion.requested`

```json
{
  "schema_version": "1.0",
  "event_id": "evt-b8c9d0e1-f2a3-4567-0008",
  "event_type": "user.gdpr.deletion.requested",
  "timestamp": "2025-07-15T10:15:00.000Z",
  "source": "authentication-service",
  "payload": {
    "user_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "requested_at": "2025-07-15T10:15:00.000Z",
    "scheduled_deletion_at": "2025-08-14T10:15:00.000Z",
    "grace_period_days": 30
  }
}
```

**Consumer Groups:** ALL services must consume this topic to execute data erasure.

---

### 5.9 Dead Letter Queue Strategy

```
user.registered          →  user.registered.dlq
user.login               →  user.login.dlq
user.gdpr.*              →  user.gdpr.dlq  (monitored with CRITICAL alert — 0 messages tolerated)
```

- DLQ retention: 30 days
- Alerting: any DLQ message older than 1 hour triggers PagerDuty page
- Reprocessing: manual or automated replay via admin tooling

---

## 6. Redis Caching Strategy

**Redis cluster:** 3 primary + 3 replica nodes, 16 GB RAM each  
**Eviction policy:** `allkeys-lru`

### 6.1 Key Patterns and TTLs

| Purpose | Key Pattern | TTL | Value |
|---------|-------------|-----|-------|
| OTP code | `otp:{target_hash}:{purpose}` | 10 min | Hashed code + attempt count (JSON) |
| Rate limit — registration | `rate:reg:{ip}` | 1 hour | Request count (integer) |
| Rate limit — login by IP | `rate:login:ip:{ip}` | 15 min | Request count |
| Rate limit — login by user | `rate:login:user:{userId}` | 15 min | Request count |
| Rate limit — magic link | `rate:magic:{emailHash}` | 1 hour | Request count |
| Session blacklist (JTI) | `session:revoked:{jti}` | Access token TTL (15 min) | `"1"` |
| User account lock | `lock:user:{userId}` | Lockout duration (15 min → 24 hr) | Lock expiry timestamp |
| Risk score cache | `risk:score:{userId}` | 5 min | Risk score (integer 0-100) |
| TOTP setup temp token | `totp:setup:{userId}` | 5 min | Encrypted TOTP seed |
| Session count | `session:count:{userId}` | 30 days | Active session count |
| Refresh token family | `rt:family:{familyId}` | 30 days | JSON: revoked flag + user_id |

### 6.2 Rate Limiting Implementation

Sliding window counter using Redis `INCR` + `EXPIRE`:

```
1. INCR rate:login:ip:{ip}
2. If result == 1: EXPIRE rate:login:ip:{ip} 900
3. If result > 10: reject with 429
```

Token bucket for burst protection uses `EVAL` with Lua script for atomicity.

### 6.3 Session Blacklist

On token revocation (logout, password change, admin ban):
```
SET session:revoked:{jti} "1" EX 900
```

Every service validating JWTs calls the API Gateway, which checks this key. The Auth Service also accepts inbound validation calls from internal services.

---

## 7. Security & Compliance

### 7.1 Cryptography

| Asset | Algorithm | Parameters |
|-------|-----------|-----------|
| Password hashing | Argon2id | time=3, memory=65536 KB (64 MB), parallelism=4, tag=32 bytes |
| PII field encryption | AES-256-GCM | 256-bit key from AWS KMS, 96-bit random IV per value, 128-bit auth tag |
| PII lookup hash | SHA-256 | HMAC-SHA-256 with server-side secret (prevents rainbow table attacks) |
| JWT signing | RS256 | RSA-4096, 90-day rotation, JWKS endpoint exposed |
| OTP | TOTP RFC 6238 | SHA-1, 6 digits, 30-second window, ±1 window tolerance |
| TOTP secret | CSPRNG | 20-byte (160-bit) Base32 encoded |
| Backup codes | CSPRNG | 10 × 10-digit codes, Argon2id hashed for storage |
| Refresh tokens | CSPRNG | 256-bit opaque token, SHA-256 hashed for storage |
| Password reset tokens | CSPRNG | 256-bit URL-safe Base64 token, SHA-256 hashed |

### 7.2 JWT Claims Structure

```json
{
  "iss": "https://auth.app.com",
  "sub": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "aud": ["https://api.app.com"],
  "exp": 1752583200,
  "iat": 1752582300,
  "jti": "s1e2s3s4-i5o6-n7i8-d900-000000000001",
  "sid": "s1e2s3s4-i5o6-n7i8-d900-000000000001",
  "role": "USER",
  "tier": "FREE",
  "did": "d1e2v3i4-c5e6-7890-abcd-000000000001",
  "kid": "rsa-20250101"
}
```

### 7.3 Rate Limiting Rules

| Endpoint | Limit | Window | Scope |
|----------|-------|--------|-------|
| POST /register | 5 | 1 hour | Per IP |
| POST /register/phone | 3 | 1 hour | Per IP |
| POST /login | 10 | 15 min | Per IP |
| POST /login (per account) | 5 | 15 min | Per user |
| POST /login/phone | 5 | 15 min | Per IP |
| POST /password/forgot | 3 | 1 hour | Per email |
| POST /password/reset | 5 | 1 hour | Per IP |
| POST /totp/verify | 10 | 15 min | Per user |
| POST /oauth/* | 20 | 1 min | Per IP |
| POST /token/refresh | 60 | 1 hour | Per user |

### 7.4 GDPR & CCPA Compliance

| Right | Implementation |
|-------|---------------|
| Right to Access | Data export endpoint; JSON export generated within 72 hours |
| Right to Erasure | 30-day grace period, then hard delete across all services via Kafka event |
| Right to Portability | Data export in machine-readable JSON |
| Right to Rectification | Email/phone change via separate verification flow |
| Data Minimisation | Only email/phone stored (encrypted); no plaintext PII at rest |
| Lawful Basis | Explicit consent at registration; TOS + Privacy Policy version tracked |
| Retention | Audit logs: 7 years; active account data: indefinite; deleted account: 0 days after hard delete |

### 7.5 Audit Logging

Every security-relevant action is written to `audit_logs` with:
- `user_id` (if known)
- `action` (from allowed enum)
- `ip_address`
- `user_agent`
- `device_id`
- `result` (SUCCESS / FAILURE)
- `failure_reason` (if applicable)
- `metadata` (JSONB, never contains unencrypted PII)

Audit logs are immutable (no DELETE or UPDATE allowed — enforced via PostgreSQL row security policies).

### 7.6 Threat Model & Mitigations

| Threat | Mitigation |
|--------|-----------|
| Credential stuffing | Rate limiting + IP reputation (MaxMind) + CAPTCHA on risky IPs |
| Brute force | 5-attempt lockout with exponential backoff |
| Token theft (access) | Short-lived (15 min) + JTI blacklist |
| Token theft (refresh) | Family invalidation on reuse detection |
| OTP interception | Short TTL (10 min) + SHA-256 hashed storage + 3-attempt limit |
| Account enumeration | Email forgot password always returns 200; consistent response timing |
| Password spraying | Account-level rate limiting independent of IP |
| TOTP seed theft | Seed stored AES-256-GCM encrypted; never returned after setup |
| SQL injection | Parameterised queries via R2DBC; no dynamic SQL |
| XSS | JWT in HttpOnly Secure cookies for web; not in localStorage |

---

## 8. Monitoring & Observability

### 8.1 Prometheus Metrics

| Metric | Type | Labels | Description |
|--------|------|--------|-------------|
| `auth_registrations_total` | Counter | `method`, `status`, `country` | Total registration attempts |
| `auth_login_total` | Counter | `method`, `status` | Total login attempts |
| `auth_login_failures_total` | Counter | `method`, `reason` | Total failed logins |
| `auth_login_duration_seconds` | Histogram | `method` | Login latency distribution |
| `auth_token_refresh_total` | Counter | `status` | Token refresh attempts |
| `auth_token_reuse_detected_total` | Counter | — | Refresh token reuse events |
| `auth_otp_issued_total` | Counter | `purpose`, `channel` | OTPs sent |
| `auth_otp_verified_total` | Counter | `purpose`, `status` | OTP verifications |
| `auth_sessions_active` | Gauge | — | Current active sessions |
| `auth_account_lockouts_total` | Counter | — | Accounts locked due to failures |
| `auth_mfa_enabled_total` | Counter | `method` | Users enabling MFA |
| `auth_gdpr_requests_total` | Counter | — | GDPR deletion requests |
| `auth_kafka_publish_total` | Counter | `topic`, `status` | Kafka publish outcomes |

### 8.2 Health Endpoints

```
GET /actuator/health           → {"status":"UP", "components":{...}}
GET /actuator/health/liveness  → 200 if JVM alive
GET /actuator/health/readiness → 200 if DB + Redis + Kafka healthy
GET /actuator/metrics          → Prometheus-format metrics
GET /actuator/info             → {"version":"1.0.0","build":"..."}
GET /.well-known/jwks.json     → Public key set for JWT verification
```

### 8.3 Distributed Tracing

- **Provider:** OpenTelemetry SDK → Jaeger
- **Trace propagation:** W3C Trace Context (`traceparent` header)
- **Sampling rate:** 1% in production (100% for errors and p99 > 200ms)
- **Spans captured:** HTTP request/response, DB queries (sanitised), Redis operations, Kafka publish, external HTTP calls

### 8.4 Alerting Rules

```yaml
# PagerDuty Critical
- alert: HighLoginFailureRate
  expr: rate(auth_login_failures_total[5m]) / rate(auth_login_total[5m]) > 0.05
  for: 2m
  severity: critical
  message: ">5% login failure rate over last 5 minutes"

- alert: BruteForceIPDetected
  expr: sum by (ip) (rate(auth_login_failures_total[1m])) > 100
  for: 0s
  severity: critical
  message: ">100 failed logins/min from single IP"

- alert: RefreshTokenReuseSpike
  expr: rate(auth_token_reuse_detected_total[5m]) > 10
  for: 1m
  severity: high
  message: "Refresh token reuse spike — possible token theft"

# Warning
- alert: AuthServiceHighLatency
  expr: histogram_quantile(0.99, rate(auth_login_duration_seconds_bucket[5m])) > 0.2
  for: 5m
  severity: warning
  message: "Auth login p99 > 200ms"

- alert: KafkaPublishFailures
  expr: rate(auth_kafka_publish_total{status="failure"}[5m]) > 1
  for: 2m
  severity: warning
  message: "Kafka publish failures in authentication-service"
```

### 8.5 Log Format

All logs are structured JSON (Logback + Loki):

```json
{
  "timestamp": "2025-07-15T10:15:00.000Z",
  "level": "INFO",
  "service": "authentication-service",
  "trace_id": "4bf92f3577b34da6a3ce929d0e0e4736",
  "span_id": "00f067aa0ba902b7",
  "user_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "action": "LOGIN",
  "method": "EMAIL_PASSWORD",
  "result": "SUCCESS",
  "duration_ms": 87,
  "ip": "203.0.113.42",
  "country": "US"
}
```

**PII Policy:** No passwords, tokens, email addresses, or phone numbers in logs. Only `user_id` (UUID), hashes, or masked values.

---

## 9. Testing Strategy

### 9.1 Unit Tests

**Target coverage:** ≥ 80% line coverage, ≥ 70% branch coverage

Key units under test:

| Class | Test Cases |
|-------|-----------|
| `PasswordService` | Argon2id hashing, verification, weak password rejection, pepper application |
| `TokenService` | JWT generation, claim validation, expiry, RS256 signing, kid rotation |
| `OtpService` | Code generation (CSPRNG), hash storage, 3-attempt limit, expiry |
| `RiskService` | Score calculation, impossible travel detection, device trust logic |
| `TotpService` | TOTP seed generation, code verification (±1 window), backup code redemption |
| `AesEncryptionService` | Encrypt/decrypt round-trip, IV uniqueness, wrong key rejection |

**Framework:** JUnit 5 + Mockito + AssertJ  

### 9.2 Integration Tests

Tests run against Testcontainers (PostgreSQL 16, Redis 7, Kafka 3):

| Scenario | Flow |
|----------|------|
| Full registration → email verify → first login | End-to-end happy path |
| Phone registration → OTP verify → login | Happy path |
| Brute force protection | 5 failed logins → account locked → timeout → unlock |
| Refresh token rotation | Issue → use → verify new token → reuse old → family revoked |
| TOTP setup and login | Setup → verify → login with TOTP → wrong code handling |
| OAuth Google flow | Mock OIDC provider → token exchange → JWT issued |
| GDPR deletion | Request → Kafka event published → account soft deleted |
| Password reset | Forgot → email link → reset → old sessions revoked |
| Impossible travel | Login SF → login Tokyo 5min later → risk event raised |

**Framework:** Spring Boot Test + Testcontainers + WireMock (for OAuth providers)

### 9.3 Load Tests

**Tool:** k6  
**Scenarios:**

```javascript
// k6 scenario: 10,000 concurrent logins
export const options = {
  scenarios: {
    concurrent_logins: {
      executor: 'constant-vus',
      vus: 10000,
      duration: '5m',
    },
  },
  thresholds: {
    http_req_duration: ['p(99)<200'],   // p99 < 200ms
    http_req_failed: ['rate<0.001'],    // < 0.1% error rate
  },
};
```

**Targets:**
- 10,000 concurrent logins: p99 < 200 ms, error rate < 0.1%
- 5,000 concurrent token refreshes: p99 < 100 ms
- 1,000 concurrent registrations: p99 < 500 ms (includes email dispatch)

### 9.4 Security Tests

**OWASP Top 10 coverage:**

| OWASP | Test |
|-------|------|
| A01 Broken Access Control | Attempt to revoke another user's session |
| A02 Cryptographic Failures | Verify no plaintext PII in DB or logs |
| A03 Injection | SQL injection payloads in all string fields |
| A04 Insecure Design | Refresh token reuse detection |
| A05 Security Misconfiguration | Ensure no debug endpoints exposed in prod |
| A07 Auth Failures | Brute force, credential stuffing simulation |
| A09 Logging Failures | Verify audit log completeness |

**Tools:** OWASP ZAP, Burp Suite (manual penetration test quarterly), Snyk (dependency scanning in CI)

### 9.5 CI/CD Pipeline

```yaml
# GitHub Actions pipeline (simplified)
jobs:
  test:
    - ./gradlew test                          # Unit tests
    - ./gradlew integrationTest               # Integration tests (Testcontainers)
    - ./gradlew jacocoTestCoverageVerification # Enforce >80% coverage
  security:
    - snyk test                               # Dependency CVE scan
    - ./gradlew dependencyCheckAnalyze        # OWASP dependency check
  build:
    - ./gradlew bootJar
    - docker build -t auth-service:$SHA .
    - trivy image auth-service:$SHA           # Container vulnerability scan
  deploy:
    - argocd app sync authentication-service  # GitOps deploy via ArgoCD
```

---

*Document version: 1.0.0 · Last updated: 2025 · Owner: Platform — Identity & Security Team*
