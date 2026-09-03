export const dynamic = 'force-dynamic';

/**
 * A deliberately tiny endpoint for measuring round-trip time from the browser.
 * No database, no session — the point is to measure the network, not the app.
 */
export function GET() {
  return new Response('1', {
    headers: {
      'content-type': 'text/plain',
      'cache-control': 'no-store, no-cache, must-revalidate',
    },
  });
}
