const basePath = process.env.NEXT_PUBLIC_BASE_PATH || '';
// GITHUB_PAGES=1 — статическая сборка для GitHub Pages: без сервера, поэтому без маршрутов /api и своих заголовков.
const pages = process.env.GITHUB_PAGES === '1';

/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  poweredByHeader: false,
  basePath,
  ...(pages
    ? { output: 'export', images: { unoptimized: true } }
    : {
        async headers() {
          return [
            { source: '/sw.js', headers: [{ key: 'Cache-Control', value: 'no-cache' }] },
            {
              source: '/:path*',
              headers: [
                { key: 'X-Content-Type-Options', value: 'nosniff' },
                { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
                { key: 'X-Frame-Options', value: 'DENY' },
              ],
            },
          ];
        },
      }),
};

export default config;
