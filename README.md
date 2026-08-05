# WebMatrix

Multi-role MERN starter with Super Admin, Admin, and Customer dashboards.

## Setup

1. Copy `server/.env.example` to `server/.env`.
2. Create a Supabase project and run `server/supabase/schema.sql` in its SQL Editor.
3. Add `SUPABASE_URL` and the server-only `SUPABASE_SERVICE_ROLE_KEY` to `server/.env`.
4. Run `npm run install:all`.
5. Run `npm run seed` to create the Super Admin.
6. Run `npm run dev`.

Client: http://localhost:5173

API: http://localhost:5000/api

Default seeded login values come from `server/.env`.
