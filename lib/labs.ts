// Growlink LABS: where this app lives and whose login it uses.
//
// The app is served at labs.growlink.io/plant-health/ (a rewrite on the LABS
// site to this Vercel project, which builds with basePath /plant-health).
// Sign-in is the LABS account: Supabase Auth in the LABS platform project,
// shared by every LABS page on that origin under one localStorage key.
// The publishable key is public by design (LABS ships it in labs-auth.js).

export const BASE_PATH = "/plant-health";
export const LABS_ORIGIN = process.env.NEXT_PUBLIC_LABS_ORIGIN ?? "https://labs.growlink.io";
export const APP_URL = `${LABS_ORIGIN}${BASE_PATH}/`;

export const LABS_SUPABASE_URL = process.env.NEXT_PUBLIC_LABS_SUPABASE_URL ?? "https://mgenmllmciiijyeielak.supabase.co";
export const LABS_PUBLISHABLE_KEY =
  process.env.NEXT_PUBLIC_LABS_PUBLISHABLE_KEY ?? "sb_publishable_bM41aNdv5IJvmhWGmBcDiQ_eiY6QG8-";
export const LABS_STORAGE_KEY = "growlink.labs.auth";

/** An app path with the base path and the trailing slash both sites use. */
export function appPath(path: string): string {
  const [p, q] = path.split("?");
  const withSlash = p.endsWith("/") ? p : p + "/";
  return BASE_PATH + withSlash + (q !== undefined ? "?" + q : "");
}
