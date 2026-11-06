// 학부모 단계(parent) 암호화 — 공개 사이트 저장소 p/ 에 올리는 것 (ACCESS-SPEC.md 의 "봉투 암호화")
//
//   p/public.json        공개 단계: 평문 (홍보 페이지 1~2쪽)
//   p/keyring.json       가족마다 칸 하나 (core/access.js). 칸을 열면 학부모 내용 키 K_parent 가 나온다
//   p/content.json       { v, role:'parent', kid, wk, iv, ct } — 항목 키로 암호화한 학부모용 묶음. 항목 키는 K_parent 로 감싸 wk 에
//   p/a/<앨범id>.json     같은 모양 — 그 앨범의 사진 목록
// 사진·PDF 는 공개 사진 저장소(choir-photos-N)에 파일마다 다른 키로 암호화해 두고, 그 키는 위 항목(학부모만 열 수 있음) 안에만 있다.
//
// 가족이 탈퇴하면 K_parent 를 바꾼다: 새 묶음·바뀐 앨범은 새 항목 키로, 안 바뀐 앨범은 wk 만 새 K 로 다시 감싼다(큰 파일은 그대로).
// 탈퇴한 가족은 그 뒤에 올린 것을 열 수 없다. 이미 받아 둔 것은 그 가족 기기에 남을 수 있다.
// 주의: 공개 저장소의 git 기록에는 예전 파일이 남는다(예전 K 로 열리는 예전 내용). 새 내용은 새 K 로만 열린다.

import * as C from './core/crypto.js';
import { wrapItemKey, unwrapItemKey, keyId } from './core/access.js';

export const CONTENT_PATH = 'p/content.json';
export const KEYRING_PATH = 'p/keyring.json';
export const PUBLIC_PATH = 'p/public.json';
export const STAFF_PATH = 'p/staff.json'; // 스탭 단계: 연락처가 든 명단·비공개 안내 (K_staff)
export const staffRecPath = (col, id) => `p/s/${col}/${id}.json`; // 스탭이 쓰는 기록(회의자료·간식), 기록마다 파일 하나
export const albumPath = id => `p/a/${id}.json`;

const imp = b64 => crypto.subtle.importKey('raw', C.unb64(b64), 'AES-GCM', false, ['encrypt', 'decrypt']);

// 항목 하나 봉하기 (부를 때마다 새 항목 키)
export async function sealItem(kB64, obj, path, role = 'parent') {
  const ik = C.b64(crypto.getRandomValues(new Uint8Array(32)));
  const env = await C.encryptText(await imp(ik), JSON.stringify(obj), path);
  return { v: 2, role, kid: await keyId(kB64), wk: await wrapItemKey(kB64, ik, path), iv: env.iv, ct: env.ct };
}

// 키만 바꾸기: 내용(ct)은 그대로, 항목 키를 새 K 로 다시 감싼다
export async function rewrapItem(oldKB64, newKB64, file, path) {
  const ik = await unwrapItemKey(oldKB64, file.wk, path);
  return { ...file, kid: await keyId(newKB64), wk: await wrapItemKey(newKB64, ik, path) };
}

// 열기. k = K_parent (b64 글자 또는 CryptoKey). 키가 맞지 않으면 오류
export async function openItem(k, file, path) {
  const ik = await unwrapItemKey(k, file.wk, path);
  return JSON.parse(await C.decryptText(await imp(ik), { iv: file.iv, ct: file.ct }, path));
}

export class TierError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

// ---------- 파일(사진·PDF) 하나의 암호화 ----------
// 파일마다 무작위 키. 조각(8MB)마다 따로 암호화, AAD = '<파일id>:<조각 번호>' (작은 그림은 '<파일id>:t')
export const newFileKey = () => C.b64(crypto.getRandomValues(new Uint8Array(32)));
export const fileKey = b64 => imp(b64);
export const encPart = async (key, id, part, bytes) => C.encryptBytes(key, bytes, `${id}:${part}`);
export const decPart = async (key, id, part, bytes) => C.decryptBytes(key, bytes, `${id}:${part}`);
