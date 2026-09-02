const encoder = new TextEncoder();

export async function sha256(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(value));
  return toHex(new Uint8Array(digest));
}

export async function verifyPassword(password: string, encodedHash: string) {
  const [algorithm, iterationsValue, saltValue, expectedValue] =
    encodedHash.split('$');
  if (
    algorithm !== 'pbkdf2' ||
    !iterationsValue ||
    !saltValue ||
    !expectedValue
  ) {
    return false;
  }

  const iterations = Number(iterationsValue);
  if (!Number.isSafeInteger(iterations) || iterations < 100_000) return false;

  const material = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const derived = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt: fromBase64(saltValue),
      iterations,
    },
    material,
    256,
  );

  return timingSafeEqual(new Uint8Array(derived), fromBase64(expectedValue));
}

export async function hashPassword(password: string) {
  const iterations = 120_000;
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const material = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const derived = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    material,
    256,
  );
  return `pbkdf2$${iterations}$${toBase64(salt)}$${toBase64(new Uint8Array(derived))}`;
}

export function createOpaqueToken(prefix = '') {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return `${prefix}${toBase64Url(bytes)}`;
}

export async function encryptSecret(secret: string) {
  const rawKey = getEncryptionKey();
  const keyBytes = await crypto.subtle.digest(
    'SHA-256',
    encoder.encode(rawKey),
  );
  const key = await crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'AES-GCM' },
    false,
    ['encrypt'],
  );
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encoder.encode(secret),
  );
  return `v1.${toBase64Url(iv)}.${toBase64Url(new Uint8Array(encrypted))}`;
}

export async function decryptSecret(encodedSecret: string) {
  const [version, ivValue, encryptedValue] = encodedSecret.split('.');
  if (version !== 'v1' || !ivValue || !encryptedValue) {
    throw new Error('Encrypted secret format is invalid.');
  }
  const rawKey = getEncryptionKey();
  const keyBytes = await crypto.subtle.digest(
    'SHA-256',
    encoder.encode(rawKey),
  );
  const key = await crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'AES-GCM' },
    false,
    ['decrypt'],
  );
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64Url(ivValue) },
    key,
    fromBase64Url(encryptedValue),
  );
  return new TextDecoder().decode(decrypted);
}

function getEncryptionKey() {
  const configured = process.env.VAANI_ENCRYPTION_KEY;
  if (configured && configured.length >= 32) return configured;
  if (process.env.NODE_ENV !== 'production') {
    return 'vaani-local-only-encryption-key-change-before-production';
  }
  throw new Error('VAANI_ENCRYPTION_KEY must be configured.');
}

function timingSafeEqual(left: Uint8Array, right: Uint8Array) {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left[index] ^ right[index];
  }
  return mismatch === 0;
}

function toHex(value: Uint8Array) {
  return Array.from(value, (byte) => byte.toString(16).padStart(2, '0')).join(
    '',
  );
}

function toBase64(value: Uint8Array) {
  let binary = '';
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string) {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function toBase64Url(value: Uint8Array) {
  let binary = '';
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');
}

function fromBase64Url(value: string) {
  const padded = value
    .replaceAll('-', '+')
    .replaceAll('_', '/')
    .padEnd(Math.ceil(value.length / 4) * 4, '=');
  return fromBase64(padded);
}
