# User Service — Comprehensive Technical Documentation

> **AI-Powered Dating App · Microservices Platform**
> Version: 1.0.0 · Last Updated: 2025 · Service Owner: Platform Engineering

---

## Table of Contents

1. [Service Overview & Architecture](#1-service-overview--architecture)
2. [Complete Database DDL](#2-complete-database-ddl)
3. [Complete API Endpoints](#3-complete-api-endpoints)
4. [User Stories & Acceptance Criteria](#4-user-stories--acceptance-criteria)
5. [Kafka Events Published & Consumed](#5-kafka-events-published--consumed)
6. [Redis Caching Strategy](#6-redis-caching-strategy)
7. [Security & GDPR Compliance](#7-security--gdpr-compliance)
8. [Monitoring, Observability & SLAs](#8-monitoring-observability--slas)
9. [Testing Strategy](#9-testing-strategy)

---

## 1. Service Overview & Architecture

### 1.1 Purpose

The **User Service** is the authoritative source of truth for all user account data in the platform. It owns the complete user lifecycle from post-registration onboarding through voluntary account deletion, covering:

- **User Account Management** — display name, DOB, gender, sexuality, locale, timezone, account status transitions (ACTIVE → SUSPENDED → DELETED)
- **GDPR & Privacy Controls** — right to access, right to erasure, data portability, consent tracking, incognito mode
- **Privacy Settings** — granular visibility controls (who can see your profile, who can message you, online status visibility)
- **Block Management** — block/unblock users, block list retrieval, enforcement signals to downstream services
- **Onboarding Lifecycle** — step-based onboarding progress tracking, completion gating for feature access
- **User Preferences** — language, timezone, notification hooks (preference events emitted to Notification Service)
- **Account Lifecycle Events** — emit Kafka events consumed by Profile Service, Recommendation Engine, Analytics, and Audit services

### 1.2 Technology Stack

| Component         | Technology                       | Version  |
|-------------------|----------------------------------|----------|
| Runtime           | Java                             | 21 (LTS) |
| Framework         | Spring Boot                      | 4.0.1    |
| Primary Database  | PostgreSQL                       | 16       |
| Cache / Sessions  | Redis                            | 7.x      |
| Messaging         | Apache Kafka                     | 3.x      |
| Build Tool        | Gradle                           | 8.x      |
| Containerization  | Docker + Kubernetes (EKS)        | 1.29     |
| Service Mesh      | Istio                            | 1.20     |
| Secret Management | AWS Secrets Manager              | —        |
| Observability     | Prometheus + Grafana + Jaeger    | —        |

### 1.3 Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          API Gateway (Kong)                                 │
│                    JWT Validation · Rate Limiting · TLS                     │
└───────────────────────────────┬─────────────────────────────────────────────┘
                                │ HTTP/2 + mTLS (Istio)
                                ▼
┌───────────────────────────────────────────────────────────────────────────┐
│                         USER SERVICE (3 replicas)                         │
│                   Spring Boot 4.0.1 · Java 21 · Port 8082                 │
│                                                                           │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────┐  ┌─────────────┐ │
│  │ UserAccount  │  │ Privacy      │  │ Block         │  │ GDPR        │ │
│  │ Controller   │  │ Controller   │  │ Controller    │  │ Controller  │ │
│  └──────┬───────┘  └──────┬───────┘  └───────┬───────┘  └──────┬──────┘ │
│         │                 │                   │                  │        │
│  ┌──────▼─────────────────▼───────────────────▼──────────────────▼──────┐ │
│  │                     Service Layer (Business Logic)                    │ │
│  │   UserAccountService · PrivacyService · BlockService · GdprService   │ │
│  └──────┬────────────────────────────────────────────┬──────────────────┘ │
│         │                                            │                     │
│  ┌──────▼──────────────┐              ┌──────────────▼───────────────┐    │
│  │   Repository Layer  │              │    Kafka Producer            │    │
│  │   (Spring Data JPA) │              │    (KafkaTemplate)           │    │
│  └──────┬──────────────┘              └──────────────────────────────┘    │
│         │                                                                  │
│  ┌──────▼──────────────┐              ┌──────────────────────────────┐    │
│  │   Redis Cache       │              │    Kafka Consumer            │    │
│  │   (Lettuce Client)  │              │    (user.registered topic)   │    │
│  └─────────────────────┘              └──────────────────────────────┘    │
└───────────────────────────────────────────────────────────────────────────┘
          │                        │                        │
          ▼                        ▼                        ▼
┌──────────────────┐  ┌─────────────────────┐  ┌────────────────────────┐
│  PostgreSQL 16   │  │    Redis 7.x         │  │   Apache Kafka 3.x     │
│  user_db         │  │    Cluster           │  │                        │
│                  │  │                      │  │  Topics (Published):   │
│  • user_accounts │  │  • user:{publicId}   │  │  • user.profile.       │
│  • privacy_      │  │  • blocked:{userId}  │  │    created             │
│    settings      │  │  • privacy:{userId}  │  │  • user.account.       │
│  • blocked_users │  │  • session:{token}   │  │    deleted             │
│  • user_consents │  │                      │  │  • user.preferences.   │
│  • gdpr_requests │  │                      │  │    updated             │
└──────────────────┘  └─────────────────────┘  │                        │
                                                │  Topics (Consumed):    │
                                                │  • user.registered     │
                                                └────────────────────────┘
                                                          │
                              ┌───────────────────────────┼───────────────┐
                              ▼                           ▼               ▼
                    ┌──────────────────┐     ┌──────────────────┐  ┌──────────────┐
                    │  Profile Service │     │  Notification    │  │  Analytics   │
                    │  (profile        │     │  Service         │  │  Service     │
                    │   creation)      │     │  (preferences    │  │  (audit log) │
                    └──────────────────┘     │   updated)       │  └──────────────┘
                                             └──────────────────┘
```

### 1.4 Service Dependencies

| Dependency         | Type      | Protocol  | Purpose                                      |
|--------------------|-----------|-----------|----------------------------------------------|
| Auth Service       | Upstream  | HTTP/gRPC | JWT validation, `auth_user_id` resolution    |
| Profile Service    | Downstream| Kafka     | Triggered by `user.profile.created` event    |
| Notification Svc   | Downstream| Kafka     | Triggered by `user.preferences.updated`      |
| Recommendation Eng | Downstream| Kafka     | Triggered by `user.account.deleted` (purge)  |
| Analytics Service  | Downstream| Kafka     | All user lifecycle events (audit trail)      |
| AWS S3             | External  | HTTPS     | GDPR data export package upload              |

### 1.5 Kafka Topic Ownership

| Topic                         | Role      | Partitions | Retention |
|-------------------------------|-----------|------------|-----------|
| `user.registered`             | Consumed  | 30         | 7 days    |
| `user.profile.created`        | Published | 30         | 7 days    |
| `user.account.deleted`        | Published | 30         | 30 days   |
| `user.preferences.updated`    | Published | 30         | 7 days    |
| `user.blocked`                | Published | 20         | 7 days    |
| `user.gdpr.export.ready`      | Published | 10         | 3 days    |

### 1.6 Kubernetes Deployment Spec

```yaml
# Deployment summary — full manifests in /k8s/user-service/
replicas: 3
resources:
  requests:
    cpu: "256m"
    memory: "512Mi"
  limits:
    cpu: "512m"
    memory: "1Gi"
hpa:
  minReplicas: 3
  maxReplicas: 12
  targetCPUUtilizationPercentage: 70
livenessProbe:
  path: /actuator/health/liveness
  initialDelaySeconds: 30
readinessProbe:
  path: /actuator/health/readiness
  initialDelaySeconds: 20
```

---

## 2. Complete Database DDL

### 2.1 Database: `user_db`

All tables reside in the `user_db` PostgreSQL 16 database within the `users` schema. Connection pool managed by HikariCP: min=5, max=20 per pod instance.

```sql
-- ============================================================
-- EXTENSIONS
-- ============================================================
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "pg_stat_statements";
CREATE EXTENSION IF NOT EXISTS "btree_gist";

-- ============================================================
-- SCHEMA
-- ============================================================
CREATE SCHEMA IF NOT EXISTS users;
SET search_path TO users, public;

-- ============================================================
-- TABLE: user_accounts
-- Scale: ~100M rows at target scale
-- Storage estimate: ~120 bytes avg row → ~12GB base + indexes ~18GB total
-- ============================================================
CREATE TABLE user_accounts (
    id                      BIGSERIAL       PRIMARY KEY,
    public_id               UUID            NOT NULL DEFAULT gen_random_uuid(),
    auth_user_id            UUID            NOT NULL,              -- FK → auth_db.users.public_id (cross-service, enforced in app layer)
    display_name            VARCHAR(50),
    date_of_birth           DATE,
    age_verified            BOOLEAN         NOT NULL DEFAULT FALSE,
    gender                  VARCHAR(30)     CHECK (gender IN (
                                                'MALE','FEMALE','NON_BINARY',
                                                'TRANSGENDER_MALE','TRANSGENDER_FEMALE',
                                                'GENDERQUEER','AGENDER','OTHER'
                                            )),
    sexuality               VARCHAR(30)     CHECK (sexuality IN (
                                                'STRAIGHT','GAY','LESBIAN','BISEXUAL',
                                                'PANSEXUAL','ASEXUAL','DEMISEXUAL',
                                                'FLUID','QUEER','OTHER'
                                            )),
    country_code            VARCHAR(5),                            -- ISO 3166-1 alpha-2
    language_code           VARCHAR(10)     NOT NULL DEFAULT 'en', -- BCP-47
    timezone                VARCHAR(50),                           -- IANA tz database
    account_status          VARCHAR(20)     NOT NULL DEFAULT 'ACTIVE'
                                            CHECK (account_status IN (
                                                'ACTIVE','SUSPENDED','DEACTIVATED',
                                                'PENDING_DELETION','HARD_DELETED'
                                            )),
    onboarding_completed    BOOLEAN         NOT NULL DEFAULT FALSE,
    onboarding_step         INTEGER         NOT NULL DEFAULT 0,    -- 0-6 steps
    last_active_at          TIMESTAMPTZ,
    deletion_requested_at   TIMESTAMPTZ,
    deletion_scheduled_at   TIMESTAMPTZ,
    hard_deleted_at         TIMESTAMPTZ,
    version                 INTEGER         NOT NULL DEFAULT 0,    -- Optimistic locking
    created_at              TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

-- Constraints
ALTER TABLE user_accounts ADD CONSTRAINT uq_user_accounts_public_id    UNIQUE (public_id);
ALTER TABLE user_accounts ADD CONSTRAINT uq_user_accounts_auth_user_id UNIQUE (auth_user_id);

-- Indexes for common query patterns
CREATE INDEX idx_user_accounts_public_id         ON user_accounts (public_id);
CREATE INDEX idx_user_accounts_auth_user_id      ON user_accounts (auth_user_id);
CREATE INDEX idx_user_accounts_account_status    ON user_accounts (account_status)
    WHERE account_status NOT IN ('HARD_DELETED');
CREATE INDEX idx_user_accounts_country_status    ON user_accounts (country_code, account_status)
    WHERE account_status = 'ACTIVE';
CREATE INDEX idx_user_accounts_last_active       ON user_accounts (last_active_at DESC NULLS LAST)
    WHERE account_status = 'ACTIVE';
CREATE INDEX idx_user_accounts_deletion_sched    ON user_accounts (deletion_scheduled_at)
    WHERE deletion_scheduled_at IS NOT NULL;
CREATE INDEX idx_user_accounts_created_at        ON user_accounts (created_at DESC);

-- Auto-update updated_at trigger
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_user_accounts_updated_at
    BEFORE UPDATE ON user_accounts
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- TABLE: privacy_settings
-- Scale: 1:1 with user_accounts → ~100M rows
-- Storage estimate: ~80 bytes avg row → ~8GB base + indexes ~2GB total
-- ============================================================
CREATE TABLE privacy_settings (
    id                      BIGSERIAL   PRIMARY KEY,
    user_id                 BIGINT      NOT NULL UNIQUE REFERENCES user_accounts(id) ON DELETE CASCADE,
    show_age                BOOLEAN     NOT NULL DEFAULT TRUE,
    show_distance           BOOLEAN     NOT NULL DEFAULT TRUE,
    show_online_status      BOOLEAN     NOT NULL DEFAULT TRUE,
    show_read_receipts      BOOLEAN     NOT NULL DEFAULT TRUE,
    who_can_message         VARCHAR(20) NOT NULL DEFAULT 'MATCHES_ONLY'
                                        CHECK (who_can_message IN ('EVERYONE','MATCHES_ONLY','NOBODY')),
    who_can_see_profile     VARCHAR(20) NOT NULL DEFAULT 'EVERYONE'
                                        CHECK (who_can_see_profile IN ('EVERYONE','MATCHES_ONLY','NOBODY')),
    hide_from_contacts      BOOLEAN     NOT NULL DEFAULT FALSE,
    incognito_mode          BOOLEAN     NOT NULL DEFAULT FALSE,   -- Hides from discovery; only visible to current matches
    data_analytics_consent  BOOLEAN     NOT NULL DEFAULT TRUE,
    marketing_consent       BOOLEAN     NOT NULL DEFAULT FALSE,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_privacy_settings_user_id      ON privacy_settings (user_id);
CREATE INDEX idx_privacy_settings_incognito    ON privacy_settings (incognito_mode)
    WHERE incognito_mode = TRUE;

CREATE TRIGGER trg_privacy_settings_updated_at
    BEFORE UPDATE ON privacy_settings
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- TABLE: blocked_users
-- Scale: avg 2 blocks/user → ~200M rows at 100M users
-- Storage estimate: ~60 bytes avg row → ~12GB base + indexes ~6GB total
-- ============================================================
CREATE TABLE blocked_users (
    id          BIGSERIAL   PRIMARY KEY,
    blocker_id  BIGINT      NOT NULL REFERENCES user_accounts(id) ON DELETE CASCADE,
    blocked_id  BIGINT      NOT NULL REFERENCES user_accounts(id) ON DELETE CASCADE,
    reason      VARCHAR(100),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_blocked_users_pair       UNIQUE (blocker_id, blocked_id),
    CONSTRAINT chk_blocked_users_no_self   CHECK (blocker_id != blocked_id)
);

CREATE INDEX idx_blocked_users_blocker_id ON blocked_users (blocker_id);
CREATE INDEX idx_blocked_users_blocked_id ON blocked_users (blocked_id);
CREATE INDEX idx_blocked_users_created_at ON blocked_users (created_at DESC);

-- ============================================================
-- TABLE: user_consents (GDPR audit trail)
-- Scale: avg 5 consent events/user → ~500M rows, append-only
-- Storage estimate: ~150 bytes avg row → ~75GB (partitioned by year recommended)
-- ============================================================
CREATE TABLE user_consents (
    id              BIGSERIAL   PRIMARY KEY,
    user_id         BIGINT      NOT NULL REFERENCES user_accounts(id) ON DELETE CASCADE,
    consent_type    VARCHAR(50) NOT NULL,   -- e.g., 'TERMS_OF_SERVICE', 'PRIVACY_POLICY', 'MARKETING', 'ANALYTICS'
    consent_version VARCHAR(20) NOT NULL,   -- e.g., '2025-01-01'
    granted         BOOLEAN     NOT NULL,
    granted_at      TIMESTAMPTZ,
    revoked_at      TIMESTAMPTZ,
    ip_address      INET,                   -- stored hashed in application layer before persistence
    user_agent      TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_user_consents_user_id       ON user_consents (user_id);
CREATE INDEX idx_user_consents_type_version  ON user_consents (consent_type, consent_version);
CREATE INDEX idx_user_consents_user_type     ON user_consents (user_id, consent_type, created_at DESC);

-- ============================================================
-- TABLE: gdpr_requests
-- Scale: ~1M requests/year at 100M users (1% annual churn)
-- Storage estimate: low volume, ~200 bytes avg row → <1GB
-- ============================================================
CREATE TABLE gdpr_requests (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         BIGINT      NOT NULL REFERENCES user_accounts(id) ON DELETE CASCADE,
    request_type    VARCHAR(30) NOT NULL CHECK (request_type IN (
                                    'DATA_EXPORT','DATA_DELETION','DATA_ACCESS',
                                    'DATA_PORTABILITY','CONSENT_WITHDRAWAL'
                                )),
    status          VARCHAR(20) NOT NULL DEFAULT 'PENDING'
                                CHECK (status IN ('PENDING','IN_PROGRESS','COMPLETED','FAILED')),
    requested_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at    TIMESTAMPTZ,
    download_url    TEXT,                    -- Pre-signed S3 URL, stored encrypted
    expires_at      TIMESTAMPTZ,             -- Pre-signed URL expiry (72 hours)
    error_message   TEXT,
    metadata        JSONB       DEFAULT '{}' -- Arbitrary processing metadata
);

CREATE INDEX idx_gdpr_requests_user_id      ON gdpr_requests (user_id);
CREATE INDEX idx_gdpr_requests_status       ON gdpr_requests (status) WHERE status IN ('PENDING','IN_PROGRESS');
CREATE INDEX idx_gdpr_requests_requested_at ON gdpr_requests (requested_at DESC);
CREATE INDEX idx_gdpr_requests_type_status  ON gdpr_requests (request_type, status);

-- ============================================================
-- PARTITIONING: user_consents by year (recommended at scale)
-- Run annually via migration; shown here for documentation
-- ============================================================
-- ALTER TABLE user_consents PARTITION BY RANGE (created_at);
-- CREATE TABLE user_consents_2024 PARTITION OF user_consents
--     FOR VALUES FROM ('2024-01-01') TO ('2025-01-01');
-- CREATE TABLE user_consents_2025 PARTITION OF user_consents
--     FOR VALUES FROM ('2025-01-01') TO ('2026-01-01');
```

### 2.2 Scale Estimates

| Table             | Row Count (100M users) | Avg Row Size | Estimated Storage |
|-------------------|------------------------|--------------|-------------------|
| `user_accounts`   | 100M                   | 120 bytes    | ~12 GB base       |
| `privacy_settings`| 100M                   | 80 bytes     | ~8 GB base        |
| `blocked_users`   | 200M (2 avg/user)      | 60 bytes     | ~12 GB base       |
| `user_consents`   | 500M (5 avg/user)      | 150 bytes    | ~75 GB base       |
| `gdpr_requests`   | ~5M                    | 200 bytes    | ~1 GB base        |
| **Total w/indexes**| —                     | —            | **~200 GB**       |

**PostgreSQL 16 Optimizations Applied:**
- `pg_partman` for `user_consents` time-based partitioning
- `pg_cron` for nightly `deletion_scheduled_at` cleanup jobs
- Connection pooling via PgBouncer (transaction mode, pool_size=100)
- Read replicas for all `SELECT` queries via Spring Data routing datasource

---

## 3. Complete API Endpoints

**Base URL:** `https://api.yourdatingapp.com/user-service`
**Auth:** All endpoints require `Authorization: Bearer <JWT>` unless noted.
**Content-Type:** `application/json`

---

### 3.1 `GET /v1/users/me` — Get Current User Profile

Returns the authenticated user's full account details.

**Rate Limit:** 60 req/min per user

**Request:**
```http
GET /v1/users/me
Authorization: Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...
```

**Success Response `200 OK`:**
```json
{
  "data": {
    "publicId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "displayName": "Alex",
    "dateOfBirth": "1995-06-15",
    "age": 29,
    "ageVerified": true,
    "gender": "NON_BINARY",
    "sexuality": "BISEXUAL",
    "countryCode": "US",
    "languageCode": "en",
    "timezone": "America/New_York",
    "accountStatus": "ACTIVE",
    "onboardingCompleted": true,
    "onboardingStep": 6,
    "lastActiveAt": "2025-01-15T14:32:00Z",
    "createdAt": "2024-03-01T09:00:00Z",
    "updatedAt": "2025-01-15T14:32:00Z"
  }
}
```

**Error Responses:**
```json
// 401 Unauthorized
{
  "error": {
    "code": "UNAUTHORIZED",
    "message": "Invalid or expired JWT token",
    "requestId": "req_7f8a9b0c1d2e3f4a"
  }
}

// 404 Not Found (user exists in Auth but not yet in User Service — race condition)
{
  "error": {
    "code": "USER_NOT_FOUND",
    "message": "User account not found",
    "requestId": "req_7f8a9b0c1d2e3f4b"
  }
}
```

---

### 3.2 `PUT /v1/users/me` — Update Current User Profile

Updates mutable fields on the authenticated user's account. Immutable fields (`dateOfBirth` after verification, `gender` after 30 days) are rejected.

**Rate Limit:** 10 req/min per user

**Request:**
```json
{
  "displayName": "Alex J.",
  "gender": "NON_BINARY",
  "sexuality": "PANSEXUAL",
  "countryCode": "US",
  "languageCode": "en-US",
  "timezone": "America/Chicago"
}
```

**Success Response `200 OK`:**
```json
{
  "data": {
    "publicId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "displayName": "Alex J.",
    "gender": "NON_BINARY",
    "sexuality": "PANSEXUAL",
    "countryCode": "US",
    "languageCode": "en-US",
    "timezone": "America/Chicago",
    "updatedAt": "2025-01-15T15:00:00Z",
    "version": 4
  }
}
```

**Error Responses:**
```json
// 400 Bad Request — validation failure
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request validation failed",
    "details": [
      { "field": "displayName", "message": "Display name must be between 2 and 50 characters" },
      { "field": "timezone", "message": "Invalid IANA timezone identifier" }
    ],
    "requestId": "req_abc123"
  }
}

// 409 Conflict — optimistic locking failure
{
  "error": {
    "code": "CONCURRENT_MODIFICATION",
    "message": "User account was modified by another request. Please retry.",
    "requestId": "req_abc124"
  }
}

// 422 Unprocessable Entity — immutable field change attempt
{
  "error": {
    "code": "IMMUTABLE_FIELD",
    "message": "Date of birth cannot be changed after age verification",
    "requestId": "req_abc125"
  }
}
```

---

### 3.3 `DELETE /v1/users/me` — Request Account Deletion (GDPR)

Initiates the GDPR-compliant soft-delete pipeline. Account status changes to `PENDING_DELETION`. Hard delete occurs after 30-day grace period via scheduled job.

**Rate Limit:** 2 req/day per user

**Request:**
```json
{
  "reason": "FOUND_PARTNER",
  "feedback": "I found someone special!",
  "confirmDeletion": true
}
```

**Success Response `202 Accepted`:**
```json
{
  "data": {
    "requestId": "del_f1e2d3c4-b5a6-7890-fedc-ba9876543210",
    "status": "PENDING_DELETION",
    "deletionScheduledAt": "2025-02-14T15:00:00Z",
    "gracePeriodEndsAt": "2025-02-14T15:00:00Z",
    "message": "Your account will be permanently deleted on 2025-02-14. You may reactivate before this date."
  }
}
```

**Error Responses:**
```json
// 400 Bad Request — missing confirmation
{
  "error": {
    "code": "DELETION_NOT_CONFIRMED",
    "message": "confirmDeletion must be true to proceed with account deletion",
    "requestId": "req_del001"
  }
}

// 409 Conflict — already pending deletion
{
  "error": {
    "code": "DELETION_ALREADY_REQUESTED",
    "message": "Account deletion is already scheduled for 2025-02-14T15:00:00Z",
    "requestId": "req_del002"
  }
}
```

---

### 3.4 `GET /v1/users/me/privacy` — Get Privacy Settings

**Rate Limit:** 60 req/min per user

**Response `200 OK`:**
```json
{
  "data": {
    "showAge": true,
    "showDistance": false,
    "showOnlineStatus": true,
    "showReadReceipts": false,
    "whoCanMessage": "MATCHES_ONLY",
    "whoCanSeeProfile": "EVERYONE",
    "hideFromContacts": false,
    "incognitoMode": false,
    "dataAnalyticsConsent": true,
    "marketingConsent": false,
    "updatedAt": "2025-01-10T08:00:00Z"
  }
}
```

---

### 3.5 `PUT /v1/users/me/privacy` — Update Privacy Settings

**Rate Limit:** 20 req/min per user

**Request:**
```json
{
  "showAge": false,
  "showDistance": false,
  "showOnlineStatus": false,
  "showReadReceipts": false,
  "whoCanMessage": "MATCHES_ONLY",
  "whoCanSeeProfile": "EVERYONE",
  "hideFromContacts": true,
  "incognitoMode": true,
  "dataAnalyticsConsent": true,
  "marketingConsent": false
}
```

**Success Response `200 OK`:**
```json
{
  "data": {
    "showAge": false,
    "showDistance": false,
    "showOnlineStatus": false,
    "showReadReceipts": false,
    "whoCanMessage": "MATCHES_ONLY",
    "whoCanSeeProfile": "EVERYONE",
    "hideFromContacts": true,
    "incognitoMode": true,
    "dataAnalyticsConsent": true,
    "marketingConsent": false,
    "updatedAt": "2025-01-15T15:30:00Z"
  },
  "meta": {
    "incognito_notice": "Incognito mode activated. You will not appear in discovery feeds."
  }
}
```

**Error Responses:**
```json
// 400 Bad Request
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid value for whoCanMessage",
    "details": [
      { "field": "whoCanMessage", "message": "Must be one of: EVERYONE, MATCHES_ONLY, NOBODY" }
    ],
    "requestId": "req_priv001"
  }
}
```

---

### 3.6 `GET /v1/users/me/blocked` — Get Block List

**Rate Limit:** 30 req/min per user

**Query Parameters:**
- `page` (default: 0) — Zero-based page number
- `size` (default: 20, max: 100) — Page size
- `sort` (default: `createdAt,desc`)

**Response `200 OK`:**
```json
{
  "data": [
    {
      "blockedUserId": "b2c3d4e5-f6a7-8901-bcde-f23456789012",
      "displayName": "Blocked User",
      "reason": "HARASSMENT",
      "blockedAt": "2025-01-01T12:00:00Z"
    }
  ],
  "meta": {
    "page": 0,
    "size": 20,
    "totalElements": 1,
    "totalPages": 1,
    "hasNext": false
  }
}
```

---

### 3.7 `POST /v1/users/me/blocked/{userId}` — Block a User

**Rate Limit:** 30 req/hour per user

**Path Parameters:** `userId` — public UUID of user to block

**Request:**
```json
{
  "reason": "INAPPROPRIATE_CONTENT"
}
```

**Success Response `201 Created`:**
```json
{
  "data": {
    "blockedUserId": "c3d4e5f6-a7b8-9012-cdef-345678901234",
    "reason": "INAPPROPRIATE_CONTENT",
    "blockedAt": "2025-01-15T16:00:00Z"
  }
}
```

**Error Responses:**
```json
// 404 Not Found
{
  "error": {
    "code": "USER_NOT_FOUND",
    "message": "User to block was not found",
    "requestId": "req_blk001"
  }
}

// 409 Conflict — already blocked
{
  "error": {
    "code": "ALREADY_BLOCKED",
    "message": "This user is already blocked",
    "requestId": "req_blk002"
  }
}

// 422 Unprocessable Entity — self-block
{
  "error": {
    "code": "CANNOT_BLOCK_SELF",
    "message": "You cannot block yourself",
    "requestId": "req_blk003"
  }
}
```

---

### 3.8 `DELETE /v1/users/me/blocked/{userId}` — Unblock a User

**Rate Limit:** 30 req/hour per user

**Success Response `204 No Content`**

**Error Response:**
```json
// 404 Not Found — not currently blocked
{
  "error": {
    "code": "BLOCK_NOT_FOUND",
    "message": "No active block found for the specified user",
    "requestId": "req_ublk001"
  }
}
```

---

### 3.9 `POST /v1/users/me/gdpr/export` — Request Data Export

Initiates a GDPR data export. Aggregates data from all services and packages as a ZIP archive uploaded to S3 with a pre-signed download URL delivered by email.

**Rate Limit:** 1 req/30 days per user

**Request:**
```json
{
  "includeServices": ["USER","PROFILE","MATCHES","MESSAGES","BILLING"],
  "format": "JSON"
}
```

**Success Response `202 Accepted`:**
```json
{
  "data": {
    "requestId": "gdpr_d4e5f6a7-b8c9-0123-defa-567890123456",
    "status": "PENDING",
    "requestType": "DATA_EXPORT",
    "requestedAt": "2025-01-15T16:00:00Z",
    "estimatedCompletionAt": "2025-01-15T18:00:00Z",
    "message": "Your data export is being prepared. You will receive an email with a download link within 2 hours."
  }
}
```

**Error Response:**
```json
// 429 Too Many Requests
{
  "error": {
    "code": "EXPORT_RATE_LIMIT",
    "message": "A data export was already requested on 2024-12-20. You may request another export after 2025-01-19.",
    "retryAfter": "2025-01-19T16:00:00Z",
    "requestId": "req_gdpr001"
  }
}
```

---

### 3.10 `GET /v1/users/me/gdpr/requests` — Get GDPR Request History

**Rate Limit:** 30 req/min per user

**Response `200 OK`:**
```json
{
  "data": [
    {
      "requestId": "gdpr_d4e5f6a7-b8c9-0123-defa-567890123456",
      "requestType": "DATA_EXPORT",
      "status": "COMPLETED",
      "requestedAt": "2025-01-15T16:00:00Z",
      "completedAt": "2025-01-15T17:45:00Z",
      "downloadUrl": "https://s3.amazonaws.com/gdpr-exports/...?X-Amz-Expires=259200",
      "expiresAt": "2025-01-18T17:45:00Z"
    },
    {
      "requestId": "gdpr_e5f6a7b8-c9d0-1234-efab-678901234567",
      "requestType": "DATA_DELETION",
      "status": "PENDING",
      "requestedAt": "2025-01-15T16:30:00Z",
      "completedAt": null,
      "downloadUrl": null,
      "expiresAt": null
    }
  ],
  "meta": {
    "totalElements": 2
  }
}
```

---

### 3.11 `PUT /v1/users/me/onboarding` — Update Onboarding Progress

**Rate Limit:** 60 req/min per user

**Request:**
```json
{
  "step": 3,
  "data": {
    "displayName": "Alex",
    "dateOfBirth": "1995-06-15",
    "gender": "NON_BINARY"
  }
}
```

**Success Response `200 OK`:**
```json
{
  "data": {
    "currentStep": 3,
    "totalSteps": 6,
    "completedSteps": [0, 1, 2, 3],
    "onboardingCompleted": false,
    "nextStep": {
      "stepNumber": 4,
      "stepName": "PHOTO_UPLOAD",
      "required": true,
      "description": "Upload at least one profile photo"
    }
  }
}
```

---

### 3.12 `GET /v1/users/{publicId}` — Get Public User View

Limited view of another user's public profile. Privacy settings enforced.

**Rate Limit:** 120 req/min per user

**Path Parameters:** `publicId` — public UUID of target user

**Response `200 OK`:**
```json
{
  "data": {
    "publicId": "d4e5f6a7-b8c9-0123-defa-567890123456",
    "displayName": "Jordan",
    "age": 27,
    "gender": "MALE",
    "countryCode": "GB",
    "isOnline": true,
    "lastActiveAt": null
  },
  "meta": {
    "privacyFiltersApplied": ["age_hidden_by_user", "distance_hidden_by_user"]
  }
}
```

**Error Response:**
```json
// 403 Forbidden — requester is blocked by target user
{
  "error": {
    "code": "ACCESS_DENIED",
    "message": "Profile not accessible",
    "requestId": "req_pub001"
  }
}
```

---

### 3.13 `POST /v1/users/me/consents` — Record Consent

**Rate Limit:** 20 req/min per user

**Request:**
```json
{
  "consentType": "MARKETING",
  "consentVersion": "2025-01-01",
  "granted": true
}
```

**Success Response `201 Created`:**
```json
{
  "data": {
    "consentType": "MARKETING",
    "consentVersion": "2025-01-01",
    "granted": true,
    "grantedAt": "2025-01-15T16:45:00Z"
  }
}
```

---

### 3.14 `GET /v1/users/me/consents` — Get Consent History

**Rate Limit:** 30 req/min per user

**Response `200 OK`:**
```json
{
  "data": [
    {
      "consentType": "TERMS_OF_SERVICE",
      "consentVersion": "2025-01-01",
      "granted": true,
      "grantedAt": "2024-03-01T09:00:00Z",
      "revokedAt": null
    },
    {
      "consentType": "MARKETING",
      "consentVersion": "2025-01-01",
      "granted": false,
      "grantedAt": null,
      "revokedAt": "2025-01-10T10:00:00Z"
    }
  ]
}
```

---

## 4. User Stories & Acceptance Criteria

### 4.1 US-001: User Profile Retrieval

**As a** registered user,
**I want to** retrieve my complete profile information,
**So that** I can verify my data and understand what is stored about me.

**Acceptance Criteria:**
- AC1: Returns 200 with full profile when JWT is valid and user exists
- AC2: Returns age calculated from `date_of_birth`, not stored age field
- AC3: Returns 401 when JWT is missing, malformed, or expired
- AC4: Returns 404 when JWT is valid but no user record exists (e.g., Kafka lag after registration)
- AC5: Response time < 50ms p99 when Redis cache is warm
- AC6: Response time < 150ms p99 when cache miss triggers DB read
- AC7: Cache TTL is 10 minutes; cache is invalidated on any `PUT /v1/users/me` call
- AC8: PII fields (date_of_birth exact value) are never logged in application logs

**Edge Cases:**
- User account in `PENDING_DELETION` state — returns profile with `accountStatus: PENDING_DELETION` and `deletionScheduledAt`
- User with incomplete onboarding — returns profile with `onboardingCompleted: false` and current `onboardingStep`
- Concurrent requests — idempotent, all return the same cached value

---

### 4.2 US-002: Privacy Settings Update

**As a** user concerned about my privacy,
**I want to** control who can see my profile and contact me,
**So that** I feel safe using the app.

**Acceptance Criteria:**
- AC1: All privacy fields update atomically within a single database transaction
- AC2: `incognito_mode = true` immediately invalidates user's appearance in Recommendation Engine (via Kafka event)
- AC3: `who_can_message` change publishes `user.preferences.updated` Kafka event so Chat Service enforces the rule
- AC4: Privacy settings cache (`privacy:{userId}`) is invalidated immediately on any update
- AC5: `marketingConsent` change records a new entry in `user_consents` table for GDPR audit trail
- AC6: Returns 200 with the full updated settings object
- AC7: Changes persisted within 100ms (synchronous DB write before 200 response)

**Edge Cases:**
- Setting `whoCanMessage = NOBODY` while having open conversations — Chat Service receives event and enforces restriction
- Enabling incognito mode — existing matches remain visible but user disappears from new discovery feeds
- Revoking `dataAnalyticsConsent` — must trigger `user.preferences.updated` event with analytics opt-out flag

---

### 4.3 US-003: GDPR Account Deletion

**As a** user exercising my right to erasure,
**I want to** permanently delete my account and all associated data,
**So that** I comply with my GDPR rights and the app complies with GDPR Article 17.

**Acceptance Criteria:**
- AC1: `confirmDeletion: true` is required; any other value or missing field returns 400
- AC2: `account_status` changes to `PENDING_DELETION` and `deletion_scheduled_at` is set to NOW() + 30 days
- AC3: `deletion_requested_at` is set to NOW()
- AC4: `user.account.deleted` Kafka event is published immediately (for downstream services to soft-delete)
- AC5: User can still log in and access their data during the 30-day grace period
- AC6: A dedicated GDPR pipeline hard-deletes the account on `deletion_scheduled_at` date
- AC7: Hard delete must anonymize/delete: profile photos (S3), messages (Chat DB), matches (Match DB), billing records (Billing DB anonymized)
- AC8: Hard delete completes within 30 days of request per GDPR Article 17(3)
- AC9: User receives email confirmation with deletion date within 1 minute of request
- AC10: If user re-activates account within grace period, `account_status` reverts to `ACTIVE` and deletion fields are cleared

**Edge Cases:**
- User with active Premium subscription — subscription is cancelled immediately, prorated refund processed
- User who is a conversation initiator — messages anonymized, not deleted (to preserve context for other party)
- Race condition where deletion request and login occur simultaneously — deletion wins; auth tokens invalidated

---

### 4.4 US-004: Block Management

**As a** user who has experienced unwanted contact,
**I want to** block another user,
**So that** they can no longer see my profile, match with me, or message me.

**Acceptance Criteria:**
- AC1: Block is recorded in DB and `blocked:{userId}` cache is invalidated
- AC2: `user.blocked` Kafka event is published; consumed by Match, Chat, and Recommendation services
- AC3: Bidirectional enforcement: blocked user cannot message or see the blocker's profile
- AC4: Existing matches between blocker and blocked user are removed by Match Service on receiving event
- AC5: Self-block returns 422 with `CANNOT_BLOCK_SELF` error code
- AC6: Duplicate block returns 409 with `ALREADY_BLOCKED` error code
- AC7: Block list is paginated; default 20 per page
- AC8: Block list response does NOT include full profile data of blocked users (privacy protection)

---

### 4.5 US-005: Data Export

**As a** user exercising my right to data portability,
**I want to** download all data the app holds about me,
**So that** I can review it and/or port it to another service.

**Acceptance Criteria:**
- AC1: Export includes data from: User Service, Profile Service, Match Service, Chat Service, Billing Service
- AC2: Export packaged as ZIP containing JSON files per service
- AC3: Pre-signed S3 URL expires after 72 hours
- AC4: Download link delivered to registered email within 2 hours of request
- AC5: Only 1 export allowed per 30 days (rate limited by `gdpr_requests` table query)
- AC6: Export contains no raw passwords, OAuth tokens, or internal system IDs
- AC7: Request status is queryable via `GET /v1/users/me/gdpr/requests`

---

## 5. Kafka Events Published & Consumed

### 5.1 Events Consumed

#### `user.registered` (from Auth Service)

Triggered when a new user completes authentication registration. User Service creates the `user_accounts` and `privacy_settings` records.

**Consumer Group:** `user-service-registration`
**Topic:** `user.registered`
**Partitioning Key:** `authUserId`

```json
{
  "eventId": "evt_f1e2d3c4-b5a6-7890-fedc-ba9876543210",
  "eventType": "user.registered",
  "version": "1.0",
  "timestamp": "2025-01-15T09:00:00Z",
  "source": "auth-service",
  "data": {
    "authUserId": "550e8400-e29b-41d4-a716-446655440000",
    "email": "user@example.com",
    "registrationMethod": "GOOGLE_OAUTH",
    "ipAddress": "203.0.113.45",
    "userAgent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)",
    "countryCode": "US",
    "languageCode": "en",
    "timezone": "America/New_York"
  }
}
```

**Processing Logic:**
```
1. Check if user_accounts record already exists for authUserId (idempotency)
2. If not exists:
   a. Create user_accounts record with ACTIVE status
   b. Create privacy_settings record with defaults
   c. Create user_consents record for TERMS_OF_SERVICE and PRIVACY_POLICY
   d. Publish user.profile.created event
3. If exists: log warning and discard (duplicate event)
```

---

### 5.2 Events Published

#### `user.profile.created`

Published immediately after a new `user_accounts` record is successfully created.

**Topic:** `user.profile.created`
**Partitioning Key:** `publicId`

```json
{
  "eventId": "evt_a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "eventType": "user.profile.created",
  "version": "1.0",
  "timestamp": "2025-01-15T09:00:05Z",
  "source": "user-service",
  "data": {
    "publicId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "authUserId": "550e8400-e29b-41d4-a716-446655440000",
    "displayName": null,
    "gender": null,
    "countryCode": "US",
    "languageCode": "en",
    "timezone": "America/New_York",
    "accountStatus": "ACTIVE",
    "onboardingCompleted": false,
    "onboardingStep": 0,
    "createdAt": "2025-01-15T09:00:05Z"
  }
}
```

**Consumers:** Profile Service (creates empty profile record), Analytics Service

---

#### `user.account.deleted`

Published when a user requests account deletion (`PENDING_DELETION`) and again when hard delete completes.

**Topic:** `user.account.deleted`
**Partitioning Key:** `publicId`

```json
{
  "eventId": "evt_b2c3d4e5-f6a7-8901-bcde-f23456789012",
  "eventType": "user.account.deleted",
  "version": "1.0",
  "timestamp": "2025-01-15T16:00:00Z",
  "source": "user-service",
  "data": {
    "publicId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "deletionPhase": "SOFT_DELETE",
    "deletionRequestedAt": "2025-01-15T16:00:00Z",
    "hardDeleteScheduledAt": "2025-02-14T16:00:00Z",
    "reason": "USER_REQUESTED"
  }
}
```

**Consumers:** Profile Service, Match Service, Chat Service, Recommendation Engine, Billing Service, Analytics Service

---

#### `user.preferences.updated`

Published on any privacy settings or account preference change.

**Topic:** `user.preferences.updated`
**Partitioning Key:** `publicId`

```json
{
  "eventId": "evt_c3d4e5f6-a7b8-9012-cdef-345678901234",
  "eventType": "user.preferences.updated",
  "version": "1.0",
  "timestamp": "2025-01-15T15:30:00Z",
  "source": "user-service",
  "data": {
    "publicId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "changedFields": ["incognito_mode", "who_can_message"],
    "preferences": {
      "incognitoMode": true,
      "whoCanMessage": "MATCHES_ONLY",
      "whoCanSeeProfile": "EVERYONE",
      "showOnlineStatus": false,
      "dataAnalyticsConsent": true,
      "marketingConsent": false
    }
  }
}
```

---

#### `user.blocked`

Published when a user blocks another user.

**Topic:** `user.blocked`
**Partitioning Key:** `blockerPublicId`

```json
{
  "eventId": "evt_d4e5f6a7-b8c9-0123-defa-567890123456",
  "eventType": "user.blocked",
  "version": "1.0",
  "timestamp": "2025-01-15T16:00:00Z",
  "source": "user-service",
  "data": {
    "blockerPublicId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "blockedPublicId": "b2c3d4e5-f6a7-8901-bcde-f23456789012",
    "reason": "HARASSMENT",
    "blockedAt": "2025-01-15T16:00:00Z"
  }
}
```

**Consumers:** Match Service (remove existing matches), Chat Service (block messaging), Recommendation Engine (exclude from discovery)

---

#### `user.gdpr.export.ready`

Published when a GDPR data export has been packaged and uploaded to S3.

**Topic:** `user.gdpr.export.ready`
**Partitioning Key:** `publicId`

```json
{
  "eventId": "evt_e5f6a7b8-c9d0-1234-efab-678901234567",
  "eventType": "user.gdpr.export.ready",
  "version": "1.0",
  "timestamp": "2025-01-15T17:45:00Z",
  "source": "user-service",
  "data": {
    "publicId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "requestId": "gdpr_d4e5f6a7-b8c9-0123-defa-567890123456",
    "downloadUrlExpiry": "2025-01-18T17:45:00Z",
    "fileSizeBytes": 2457600
  }
}
```

**Consumers:** Notification Service (sends email with download link)

---

## 6. Redis Caching Strategy

### 6.1 Cache Architecture

Redis 7.x cluster (3 primary + 3 replica nodes) with consistent hashing. All caches use JSON serialization via Jackson.

```
┌─────────────────────────────────────────────────────────────┐
│                     Redis 7.x Cluster                        │
│                                                             │
│  Shard 1               Shard 2               Shard 3        │
│  ┌─────────────┐       ┌─────────────┐       ┌───────────┐ │
│  │ user:*      │       │ blocked:*   │       │ privacy:* │ │
│  │ (10min TTL) │       │ (5min TTL)  │       │ (15m TTL) │ │
│  └─────────────┘       └─────────────┘       └───────────┘ │
└─────────────────────────────────────────────────────────────┘
```

### 6.2 User Profile Cache

| Key Pattern         | Value Type | TTL    | Invalidation Trigger           |
|---------------------|------------|--------|--------------------------------|
| `user:{publicId}`   | JSON String| 10 min | `PUT /v1/users/me`             |
| `user:id:{id}`      | String     | 10 min | Same as above (internal ID map)|

**Key Example:** `user:a1b2c3d4-e5f6-7890-abcd-ef1234567890`

**Cached Value:**
```json
{
  "id": 10000001,
  "publicId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "displayName": "Alex",
  "dateOfBirth": "1995-06-15",
  "age": 29,
  "ageVerified": true,
  "gender": "NON_BINARY",
  "sexuality": "BISEXUAL",
  "countryCode": "US",
  "languageCode": "en",
  "timezone": "America/New_York",
  "accountStatus": "ACTIVE",
  "onboardingCompleted": true,
  "lastActiveAt": "2025-01-15T14:32:00Z"
}
```

**Cache-Aside Pattern Implementation:**
```
1. Request arrives for GET /v1/users/me
2. Check Redis: GET user:{publicId}
3. Cache HIT → deserialize and return (target: ~85% hit rate)
4. Cache MISS → query PostgreSQL → serialize → SET user:{publicId} EX 600 → return
5. On PUT /v1/users/me success → DEL user:{publicId} (cache invalidation)
```

### 6.3 Block List Cache

| Key Pattern          | Value Type | TTL   | Invalidation Trigger           |
|----------------------|------------|-------|--------------------------------|
| `blocked:{userId}`   | JSON Array | 5 min | POST/DELETE /v1/users/me/blocked|

**Key Example:** `blocked:10000001`

**Cached Value:**
```json
[10000002, 10000003, 10000099]
```
*Stores internal IDs for O(1) lookup in block-check hot path.*

### 6.4 Privacy Settings Cache

| Key Pattern          | Value Type | TTL    | Invalidation Trigger          |
|----------------------|------------|--------|-------------------------------|
| `privacy:{userId}`   | JSON String| 15 min | `PUT /v1/users/me/privacy`    |

**Key Example:** `privacy:10000001`

### 6.5 Cache Stampede Prevention

```java
// Probabilistic early expiration (PER algorithm)
// Prevents thundering herd on TTL expiry for hot keys
@Cacheable(value = "userProfile", key = "#publicId",
           condition = "#result != null",
           unless = "#result == null")
public UserProfileDto getUserProfile(UUID publicId) {
    // Spring Cache abstraction handles PER via custom CacheManager
}
```

---

## 7. Security & GDPR Compliance

### 7.1 Authentication & Authorization

- **JWT Validation:** RS256 asymmetric signed tokens, validated against Auth Service's JWKS endpoint
- **Token Claims Required:** `sub` (authUserId), `iat`, `exp`, `jti` (replay prevention)
- **Token Expiry:** Access token 15 minutes; Refresh token 30 days (handled by Auth Service)
- **Scope-based Access:** `user:read`, `user:write`, `user:admin` scopes enforced per endpoint
- **mTLS:** All inter-service communication uses mutual TLS via Istio service mesh

### 7.2 PII Encryption at Rest

Sensitive fields encrypted using AES-256-GCM before persistence, decrypted on read:

| Field           | Encryption       | Notes                              |
|-----------------|------------------|------------------------------------|
| `date_of_birth` | AES-256-GCM      | Key rotation quarterly             |
| `ip_address`    | SHA-256 Hash     | In `user_consents` — one-way hash  |
| GDPR download URL| AES-256-GCM     | Encrypted column in `gdpr_requests`|

**Key Management:** AWS KMS with envelope encryption. Data keys cached in memory for 60 seconds max.

### 7.3 GDPR Compliance

#### Right to Erasure (Article 17)

```
Day 0:   User submits DELETE /v1/users/me
         → account_status = PENDING_DELETION
         → deletion_scheduled_at = NOW() + 30 days
         → Kafka: user.account.deleted (SOFT_DELETE phase)
         → All downstream services soft-delete user data

Day 1-29: Grace period
         → User may reactivate account
         → Account visible only to authenticated user (not in discovery)

Day 30:  Scheduled job (pg_cron + Spring Batch) triggers hard delete:
         → Anonymize messages in Chat DB (sender_id → NULL)
         → Delete profile photos from S3
         → Delete match records from Match DB
         → Anonymize billing records (keep for 7 years per tax law)
         → Delete user_accounts, privacy_settings, blocked_users records
         → Set hard_deleted_at timestamp on anonymized stub record
         → Kafka: user.account.deleted (HARD_DELETE phase)
```

#### Right to Data Access (Article 15) & Portability (Article 20)

- Export contains ALL personal data: account info, profile, photos manifest, match history, message history, payment history
- Delivered within 2 hours (SLA) — GDPR requires 30 days maximum
- JSON format for machine readability (portability compliance)
- Export ZIP encrypted with user's registered email as additional access factor

#### Consent Management

| Consent Type        | Default | Version Tracking | Re-consent Required         |
|---------------------|---------|------------------|-----------------------------|
| TERMS_OF_SERVICE    | Required| ✅ Yes           | On each TOS version change  |
| PRIVACY_POLICY      | Required| ✅ Yes           | On each policy change       |
| DATA_ANALYTICS      | Opt-in  | ✅ Yes           | Annually                    |
| MARKETING           | Opt-out | ✅ Yes           | No (persisted choice)       |
| LOCATION_SERVICES   | Opt-in  | ✅ Yes           | On permission change        |

### 7.4 CCPA Compliance

- **Right to Know:** Fulfilled by GDPR export (`POST /v1/users/me/gdpr/export`)
- **Right to Delete:** Fulfilled by GDPR deletion pipeline
- **Right to Opt-Out of Sale:** `data_analytics_consent = false` signals opt-out to Analytics Service
- **Non-Discrimination:** No service degradation based on privacy choices

### 7.5 Security Controls

```yaml
# application-security.yml
security:
  rate-limiting:
    enabled: true
    default-limit: 60/minute
    burst-capacity: 120
  input-validation:
    max-request-size: 10KB
    sql-injection-prevention: true   # Spring Data JPA parameterized queries
    xss-prevention: true             # Jackson HTML escaping enabled
  headers:
    x-content-type-options: nosniff
    x-frame-options: DENY
    strict-transport-security: max-age=31536000; includeSubDomains
  cors:
    allowed-origins: ["https://app.yourdatingapp.com"]
    allowed-methods: [GET, POST, PUT, DELETE]
```

---

## 8. Monitoring, Observability & SLAs

### 8.1 Service Level Objectives

| Metric                     | Target        | Alert Threshold |
|----------------------------|---------------|-----------------|
| Availability               | 99.99% uptime | < 99.95%        |
| p50 API latency            | < 20ms        | > 50ms          |
| p95 API latency            | < 50ms        | > 100ms         |
| p99 API latency            | < 100ms       | > 200ms         |
| Error rate (5xx)           | < 0.01%       | > 0.1%          |
| Cache hit rate             | > 85%         | < 75%           |
| Kafka consumer lag         | < 1000 msgs   | > 5000 msgs     |

### 8.2 Prometheus Metrics

```java
// Custom metrics exposed at /actuator/prometheus

// Counter: total requests by endpoint and status
Counter.builder("user_service.http.requests.total")
    .tag("method", method)
    .tag("endpoint", endpoint)
    .tag("status", statusCode)
    .register(meterRegistry);

// Histogram: request duration
Timer.builder("user_service.http.request.duration")
    .tag("endpoint", endpoint)
    .publishPercentiles(0.5, 0.95, 0.99)
    .register(meterRegistry);

// Gauge: active users (cached count, refreshed every 5min)
Gauge.builder("user_service.active_users.total", this, UserMetrics::getActiveUserCount)
    .register(meterRegistry);

// Counter: GDPR requests by type
Counter.builder("user_service.gdpr.requests.total")
    .tag("type", requestType)
    .tag("status", status)
    .register(meterRegistry);

// Counter: Kafka events published/consumed
Counter.builder("user_service.kafka.events.published")
    .tag("topic", topic)
    .register(meterRegistry);

Counter.builder("user_service.kafka.events.consumed")
    .tag("topic", topic)
    .tag("status", "success|failure")
    .register(meterRegistry);
```

### 8.3 Health Checks

```yaml
# Spring Actuator endpoints
management:
  endpoints:
    web:
      exposure:
        include: health, info, metrics, prometheus
  health:
    show-details: when-authorized
    livenessstate:
      enabled: true
    readinessstate:
      enabled: true
    db:
      enabled: true          # PostgreSQL connectivity
    redis:
      enabled: true          # Redis connectivity
    kafka:
      enabled: true          # Kafka broker connectivity
    diskspace:
      enabled: true
```

### 8.4 Distributed Tracing

```yaml
# Micrometer Tracing + Jaeger
tracing:
  sampling:
    probability: 0.1          # 10% sampling in production
  propagation:
    type: w3c                 # W3C TraceContext standard
  baggage:
    correlation:
      enabled: true
      fields: [userId, requestId]
```

### 8.5 Alerting Rules (Prometheus AlertManager)

```yaml
groups:
  - name: user-service
    rules:
      - alert: UserServiceHighErrorRate
        expr: rate(user_service_http_requests_total{status=~"5.."}[5m]) > 0.001
        for: 2m
        labels:
          severity: critical
          team: platform-eng
        annotations:
          summary: "User Service error rate > 0.1%"

      - alert: UserServiceHighLatency
        expr: histogram_quantile(0.99, user_service_http_request_duration_bucket) > 0.2
        for: 5m
        labels:
          severity: warning

      - alert: UserServiceKafkaConsumerLag
        expr: kafka_consumer_group_lag{group="user-service-registration"} > 5000
        for: 3m
        labels:
          severity: critical
```

---

## 9. Testing Strategy

### 9.1 Coverage Targets

| Layer               | Target Coverage | Tool                    |
|---------------------|-----------------|-------------------------|
| Unit Tests          | 85%             | JUnit 5 + Mockito       |
| Integration Tests   | Key flows 100%  | Spring Boot Test        |
| Contract Tests      | All APIs        | Spring Cloud Contract   |
| E2E Tests           | Critical paths  | TestContainers + REST Assured |
| Performance Tests   | SLO validation  | Gatling                 |

### 9.2 Unit Test Examples

```java
// UserAccountServiceTest.java
@ExtendWith(MockitoExtension.class)
class UserAccountServiceTest {

    @Mock private UserAccountRepository userAccountRepository;
    @Mock private PrivacySettingsRepository privacySettingsRepository;
    @Mock private KafkaTemplate<String, Object> kafkaTemplate;
    @Mock private RedisTemplate<String, Object> redisTemplate;

    @InjectMocks private UserAccountService userAccountService;

    @Test
    @DisplayName("Should create user account from user.registered Kafka event")
    void shouldCreateUserAccountFromRegistrationEvent() {
        // Given
        UserRegisteredEvent event = UserRegisteredEvent.builder()
            .authUserId(UUID.randomUUID())
            .email("test@example.com")
            .countryCode("US")
            .languageCode("en")
            .build();
        when(userAccountRepository.existsByAuthUserId(event.getAuthUserId())).thenReturn(false);
        when(userAccountRepository.save(any())).thenAnswer(i -> i.getArgument(0));

        // When
        userAccountService.handleUserRegistered(event);

        // Then
        verify(userAccountRepository).save(argThat(u ->
            u.getAuthUserId().equals(event.getAuthUserId()) &&
            u.getAccountStatus() == AccountStatus.ACTIVE &&
            !u.isOnboardingCompleted()
        ));
        verify(kafkaTemplate).send(eq("user.profile.created"), anyString(), any());
    }

    @Test
    @DisplayName("Should be idempotent for duplicate user.registered events")
    void shouldBeIdempotentForDuplicateRegistrationEvents() {
        // Given
        UUID authUserId = UUID.randomUUID();
        when(userAccountRepository.existsByAuthUserId(authUserId)).thenReturn(true);

        // When
        userAccountService.handleUserRegistered(
            UserRegisteredEvent.builder().authUserId(authUserId).build()
        );

        // Then
        verify(userAccountRepository, never()).save(any());
        verify(kafkaTemplate, never()).send(anyString(), any(), any());
    }

    @Test
    @DisplayName("Should schedule deletion 30 days in future")
    void shouldScheduleDeletionThirtyDaysInFuture() {
        // Given
        UserAccount user = createActiveUser();
        AccountDeletionRequest request = new AccountDeletionRequest("FOUND_PARTNER", "", true);
        when(userAccountRepository.findByAuthUserId(any())).thenReturn(Optional.of(user));

        // When
        userAccountService.requestAccountDeletion(user.getAuthUserId(), request);

        // Then
        verify(userAccountRepository).save(argThat(u ->
            u.getAccountStatus() == AccountStatus.PENDING_DELETION &&
            u.getDeletionScheduledAt().isAfter(OffsetDateTime.now().plusDays(29))
        ));
    }
}
```

### 9.3 Integration Tests with TestContainers

```java
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@Testcontainers
class UserAccountIntegrationTest {

    @Container
    static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:16")
        .withDatabaseName("user_db_test");

    @Container
    static GenericContainer<?> redis = new GenericContainer<>("redis:7-alpine")
        .withExposedPorts(6379);

    @Container
    static KafkaContainer kafka = new KafkaContainer(
        DockerImageName.parse("confluentinc/cp-kafka:7.5.0"));

    @Test
    @DisplayName("Full user lifecycle: register → update → privacy → delete")
    void fullUserLifecycle(@Autowired TestRestTemplate restTemplate) {
        // Simulate user.registered Kafka event
        // Assert user_accounts record created
        // Call PUT /v1/users/me and assert update
        // Call PUT /v1/users/me/privacy and assert cache invalidation
        // Call DELETE /v1/users/me and assert PENDING_DELETION status
        // Assert user.account.deleted Kafka event published
    }
}
```

### 9.4 Contract Testing

```yaml
# Spring Cloud Contract — GET /v1/users/me
description: "Returns current user profile for valid JWT"
request:
  method: GET
  url: /v1/users/me
  headers:
    Authorization: "Bearer valid-jwt-token"
response:
  status: 200
  headers:
    Content-Type: application/json
  body:
    data:
      publicId: anyNonEmptyString()
      displayName: anyNonEmptyString()
      accountStatus: "ACTIVE"
```

### 9.5 Performance Test Targets (Gatling)

```scala
// UserServiceLoadTest.scala
val getUserProfile = scenario("GET /v1/users/me")
  .exec(http("get_profile")
    .get("/v1/users/me")
    .header("Authorization", "Bearer ${token}")
    .check(status.is(200))
    .check(responseTimeInMillis.lt(100)))  // p99 < 100ms

setUp(
  getUserProfile.inject(
    rampUsersPerSec(100).to(10000).during(60.seconds),  // Ramp to 10k RPS
    constantUsersPerSec(10000).during(300.seconds)       // Sustain 10k RPS
  )
).assertions(
  global.responseTime.percentile3.lt(100),  // p99 < 100ms
  global.successfulRequests.percent.gt(99.99)
)
```

---

*Document maintained by Platform Engineering Team. For questions or updates, open a ticket in the `user-service` project board.*
