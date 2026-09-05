import type { NextConfig } from 'next';

const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-Frame-Options', value: 'DENY' },
  {
    key: 'Permissions-Policy',
    value: 'camera=(), geolocation=(), payment=(self), microphone=(self)',
  },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  { key: 'Cross-Origin-Resource-Policy', value: 'same-origin' },
];

/**
 * The embeddable widgets are served to other people's websites on purpose, so
 * the two headers that exist to stop that have to be relaxed for exactly those
 * paths and nowhere else.
 *
 * `Cross-Origin-Resource-Policy: same-origin` blocks a cross-origin
 * `<script src>` outright — with it applied site-wide, no `<script>` tag on a
 * customer's own site could ever load either widget. `X-Frame-Options` is left
 * alone: neither widget is an iframe, and nothing here should become
 * embeddable as one.
 */
const publicEmbedHeaders = securityHeaders.map((header) =>
  header.key === 'Cross-Origin-Resource-Policy'
    ? { key: header.key, value: 'cross-origin' }
    : header,
);

const nextConfig: NextConfig = {
  async headers() {
    // The catch-all first: where two rules match the same path, the later
    // one's value for a key is the one that survives, so the embed paths must
    // come after it to relax Cross-Origin-Resource-Policy.
    return [
      { source: '/(.*)', headers: securityHeaders },
      { source: '/api/widget/:path*', headers: publicEmbedHeaders },
      { source: '/api/forms/:path*', headers: publicEmbedHeaders },
    ];
  },
};

export default nextConfig;
