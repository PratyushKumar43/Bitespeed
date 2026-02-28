# API Testing Guide — BiteSpeed Identity Reconciliation

## Base URL

```
Local:  http://localhost:3000
Hosted: https://<your-app-name>.onrender.com
```

---

## 1. Health Check

```bash
curl http://localhost:3000/
```

**Expected:** `200 OK`

```json
{ "status": "ok", "service": "BiteSpeed Identity Reconciliation" }
```

---

## 2. POST /identify — Core Scenarios

### 2.1 New Customer (No Existing Contacts)

Creates a new **primary** contact.

```bash
curl -X POST http://localhost:3000/identify \
  -H "Content-Type: application/json" \
  -d '{"email": "lorraine@hillvalley.edu", "phoneNumber": "123456"}'
```

**Expected:** `200 OK`

```json
{
  "contact": {
    "primaryContactId": 1,
    "emails": ["lorraine@hillvalley.edu"],
    "phoneNumbers": ["123456"],
    "secondaryContactIds": []
  }
}
```

**Verify:** One row in `contacts` table with `link_precedence = 'primary'`.

---

### 2.2 Existing Phone + New Email → Creates Secondary

```bash
curl -X POST http://localhost:3000/identify \
  -H "Content-Type: application/json" \
  -d '{"email": "mcfly@hillvalley.edu", "phoneNumber": "123456"}'
```

**Expected:** `200 OK`

```json
{
  "contact": {
    "primaryContactId": 1,
    "emails": ["lorraine@hillvalley.edu", "mcfly@hillvalley.edu"],
    "phoneNumbers": ["123456"],
    "secondaryContactIds": [2]
  }
}
```

**Verify:** New row with `link_precedence = 'secondary'`, `linked_id = 1`.

---

### 2.3 Existing Email + New Phone → Creates Secondary

```bash
curl -X POST http://localhost:3000/identify \
  -H "Content-Type: application/json" \
  -d '{"email": "lorraine@hillvalley.edu", "phoneNumber": "987654"}'
```

**Expected:** `200 OK` — response includes both phone numbers, new secondary created.

---

### 2.4 Exact Duplicate → No New Row

```bash
curl -X POST http://localhost:3000/identify \
  -H "Content-Type: application/json" \
  -d '{"email": "lorraine@hillvalley.edu", "phoneNumber": "123456"}'
```

**Expected:** `200 OK` — same response as before, no new contact row created.

---

### 2.5 Merge Two Primary Groups (Demotion)

**Step 1:** Create two separate groups.

```bash
curl -X POST http://localhost:3000/identify \
  -H "Content-Type: application/json" \
  -d '{"email": "george@hillvalley.edu", "phoneNumber": "919191"}'
```

```bash
curl -X POST http://localhost:3000/identify \
  -H "Content-Type: application/json" \
  -d '{"email": "biffsucks@hillvalley.edu", "phoneNumber": "717171"}'
```

**Step 2:** Merge them with a linking request.

```bash
curl -X POST http://localhost:3000/identify \
  -H "Content-Type: application/json" \
  -d '{"email": "george@hillvalley.edu", "phoneNumber": "717171"}'
```

**Expected:** `200 OK`

```json
{
  "contact": {
    "primaryContactId": <older_id>,
    "emails": ["george@hillvalley.edu", "biffsucks@hillvalley.edu"],
    "phoneNumbers": ["919191", "717171"],
    "secondaryContactIds": [<newer_id>]
  }
}
```

**Verify:** The newer primary's `link_precedence` changed to `'secondary'` and `linked_id` points to the older primary.

---

### 2.6 Query with Only Email

```bash
curl -X POST http://localhost:3000/identify \
  -H "Content-Type: application/json" \
  -d '{"email": "mcfly@hillvalley.edu"}'
```

**Expected:** `200 OK` — returns the full consolidated group for that email.

---

### 2.7 Query with Only Phone Number

```bash
curl -X POST http://localhost:3000/identify \
  -H "Content-Type: application/json" \
  -d '{"phoneNumber": "123456"}'
```

**Expected:** `200 OK` — returns the full consolidated group for that phone.

---

### 2.8 Null Fields

```bash
curl -X POST http://localhost:3000/identify \
  -H "Content-Type: application/json" \
  -d '{"email": "lorraine@hillvalley.edu", "phoneNumber": null}'
```

**Expected:** `200 OK` — `null` field is ignored, lookup uses only the provided field.

---

## 3. Error Scenarios

### 3.1 Missing Both Fields → 400

```bash
curl -X POST http://localhost:3000/identify \
  -H "Content-Type: application/json" \
  -d '{}'
```

**Expected:** `400 Bad Request`

```json
{ "error": "email or phoneNumber is required" }
```

---

### 3.2 Both Null → 400

```bash
curl -X POST http://localhost:3000/identify \
  -H "Content-Type: application/json" \
  -d '{"email": null, "phoneNumber": null}'
```

**Expected:** `400 Bad Request`

```json
{ "error": "email or phoneNumber is required" }
```

---

### 3.3 Invalid Email Format → 422

```bash
curl -X POST http://localhost:3000/identify \
  -H "Content-Type: application/json" \
  -d '{"email": "not-an-email", "phoneNumber": "123456"}'
```

**Expected:** `422 Unprocessable Entity`

```json
{
  "errors": [
    { "field": "email", "message": "Must be a valid email address" }
  ]
}
```

---

### 3.4 Non-Digit Phone Number → 422

```bash
curl -X POST http://localhost:3000/identify \
  -H "Content-Type: application/json" \
  -d '{"email": "test@test.com", "phoneNumber": "abc123"}'
```

**Expected:** `422 Unprocessable Entity`

