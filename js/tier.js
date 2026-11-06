// 학부모 단계(parent tier) 암호화 — 공개 사이트 저장소에 올리는 암호문
//
// 학부모는 토큰 없이 "학부모 비밀번호" 하나만 안다. 그래서 학부모용 내용은 공개 저장소에 암호문으로 둔다.
// 누구나 그 암호문을 받아 비밀번호를 끝없이 맞혀 볼 수 있으므로:
//   - 키 만들기는 scrypt(N=2^16, r=8, p=2, 64MB) — 한 번 맞혀 보는 데 메모리와 시간이 많이 든다
//   - 관리자 화면은 약한 비밀번호(10자 미만·흔한 모양)에 경고한다
//
// 구조 (공개 사이트 저장소 jayangchoir/jayangchoir.github.io)
//   p/content.json      { v, kdf: { alg:'scrypt', N, r, p, salt }, wrap, iv, ct, rev, at }
//                         wrap = AES-GCM(KEK = scrypt(학부모 비밀번호), 내용 키 CK)
//                         iv/ct = AES-GCM(CK, 학부모용 묶음 JSON), AAD 'p/content.json'
//   p/a/<앨범id>.json    { iv, ct } = AES-GCM(CK, 그 앨범의 사진 목록), AAD = 경로
// 사진·PDF 는 공개 사진 저장소(choir-photos-N)에 파일마다 다른 무작위 키로 암호화해 두고,
// 그 키는 위 묶음(CK 로 암호화) 안에만 있다. 그래서 학부모 비밀번호 없이는 아무것도 열리지 않는다.
//
// 학부모 비밀번호를 바꾸면 새 salt·새 CK 로 묶음과 앨범 목록을 모두 다시 암호화한다 → 예전 비밀번호로는 새 내용이 열리지 않는다.
// (수천 장의 사진 파일 자체는 다시 올리지 않는다. 사진 키는 새 묶음 안에만 들어가고, 새로 올리는 사진은 새 키를 받는다.)
// 주의: 공개 저장소의 git 기록에는 예전 암호문이 남는다. 예전 비밀번호를 아는 사람은 그때까지의 내용은 볼 수 있다.

import { scrypt } from './core/scrypt.js';
import * as C from './core/crypto.js';

export const KDF = { alg: 'scrypt', N: 65536, r: 8, p: 2 };
export const CONTENT_PATH = 'p/content.json';
export const albumPath = id => `p/a/${id}.json`;

export class TierError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

