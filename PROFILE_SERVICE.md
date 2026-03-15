# Profile Service — Comprehensive Technical Documentation

> **Stack:** Java 21 · Spring Boot 4.0.1 · PostgreSQL 16 + pgvector · Redis 7.x · Kafka 3.x · Elasticsearch 8.x  
> **Scale:** 100 M+ registered users · 5–10 replicas · 1 CPU / 2 GB RAM per pod · HPA enabled

---

## Table of Contents

1. [Service Overview & Architecture](#1-service-overview--architecture)
2. [Complete Database DDL](#2-complete-database-ddl)
3. [API Endpoints with Full JSON Examples](#3-api-endpoints-with-full-json-examples)
4. [User Stories & Acceptance Criteria](#4-user-stories--acceptance-criteria)
5. [NLPE Integration](#5-nlpe-natural-language-preference-engine-integration)
6. [Kafka Events](#6-kafka-events)
7. [Redis Caching Strategy](#7-redis-caching-strategy)
8. [Security & Compliance](#8-security--compliance)
9. [Monitoring & Observability](#9-monitoring--observability)

---

## 1. Service Overview & Architecture

### 1.1 Purpose

The Profile Service is the **central data authority** for everything a user presents to the world. It owns:

- **Profile CRUD** — display name, bio, demographics, lifestyle attributes
- **Photos** — ordered photo gallery linked to Media Service CDNs
- **Personality Assessments** — Big Five (OCEAN), MBTI, attachment style, love languages
- **Relationship Preferences** — age range, distance, gender, dealbreakers
- **NLPE Integration** — raw natural-language preference text → AI-parsed structured vectors
- **Prompt Q&A** — up to 3 conversational prompts shown on profile cards
- **Vibe Tags** — culturally expressive self-labels ("dark academia", "gym bro", "main character energy")
- **Completeness Score** — drives discovery ranking and onboarding nudges
- **ELO / Attractiveness Scores** — updated by Matching Engine, read here for display

### 1.2 ASCII Architecture Diagram

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                            API GATEWAY / Load Balancer                       │
└─────────────────────────────────┬────────────────────────────────────────────┘
                                  │ HTTP/2 + JWT
                    ┌─────────────▼──────────────┐
                    │      Profile Service        │
                    │   (5-10 Spring Boot pods)   │
                    │                             │
                    │  ┌─────────────────────┐   │
                    │  │  ProfileController  │   │
                    │  │  PreferenceCtrl     │   │
                    │  │  PhotoController    │   │
                    │  │  PersonalityCtrl    │   │
                    │  └──────────┬──────────┘   │
                    │             │               │
                    │  ┌──────────▼──────────┐   │
                    │  │   Service Layer      │   │
                    │  │  ProfileService     │   │
                    │  │  NLPEService        │   │
                    │  │  CompletenessCalc   │   │
                    │  └──────────┬──────────┘   │
                    │             │               │
                    │  ┌──────────▼──────────┐   │
                    │  │  Repository Layer    │   │
                    │  │  (Spring Data JPA)   │   │
                    │  └──────────┬──────────┘   │
                    └─────────────┼──────────────┘
                                  │
          ┌───────────────────────┼───────────────────────────┐
          │                       │                           │
   ┌──────▼──────┐       ┌────────▼────────┐       ┌─────────▼────────┐
   │ PostgreSQL  │       │   Redis 7.x      │       │ Elasticsearch 8.x│
   │ 16+pgvector │       │  Profile Cache   │       │  Profile Index   │
   │ (primary)   │       │  Pref Cache      │       │  (search/disco.) │
   └─────────────┘       └─────────────────┘       └──────────────────┘

  ─── Inter-Service Calls (REST/gRPC) ────────────────────────────────────────
  Profile Svc ──► AI Service         : POST /v1/ai/preferences/parse (NLPE)
  Profile Svc ──► AI Service         : POST /v1/ai/embeddings/profile
  Profile Svc ──► Media Service      : GET  /v1/media/photos/{id}
  Profile Svc ──► Discovery Service  : PUT  /v1/discovery/index/{profileId}

  ─── Kafka Topics ───────────────────────────────────────────────────────────
  PUBLISHES ──► profile.created
  PUBLISHES ──► profile.updated
  PUBLISHES ──► profile.photo.added
  PUBLISHES ──► profile.preferences.updated
  CONSUMES  ◄── user.account.created
  CONSUMES  ◄── ai.profile.embedding.computed
  CONSUMES  ◄── media.photo.processed
```

### 1.3 Deployment Spec

| Parameter         | Value                            |
|-------------------|----------------------------------|
| Replicas          | 5 (min) – 10 (max) via HPA       |
| CPU Request/Limit | 500m / 1000m                     |
| RAM Request/Limit | 1 Gi / 2 Gi                      |
| HPA Metric        | CPU > 70% or RPS > 500 per pod   |
| JVM Flags         | `-XX:+UseZGC -Xms512m -Xmx1600m` |
| Startup Probe     | `/actuator/health` after 20s     |
| Liveness Probe    | `/actuator/health/liveness`      |
| Readiness Probe   | `/actuator/health/readiness`     |

---

## 2. Complete Database DDL

> **Storage Estimate:** 100 M profiles × ~5 KB text data = ~500 GB text.  
> Photos stored in S3 (Media Service); only CDN URLs (~500 B each) live here.  
> 5 photo URLs/user × 500 B = ~250 GB URL data. pgvector 512-dim float32 = 2 KB/row.  
> Grand total profile_db ≈ **~1.5 TB** (text + vectors + indexes).

### 2.1 Enable Required Extensions

```sql
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "vector";         -- pgvector 0.7+
CREATE EXTENSION IF NOT EXISTS "pg_trgm";        -- trigram for text search
```

### 2.2 Core Profiles Table

```sql
CREATE TABLE profiles (
    id                   BIGSERIAL PRIMARY KEY,
    public_id            UUID          NOT NULL DEFAULT gen_random_uuid() UNIQUE,
    user_id              BIGINT        NOT NULL UNIQUE, -- FK → auth_service.user_accounts.id
    display_name         VARCHAR(50)   NOT NULL,
    date_of_birth        DATE          NOT NULL,
    age                  INTEGER       GENERATED ALWAYS AS
                             (EXTRACT(YEAR FROM AGE(date_of_birth))::INTEGER) STORED,
    gender               VARCHAR(30)   NOT NULL,
    sexuality            VARCHAR(30),
    bio                  TEXT          CHECK (LENGTH(bio) <= 500),
    height_cm            SMALLINT      CHECK (height_cm BETWEEN 100 AND 250),
    body_type            VARCHAR(30),
    ethnicity            VARCHAR(50)[],
    religion             VARCHAR(50),
    education_level      VARCHAR(30),
    occupation           VARCHAR(100),
    company              VARCHAR(100),
    school               VARCHAR(100),
    drinking_habit       VARCHAR(20),
    smoking_habit        VARCHAR(20),
    cannabis_habit       VARCHAR(20),
    exercise_frequency   VARCHAR(20),
    diet                 VARCHAR(30),
    has_children         BOOLEAN,
    wants_children       VARCHAR(30),
    pets                 VARCHAR(50)[],
    relationship_goal    VARCHAR(30)   CHECK (relationship_goal IN (
                             'SERIOUS','CASUAL','SITUATIONSHIP',
                             'FRIENDSHIP','OPEN','EXPLORING')),
    personality_type     VARCHAR(10),  -- MBTI e.g. INFJ
    love_languages       VARCHAR(30)[],
    attachment_style     VARCHAR(20),
    political_views      VARCHAR(30),
    star_sign            VARCHAR(15),
    profile_completeness SMALLINT      NOT NULL DEFAULT 0,
    is_verified          BOOLEAN       NOT NULL DEFAULT FALSE,
    verification_level   VARCHAR(20)   NOT NULL DEFAULT 'UNVERIFIED',
    is_boosted           BOOLEAN       NOT NULL DEFAULT FALSE,
    boost_expires_at     TIMESTAMPTZ,
    elo_score            NUMERIC(6,2)  NOT NULL DEFAULT 1000.00,
    attractiveness_score NUMERIC(5,2),
    profile_vector       vector(512),  -- pgvector cosine embedding for AI matching
    last_active_at       TIMESTAMPTZ,
    version              INTEGER       NOT NULL DEFAULT 0, -- optimistic locking
    created_at           TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at           TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_profiles_user_id       ON profiles(user_id);
CREATE INDEX idx_profiles_elo_score     ON profiles(elo_score DESC);
CREATE INDEX idx_profiles_relationship  ON profiles(relationship_goal);
CREATE INDEX idx_profiles_age           ON profiles(age);
CREATE INDEX idx_profiles_last_active   ON profiles(last_active_at DESC);
CREATE INDEX idx_profiles_public_id     ON profiles(public_id);
CREATE INDEX idx_profiles_gender        ON profiles(gender);
CREATE INDEX idx_profiles_completeness  ON profiles(profile_completeness DESC);

-- pgvector IVFFlat index (rebuild periodically as data grows)
CREATE INDEX idx_profiles_vector ON profiles
    USING ivfflat (profile_vector vector_cosine_ops) WITH (lists = 100);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_profiles_updated_at
    BEFORE UPDATE ON profiles
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
```

### 2.3 Profile Photos

```sql
CREATE TABLE profile_photos (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    profile_id          BIGINT      NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    media_id            UUID        NOT NULL,   -- references media_service.media_files.id
    cdn_url             VARCHAR(500) NOT NULL,
    thumbnail_url       VARCHAR(500),
    position            SMALLINT    NOT NULL DEFAULT 0, -- 0 = primary display order
    is_primary          BOOLEAN     NOT NULL DEFAULT FALSE,
    is_verified         BOOLEAN     NOT NULL DEFAULT FALSE,
    photo_quality_score NUMERIC(3,2),           -- AI quality score 0.00–1.00
    is_nsfw             BOOLEAN     NOT NULL DEFAULT FALSE,
    is_active           BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_photos_profile_id ON profile_photos(profile_id);
CREATE INDEX idx_photos_position   ON profile_photos(profile_id, position);
CREATE INDEX idx_photos_primary    ON profile_photos(profile_id) WHERE is_primary = TRUE;

-- Enforce max 9 active photos per profile
CREATE OR REPLACE FUNCTION check_max_photos()
RETURNS TRIGGER AS $$
BEGIN
    IF (SELECT COUNT(*) FROM profile_photos
        WHERE profile_id = NEW.profile_id AND is_active = TRUE) >= 9 THEN
        RAISE EXCEPTION 'Maximum 9 active photos allowed per profile';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_max_photos
    BEFORE INSERT ON profile_photos
    FOR EACH ROW EXECUTE FUNCTION check_max_photos();
```

### 2.4 Profile Prompts

```sql
CREATE TABLE profile_prompts (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    profile_id      BIGINT      NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    prompt_question VARCHAR(200) NOT NULL,
    prompt_answer   TEXT        NOT NULL CHECK (LENGTH(prompt_answer) <= 300),
    position        SMALLINT    NOT NULL DEFAULT 0, -- display order (0-2)
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_prompt_position UNIQUE (profile_id, position)
);

CREATE INDEX idx_prompts_profile_id ON profile_prompts(profile_id);

CREATE TRIGGER trg_prompts_updated_at
    BEFORE UPDATE ON profile_prompts
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
```

### 2.5 Profile Interests

```sql
CREATE TABLE profile_interests (
    id                BIGSERIAL   PRIMARY KEY,
    profile_id        BIGINT      NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    interest_name     VARCHAR(50) NOT NULL,
    interest_category VARCHAR(50),             -- SPORTS, MUSIC, FOOD, TRAVEL, ARTS, TECH …
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_profile_interest UNIQUE (profile_id, interest_name)
);

CREATE INDEX idx_interests_profile_id ON profile_interests(profile_id);
CREATE INDEX idx_interests_category   ON profile_interests(interest_category);
```

### 2.6 Profile Vibe Tags

```sql
CREATE TABLE profile_vibe_tags (
    id            BIGSERIAL   PRIMARY KEY,
    profile_id    BIGINT      NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    vibe_tag      VARCHAR(50) NOT NULL,  -- "dark academia", "main character energy", "gym bro"
    vibe_category VARCHAR(30),           -- AESTHETIC, PERSONALITY, LIFESTYLE, DYNAMIC
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_profile_vibe UNIQUE (profile_id, vibe_tag)
);

CREATE INDEX idx_vibes_profile_id ON profile_vibe_tags(profile_id);
CREATE INDEX idx_vibes_tag        ON profile_vibe_tags(vibe_tag);
```

### 2.7 Relationship Preferences

```sql
CREATE TABLE relationship_preferences (
    id                   BIGSERIAL    PRIMARY KEY,
    profile_id           BIGINT       NOT NULL UNIQUE REFERENCES profiles(id),
    min_age              SMALLINT     DEFAULT 18,
    max_age              SMALLINT     DEFAULT 99,
    max_distance_km      INTEGER      DEFAULT 50,
    genders_interested_in VARCHAR(30)[],
    relationship_goals   VARCHAR(30)[],
    nlpe_raw_text        TEXT,                    -- user's free-form preference description
    nlpe_parsed_at       TIMESTAMPTZ,
    preference_vector    vector(512),             -- AI embedding of parsed preferences
    must_have_tags       VARCHAR(50)[],           -- hard requirements
    nice_to_have_tags    VARCHAR(50)[],           -- soft preferences
    dealbreaker_tags     VARCHAR(50)[],           -- automatic disqualifiers
    height_min_cm        SMALLINT,
    height_max_cm        SMALLINT,
    education_preference VARCHAR(30)[],
    religion_preference  VARCHAR(50)[],
    has_children_ok      BOOLEAN,
    wants_children_pref  VARCHAR(30),
    updated_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_prefs_profile_id ON relationship_preferences(profile_id);
CREATE INDEX idx_prefs_vector ON relationship_preferences
    USING ivfflat (preference_vector vector_cosine_ops) WITH (lists = 100);

CREATE TRIGGER trg_prefs_updated_at
    BEFORE UPDATE ON relationship_preferences
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
```

### 2.8 Personality Assessments

```sql
CREATE TABLE personality_assessments (
    id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    profile_id              BIGINT      NOT NULL UNIQUE REFERENCES profiles(id),
    big5_openness           NUMERIC(3,2) CHECK (big5_openness BETWEEN 0 AND 1),
    big5_conscientiousness  NUMERIC(3,2) CHECK (big5_conscientiousness BETWEEN 0 AND 1),
    big5_extraversion       NUMERIC(3,2) CHECK (big5_extraversion BETWEEN 0 AND 1),
    big5_agreeableness      NUMERIC(3,2) CHECK (big5_agreeableness BETWEEN 0 AND 1),
    big5_neuroticism        NUMERIC(3,2) CHECK (big5_neuroticism BETWEEN 0 AND 1),
    attachment_style        VARCHAR(20)  CHECK (attachment_style IN
                                ('SECURE','ANXIOUS','AVOIDANT','DISORGANIZED')),
    love_language_primary   VARCHAR(30),
    love_language_secondary VARCHAR(30),
    communication_style     VARCHAR(20),
    conflict_resolution_style VARCHAR(20),
    assessed_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    assessment_version      VARCHAR(10) NOT NULL DEFAULT '1.0'
);

CREATE INDEX idx_assessments_profile_id ON personality_assessments(profile_id);
```

### 2.9 Profile Boosts

```sql
CREATE TABLE profile_boosts (
    id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    profile_id   BIGINT      NOT NULL REFERENCES profiles(id),
    boost_type   VARCHAR(20) NOT NULL CHECK (boost_type IN ('STANDARD','SUPER','PREMIUM')),
    started_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at   TIMESTAMPTZ NOT NULL,
    views_gained INTEGER     NOT NULL DEFAULT 0,
    likes_gained INTEGER     NOT NULL DEFAULT 0,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_boosts_profile_id  ON profile_boosts(profile_id);
CREATE INDEX idx_boosts_expires_at  ON profile_boosts(expires_at) WHERE expires_at > NOW();
CREATE INDEX idx_boosts_active      ON profile_boosts(profile_id, expires_at DESC);
```

---

## 3. API Endpoints with Full JSON Examples

> **Base URL:** `https://api.yourdatingapp.com`  
> **Auth:** Bearer JWT (required on all endpoints unless noted)  
> **Rate limits** are per-user unless stated otherwise.

---

### 3.1 `GET /v1/profile/me` — Fetch Own Profile

**Rate limit:** 60 req/min

**Response 200:**
```json
{
  "data": {
    "publicId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "displayName": "Jordan",
    "age": 27,
    "gender": "NON_BINARY",
    "sexuality": "PANSEXUAL",
    "bio": "Overthinker. Coffee-dependent. Believes in late-night conversations and early morning hikes.",
    "heightCm": 172,
    "bodyType": "ATHLETIC",
    "ethnicity": ["MIXED_RACE"],
    "religion": "AGNOSTIC",
    "educationLevel": "BACHELORS",
    "occupation": "UX Designer",
    "company": "Figma",
    "drinkingHabit": "SOCIAL",
    "smokingHabit": "NEVER",
    "cannabisHabit": "OCCASIONALLY",
    "exerciseFrequency": "4_TIMES_WEEK",
    "diet": "FLEXITARIAN",
    "hasChildren": false,
    "wantsChildren": "OPEN_TO_IT",
    "pets": ["CAT"],
    "relationshipGoal": "SITUATIONSHIP",
    "personalityType": "ENFP",
    "loveLanguages": ["QUALITY_TIME", "WORDS_OF_AFFIRMATION"],
    "attachmentStyle": "SECURE",
    "politicalViews": "PROGRESSIVE",
    "starSign": "SCORPIO",
    "photos": [
      {
        "photoId": "photo-uuid-001",
        "cdnUrl": "https://cdn.yourdatingapp.com/photos/a1b2/photo1.webp",
        "thumbnailUrl": "https://cdn.yourdatingapp.com/photos/a1b2/photo1_thumb.webp",
        "position": 0,
        "isPrimary": true,
        "isVerified": true,
        "qualityScore": 0.91
      }
    ],
    "prompts": [
      {
        "promptId": "prompt-uuid-001",
        "question": "A shower thought I recently had…",
        "answer": "What if maps showed elevation so cities felt like mountains?",
        "position": 0
      }
    ],
    "interests": ["Bouldering", "Sourdough Baking", "Indie Games", "Graphic Novels"],
    "vibeTags": [
      { "tag": "dark academia", "category": "AESTHETIC" },
      { "tag": "golden retriever energy", "category": "PERSONALITY" }
    ],
    "profileCompleteness": 87,
    "isVerified": true,
    "verificationLevel": "PHOTO_VERIFIED",
    "isBoosted": false,
    "eloScore": 1247.50,
    "lastActiveAt": "2025-01-15T14:30:00Z",
    "createdAt": "2024-08-01T10:00:00Z",
    "updatedAt": "2025-01-15T14:30:00Z"
  }
}
```

---

### 3.2 `PUT /v1/profile/me` — Update Own Profile

**Rate limit:** 30 req/min  
**Validation:** All string fields sanitized; bio max 500 chars; display_name 2–50 chars.

**Request Body:**
```json
{
  "displayName": "Jordan",
  "bio": "Overthinker. Coffee-dependent. Believes in late-night conversations and early morning hikes.",
  "heightCm": 172,
  "bodyType": "ATHLETIC",
  "religion": "AGNOSTIC",
  "educationLevel": "BACHELORS",
  "occupation": "UX Designer",
  "company": "Figma",
  "drinkingHabit": "SOCIAL",
  "smokingHabit": "NEVER",
  "cannabisHabit": "OCCASIONALLY",
  "exerciseFrequency": "4_TIMES_WEEK",
  "diet": "FLEXITARIAN",
  "hasChildren": false,
  "wantsChildren": "OPEN_TO_IT",
  "pets": ["CAT"],
  "relationshipGoal": "SITUATIONSHIP",
  "personalityType": "ENFP",
  "loveLanguages": ["QUALITY_TIME", "WORDS_OF_AFFIRMATION"],
  "attachmentStyle": "SECURE",
  "politicalViews": "PROGRESSIVE",
  "starSign": "SCORPIO"
}
```

**Response 200:**
```json
{
  "data": { "message": "Profile updated successfully.", "profileCompleteness": 87 }
}
```

**Error 400 (validation failure):**
```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Validation failed",
    "details": [
      { "field": "bio", "message": "Bio must not exceed 500 characters." },
      { "field": "heightCm", "message": "Height must be between 100 and 250 cm." }
    ]
  }
}
```

---

### 3.3 `GET /v1/profile/{publicId}` — View Another User's Profile

**Rate limit:** 120 req/min  
**Note:** Sensitive fields (DOB, ELO score, user_id) are **never** returned for third-party views.

**Response 200:**
```json
{
  "data": {
    "publicId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "displayName": "Jordan",
    "age": 27,
    "gender": "NON_BINARY",
    "bio": "Overthinker. Coffee-dependent.",
    "heightCm": 172,
    "relationshipGoal": "SITUATIONSHIP",
    "photos": [ { "cdnUrl": "...", "position": 0, "isPrimary": true } ],
    "prompts": [ { "question": "A shower thought I recently had…", "answer": "...", "position": 0 } ],
    "interests": ["Bouldering", "Indie Games"],
    "vibeTags": [ { "tag": "dark academia", "category": "AESTHETIC" } ],
    "isVerified": true,
    "lastActiveAt": "2025-01-15T14:30:00Z"
  }
}
```

---

### 3.4 `POST /v1/profile/photos` — Add Photo to Profile

**Rate limit:** 10 req/min  
**Note:** Requires `mediaId` returned by Media Service after upload completes.

**Request Body:**
```json
{
  "mediaId": "media-uuid-from-media-service",
  "position": 1
}
```

**Response 201:**
```json
{
  "data": {
    "photoId": "photo-uuid-002",
    "cdnUrl": "https://cdn.yourdatingapp.com/photos/a1b2/photo2.webp",
    "thumbnailUrl": "https://cdn.yourdatingapp.com/photos/a1b2/photo2_thumb.webp",
    "position": 1,
    "isPrimary": false,
    "processingStatus": "PROCESSING",
    "message": "Photo added. AI quality check in progress."
  }
}
```

---

### 3.5 `DELETE /v1/profile/photos/{photoId}` — Remove a Photo

**Rate limit:** 20 req/min

**Response 200:**
```json
{ "data": { "message": "Photo removed successfully." } }
```

**Error 404:**
```json
{ "error": { "code": "PHOTO_NOT_FOUND", "message": "Photo not found or does not belong to your profile." } }
```

---

### 3.6 `PUT /v1/profile/photos/{photoId}/primary` — Set Primary Photo

**Rate limit:** 20 req/min

**Response 200:**
```json
{ "data": { "message": "Primary photo updated.", "photoId": "photo-uuid-002" } }
```

---

### 3.7 `PUT /v1/profile/photos/reorder` — Reorder Photos

**Rate limit:** 20 req/min

**Request Body:**
```json
{
  "order": [
    { "photoId": "photo-uuid-002", "position": 0 },
    { "photoId": "photo-uuid-001", "position": 1 },
    { "photoId": "photo-uuid-003", "position": 2 }
  ]
}
```

**Response 200:**
```json
{ "data": { "message": "Photos reordered successfully." } }
```

---

### 3.8 `POST /v1/profile/prompts` — Add a Prompt

**Rate limit:** 10 req/min  
**Validation:** Max 3 prompts per profile; answer max 300 chars.

**Request Body:**
```json
{
  "question": "A shower thought I recently had…",
  "answer": "What if maps showed elevation so cities felt like mountains?",
  "position": 0
}
```

**Response 201:**
```json
{
  "data": {
    "promptId": "prompt-uuid-001",
    "question": "A shower thought I recently had…",
    "answer": "What if maps showed elevation so cities felt like mountains?",
    "position": 0
  }
}
```

---

### 3.9 `PUT /v1/profile/prompts/{promptId}` — Update a Prompt

**Rate limit:** 15 req/min

**Request Body:**
```json
{ "answer": "What if every building had a rooftop garden?" }
```

**Response 200:**
```json
{ "data": { "promptId": "prompt-uuid-001", "answer": "What if every building had a rooftop garden?" } }
```

---

### 3.10 `DELETE /v1/profile/prompts/{promptId}` — Delete a Prompt

**Rate limit:** 10 req/min  
**Response 200:** `{ "data": { "message": "Prompt deleted." } }`

---

### 3.11 `PUT /v1/profile/interests` — Replace Interests (Full Overwrite)

**Rate limit:** 10 req/min  
**Validation:** Max 30 interests; each name max 50 chars.

**Request Body:**
```json
{
  "interests": [
    { "name": "Bouldering",      "category": "SPORTS" },
    { "name": "Sourdough Baking","category": "FOOD"   },
    { "name": "Indie Games",     "category": "TECH"   },
    { "name": "Graphic Novels",  "category": "ARTS"   }
  ]
}
```

**Response 200:**
```json
{ "data": { "message": "Interests updated.", "count": 4 } }
```

---

### 3.12 `PUT /v1/profile/vibe-tags` — Replace Vibe Tags

**Rate limit:** 10 req/min  
**Validation:** Max 10 vibe tags; each tag max 50 chars.

**Request Body:**
```json
{
  "vibeTags": [
    { "tag": "dark academia",        "category": "AESTHETIC"   },
    { "tag": "golden retriever energy", "category": "PERSONALITY" },
    { "tag": "plant parent",          "category": "LIFESTYLE"   }
  ]
}
```

**Response 200:**
```json
{ "data": { "message": "Vibe tags updated.", "count": 3 } }
```

---

### 3.13 `GET /v1/profile/preferences` — Get Relationship Preferences

**Rate limit:** 60 req/min

**Response 200:**
```json
{
  "data": {
    "minAge": 24,
    "maxAge": 35,
    "maxDistanceKm": 40,
    "gendersInterestedIn": ["WOMAN", "NON_BINARY"],
    "relationshipGoals": ["SITUATIONSHIP", "SERIOUS"],
    "nlpeRawText": "I'm drawn to people who are intellectually curious, emotionally available, and have their own creative pursuits. Ideally someone who enjoys both cozy nights in and spontaneous adventures. Deal-breakers: avoidant attachment patterns, heavy smokers.",
    "nlpeParsedAt": "2025-01-14T09:00:00Z",
    "mustHaveTags": ["emotionally available", "intellectually curious"],
    "niceToHaveTags": ["creative", "adventurous"],
    "dealbreakers": ["heavy smoker", "avoidant attachment"],
    "heightMinCm": null,
    "heightMaxCm": null,
    "educationPreference": [],
    "religionPreference": [],
    "hasChildrenOk": true,
    "wantsChildrenPref": "OPEN_TO_IT",
    "updatedAt": "2025-01-14T09:00:00Z"
  }
}
```

---

### 3.14 `PUT /v1/profile/preferences` — Update Preferences (includes NLPE)

**Rate limit:** 10 req/min  
**NLPE:** If `nlpeRawText` is present, async call to AI Service is enqueued.

**Request Body:**
```json
{
  "minAge": 24,
  "maxAge": 35,
  "maxDistanceKm": 40,
  "gendersInterestedIn": ["WOMAN", "NON_BINARY"],
  "relationshipGoals": ["SITUATIONSHIP", "SERIOUS"],
  "nlpeRawText": "I'm drawn to people who are intellectually curious, emotionally available, and have their own creative pursuits. Deal-breakers: avoidant attachment patterns, heavy smokers.",
  "hasChildrenOk": true,
  "wantsChildrenPref": "OPEN_TO_IT"
}
```

**Response 202 (NLPE parsing in progress):**
```json
{
  "data": {
    "message": "Preferences saved. Natural language preferences are being processed by AI.",
    "nlpeStatus": "PROCESSING",
    "estimatedProcessingMs": 1800
  }
}
```

---

### 3.15 `POST /v1/profile/personality/assessment` — Submit Personality Assessment

**Rate limit:** 2 req/day (throttle retakes)

**Request Body:**
```json
{
  "big5Openness": 0.82,
  "big5Conscientiousness": 0.61,
  "big5Extraversion": 0.74,
  "big5Agreeableness": 0.78,
  "big5Neuroticism": 0.35,
  "attachmentStyle": "SECURE",
  "loveLangPrimary": "QUALITY_TIME",
  "loveLangSecondary": "WORDS_OF_AFFIRMATION",
  "communicationStyle": "DIRECT",
  "conflictResolutionStyle": "COLLABORATIVE",
  "assessmentVersion": "1.0"
}
```

**Response 201:**
```json
{
  "data": {
    "assessmentId": "assess-uuid-001",
    "message": "Assessment saved. Profile embedding will be updated.",
    "assessedAt": "2025-01-15T12:00:00Z"
  }
}
```

---

### 3.16 `GET /v1/profile/personality` — Get Personality Results

**Rate limit:** 60 req/min

**Response 200:**
```json
{
  "data": {
    "big5": {
      "openness": 0.82, "conscientiousness": 0.61, "extraversion": 0.74,
      "agreeableness": 0.78, "neuroticism": 0.35
    },
    "attachmentStyle": "SECURE",
    "loveLangPrimary": "QUALITY_TIME",
    "loveLangSecondary": "WORDS_OF_AFFIRMATION",
    "communicationStyle": "DIRECT",
    "conflictResolutionStyle": "COLLABORATIVE",
    "assessedAt": "2025-01-15T12:00:00Z"
  }
}
```

---

### 3.17 `GET /v1/profile/completeness` — Get Completeness Score

**Rate limit:** 60 req/min

**Response 200:**
```json
{
  "data": {
    "score": 87,
    "breakdown": {
      "basicInfo":    { "score": 100, "weight": 0.20 },
      "photos":       { "score": 100, "weight": 0.25 },
      "bio":          { "score": 100, "weight": 0.10 },
      "prompts":      { "score": 100, "weight": 0.10 },
      "interests":    { "score": 100, "weight": 0.10 },
      "vibeTags":     { "score":  80, "weight": 0.05 },
      "preferences":  { "score": 100, "weight": 0.10 },
      "personality":  { "score":  50, "weight": 0.10 }
    },
    "nextActions": [
      "Complete your personality assessment to boost your score by 5 points.",
      "Add 2 more vibe tags to reach 100% in that section."
    ]
  }
}
```

---

### 3.18 `POST /v1/profile/boost` — Activate a Profile Boost

**Rate limit:** 5 req/day  
**Requires:** Active boost entitlement in Subscription Service.

**Request Body:**
```json
{ "boostType": "SUPER" }
```

**Response 201:**
```json
{
  "data": {
    "boostId": "boost-uuid-001",
    "boostType": "SUPER",
    "startedAt": "2025-01-15T15:00:00Z",
    "expiresAt": "2025-01-15T15:30:00Z",
    "durationMinutes": 30
  }
}
```

---

### 3.19 `GET /v1/profile/boost/status` — Get Active Boost Status

**Rate limit:** 30 req/min

**Response 200:**
```json
{
  "data": {
    "isActive": true,
    "boostType": "SUPER",
    "expiresAt": "2025-01-15T15:30:00Z",
    "remainingSeconds": 847,
    "viewsGained": 143,
    "likesGained": 12
  }
}
```

---

## 4. User Stories & Acceptance Criteria

> **Pure Freedom Principle:** This platform respects each user's complete autonomy to express any preference — gender identity, relationship structure, lifestyle, or attraction — **without judgment, filtering, or limitation**. No preference is considered non-standard. Every combination is treated with equal dignity.

---

### Story 4.1 — Expressive Profile Creation

**As a** new user,  
**I want to** describe myself with my actual identity (non-binary, polyamorous, demi-sexual, etc.),  
**So that** I attract people who genuinely align with who I am.

**Acceptance Criteria:**
- All gender options render as free-text OR from an inclusive predefined set (no binary-only constraint)
- `sexuality` field accepts any value without validation rejection
- `relationship_goal` enum includes OPEN, EXPLORING, SITUATIONSHIP (not just SERIOUS/CASUAL)
- No field combination triggers a policy warning or restriction
- Profile saves with 200/201 regardless of lifestyle combination

---

### Story 4.2 — Vibe Tag Self-Expression

**As a** user with a distinct aesthetic identity,  
**I want to** add culturally specific vibe tags ("dark academia", "soft life", "gym bro", "hyperpop era"),  
**So that** like-minded people recognise me immediately.

**Acceptance Criteria:**
- Up to 10 vibe tags allowed, each up to 50 chars
- Tags are free-form text (no restricted list — users define culture)
- Tags appear on profile card in Discovery Service
- Tags are included in AI embedding for personality-match scoring

---

### Story 4.3 — Natural Language Preference Input

**As a** user who knows what I want but hates forms,  
**I want to** type a free paragraph about my ideal match,  
**So that** the AI figures out structured preferences from my own words.

**Acceptance Criteria:**
- `nlpeRawText` field accepts up to 2000 chars of free text
- AI Service parses and returns structured `ParsedPreference` within 2 seconds
- Parsed preferences are shown back to user for confirmation
- User can override any AI-parsed field manually
- Original raw text is always preserved

---

### Story 4.4 — Photo Management

**As a** user,  
**I want to** manage up to 9 photos, set a primary, and reorder them,  
**So that** my best impression is always first.

**Acceptance Criteria:**
- Max 9 active photos enforced at DB level (trigger)
- Primary photo is exactly one at any time (DB constraint)
- Reorder endpoint atomically updates all positions
- Deleted photos are soft-deleted (is_active = false), not hard-deleted

---

### Story 4.5 — Personality Assessment

**As a** user who values psychological compatibility,  
**I want to** complete an assessment and see my Big Five results,  
**So that** the matching algorithm factors in personality compatibility.

**Acceptance Criteria:**
- All five OCEAN scores stored as 0.00–1.00
- Assessment can be retaken (max 2× per day)
- New assessment triggers re-embedding of profile_vector via Kafka
- Results displayed with human-readable labels (not raw floats)

---

### Story 4.6 — Profile Completeness Nudges

**As a** user who just joined,  
**I want to** see exactly what I need to do to complete my profile,  
**So that** I know how to improve my visibility in discovery.

**Acceptance Criteria:**
- `GET /v1/profile/completeness` returns score breakdown by section
- `nextActions` list shows at most 3 highest-impact incomplete sections
- Score updates within 5 seconds of any profile save
- Users with completeness < 40% are soft-blocked from appearing in discovery

---

## 5. NLPE (Natural Language Preference Engine) Integration

### 5.1 Overview

NLPE lets users describe their ideal partner in plain English (or any supported language). The AI Service parses this into structured data and generates a `preference_vector` for cosine-similarity matching.

### 5.2 Full Request/Response Flow

```
User ──PUT /v1/profile/preferences──► Profile Service
                                          │
                                          ├─ 1. Saves nlpe_raw_text to DB
                                          ├─ 2. Returns HTTP 202 immediately
                                          │
                                          └─ 3. Async: POST → AI Service
                                                    /v1/ai/preferences/parse
                                                    {
                                                      "profileId": "...",
                                                      "rawText": "I'm drawn to..."
                                                    }
                                                          │
                                                          ▼ (within ~1.5s)
                                              AI Service returns:
                                              {
                                                "parsedPreferences": {
                                                  "mustHaveTags": ["emotionally available"],
                                                  "dealbreakers": ["heavy smoker"],
                                                  "inferredAgeRange": [24, 35],
                                                  "inferredRelGoals": ["SITUATIONSHIP"]
                                                },
                                                "preferenceVector": [0.12, -0.87, ...] // 512-dim
                                              }
                                                          │
                                          ◄─ 4. Profile Service saves parsed data
                                          ├─ 5. Updates preference_vector in DB
                                          ├─ 6. Sets nlpe_parsed_at = NOW()
                                          └─ 7. Publishes Kafka: profile.preferences.updated
```

### 5.3 ParsedPreference Schema

```json
{
  "profileId": "a1b2c3d4-...",
  "rawText": "I'm drawn to people who are intellectually curious...",
  "parsedPreferences": {
    "mustHaveTags":      ["emotionally available", "intellectually curious"],
    "niceToHaveTags":    ["creative", "adventurous", "financially independent"],
    "dealbreakers":      ["heavy smoker", "avoidant attachment"],
    "inferredAgeMin":    24,
    "inferredAgeMax":    35,
    "inferredRelGoals":  ["SITUATIONSHIP", "SERIOUS"],
    "inferredGenders":   ["WOMAN", "NON_BINARY"],
    "confidenceScore":   0.93
  },
  "preferenceVector": [0.12, -0.87, 0.34, "...511 more floats..."],
  "processingMs": 1420
}
```

### 5.4 Timing & SLA

| Step                        | Target Latency |
|-----------------------------|----------------|
| Profile Service → HTTP 202  | < 50 ms        |
| AI Service NLPE parsing     | < 1500 ms      |
| DB write + cache invalidate | < 100 ms       |
| Kafka event publish         | < 50 ms        |
| **End-to-end**              | **< 2000 ms**  |

---

## 6. Kafka Events

### 6.1 Published Events

#### `profile.created`
```json
{
  "eventType": "profile.created",
  "eventId": "evt-uuid-001",
  "timestamp": "2025-01-15T10:00:00Z",
  "version": "1.0",
  "payload": {
    "profileId": 12345,
    "publicId": "a1b2c3d4-...",
    "userId": 67890,
    "displayName": "Jordan",
    "age": 27,
    "gender": "NON_BINARY",
    "relationshipGoal": "SITUATIONSHIP",
    "location": { "lat": 37.7749, "lon": -122.4194 }
  }
}
```

#### `profile.updated`
```json
{
  "eventType": "profile.updated",
  "eventId": "evt-uuid-002",
  "timestamp": "2025-01-15T14:30:00Z",
  "version": "1.0",
  "payload": {
    "profileId": 12345,
    "publicId": "a1b2c3d4-...",
    "changedFields": ["bio", "relationshipGoal", "vibeTags"],
    "profileCompleteness": 87,
    "triggerReEmbed": true
  }
}
```

#### `profile.photo.added`
```json
{
  "eventType": "profile.photo.added",
  "eventId": "evt-uuid-003",
  "timestamp": "2025-01-15T11:00:00Z",
  "version": "1.0",
  "payload": {
    "profileId": 12345,
    "photoId": "photo-uuid-002",
    "mediaId": "media-uuid-from-media-service",
    "isPrimary": false,
    "position": 1,
    "cdnUrl": "https://cdn.yourdatingapp.com/photos/a1b2/photo2.webp"
  }
}
```

#### `profile.preferences.updated`
```json
{
  "eventType": "profile.preferences.updated",
  "eventId": "evt-uuid-004",
  "timestamp": "2025-01-15T09:00:00Z",
  "version": "1.0",
  "payload": {
    "profileId": 12345,
    "publicId": "a1b2c3d4-...",
    "nlpeProcessed": true,
    "preferenceVectorUpdated": true,
    "dealbreakers": ["heavy smoker", "avoidant attachment"]
  }
}
```

### 6.2 Consumed Events

#### `user.account.created` → Bootstrap empty profile
```json
{
  "eventType": "user.account.created",
  "payload": { "userId": 67890, "email": "user@example.com", "createdAt": "2025-01-15T10:00:00Z" }
}
```
**Action:** Creates a `profiles` row with defaults; creates empty `relationship_preferences` row.

#### `ai.profile.embedding.computed` → Update profile_vector
```json
{
  "eventType": "ai.profile.embedding.computed",
  "payload": {
    "profileId": 12345,
    "embeddingVector": [0.12, -0.87, "...511 more floats..."],
    "embeddingModel": "dating-embed-v3",
    "computedAt": "2025-01-15T14:31:00Z"
  }
}
```
**Action:** Updates `profiles.profile_vector`; invalidates Redis cache.

#### `media.photo.processed` → Update photo record
```json
{
  "eventType": "media.photo.processed",
  "payload": {
    "mediaId": "media-uuid-from-media-service",
    "ownerId": 67890,
    "cdnUrl": "https://cdn.yourdatingapp.com/photos/a1b2/photo2.webp",
    "thumbnailUrl": "https://cdn.yourdatingapp.com/photos/a1b2/photo2_thumb.webp",
    "aiQualityScore": 0.89,
    "isNsfw": false,
    "isApproved": true
  }
}
```
**Action:** Updates `profile_photos` with final CDN URLs, quality scores, and NSFW flag.

---

## 7. Redis Caching Strategy

### 7.1 Cache Keys & TTLs

| Cache Key Pattern                         | Content                  | TTL       | Invalidated On           |
|-------------------------------------------|--------------------------|-----------|--------------------------|
| `profile:public:{publicId}`               | Full public profile DTO  | 10 min    | Any profile.updated      |
| `profile:me:{userId}`                     | Own profile DTO          | 5 min     | Any profile update       |
| `profile:prefs:{profileId}`               | Preferences DTO          | 15 min    | preferences.updated      |
| `profile:photos:{profileId}`              | Ordered photo list       | 10 min    | photo.added / reorder    |
| `profile:completeness:{profileId}`        | Completeness score       | 5 min     | Any profile update       |
| `profile:boost:active:{profileId}`        | Active boost details     | 1 min     | Boost expires            |
| `vibe_tags:popular`                       | Top 100 vibe tags        | 60 min    | Manual / hourly cron     |

### 7.2 Cache-Aside Pattern

```
Read:
  1. Check Redis key
  2. HIT  → return cached DTO
  3. MISS → query PostgreSQL
          → serialize to JSON
          → SET Redis key with TTL
          → return DTO

Write (profile update):
  1. Write to PostgreSQL (primary)
  2. DEL Redis keys for this profile
  3. Publish Kafka event
  4. (Cache rebuilt on next read)
```

### 7.3 Photo URL Cache

CDN photo URLs are immutable once generated. Photo URL cache uses a longer TTL (30 min) and is invalidated only when a photo is deleted or repositioned.

---

## 8. Security & Compliance

### 8.1 PII Fields & Handling

| Field                | PII Level | Storage        | Exposure                            |
|----------------------|-----------|----------------|-------------------------------------|
| `date_of_birth`      | HIGH      | Encrypted AES  | Never returned raw; only `age` int  |
| `user_id`            | HIGH      | Internal only  | Never in API responses              |
| `bio`                | MEDIUM    | Plaintext      | Only returned to self + matches     |
| `display_name`       | LOW       | Plaintext      | Public                              |
| `profile_vector`     | MEDIUM    | DB only        | Never serialized to API             |
| `preference_vector`  | MEDIUM    | DB only        | Never serialized to API             |
| `nlpe_raw_text`      | HIGH      | Encrypted AES  | Returned only to owner              |
| `elo_score`          | LOW       | Plaintext      | Owner only (hidden from others)     |

### 8.2 GDPR Compliance

- **Right to Erasure:** `DELETE /v1/users/me/account` triggers Kafka `user.account.deleted` → Profile Service hard-deletes all rows after 30-day soft-delete window. Cascade deletes photos, prompts, preferences.
- **Right to Portability:** `GET /v1/profile/me/export` returns full JSON export of all profile data within 48 hours.
- **Data Minimisation:** `GET /v1/profile/{publicId}` never returns DOB, user_id, ELO, or preference vectors.
- **Consent Logging:** Personality assessment data requires explicit user consent (stored in Auth Service consent log).

### 8.3 Photo Verification Workflow

```
User uploads photo
       │
       ▼
Media Service: NSFW scan + deepfake detection (AI Service)
       │
       ├─ is_nsfw = true  → Photo rejected; user notified; strike logged
       ├─ is_deepfake = true → Photo rejected; account flagged for review
       │
       ▼
Profile Service receives media.photo.processed event
       │
       ├─ quality_score < 0.40 → Photo marked low quality; nudge to replace
       ├─ quality_score ≥ 0.40 → Photo activated, shown in profile
       │
       ▼
Photo Verification (optional premium feature):
  User submits selfie matching profile photo pose →
  AI liveness check → is_verified = true → blue checkmark
```

### 8.4 Rate Limiting & Abuse Prevention

- Photo uploads: 10/hour per user (prevents photo-bombing)
- Profile updates: 30/min (prevents scraping via diff)
- Public profile views: 120/min per caller (Bot detection at gateway)
- NLPE calls: 5/hour (AI API cost control)
- All endpoints: Global DDoS protection via AWS WAF + CloudFront

---

## 9. Monitoring & Observability

### 9.1 Key Metrics (Prometheus / Grafana)

| Metric Name                                  | Type      | Alert Threshold          |
|----------------------------------------------|-----------|--------------------------|
| `profile_api_request_duration_seconds`        | Histogram | p99 > 500 ms → WARN      |
| `profile_api_request_duration_seconds`        | Histogram | p99 > 2000 ms → CRITICAL |
| `profile_cache_hit_ratio`                     | Gauge     | < 0.80 → WARN            |
| `profile_kafka_publish_errors_total`          | Counter   | > 10/min → WARN          |
| `profile_nlpe_processing_duration_seconds`    | Histogram | p95 > 2000 ms → WARN     |
| `profile_photo_upload_errors_total`           | Counter   | > 5/min → WARN           |
| `profile_db_connection_pool_active`           | Gauge     | > 90% pool → WARN        |
| `profile_completeness_avg`                    | Gauge     | < 0.60 → product alert   |

### 9.2 Distributed Tracing

All requests carry `X-Trace-Id` and `X-Span-Id` headers (OpenTelemetry). Traces exported to Jaeger. Cross-service calls (→ AI Service, → Media Service) propagate the trace context.

### 9.3 Structured Logging

```json
{
  "timestamp": "2025-01-15T14:30:00.123Z",
  "level": "INFO",
  "service": "profile-service",
  "traceId": "abc123",
  "spanId": "def456",
  "userId": "[REDACTED]",
  "publicId": "a1b2c3d4-...",
  "action": "PROFILE_UPDATED",
  "changedFields": ["bio", "vibeTags"],
  "durationMs": 47,
  "cacheInvalidated": true
}
```

> **Note:** `userId` is always redacted in logs. `publicId` (UUID) is safe to log.

### 9.4 Health Checks

```
GET /actuator/health
→ {
    "status": "UP",
    "components": {
      "db":    { "status": "UP", "details": { "database": "PostgreSQL 16" } },
      "redis": { "status": "UP" },
      "kafka": { "status": "UP" }
    }
  }
```