```json
{
  "errors": [
    { "field": "phoneNumber", "message": "Must contain only digits" }
  ]
}
```

---

### 3.5 Phone Number Too Long (>20 chars) → 422

```bash
curl -X POST http://localhost:3000/identify \
  -H "Content-Type: application/json" \
  -d '{"phoneNumber": "123456789012345678901"}'
```

**Expected:** `422 Unprocessable Entity`

```json
{
  "errors": [
    { "field": "phoneNumber", "message": "Must be between 1 and 20 characters" }
  ]
}
```

---

### 3.6 Payload Too Large → 413

```bash
curl -X POST http://localhost:3000/identify \
  -H "Content-Type: application/json" \
  -d '{"email": "test@test.com", "phoneNumber": "'"$(python -c "print('1'*20000)")"'"}'
```

Or using PowerShell:

```powershell
$body = '{"email":"test@test.com","phoneNumber":"' + ('1' * 20000) + '"}'
Invoke-RestMethod -Uri http://localhost:3000/identify -Method POST -Body $body -ContentType "application/json"
```

**Expected:** `413 Payload Too Large`

```json
{ "error": "Payload too large" }
```

---

### 3.7 Malformed JSON → 400

```bash
curl -X POST http://localhost:3000/identify \
  -H "Content-Type: application/json" \
  -d '{bad json}'
```

**Expected:** `400 Bad Request`

```json
{ "error": "Invalid JSON in request body" }
```

---

### 3.8 Wrong HTTP Method → 404

```bash
curl http://localhost:3000/identify
```

**Expected:** `404 Not Found` (GET is not handled on `/identify`).

---

## 4. Rate Limiting

Send more than 100 requests in 15 minutes from the same IP:

```powershell
for ($i = 0; $i -lt 105; $i++) {
  $response = Invoke-WebRequest -Uri http://localhost:3000/identify `
    -Method POST -Body '{"email":"test@test.com"}' `
    -ContentType "application/json" -UseBasicParsing
  Write-Host "$i : $($response.StatusCode)"
}
```

**Expected:** First 100 return `200`, then `429 Too Many Requests`:

```json
{ "error": "Too many requests, please try again later" }
```

Response headers include `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset`, and `Retry-After`.

---

## 5. Security Headers

```bash
curl -I -X POST http://localhost:3000/identify \
  -H "Content-Type: application/json" \
  -d '{"email": "test@test.com"}'
```

**Verify these headers are present:**

| Header                        | Expected Value            |
| ----------------------------- | ------------------------- |
| `X-Content-Type-Options`      | `nosniff`                 |
| `X-Frame-Options`             | `SAMEORIGIN`              |
| `Strict-Transport-Security`   | present                   |
| `Content-Security-Policy`     | present                   |
| `X-DNS-Prefetch-Control`      | `off`                     |
| `Referrer-Policy`             | present                   |
| `X-Powered-By`                | **absent** (removed)      |

---

## 6. Testing Checklist

| #  | Test Case                                     | Method | Expected Status | Pass? |
| -- | --------------------------------------------- | ------ | --------------- | ----- |
| 1  | Health check `GET /`                          | GET    | 200             | ☐     |
| 2  | New customer (both email + phone)             | POST   | 200             | ☐     |
| 3  | Existing phone + new email → secondary        | POST   | 200             | ☐     |
| 4  | Existing email + new phone → secondary        | POST   | 200             | ☐     |
| 5  | Exact duplicate → no new row                  | POST   | 200             | ☐     |
| 6  | Merge two primary groups → demotion           | POST   | 200             | ☐     |
| 7  | Query with only email                         | POST   | 200             | ☐     |
| 8  | Query with only phone                         | POST   | 200             | ☐     |
| 9  | Null fields handled correctly                 | POST   | 200             | ☐     |
| 10 | Empty body → 400                              | POST   | 400             | ☐     |
| 11 | Both null → 400                               | POST   | 400             | ☐     |
| 12 | Invalid email → 422                           | POST   | 422             | ☐     |
| 13 | Non-digit phone → 422                         | POST   | 422             | ☐     |
| 14 | Phone too long → 422                          | POST   | 422             | ☐     |
| 15 | Payload too large → 413                       | POST   | 413             | ☐     |
| 16 | Malformed JSON → 400                          | POST   | 400             | ☐     |
| 17 | Wrong HTTP method → 404                       | GET    | 404             | ☐     |
| 18 | Rate limit exceeded → 429                     | POST   | 429             | ☐     |
| 19 | Security headers present                      | POST   | 200             | ☐     |
| 20 | Primary's email/phone first in response arrays| POST   | 200             | ☐     |
| 21 | No duplicates in emails/phoneNumbers arrays   | POST   | 200             | ☐     |

---

## 7. Tools

- **curl** — command-line HTTP client
- **Postman** — GUI API testing (import the requests above)
- **PowerShell** — `Invoke-RestMethod` / `Invoke-WebRequest`
- **Supabase Dashboard** — verify database rows directly at `https://supabase.com/dashboard`

---

## 8. Database Verification Queries

Run these in the Supabase SQL Editor to inspect state after tests:

```sql
-- All contacts
SELECT * FROM contacts WHERE deleted_at IS NULL ORDER BY id;

-- Primary contacts only
SELECT * FROM contacts WHERE link_precedence = 'primary' AND deleted_at IS NULL;

-- Secondary contacts and who they link to
SELECT c.id, c.email, c.phone_number, c.linked_id, p.email AS primary_email
FROM contacts c
LEFT JOIN contacts p ON c.linked_id = p.id
WHERE c.link_precedence = 'secondary' AND c.deleted_at IS NULL;

-- Reset all test data
DELETE FROM contacts;
```
