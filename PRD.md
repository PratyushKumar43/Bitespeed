# BiteSpeed Backend — Identity Reconciliation Service

## Product Requirements Document (PRD)

---

## 1. Overview

### 1.1 Product Name

**BiteSpeed Identity Reconciliation Service**

### 1.2 Problem Statement

FluxKart.com integrates BiteSpeed to deliver personalised customer experiences. However, customers frequently use different email addresses and phone numbers across multiple purchases, making it difficult to link separate orders to the same individual. BiteSpeed needs a backend service that can **intelligently reconcile fragmented contact information** into a unified customer identity.

### 1.3 Objective

Build a backend web service that exposes an `/identify` endpoint. This endpoint receives a customer's `email` and/or `phoneNumber`, reconciles it against existing contact records, and returns a consolidated identity — linking all known emails, phone numbers, and secondary contact records under a single primary contact.

### 1.4 Target Users

- **FluxKart.com** (the integrating e-commerce platform)
- **BiteSpeed internal systems** consuming the consolidated identity data

### 1.5 Success Metrics

| Metric                                         | Target  |
| ---------------------------------------------- | ------- |
| Correct identity linkage across all edge cases | 100%    |
| API response time (p95)                        | < 500ms |
| Uptime                                         | 99.9%   |
| Zero data loss on contact reconciliation       | 100%    |

---

## 2. Tech Stack

| Layer               | Technology                                            |
| ------------------- | ----------------------------------------------------- |
| **Runtime**         | Node.js (v18+)                                        |
| **Framework**       | Express.js                                            |
| **Database**        | Supabase (PostgreSQL)                                 |
| **Language**        | JavaScript (ES6+)                                     |
| **Hosting**         | Render.com (free tier) / Railway / any cloud provider |
| **Version Control** | Git + GitHub                                          |

### 2.1 Why This Stack?

- **Node.js + Express.js** — Lightweight, fast, and widely adopted for REST APIs.
- **Supabase** — Managed PostgreSQL with built-in auth, real-time subscriptions, and a generous free tier. Provides the `@supabase/supabase-js` SDK for seamless integration.
- **JavaScript** — Rapid development with broad ecosystem support.

---

## 3. Data Model

### 3.1 Database Table: `contacts`

| Column            | Type           | Constraints                                     | Description                                                     |
| ----------------- | -------------- | ----------------------------------------------- | --------------------------------------------------------------- |
| `id`              | `SERIAL`       | `PRIMARY KEY`                                   | Auto-incrementing unique identifier                             |
| `phone_number`    | `VARCHAR(20)`  | `NULLABLE`                                      | Customer phone number                                           |
| `email`           | `VARCHAR(255)` | `NULLABLE`                                      | Customer email address                                          |
| `linked_id`       | `INTEGER`      | `NULLABLE`, `REFERENCES contacts(id)`           | ID of the primary contact this record is linked to              |
| `link_precedence` | `VARCHAR(10)`  | `NOT NULL`, `CHECK IN ('primary', 'secondary')` | Whether the contact is the primary or a secondary linked record |
| `created_at`      | `TIMESTAMPTZ`  | `NOT NULL`, `DEFAULT NOW()`                     | Row creation timestamp                                          |
| `updated_at`      | `TIMESTAMPTZ`  | `NOT NULL`, `DEFAULT NOW()`                     | Last update timestamp                                           |
| `deleted_at`      | `TIMESTAMPTZ`  | `NULLABLE`                                      | Soft-delete timestamp                                           |

### 3.2 SQL Migration Script

```sql
CREATE TABLE IF NOT EXISTS contacts (
  id            SERIAL PRIMARY KEY,
  phone_number  VARCHAR(20),
  email         VARCHAR(255),
  linked_id     INTEGER REFERENCES contacts(id) ON DELETE SET NULL,
  link_precedence VARCHAR(10) NOT NULL CHECK (link_precedence IN ('primary', 'secondary')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at    TIMESTAMPTZ
);

CREATE INDEX idx_contacts_email ON contacts(email) WHERE deleted_at IS NULL;
CREATE INDEX idx_contacts_phone ON contacts(phone_number) WHERE deleted_at IS NULL;
CREATE INDEX idx_contacts_linked_id ON contacts(linked_id);
```

