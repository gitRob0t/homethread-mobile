const encoder = new TextEncoder();
const decoder = new TextDecoder();

export async function sealCalendarSecret(value: string, secret: string) {
  const key = await encryptionKey(secret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encoder.encode(value),
  );
  return `v1.${base64Url(iv)}.${base64Url(new Uint8Array(ciphertext))}`;
}

export async function openCalendarSecret(value: string, secret: string) {
  const [version, ivValue, ciphertextValue] = value.split('.');
  if (version !== 'v1' || !ivValue || !ciphertextValue) {
    throw new Error('Encrypted calendar credential is invalid.');
  }
  const key = await encryptionKey(secret);
  const cleartext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64Url(ivValue) },
    key,
    fromBase64Url(ciphertextValue),
  );
  return decoder.decode(cleartext);
}

export async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(value));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export async function pkceChallenge(verifier: string) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(verifier));
  return base64Url(new Uint8Array(digest));
}

export function randomUrlToken(byteCount = 32) {
  return base64Url(crypto.getRandomValues(new Uint8Array(byteCount)));
}

async function encryptionKey(secret: string) {
  const material = await crypto.subtle.digest('SHA-256', encoder.encode(secret));
  return crypto.subtle.importKey('raw', material, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

function base64Url(bytes: Uint8Array) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/g, '');
}

function fromBase64Url(value: string) {
  const normalized = value.replaceAll('-', '+').replaceAll('_', '/');
  const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}
