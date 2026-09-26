# display-fleet backend changes

Changes this project made to the **display-fleet** Supabase project
(`qjitjkoerviorscyupun`): the AI proxy that all of Nova goes through, and the
usage ledger. They're kept here until they move to the repo that owns the
fleet backend. Deploy from there, or copy these in first, so a redeploy
doesn't drop them.

| File | What |
|---|---|
| `functions/ai/index.ts` | AI proxy (current): panel / user / service-key auth, per-call usage metering, per-org budgets |
| `functions/ai/index.v5.ts` | Proxy as of v5 (service-key auth only), kept as the diff baseline |
| `migrations/20260926100000_ai_usage_ledger.sql` | `ai_usage`, `ai_prices`, `ai_budgets`, `ai_month_spend()`, `ai_usage_daily` |

Secrets on the `ai` function: `OPENAI_API_KEY`, `AI_SERVICE_KEYS`.

Deploy: `supabase functions deploy ai --no-verify-jwt --project-ref qjitjkoerviorscyupun`
