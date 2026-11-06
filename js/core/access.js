// 접근 단계(공개 · 학부모 · 관리자) — ACCESS-SPEC.md (jayangchild-site/js/core) 를 따른 구현.
//
// ★ 공유 모듈(jayangchild-site/js/core/access.js)이 완성되면 이 파일을 그것으로 바꾼다.
//   합창단 사이트가 이 파일에서 쓰는 것은 아래 export 뿐이다 (바꿀 때 이름·모양만 맞추면 된다):
//     ROLES, roleClosure, newAccessCode, normCode, normIdentifier, lookupId, newKey, keyId,
//     makeSlotHead, sealSlot, openSlot, openSlotWithPk, wrapItemKey, unwrapItemKey, createKeyringProvider
//
// 규칙 (스펙 요약)
//   - public 은 평문. 그 밖의 역할 R 마다 무작위 256비트 내용 키 K_R.
//   - 사람마다 "묶음(bundle)" = { role, keys: { R: K_R(b64) … 물려받는 역할 포함 }, person: { id, name } } (+ write 면 토큰).
//   - 로그인 = 식별자 + 비밀(관리자가 발급한 접속 코드, 60비트 이상).
//     칸(slot) 찾기 id = SHA-256(siteSalt + 정규화한 식별자). 칸은 공개 keyring.json 에 있다.
//     칸 = { salt, iter, wpk: PBKDF2-SHA256(비밀, salt, 60만 회)로 감싼 사람 키 PK, b: PK 로 암호화한 묶음 }
//     (사람 키 PK 를 한 겹 두는 까닭: 탈퇴 처리로 K_R 을 바꿀 때, 남은 사람의 비밀을 몰라도 관리자가 PK 로 묶음만 다시 암호화할 수 있게.
//      PK 는 관리자 데이터(비공개 저장소)에만 있고, 각 사람은 자기 PK 만 안다.)
//   - 내용은 항목마다 무작위 항목 키, 항목 키는 K_R 로 감싸 머리(wk)에 둔다. 키를 바꿀 때 큰 파일은 그대로 두고 wk 만 다시 감싼다.
//   - 탈퇴: 그 사람의 칸을 지우고, 그 사람이 가졌던 역할의 K 를 바꾸고(항목 키 다시 감싸기 + 남은 칸 다시 암호화), 커밋 하나로 다시 올린다.
//     탈퇴한 사람은 그 뒤에 올린 것은 열 수 없다. 이미 받아 둔 것은 그 사람 기기에 남는다 (화면에 그대로 알린다).

import * as C from './crypto.js';

export const KDF_ITER = 600000;

// 합창단 역할 (스펙의 "Site role maps")
//   공개(누구나) < 학부모(가족 코드) < 스탭(개인 코드, 연락처·회의자료·간식, 쓰기) < 관리자(코드 발급·회수·역할 바꾸기, 모든 것)
//   관리자는 keyring 칸 대신 core 의 vault(관리자 비밀번호·복구 코드·QR)로 연다.
export const ROLES = [
  { id: 'public' },
  { id: 'parent', inherits: ['public'], label: '학부모' },
  { id: 'staff', inherits: ['parent'], write: true, label: '스탭', labels: ['총무', '부총무', '회계', '서기', '단복', '간식', '스탭'] },
  { id: 'admin', inherits: ['staff'], write: true, label: '관리자' },
];

// 역할과 그 역할이 물려받는 모든 역할 (자기 포함)
export function roleClosure(roles, id, out = new Set()) {
  if (out.has(id)) return out;
  out.add(id);
  for (const r of roles.find(x => x.id === id)?.inherits || []) roleClosure(roles, r, out);
  return out;
}

// 접속 코드: 헷갈리는 글자(0/O, 1/I) 를 뺀 32글자 × 12자리 = 60비트, "K7QX-M2PA-9TRD" 모양
const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function newAccessCode() {
  const b = crypto.getRandomValues(new Uint8Array(12));
  const s = [...b].map(x => ALPHA[x & 31]).join('');
  return s.match(/.{4}/g).join('-');
}
// 대소문자·띄어쓰기·하이픈은 상관없게 (코드 글자에는 0·O·1·I 가 없어서 헷갈릴 글자가 없다)
export const normCode = s => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
export const normIdentifier = s => String(s || '').normalize('NFC').trim().toLowerCase().replace(/\s+/g, '');

