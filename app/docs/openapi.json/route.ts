import { PUBLIC_API_SPEC } from '@/lib/public-api-spec';
export function GET() {
  return Response.json(PUBLIC_API_SPEC, {
    headers: {
      'content-disposition': 'inline; filename="call-vani-openapi.json"',
      'cache-control': 'public, max-age=300',
    },
  });
}
