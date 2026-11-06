// scrypt (RFC 7914) — 메모리를 많이 쓰는 비밀번호 키 만들기.
//
// 왜: 학부모용 내용은 공개 저장소에 암호문으로 올라간다. 누구나 받아서 비밀번호를 끝없이 맞혀 볼 수 있으므로
// PBKDF2(그래픽카드로 빠르게 많이 시도할 수 있음) 대신, 한 번 시도할 때마다 메모리 32MB를 쓰게 하는 scrypt 를 쓴다.
// 브라우저(WebCrypto)에는 scrypt 가 없어서 여기서 직접 계산한다. 안의 PBKDF2-HMAC-SHA256 한 번은 WebCrypto 를 쓴다.
// 시험: tier-test.html 이 RFC 7914 의 시험 값과 비교한다.

const te = new TextEncoder();

async function pbkdf2(pw, salt, len) {
  const k = await crypto.subtle.importKey('raw', pw, 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: 1, hash: 'SHA-256' }, k, len * 8));
}

function salsa8(B, o, x) {
  // B[o..o+16] 을 Salsa20/8 로 바꾼다. x = 일할 칸(Uint32Array 16)
  for (let i = 0; i < 16; i++) x[i] = B[o + i];
  let x0 = x[0], x1 = x[1], x2 = x[2], x3 = x[3], x4 = x[4], x5 = x[5], x6 = x[6], x7 = x[7];
  let x8 = x[8], x9 = x[9], x10 = x[10], x11 = x[11], x12 = x[12], x13 = x[13], x14 = x[14], x15 = x[15];
  let u;
  for (let i = 0; i < 8; i += 2) {
    u = x0 + x12; x4 ^= (u << 7) | (u >>> 25); u = x4 + x0; x8 ^= (u << 9) | (u >>> 23);
    u = x8 + x4; x12 ^= (u << 13) | (u >>> 19); u = x12 + x8; x0 ^= (u << 18) | (u >>> 14);
    u = x5 + x1; x9 ^= (u << 7) | (u >>> 25); u = x9 + x5; x13 ^= (u << 9) | (u >>> 23);
    u = x13 + x9; x1 ^= (u << 13) | (u >>> 19); u = x1 + x13; x5 ^= (u << 18) | (u >>> 14);
    u = x10 + x6; x14 ^= (u << 7) | (u >>> 25); u = x14 + x10; x2 ^= (u << 9) | (u >>> 23);
    u = x2 + x14; x6 ^= (u << 13) | (u >>> 19); u = x6 + x2; x10 ^= (u << 18) | (u >>> 14);
    u = x15 + x11; x3 ^= (u << 7) | (u >>> 25); u = x3 + x15; x7 ^= (u << 9) | (u >>> 23);
    u = x7 + x3; x11 ^= (u << 13) | (u >>> 19); u = x11 + x7; x15 ^= (u << 18) | (u >>> 14);
    u = x0 + x3; x1 ^= (u << 7) | (u >>> 25); u = x1 + x0; x2 ^= (u << 9) | (u >>> 23);
    u = x2 + x1; x3 ^= (u << 13) | (u >>> 19); u = x3 + x2; x0 ^= (u << 18) | (u >>> 14);
    u = x5 + x4; x6 ^= (u << 7) | (u >>> 25); u = x6 + x5; x7 ^= (u << 9) | (u >>> 23);
    u = x7 + x6; x4 ^= (u << 13) | (u >>> 19); u = x4 + x7; x5 ^= (u << 18) | (u >>> 14);
    u = x10 + x9; x11 ^= (u << 7) | (u >>> 25); u = x11 + x10; x8 ^= (u << 9) | (u >>> 23);
    u = x8 + x11; x9 ^= (u << 13) | (u >>> 19); u = x9 + x8; x10 ^= (u << 18) | (u >>> 14);
    u = x15 + x14; x12 ^= (u << 7) | (u >>> 25); u = x12 + x15; x13 ^= (u << 9) | (u >>> 23);
    u = x13 + x12; x14 ^= (u << 13) | (u >>> 19); u = x14 + x13; x15 ^= (u << 18) | (u >>> 14);
  }
  B[o] += x0; B[o + 1] += x1; B[o + 2] += x2; B[o + 3] += x3; B[o + 4] += x4; B[o + 5] += x5; B[o + 6] += x6; B[o + 7] += x7;
  B[o + 8] += x8; B[o + 9] += x9; B[o + 10] += x10; B[o + 11] += x11; B[o + 12] += x12; B[o + 13] += x13; B[o + 14] += x14; B[o + 15] += x15;
}

// X(32r 낱말)를 BlockMix 한다. Y = 같은 크기의 일할 칸, T = 16 낱말
function blockMix(X, Y, r, T, x) {
  const n = 2 * r;
  for (let i = 0; i < 16; i++) T[i] = X[(n - 1) * 16 + i];
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < 16; k++) T[k] ^= X[i * 16 + k];
    salsa8(T, 0, x);
    // 짝수 번째는 앞쪽, 홀수 번째는 뒤쪽
    const dst = ((i & 1) * r + (i >> 1)) * 16;
    for (let k = 0; k < 16; k++) Y[dst + k] = T[k];
  }
  X.set(Y);
}

function roMix(B, r, N) {
  const W = 32 * r;
  const X = new Uint32Array(W);
  const Y = new Uint32Array(W);
  const V = new Uint32Array(W * N);
  const T = new Uint32Array(16);
  const x = new Uint32Array(16);
  for (let i = 0; i < W; i++) {
    const j = i * 4;
    X[i] = B[j] | (B[j + 1] << 8) | (B[j + 2] << 16) | (B[j + 3] << 24);
  }
  for (let i = 0; i < N; i++) {
    V.set(X, i * W);
    blockMix(X, Y, r, T, x);
  }
  for (let i = 0; i < N; i++) {
    const j = X[(2 * r - 1) * 16] & (N - 1);
    const o = j * W;
    for (let k = 0; k < W; k++) X[k] ^= V[o + k];
    blockMix(X, Y, r, T, x);
  }
  for (let i = 0; i < W; i++) {
    const j = i * 4;
    const v = X[i];
    B[j] = v & 255; B[j + 1] = (v >>> 8) & 255; B[j + 2] = (v >>> 16) & 255; B[j + 3] = (v >>> 24) & 255;
  }
}

// → Uint8Array(dkLen). password·salt 는 글자나 Uint8Array
export async function scrypt(password, salt, { N = 32768, r = 8, p = 1, dkLen = 32 } = {}) {
  if (N < 2 || (N & (N - 1)) !== 0) throw new Error('scrypt: N 은 2의 거듭제곱이어야 해요.');
  const pw = typeof password === 'string' ? te.encode(password) : password;
  const s = typeof salt === 'string' ? te.encode(salt) : salt;
  const B = await pbkdf2(pw, s, p * 128 * r);
  for (let i = 0; i < p; i++) {
    const blk = B.subarray(i * 128 * r, (i + 1) * 128 * r);
    roMix(blk, r, N);
    // 오래 걸리는 계산 사이에 화면이 멈추지 않게 한 번 쉰다
    await new Promise(res => setTimeout(res, 0));
  }
  return pbkdf2(pw, B, dkLen);
}
