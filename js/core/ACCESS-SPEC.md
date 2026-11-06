# Access tiers spec (shared by jayangchild, jayangchoir and forcsoz sites)

Owner: the manager (main session). Every site implements tiers against THIS spec, so the code can be shared.
Constraint: static GitHub Pages, no server. Anything in a public repo can be downloaded and attacked offline.

## Roles
- A site declares its roles in config, for example:
  `[{id:'public'}, {id:'parent', inherits:['public']}, {id:'teacher', inherits:['parent']}, {id:'officer', inherits:['teacher'], write:true, labels:['부장','부감','총무','회계','서기']}, {id:'admin', inherits:['officer'], write:true}]`
- `public` content is plaintext, published as ordinary site files.
- Every other role R has a random 256-bit content key K_R.
- A person's **bundle** holds K for their role and for every role it inherits. If the role has `write`, the bundle also carries the GitHub token used for writing.

## Content (envelope encryption)
- Each record or file gets its own random item key. The item key is wrapped under K_R, where R is the lowest role allowed to see the item, and stored in the item's header or index entry.
- Binary blobs stay untouched on rotation; only the wrapped item keys change.
- Reader-tier ciphertext is published in the PUBLIC site repo or in public file repos (`<site>-files-1`, `-2`, …, auto-created by a writer near 900MB). The full admin data stays in the private data repo (the existing core vault).

## People and credentials
- The admin manages a people list in the private vault. Each person has: id, display name, role, role label(s), status, issued date and revoked date.
- Login: identifier + secret. A slot lookup id = SHA-256(siteSalt + normalized identifier).
  - The slot is AES-GCM(bundle) under a KEK = PBKDF2-SHA256(secret, per-slot salt, 600k).
  - Slots are published in a public `keyring.json`.
- **Default secret: an admin-issued random access code**, e.g. `K7QX-M2PA-9TRD`, at least 60 bits. The admin UI generates the code and shows a ready-to-send Korean invitation message (copy button). It can also print a card.
- The person may change their code to their own passphrase, which must be at least 10 chars.
- A weak-only login such as birthdate or a 4-digit PIN is NOT allowed as the sole secret. Offline guessing would break it within hours.
- Keep an `authProvider` interface: `login(identifier, secret) → bundle`. That way a future auth server (for example a Cloudflare Worker doing birthdate+rate-limit, email OTP or a customer DB check) can be plugged in without UI changes.

## Revocation
- Removing a person deletes their slot.
- It then rotates K for each role they held: new key, re-wrap the item keys, and re-wrap every remaining slot of that role.
- The new keyring and index are republished in one commit.
- A revoked person can never decrypt anything published afterwards. Anything they already downloaded stays with them; say so plainly in the UI.

## UX rules (user's standing rules)
- Korean, plain words. Every lock, code, token or revoke text says what stays safe.
- Never hard-delete data; use the trash. No action may lose un-uploaded changes.
- Readers cannot write, so no "last login" record exists without a server. The UI must not pretend otherwise.

## Site role maps (from the user, 2026-11-06)
- **jayangchild (유년부):**
  - 공개: a few promo pages
  - 학부모: activity photos and video links
  - 선생님: 명단, 사진, 달란트, 연간계획, 주보
  - 임원: 정책, 임원회의 자료, upload; labels 부장/부감/총무/회계/서기
  - 관리자: everything, including managing teachers and parents, pages and backup data
- **jayangchoir (합창단):** (corrected 11-06)
  - 공개: 1–2 promo pages
  - 학부모: all current content (per-family codes; a family that leaves must lose access)
  - 스탭: private data (contacts, personal info), 회의자료 sharing, 간식 rota; can write
  - 관리자: permission management + everything
- **forcsoz (OZ 컨설팅):**
  - 공개: 기술공지
  - 유지보수고객: an 인증번호 from the company DB unlocks the patch downloads. Static version: the admin imports the list of valid numbers and gets one slot per number. Numbers need at least 40 bits of entropy; otherwise flag it.
  - 컨설팅팀원: view only, @forcs.com email verification. Static version: the admin issues a code to each @forcs.com address; true email OTP needs the auth server.
  - 작성자: edits posts, so `write`
  - 관리자: oz@ account; site and permission management
