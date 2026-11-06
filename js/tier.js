// 사진·PDF 한 장의 암호화 (공개 사진 저장소 choir-photos-N 에 올리는 것)
// 파일마다 무작위 키. 조각(8MB)마다 따로 암호화, AAD = '<파일id>:<조각 번호>' (작은 그림은 '<파일id>:t').
// 그 키는 관리자 데이터(media 기록)와, 학부모 등급 항목(access.js 가 학부모 열쇠로 감싼 'content'·'album-…') 안에만 있다.
// 그래서 학부모 열쇠가 바뀌면(가족 탈퇴) 큰 파일은 그대로 두고도 탈퇴한 가족은 새 항목을 못 연다.
import * as C from './core/crypto.js';

export const newFileKey = () => C.b64(crypto.getRandomValues(new Uint8Array(32)));
export const fileKey = b64 => crypto.subtle.importKey('raw', C.unb64(b64), 'AES-GCM', false, ['encrypt', 'decrypt']);
export const encPart = async (key, id, part, bytes) => C.encryptBytes(key, bytes, `${id}:${part}`);
export const decPart = async (key, id, part, bytes) => C.decryptBytes(key, bytes, `${id}:${part}`);
