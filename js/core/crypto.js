// 암호화 (AES-256-GCM) — personal-hub/js/crypto.js 를 바탕으로, 조각마다 경로를 AAD로 묶는 기능을 더했다.
//
// 데이터 키(DEK): 무작위 256비트. 모든 기록과 파일을 이 키로 암호화한다.
// DEK는 vault.json 안에 두 번 감싸서(wrap) 저장한다.
//   - 사이트 비밀번호 → PBKDF2-SHA256(60만 회) → KEK 로 감싼 것
//   - 복구 코드      → PBKDF2-SHA256(20만 회) → KEK 로 감싼 것
// 그래서 비밀번호를 바꾸거나 잊어도(복구 코드로) 데이터를 다시 암호화할 필요가 없다.
//
// AAD(추가 인증 데이터): 암호문을 다른 경로에 옮겨 붙이면 풀리지 않게, 경로·파일 id를 함께 묶는다.

export const ITER = 600000; // 비밀번호
export const RITER = 200000; // 복구 코드 (120비트 무작위라 반복 수가 적어도 충분)

const te = new TextEncoder();
const td = new TextDecoder();

export const utf8 = s => te.encode(s);
export const unutf8 = u8 => td.decode(u8);

export function b64(u8) {
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(s);
}

export function unb64(s) {
  const bin = atob(String(s).replace(/\s+/g, ''));
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return u8;
}

export const b64url = u8 => b64(u8).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export const unb64url = s => unb64(String(s).replace(/-/g, '+').replace(/_/g, '/'));

export const newSalt = () => b64(crypto.getRandomValues(new Uint8Array(16)));

const aadOpt = aad => (aad ? { additionalData: te.encode(aad) } : {});

export async function deriveKEK(secret, saltB64, iter) {
  const base = await crypto.subtle.importKey('raw', te.encode(secret), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: unb64(saltB64), iterations: iter, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export const importDEK = raw => crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);

export async function newDEK() {
  const raw = crypto.getRandomValues(new Uint8Array(32));
  return { raw, key: await importDEK(raw) };
}

export async function encryptText(key, text, aad) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, ...aadOpt(aad) }, key, te.encode(text)));
  return { iv: b64(iv), ct: b64(ct) };
}

export async function decryptText(key, { iv, ct }, aad) {
  return td.decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv), ...aadOpt(aad) }, key, unb64(ct)));
}

// 파일: [iv 12바이트][암호문]
export async function encryptBytes(key, u8, aad) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, ...aadOpt(aad) }, key, u8));
  const out = new Uint8Array(12 + ct.length);
  out.set(iv);
  out.set(ct, 12);
  return out;
}

export async function decryptBytes(key, u8, aad) {
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: u8.subarray(0, 12), ...aadOpt(aad) }, key, u8.subarray(12)));
}

export const wrapDEK = (kek, raw) => encryptText(kek, b64(raw), 'dek');

export async function unwrapDEK(kek, wrap) {
  const raw = unb64(await decryptText(kek, wrap, 'dek'));
  return { raw, key: await importDEK(raw) };
}

// 비밀(비밀번호·복구 코드)로 DEK 감싸기 → vault.json 의 pw / rc 칸
export async function makeWrap(secret, iter, dekRaw) {
  const salt = newSalt();
  const kek = await deriveKEK(secret, salt, iter);
  return { salt, iter, wrap: await wrapDEK(kek, dekRaw) };
}

// 틀리면 null
export async function openWrap(secret, w) {
  try {
    return await unwrapDEK(await deriveKEK(secret, w.salt, w.iter), w.wrap);
  } catch {
    return null;
  }
}

// 복구 코드: 헷갈리는 글자(0/O, 1/I/L)를 뺀 24자, 4자씩 끊어서 표시
const ALPHA = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export function newRecoveryCode() {
  const out = [];
  while (out.length < 24) {
    // 248 이상은 버려서 글자마다 확률이 같게 (31 × 8 = 248)
    for (const b of crypto.getRandomValues(new Uint8Array(32))) if (b < 248 && out.length < 24) out.push(ALPHA[b % 31]);
  }
  return out.join('').match(/.{4}/g).join('-');
}
export const normCode = s => String(s).toUpperCase().replace(/[^A-Z0-9]/g, '');
