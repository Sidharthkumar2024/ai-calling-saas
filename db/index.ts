import { env } from 'cloudflare:workers';
import { drizzle } from 'drizzle-orm/d1';

import * as schema from './schema';

export function getRawDb(): D1Database {
  if (!env.DB) {
    throw new Error(
      'Cloudflare D1 binding `DB` is unavailable. Set `d1` to `DB` in .openai/hosting.json.',
    );
  }

  return env.DB;
}

export function getDb() {
  return drizzle(getRawDb(), { schema });
}