const hex = u8 => [...u8].map(b => b.toString(16).padStart(2, '0')).join('');
export async function lookupId(siteSalt, identifier) {
  return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', C.utf8(`${siteSalt}|${normIdentifier(identifier)}`)))).slice(0, 40);
}

export const newKey = () => C.b64(crypto.getRandomValues(new Uint8Array(32)));
const imp = b64 => crypto.subtle.importKey('raw', C.unb64(b64), 'AES-GCM', false, ['encrypt', 'decrypt']);
export async function keyId(b64) { return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', C.unb64(b64)))).slice(0, 12); }

// 관리자: 사람 한 명의 칸 머리 (비밀이 있을 때 한 번만 만든다. 60만 회라 조금 걸린다)
export async function makeSlotHead(secret, pkB64) {
  const salt = C.newSalt();
  const kek = await C.deriveKEK(normCode(secret), salt, KDF_ITER);
  return { salt, iter: KDF_ITER, wpk: await C.encryptText(kek, pkB64, 'pk') };
}

// 관리자: 칸 = 머리 + PK 로 암호화한 묶음 (K 가 바뀔 때마다 이 부분만 다시)
export async function sealSlot(head, pkB64, bundle, role) {
  const b = await C.encryptText(await imp(pkB64), JSON.stringify(bundle), 'bundle');
  return { role, salt: head.salt, iter: head.iter, wpk: head.wpk, b };
}

// 사람: 비밀로 칸 열기 → { bundle, pk(꺼낼 수 없는 키) }. 틀리면 null
export async function openSlot(slot, secret) {
  let pkB64;
  try {
    pkB64 = await C.decryptText(await C.deriveKEK(normCode(secret), slot.salt, slot.iter || KDF_ITER), slot.wpk, 'pk');
  } catch {
    return null;
  }
  const pk = await imp(pkB64);
  return { pk, bundle: await openSlotWithPk(slot, pk) };
}
export async function openSlotWithPk(slot, pk) {
  return JSON.parse(await C.decryptText(pk, slot.b, 'bundle'));
}

// 항목 키 감싸기 (aad = 항목 경로)
export async function wrapItemKey(kB64, itemKeyB64, aad) { return C.encryptText(await imp(kB64), itemKeyB64, `ik:${aad}`); }
export async function unwrapItemKey(k, wk, aad) {
  const key = typeof k === 'string' ? await imp(k) : k;
  return C.decryptText(key, wk, `ik:${aad}`);
}

// authProvider: login(식별자, 비밀) → { bundle, pk, lookup }. 나중에 인증 서버(예: Cloudflare Worker)로 바꿔 끼울 수 있게 이 모양만 지킨다
//   fetchKeyring() → keyring.json 객체 (없으면 null)
export function createKeyringProvider({ fetchKeyring }) {
  return {
    kind: 'static-keyring',
    async login(identifier, secret) {
      const kr = await fetchKeyring();
      if (!kr?.slots) throw Object.assign(new Error('아직 학부모 화면이 준비되지 않았어요.'), { code: 'none' });
      const lookup = await lookupId(kr.siteSalt, identifier);
      const slot = kr.slots[lookup];
      if (!slot) throw Object.assign(new Error('아이 이름이나 접속 코드가 맞지 않아요.'), { code: 'bad-login' });
      const r = await openSlot(slot, secret);
      if (!r) throw Object.assign(new Error('아이 이름이나 접속 코드가 맞지 않아요.'), { code: 'bad-login' });
      return { ...r, lookup };
    },
    // 기억해 둔 사람 키로 다시 열기 (코드를 다시 묻지 않음). 칸이 없어졌으면(탈퇴) null
    async resume(lookup, pk) {
      const kr = await fetchKeyring();
      const slot = kr?.slots?.[lookup];
      if (!slot) return null;
      try { return { bundle: await openSlotWithPk(slot, pk), pk, lookup }; } catch { return null; }
    },
  };
}
