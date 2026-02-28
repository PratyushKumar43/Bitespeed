# BiteSpeed Identity Reconciliation Service

A backend service that reconciles fragmented customer contact information into unified identities through a `/identify` endpoint.

## Tech Stack

- Node.js with TypeScript
- Express.js
- Supabase (PostgreSQL)

## Setup

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Configure environment variables:**
   Create a `.env` file in the root directory:
   ```env
   PORT=3000
   SUPABASE_URL=your_supabase_url
   SUPABASE_KEY=your_supabase_key
   NODE_ENV=development
   ```

3. **Run database migration:**
   Execute the SQL script in `sql/migration.sql` in your Supabase SQL Editor.

4. **Start the server:**
   ```bash
   # Development mode
   npm run dev

   # Production mode
   npm run build
   npm start
   ```

## API

### POST /identify

Reconciles contact information and returns a unified identity.

**Request:**
```json
{
  "email": "user@example.com",
  "phoneNumber": "1234567890"
}
```

At least one of `email` or `phoneNumber` must be provided.

**Response:**
```json
{
  "contact": {
    "primaryContactId": 1,
    "emails": ["user@example.com"],
    "phoneNumbers": ["1234567890"],
    "secondaryContactIds": []
  }
}
```

**Error Codes:**
- `400` - Missing email and phoneNumber
- `413` - Payload too large (>10KB)
- `422` - Validation errors
- `429` - Rate limit exceeded
- `500` - Internal server error

## Project Structure

```
src/
├── index.ts                  # Express app entry point
├── types.ts                  # TypeScript interfaces
├── config/
│   └── supabase.ts           # Supabase client
├── controllers/
│   └── identifyController.ts # Reconciliation logic
├── middleware/
│   ├── rateLimiter.ts        # Rate limiting
│   ├── requestLogger.ts      # Request logging
│   ├── security.ts           # Security middleware
│   └── validator.ts          # Input validation
├── routes/
│   └── identify.ts           # Route definition
├── services/
│   └── contactService.ts     # Database operations
└── utils/
    └── response.ts           # Response formatting
```
