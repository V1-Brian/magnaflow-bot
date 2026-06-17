# MagnaFlow Parts Bot

A chat + voice bot that identifies the exact MagnaFlow part number for any customer's vehicle, down to engine size, submodel, and configuration.

Built to demo against a manually seeded slice of MagnaFlow's catalog, with the schema designed to accept a full ACES/PIES data drop with zero restructuring.

## Stack

| Layer | Tool |
|---|---|
| Frontend | Vercel (React + Vite) |
| Backend | Render (Node.js / Express) |
| Database | Render PostgreSQL |
| Cache | Cloudflare Workers KV |
| Intelligence | Claude API (`claude-sonnet-4-6`) |
| Voice (optional) | Twilio + ElevenLabs or Vapi.ai |

## Quick Start

### 1. Database

```bash
# Apply schema to your Render Postgres instance
psql $DATABASE_URL -f backend/src/db/schema.sql

# Seed demo vehicles and parts
cd backend && npm install && npm run seed
```

### 2. Backend

```bash
cd backend
cp .env.example .env   # fill in your keys
npm run dev            # starts on port 3001
```

Test with curl:
```bash
curl -X POST http://localhost:3001/chat \
  -H "Content-Type: application/json" \
  -d '{"message":"2019 Toyota Tacoma","sessionId":"test-1"}'
```

### 3. Frontend

```bash
cd frontend
cp .env.example .env   # set VITE_API_URL
npm install
npm run dev
```

### 4. Cache (pre-demo)

```bash
node scripts/cache-pages.js
```

### 5. Voice (optional)

Configure a Twilio phone number to POST to `https://your-backend.onrender.com/voice/inbound`.

Or use Vapi.ai — set the server URL to your `/chat` endpoint and skip the Twilio wiring.

## When ACES/PIES Data Arrives

```bash
# Drop files into:
#   data/aces.xml
#   data/pies.xml

cd backend && npm run import-aces
# Zero code changes — bot immediately has the full catalog
```

## Demo Script

| Scenario | Input | Expected SKU |
|---|---|---|
| Stock Tacoma | 2019 Tacoma TRD Off-Road 3.5L, no lift | 19293 |
| Lifted Tacoma | Same truck, 3-inch lift | 19583 |
| F-150 | 2021 F-150 5.0L | 19835 |
