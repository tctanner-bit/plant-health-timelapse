# Plant Health Timelapse — web player

A tiny Next.js app that reads frames from your Supabase `frames` table and
plays them back as a timelapse. Public, read-only. Deploys to Vercel.

## Local run

1. Install Node.js 18+ if you don't have it.
2. In this folder:
   ```
   npm install
   cp .env.local.example .env.local
   ```
3. Open `.env.local` and paste your Supabase project URL and **publishable** key
   (the `sb_publishable_...` one — never the secret key).
4. `npm run dev`, then open http://localhost:3000

## Deploy to Vercel

1. Push this folder to a GitHub repo.
2. In Vercel, "Add new... → Project", import the repo.
3. Under Environment Variables, add:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`  (the publishable key)
4. Deploy. Vercel gives you a public URL — that's the link to share.

## Why these keys are safe in the browser

The publishable key is designed to be public. What it can actually do is
defined by the row-level security policies in Supabase. We added two:
read-only access to the `frames` table and read-only access to objects in the
`frames` bucket. Writes (upload, delete, update) are denied for this key, so
the worst a visitor can do is view the timelapse — which is the point.
