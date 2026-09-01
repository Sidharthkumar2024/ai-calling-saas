declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    RECORDINGS?: R2Bucket;
  }
}