### 3.3 Linkage Rules

1. **Two contacts are linked** if they share either the same `email` OR the same `phone_number`.
2. The **oldest** contact in a linked group is always the **primary**; all others are **secondary**.
3. A contact that was previously **primary** can be **demoted to secondary** if a newer request reveals it should be linked to an older existing primary.

---

## 4. API Specification

### 4.1 Endpoint: `POST /identify`

#### Request

| Field         | Type     | Required | Description            |
| ------------- | -------- | -------- | ---------------------- |
| `email`       | `string` | No\*     | Customer email address |
| `phoneNumber` | `string` | No\*     | Customer phone number  |

> **\*At least one of `email` or `phoneNumber` must be provided.**

**Request Body Example:**

```json
{
  "email": "mcfly@hillvalley.edu",
  "phoneNumber": "123456"
}
```

#### Response — `200 OK`

```json
{
  "contact": {
    "primaryContactId": 1,
    "emails": ["lorraine@hillvalley.edu", "mcfly@hillvalley.edu"],
    "phoneNumbers": ["123456"],
    "secondaryContactIds": [23]
  }
}
```

| Field                 | Type       | Description                                                           |
| --------------------- | ---------- | --------------------------------------------------------------------- |
| `primaryContactId`    | `number`   | ID of the primary contact in the linked group                         |
| `emails`              | `string[]` | All unique emails in the group (primary contact's email first)        |
| `phoneNumbers`        | `string[]` | All unique phone numbers in the group (primary contact's phone first) |
| `secondaryContactIds` | `number[]` | IDs of all secondary contacts linked to the primary                   |

#### Error Responses

| Status Code | Body                                                       | When                                                             |
| ----------- | ---------------------------------------------------------- | ---------------------------------------------------------------- |
| `400`       | `{ "error": "email or phoneNumber is required" }`          | Neither `email` nor `phoneNumber` is provided                    |
| `413`       | `{ "error": "Payload too large" }`                         | Request body exceeds 10KB limit                                  |
| `422`       | `{ "errors": [{ "field": "...", "message": "..." }] }`     | Validation fails (invalid email format, non-numeric phone, etc.) |
| `429`       | `{ "error": "Too many requests, please try again later" }` | Rate limit exceeded (includes `Retry-After` header)              |
| `500`       | `{ "error": "Internal server error" }`                     | Unexpected server failure                                        |

---

## 5. Core Business Logic

### 5.1 Identity Reconciliation Algorithm

When a `POST /identify` request is received:

```
1. QUERY all existing contacts where:
      email = request.email  OR  phone_number = request.phoneNumber
   (only non-deleted rows)

2. IF no matches found:
      → CREATE a new contact with link_precedence = "primary"
      → RETURN the new contact as the sole result

3. IF matches found:
      a. Collect all matched contacts and their linked primary contacts
      b. Recursively gather the FULL linked group
         (all contacts sharing the same primary root)
      c. Determine the PRIMARY contact:
         → The contact with the earliest created_at among all primaries
      d. IF multiple primary contacts exist (two separate groups are being merged):
         → DEMOTE the newer primary to "secondary"
         → Set its linked_id to the older primary's id
         → Update its updated_at timestamp
         → Re-link all of the demoted primary's secondaries to the surviving primary
      e. IF the request contains NEW information (a new email or phone not yet in the group):
         → CREATE a new "secondary" contact linked to the primary
      f. RETURN the consolidated response
```

### 5.2 Flowchart

```
         ┌──────────────────────┐
         │  POST /identify      │
         │  { email, phone }    │
         └──────────┬───────────┘
                    │
                    ▼
         ┌──────────────────────┐
         │  Search contacts by  │
         │  email OR phone      │
         └──────────┬───────────┘
                    │
            ┌───────┴───────┐
            │               │
       No matches      Matches found
            │               │
            ▼               ▼
    ┌───────────────┐  ┌──────────────────────┐
    │ Create new    │  │ Gather full linked    │
    │ PRIMARY       │  │ group (all primaries  │
    │ contact       │  │ + secondaries)        │
    └───────┬───────┘  └──────────┬───────────┘
            │                     │
            ▼                     ▼
    ┌───────────────┐  ┌──────────────────────┐
    │ Return single │  │ Multiple primaries?  │
    │ contact       │  └──────────┬───────────┘
    └───────────────┘        ┌────┴────┐
                            YES       NO
                             │         │
                             ▼         ▼
                    ┌─────────────┐ ┌─────────────────┐
                    │ Demote newer│ │ New info in      │
                    │ primary to  │ │ request?         │
                    │ secondary   │ └────────┬────────┘
                    └──────┬──────┘     ┌────┴────┐
                           │           YES       NO
                           ▼            │         │
                    ┌─────────────┐     ▼         │
                    │ Re-link all │ ┌──────────┐   │
                    │ secondaries │ │ Create   │   │
                    └──────┬──────┘ │ secondary│   │
                           │        └────┬─────┘   │
                           └──────┬──────┘         │
                                  │                │
                                  ▼                │
                           ┌──────────────┐        │
                           │ Return       │◄───────┘
                           │ consolidated │
                           │ response     │
                           └──────────────┘
```

---

## 6. Project Structure

```
BiteSpeed/
├── src/
│   ├── index.js              # Express app entry point
│   ├── config/
│   │   └── supabase.js       # Supabase client initialization
│   ├── middleware/
│   │   ├── rateLimiter.js    # Rate limiting configuration
│   │   ├── security.js       # Helmet, HPP, CORS, payload limits
│   │   ├── validator.js      # Input validation & sanitisation rules
│   │   └── requestLogger.js  # Morgan request logging setup
│   ├── routes/
│   │   └── identify.js       # POST /identify route handler
│   ├── controllers/
│   │   └── identifyController.js   # Business logic for /identify
│   ├── services/
│   │   └── contactService.js       # Database query functions (CRUD)
│   └── utils/
│       └── response.js       # Response formatting helpers
├── sql/
│   └── migration.sql         # Table creation script
├── .env                      # Environment variables (not committed)
├── .env.example              # Template for environment variables
├── .gitignore
├── package.json
├── Assignment.md             # Original assignment spec
└── Readme.md                 # This file (PRD)
```

---

## 7. Environment Variables

| Variable                  | Description                             | Example                     |
| ------------------------- | --------------------------------------- | --------------------------- |
| `PORT`                    | Server port                             | `3000`                      |
| `SUPABASE_URL`            | Supabase project URL                    | `https://xxxxx.supabase.co` |
| `SUPABASE_KEY`            | Supabase service role / anon key        | `eyJhbGciOi...`             |
| `RATE_LIMIT_WINDOW_MS`    | Rate limit window in milliseconds       | `900000` (15 min)           |
| `RATE_LIMIT_MAX_REQUESTS` | Max requests per window per IP          | `100`                       |
| `CORS_ORIGIN`             | Allowed CORS origin(s), comma-separated | `https://fluxkart.com`      |
| `NODE_ENV`                | Environment (development / production)  | `production`                |

**.env.example:**

```env
PORT=3000
SUPABASE_URL=your_supabase_project_url
SUPABASE_KEY=your_supabase_service_role_key
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=100
CORS_ORIGIN=*
NODE_ENV=development
```

---

## 8. Detailed Module Specifications

### 8.1 `src/index.js` — Application Entry Point

- Initialize Express app
- Apply security middleware stack (in order):
  1. `helmet()` — HTTP security headers
  2. `cors()` — CORS with whitelist
  3. `hpp()` — HTTP Parameter Pollution protection
  4. `express.json({ limit: '10kb' })` — JSON body parser with payload size limit
  5. `requestLogger` — Morgan request logging
  6. `rateLimiter` — Global rate limiting
- Mount `/identify` route with input validation middleware
- Add global error handler middleware (sanitised error messages in production)
- Start the server on `process.env.PORT` or `3000`

### 8.2 `src/config/supabase.js` — Supabase Client

- Import `createClient` from `@supabase/supabase-js`
- Read `SUPABASE_URL` and `SUPABASE_KEY` from environment
- Export a singleton Supabase client instance

### 8.3 `src/routes/identify.js` — Route Definition

- Define `POST /identify` route
- Delegate to `identifyController.handleIdentify`

### 8.4 `src/controllers/identifyController.js` — Controller

- Validate request body (at least one of `email` / `phoneNumber` must be present)
- Call `contactService` methods to execute the reconciliation algorithm
- Format and return the consolidated response

### 8.5 `src/services/contactService.js` — Service Layer

Core database interaction methods:

| Method                                          | Description                                                                                         |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `findContactsByEmailOrPhone(email, phone)`      | Fetch all non-deleted contacts matching the given email or phone                                    |
| `findContactById(id)`                           | Fetch a single contact by ID                                                                        |
| `findLinkedContacts(primaryId)`                 | Fetch all contacts linked to a given primary ID                                                     |
| `createContact(data)`                           | Insert a new contact row                                                                            |
| `updateContactToSecondary(id, primaryId)`       | Demote a contact: set `link_precedence = 'secondary'`, `linked_id = primaryId`, update `updated_at` |
| `relinkSecondaries(oldPrimaryId, newPrimaryId)` | Update all secondaries pointing to `oldPrimaryId` to point to `newPrimaryId`                        |

### 8.6 `src/utils/response.js` — Response Formatter

- `formatConsolidatedResponse(primaryContact, allContacts)` → Returns the standardised response JSON shape

### 8.7 `src/middleware/rateLimiter.js` — Rate Limiting

- Uses `express-rate-limit` to throttle requests per IP
- **Window:** Configurable via `RATE_LIMIT_WINDOW_MS` (default: 15 minutes)
- **Max requests per window:** Configurable via `RATE_LIMIT_MAX_REQUESTS` (default: 100)
- Returns `429 Too Many Requests` with a `Retry-After` header when limit is exceeded
- Custom JSON error response: `{ "error": "Too many requests, please try again later" }`
- Applies **globally** to all routes

```js
// Example configuration
const rateLimit = require("express-rate-limit");

const limiter = rateLimit({
  windowMs: process.env.RATE_LIMIT_WINDOW_MS || 15 * 60 * 1000,
  max: process.env.RATE_LIMIT_MAX_REQUESTS || 100,
  standardHeaders: true, // Return rate limit info in `RateLimit-*` headers
  legacyHeaders: false, // Disable `X-RateLimit-*` headers
  message: { error: "Too many requests, please try again later" },
});
```

### 8.8 `src/middleware/security.js` — Security Hardening

- **Helmet** — Sets secure HTTP headers automatically:
  - `X-Content-Type-Options: nosniff`
  - `X-Frame-Options: DENY`
  - `X-XSS-Protection: 0` (modern CSP is preferred)
  - `Strict-Transport-Security` (HSTS)
  - `Content-Security-Policy`
  - Removes `X-Powered-By` header
- **HPP** — Prevents HTTP Parameter Pollution attacks
- **CORS** — Whitelist-based CORS configuration:
  - Production: only allow `CORS_ORIGIN` domains
  - Development: allow all origins (`*`)
  - Only `POST` method allowed on `/identify`
- **Payload size limit** — `express.json({ limit: '10kb' })` rejects oversized bodies with `413 Payload Too Large`

```js
// Example CORS configuration
const corsOptions = {
  origin:
    process.env.NODE_ENV === "production"
      ? process.env.CORS_ORIGIN?.split(",")
      : "*",
  methods: ["POST"],
  allowedHeaders: ["Content-Type"],
  maxAge: 86400, // Cache preflight for 24 hours
};
```

### 8.9 `src/middleware/validator.js` — Input Validation & Sanitisation

- Uses `express-validator` for declarative request validation
- **Validation rules for `POST /identify`:**

| Field         | Rules                                                                                |
| ------------- | ------------------------------------------------------------------------------------ |
| `email`       | Optional, must be valid email format, normalised to lowercase, trimmed, HTML-escaped |
| `phoneNumber` | Optional, must be string of 1–20 characters, only digits allowed, trimmed            |
| **Custom**    | At least one of `email` or `phoneNumber` must be non-null/non-empty                  |

- Returns `422 Unprocessable Entity` with detailed field-level errors:

```json
{
  "errors": [
    {
      "field": "email",
      "message": "Must be a valid email address"
    }
  ]
}
```

### 8.10 `src/middleware/requestLogger.js` — Request Logging

- Uses `morgan` HTTP request logger
- **Development:** `dev` format (coloured, concise)
- **Production:** `combined` format (Apache-style, full detail)
- Logs method, URL, status code, response time, and content length

---

## 9. Edge Cases & Scenarios

### 9.1 Scenario Matrix

| #   | Request                                      | DB State Before      | Expected Behaviour                                        |
| --- | -------------------------------------------- | -------------------- | --------------------------------------------------------- |
| 1   | New email + new phone                        | Empty                | Create a new **primary** contact                          |
| 2   | Existing email + same phone                  | 1 matching contact   | Return existing consolidated identity (no new row)        |
| 3   | Existing phone + new email                   | 1 matching contact   | Create **secondary** contact with the new email           |
| 4   | New phone + existing email                   | 1 matching contact   | Create **secondary** contact with the new phone           |
| 5   | Email matches Group A, phone matches Group B | 2 separate primaries | **Merge groups** — demote the newer primary to secondary  |
| 6   | Only email provided, phone is null           | Matches exist        | Return consolidated identity for that email's group       |
| 7   | Only phone provided, email is null           | Matches exist        | Return consolidated identity for that phone's group       |
| 8   | Both null                                    | —                    | Return `400 Bad Request`                                  |
| 9   | Exact duplicate of existing contact          | Matches exist        | No new row created; return existing consolidated identity |

### 9.2 Primary-to-Secondary Demotion

When two previously unrelated primary contacts are discovered to belong to the same person (via a request that links them):

1. The **older** primary (by `created_at`) remains primary
2. The **newer** primary becomes secondary, its `linked_id` is set to the older primary's ID
3. All existing secondaries of the demoted primary are **re-linked** to the surviving primary

---

## 10. Non-Functional Requirements

### 10.1 Performance

- All database queries should use indexed columns (`email`, `phone_number`, `linked_id`)
- Response time < 500ms for 95th percentile requests

### 10.2 Reliability

- Graceful error handling with meaningful HTTP error responses
- No partial state mutations — use transactional semantics where possible

### 10.3 Security (Comprehensive)

Security is a **first-class concern** in this service. The following measures are built into every request:

#### 🛡️ A. Rate Limiting

| Setting                        | Value                                                          | Configurable Via          |
| ------------------------------ | -------------------------------------------------------------- | ------------------------- |
| Window duration                | 15 minutes                                                     | `RATE_LIMIT_WINDOW_MS`    |
| Max requests per IP per window | 100                                                            | `RATE_LIMIT_MAX_REQUESTS` |
| Standard headers               | ✅ `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset` | —                         |
| Response on exceed             | `429 Too Many Requests` + `Retry-After` header                 | —                         |

> **Why:** Prevents brute-force enumeration of contact data, DDoS abuse, and runaway integrations from overwhelming the API.

#### 🛡️ B. HTTP Security Headers (Helmet)

| Header                      | Value                                 | Purpose                            |
| --------------------------- | ------------------------------------- | ---------------------------------- |
| `X-Content-Type-Options`    | `nosniff`                             | Prevent MIME-type sniffing         |
| `X-Frame-Options`           | `DENY`                                | Prevent clickjacking               |
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains` | Enforce HTTPS                      |
| `X-Powered-By`              | _(removed)_                           | Hide server technology fingerprint |
| `Content-Security-Policy`   | `default-src 'self'`                  | Prevent XSS and code injection     |
| `X-DNS-Prefetch-Control`    | `off`                                 | Prevent DNS prefetching leaks      |
| `Referrer-Policy`           | `no-referrer`                         | Prevent referrer leaks             |

> **Why:** Defence-in-depth. Even though this is a JSON API, these headers protect against misconfigured clients and downstream proxies.

#### 🛡️ C. Input Validation & Sanitisation

- **Email:** Validated as RFC 5322 compliant → normalised to lowercase → trimmed → HTML-escaped
- **Phone:** Must be a string of 1–20 digits only → trimmed → stripped of non-numeric characters
- **Body:** At least one of `email` or `phoneNumber` must be non-null
- **Rejection:** Returns `422 Unprocessable Entity` with field-level error messages
- **Library:** `express-validator` (declarative, battle-tested)

> **Why:** Prevents malformed data from reaching the database, stops injection attempts, and ensures data quality.

#### 🛡️ D. Payload Size Limiting

- `express.json({ limit: '10kb' })` rejects oversized request bodies
- Returns `413 Payload Too Large` on violation

> **Why:** Prevents memory exhaustion attacks from maliciously large JSON payloads.

#### 🛡️ E. CORS Configuration

- **Production:** Only origins listed in `CORS_ORIGIN` are allowed
- **Development:** All origins allowed (`*`)
- Allowed methods: `POST` only
- Allowed headers: `Content-Type` only
- Preflight cache: 24 hours (`maxAge: 86400`)

> **Why:** Prevents unauthorised browser-based clients from calling the API.

#### 🛡️ F. HTTP Parameter Pollution (HPP) Protection

- Uses `hpp` middleware to pick the last value when duplicate query/body parameters are sent
- Prevents attackers from injecting duplicate parameters to bypass validation

#### 🛡️ G. SQL Injection Prevention

- All database queries go through the Supabase SDK which uses **parameterised queries**
- No raw SQL string concatenation anywhere in the codebase

#### 🛡️ H. Secret Management

- All secrets (`SUPABASE_URL`, `SUPABASE_KEY`) stored in `.env` file
- `.env` is listed in `.gitignore` — never committed to version control
- Production secrets managed via hosting platform's environment variable dashboard (e.g., Render)

#### 🛡️ I. Error Response Sanitisation

- **Development:** Full error messages + stack traces for debugging
- **Production:** Generic error messages only — no stack traces, no internal details leaked
- Never expose database schema, query details, or library versions in error responses

#### 🛡️ J. Request Logging & Audit Trail

- **Morgan** logs every incoming request (method, URL, status, response time)
- **Development:** Coloured `dev` format for readability
- **Production:** Apache `combined` format for log aggregation tools
- Aids in detecting suspicious patterns (repeated 429s, unusual payloads, etc.)

#### Security Middleware Execution Order

```
Request
  │
  ▼
┌──────────────┐  HTTP security headers + fingerprint removal
│ 1. Helmet    │
└──────┬───────┘
       ▼
┌──────────────┐  Block unauthorised origins
│ 2. CORS      │
└──────┬───────┘
       ▼
┌──────────────┐  Prevent parameter pollution
│ 3. HPP       │
└──────┬───────┘
       ▼
┌──────────────┐  Parse JSON + enforce 10KB limit
│ 4. Body      │
│    Parser    │  → 413 if too large
└──────┬───────┘
       ▼
┌──────────────┐  Log request details
│ 5. Morgan    │
└──────┬───────┘
       ▼
┌──────────────┐  Throttle by IP
│ 6. Rate      │
│    Limiter   │  → 429 if exceeded
└──────┬───────┘
       ▼
┌──────────────┐  Validate & sanitise email, phone
│ 7. Validator │  → 422 if invalid
└──────┬───────┘
       ▼
┌──────────────┐  Business logic
│ 8. Controller│
└──────┬───────┘
       ▼
    Response
```

### 10.4 Observability

- Morgan request logging for all incoming requests with response time metrics
- Console logging for key business decisions (new contact, merge, demotion)
- Error logging with stack traces in development; sanitised in production

### 10.5 Scalability

- Stateless Express server — horizontally scalable
- Supabase handles DB connection pooling

---

## 11. Dependencies

```json
{
  "dependencies": {
    "express": "^4.18.2",
    "dotenv": "^16.3.1",
    "@supabase/supabase-js": "^2.39.0",
    "cors": "^2.8.5",
    "helmet": "^7.1.0",
    "express-rate-limit": "^7.1.5",
    "express-validator": "^7.0.1",
    "hpp": "^0.2.3",
    "morgan": "^1.10.0"
  },
  "devDependencies": {
    "nodemon": "^3.0.2"
  }
}
```

### 11.1 Security Dependencies Explained

| Package              | Purpose                                       | Weekly Downloads |
| -------------------- | --------------------------------------------- | ---------------- |
| `helmet`             | Sets 15+ security HTTP headers in one line    | 2M+              |
| `express-rate-limit` | IP-based rate limiting middleware             | 1M+              |
| `express-validator`  | Declarative request validation & sanitisation | 1.5M+            |
| `hpp`                | Protects against HTTP Parameter Pollution     | 200K+            |
| `morgan`             | HTTP request logger for auditing & debugging  | 3M+              |

---

## 12. Development Setup

### 12.1 Prerequisites

- Node.js v18+ and npm installed
- A Supabase project created at [supabase.com](https://supabase.com)
- Git installed

### 12.2 Quick Start

```bash
# 1. Clone the repository
git clone https://github.com/<your-username>/bitespeed-identity.git
cd bitespeed-identity

# 2. Install dependencies
npm install

# 3. Configure environment
cp .env.example .env
# Edit .env with your Supabase credentials

# 4. Run the SQL migration in Supabase SQL Editor
# (Copy contents of sql/migration.sql and execute)

# 5. Start in development mode
npm run dev

# 6. Start in production mode
npm start
```

### 12.3 npm Scripts

| Script  | Command                | Description                           |
| ------- | ---------------------- | ------------------------------------- |
| `start` | `node src/index.js`    | Start the production server           |
| `dev`   | `nodemon src/index.js` | Start with hot-reload for development |

---

## 13. API Testing Examples

### 13.1 Create First Contact (New Customer)

```bash
curl -X POST http://localhost:3000/identify \
  -H "Content-Type: application/json" \
  -d '{"email": "lorraine@hillvalley.edu", "phoneNumber": "123456"}'
```

**Expected:** New primary contact created.

### 13.2 Link with Existing Phone (New Email)

```bash
curl -X POST http://localhost:3000/identify \
  -H "Content-Type: application/json" \
  -d '{"email": "mcfly@hillvalley.edu", "phoneNumber": "123456"}'
```

**Expected:** Secondary contact created; response shows both emails linked.

### 13.3 Merge Two Primary Groups

```bash
# First, create two separate groups
curl -X POST http://localhost:3000/identify \
  -H "Content-Type: application/json" \
  -d '{"email": "george@hillvalley.edu", "phoneNumber": "919191"}'

curl -X POST http://localhost:3000/identify \
  -H "Content-Type: application/json" \
  -d '{"email": "biffsucks@hillvalley.edu", "phoneNumber": "717171"}'

# Now merge them
curl -X POST http://localhost:3000/identify \
  -H "Content-Type: application/json" \
  -d '{"email": "george@hillvalley.edu", "phoneNumber": "717171"}'
```

**Expected:** Newer primary (id=27) demoted to secondary; both groups consolidated under older primary (id=11).

### 13.4 Query with Only Email

```bash
curl -X POST http://localhost:3000/identify \
  -H "Content-Type: application/json" \
  -d '{"email": "mcfly@hillvalley.edu", "phoneNumber": null}'
```

**Expected:** Returns consolidated contact for the group containing that email.

### 13.5 Bad Request

```bash
curl -X POST http://localhost:3000/identify \
  -H "Content-Type: application/json" \
  -d '{}'
```

**Expected:** `400` error — `email or phoneNumber is required`.

---

## 14. Deployment

### 14.1 Hosting on Render.com (Recommended — Free Tier)

1. Push the repository to GitHub
2. Go to [render.com](https://render.com) → **New Web Service**
3. Connect the GitHub repository
4. Configure:
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Environment Variables:** Add `SUPABASE_URL`, `SUPABASE_KEY`, and `PORT`
5. Deploy

### 14.2 Hosted Endpoint

Once deployed, the live endpoint will be:

```
https://<your-app-name>.onrender.com/identify
```

> ⚠️ **Note:** Replace the URL above with your actual deployed endpoint after hosting.

---

## 15. Verification Plan

### 15.1 Automated Testing

- Test all 9 scenarios from the [Scenario Matrix (§9.1)](#91-scenario-matrix) via `curl` or Postman
- Verify correct HTTP status codes (200, 400, 500)
- Verify response JSON structure matches the specification exactly

### 15.2 Manual Testing Checklist

- [ ] New customer creates a primary contact
- [ ] Existing email + new phone creates a secondary contact
- [ ] Existing phone + new email creates a secondary contact
- [ ] Duplicate request does not create new rows
- [ ] Two separate primary groups merge correctly (older stays primary)
- [ ] Demoted primary's secondaries are re-linked to the surviving primary
- [ ] Query with only `email` returns full consolidated identity
- [ ] Query with only `phoneNumber` returns full consolidated identity
- [ ] Empty body returns `400`
- [ ] Response `emails[]` and `phoneNumbers[]` have primary contact's values first
- [ ] No duplicate entries in `emails[]` or `phoneNumbers[]`

---

## 16. Git Workflow

### 16.1 Commit Strategy

Make small, incremental commits with descriptive messages:

```
feat: initialize express server with basic config
feat: add supabase client configuration
feat: create contacts table migration script
sec: add helmet for HTTP security headers
sec: add rate limiting with express-rate-limit
sec: add input validation with express-validator
sec: add HPP protection and payload size limits
sec: add morgan request logging
feat: implement /identify endpoint with reconciliation logic
feat: handle primary-to-secondary demotion edge case
feat: add input validation and error handling
feat: add CORS whitelist configuration
docs: write comprehensive PRD in Readme.md
chore: add .env.example and .gitignore
deploy: configure for render.com deployment
```

### 16.2 .gitignore

```
node_modules/
.env
.DS_Store
```

---

## 17. Future Enhancements (Out of Scope)

These are **not** part of the current scope but are worth considering:

| Enhancement              | Description                                         |
| ------------------------ | --------------------------------------------------- |
| TypeScript migration     | Stronger type safety across the codebase            |
| Unit & integration tests | Jest-based automated test suite                     |
| Soft-delete support      | Honour `deleted_at` for contact deactivation        |
| Pagination               | For large contact groups                            |
| Webhook notifications    | Notify FluxKart when groups are merged              |
| Admin dashboard          | Visualise contact linkages                          |
| API key authentication   | Per-client API keys for access control              |
| Request signing (HMAC)   | Verify request integrity from trusted clients       |
| IP allow-listing         | Restrict access to known FluxKart IPs in production |

---

## 18. References

- [BiteSpeed Assignment Specification](./Assignment.md)
- [Supabase Documentation](https://supabase.com/docs)
- [Express.js Documentation](https://expressjs.com/)
- [Node.js Documentation](https://nodejs.org/en/docs)

---

> **Author:** BiteSpeed Backend Assignment  
> **Last Updated:** February 27, 2026
