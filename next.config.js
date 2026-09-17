/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // alasql (text→SQL wala in-memory engine) ke andar react-native ke optional
  // require hain. Bundle karne par webpack/turbopack unhe dhoondhta hai aur build
  // tootti hai. External rakh do — server par seedha node_modules se load hoga.
  // (Next 15 se pehle ye `experimental.serverComponentsExternalPackages` tha.)
  serverExternalPackages: ["alasql"],
};
module.exports = nextConfig;
