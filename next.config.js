// Served inside Growlink LABS at labs.growlink.io/plant-health/ — the LABS
// site rewrites that path to this project, so every page, asset and API
// route lives under the same base path. LABS uses trailing slashes, so we do
// too (otherwise the two sites would redirect a request back and forth).
const BASE_PATH = "/plant-health";
const APP_URL = (process.env.NEXT_PUBLIC_LABS_ORIGIN ?? "https://labs.growlink.io") + BASE_PATH + "/";

/** @type {import('next').NextConfig} */
module.exports = {
  reactStrictMode: true,
  basePath: BASE_PATH,
  trailingSlash: true,
  async redirects() {
    // The bare Vercel URL (and old Builder links) go to the app in LABS.
    return [{ source: "/", destination: APP_URL, basePath: false, permanent: false }];
  },
};