async function kekFrom(password, kdf) {
  if (kdf.alg !== 'scrypt') throw new TierError('bad-kdf', '알 수 없는 암호 방식이에요. 사이트를 새로고침해 주세요.');
  const raw = await scrypt(String(password).normalize('NFC'), C.unb64(kdf.salt), { N: kdf.N, r: kdf.r, p: kdf.p, dkLen: 32 });
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

// 관리자: 새 학부모 비밀번호 → { kdf, wrap, ckRaw(b64) }. ckRaw 는 관리자 데이터(비공개, 암호화)에만 둔다
export async function newParentKey(password, kdf = KDF) {
  const k = { ...kdf, salt: C.newSalt() };
  const ck = crypto.getRandomValues(new Uint8Array(32));
  const kek = await kekFrom(password, k);
  const wrap = await C.encryptText(kek, C.b64(ck), 'jayangchoir-ck');
  return { kdf: k, wrap, ck: C.b64(ck) };
}

export const importCK = (b64, extractable = false) => crypto.subtle.importKey('raw', C.unb64(b64), 'AES-GCM', extractable, ['encrypt', 'decrypt']);

// 학부모: 비밀번호로 CK 를 연다. 틀리면 TierError('bad-password')
export async function openParentKey(password, env) {
  const kek = await kekFrom(password, env.kdf);
  let raw;
  try {
    raw = await C.decryptText(kek, env.wrap, 'jayangchoir-ck');
  } catch {
    throw new TierError('bad-password', '비밀번호가 맞지 않아요.');
  }
  return importCK(raw);
}

export const sealJSON = async (ck, obj, aad) => C.encryptText(ck, JSON.stringify(obj), aad);
export const openJSON = async (ck, env, aad) => JSON.parse(await C.decryptText(ck, env, aad));

// p/content.json 의 글자
export async function contentFile(key, bundle, rev) {
  const ck = await importCK(key.ck);
  const env = await sealJSON(ck, bundle, CONTENT_PATH);
  return JSON.stringify({ v: 1, app: 'jayangchoir-parent', kdf: key.kdf, wrap: key.wrap, iv: env.iv, ct: env.ct, rev, at: new Date().toISOString() });
}

export async function albumFile(key, albumId, list) {
  const ck = await importCK(key.ck);
  const env = await sealJSON(ck, list, albumPath(albumId));
  return JSON.stringify({ v: 1, iv: env.iv, ct: env.ct });
}

// ---------- 파일(사진·PDF) 하나의 암호화 ----------
// 파일마다 무작위 키. 조각(8MB)마다 따로 암호화, AAD = '<파일id>:<조각 번호>' (작은 그림은 '<파일id>:t')
export const newFileKey = () => C.b64(crypto.getRandomValues(new Uint8Array(32)));
export const fileKey = b64 => crypto.subtle.importKey('raw', C.unb64(b64), 'AES-GCM', false, ['encrypt', 'decrypt']);
export const encPart = async (key, id, part, bytes) => C.encryptBytes(key, bytes, `${id}:${part}`);
export const decPart = async (key, id, part, bytes) => C.decryptBytes(key, bytes, `${id}:${part}`);

// ---------- 약한 비밀번호 ----------
const COMMON = [
  'password', 'passw0rd', 'qwerty', 'asdf', 'zxcv', 'admin', 'letmein', 'welcome', 'iloveyou', 'abc', 'love', 'test',
  'jayang', 'jychoir', 'choir', 'church', 'jesus', 'amen', 'hallelujah', 'kids', 'children', 'parent',
  '자양', '합창', '교회', '어린이', '학부모', '비밀번호', '사랑', '감사', '할렐루야', '아멘', '예수',
];

// → 경고 문장 목록 (비어 있으면 괜찮음)
export function weakReasons(pw) {
  const s = String(pw || '');
  const low = s.toLowerCase();
  const out = [];
  if ([...s].length < 10) out.push('10자보다 짧아요.');
  if (/^\d+$/.test(s)) out.push('숫자만으로 되어 있어요.');
  if (/^[a-z]+$/i.test(s) && s.length < 14) out.push('영어 글자만으로 되어 있어요.');
  if (/(.)\1{2,}/.test(s)) out.push('같은 글자가 3번 넘게 이어져요.');
  const seqs = ['0123456789', 'abcdefghijklmnopqrstuvwxyz', 'qwertyuiop', 'asdfghjkl', 'zxcvbnm', '9876543210'];
  if (seqs.some(q => { for (let i = 0; i + 4 <= q.length; i++) if (low.includes(q.slice(i, i + 4))) return true; return false; })) out.push('1234·abcd·qwer 같은 이어지는 글자가 있어요.');
  const hit = COMMON.find(w => low.includes(w));
  if (hit) out.push(`흔한 낱말(“${hit}”)이 들어 있어요.`);
  if (/(19|20)\d{2}/.test(s) && s.replace(/(19|20)\d{2}/g, '').length < 8) out.push('연도를 빼면 너무 짧아요.');
  if (new Set(s).size < 5) out.push('쓴 글자 종류가 너무 적어요.');
  return out;
}

// 기억하기 좋은 강한 비밀번호 예 (낱말 4개 + 숫자 2자리, 약 144⁴×90 가지 ≈ 2^35). 관리자 화면의 "추천" 버튼
const WORDS = '봄비 노을 구름 바다 숲길 별빛 햇살 파도 단풍 눈꽃 새벽 호수 들꽃 나무 하늘 은하 노래 종소리 무지개 시냇물 반딧불 솔바람 꽃잎 달빛 사과 포도 딸기 수박 참외 자두 앵두 복숭아 감귤 호두 밤송이 도토리 옥수수 감자 고구마 당근 배추 상추 오이 호박 토끼 다람쥐 고래 펭귄 기린 사슴 여우 부엉이 참새 제비 까치 오리 거북 나비 잠자리 무당벌레 코끼리 판다 수달 고슴도치 연필 공책 지우개 색종이 풍선 우산 장화 모자 장갑 목도리 가방 시계 등불 촛불 열쇠 편지 우표 사진기 망원경 나침반 피아노 기타 바이올린 첼로 플루트 북소리 리코더 실로폰 탬버린 하모니카 트럼펫 오카리나 음표 악보 화음 박자 쉼표 높은음 낮은음 골목 다리 언덕 계곡 폭포 동굴 섬마을 등대 항구 기차 버스 자전거 돛단배 비행기 열기구 우주선 정거장 놀이터 운동장 도서관 아침 점심 저녁 한낮 한밤 봄날 여름 가을 겨울 소나기 함박눈 이슬 안개 서리 번개 천둥 바람개비 연날리기 썰매 눈사람'.split(' ');
export function suggestPassword() {
  const r = n => {
    // 고르게 뽑기 (나머지 치우침 없음)
    const lim = Math.floor(2 ** 32 / n) * n;
    for (;;) { const x = crypto.getRandomValues(new Uint32Array(1))[0]; if (x < lim) return x % n; }
  };
  const pick = () => WORDS[r(WORDS.length)];
  return `${pick()}-${pick()}-${pick()}-${pick()}-${10 + r(90)}`;
}
