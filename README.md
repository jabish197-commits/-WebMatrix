# WebMatrix

Multi-role MERN starter with Super Admin, Admin, and Customer dashboards.

## Setup

1. Copy `server/.env.example` to `server/.env`.
2. Create a Supabase project and run `server/supabase/schema.sql` in its SQL Editor.
3. Run `server/supabase/row-level-security.sql` in the SQL Editor to deny direct browser access and verify RLS.
4. Add `SUPABASE_URL` and the server-only `SUPABASE_SERVICE_ROLE_KEY` to `server/.env`. Never add this key to the client, Vercel, or GitHub.
5. Run `npm run install:all`.
6. Run `npm run seed` to create the Super Admin.
7. Run `npm run dev`.

## Password-reset email

The login page links to `/forgot-password`. The API sends a one-time reset link through Resend and stores only its SHA-256 hash in Supabase. Configure these server-only Render variables:

- `RESEND_API_KEY`: your Resend API key.
- `EMAIL_FROM`: `WebMatrix <onboarding@resend.dev>` for testing with the Resend account email, or an address on your verified sending domain for real customers.
- `CLIENT_URL`: the production Vercel URL, such as `https://web-matrix-delta.vercel.app`.

Run `server/supabase/password-reset.sql` once in the Supabase SQL Editor. Reset links expire after 30 minutes, can be used only once, and requesting a new link invalidates the previous one.

Client: http://localhost:5173

API: http://localhost:5000/api

Default seeded login values come from `server/.env`.
