// 합창단의 접근 등급 설정 (공유 모듈 js/core/access.js 에 넘긴다). 명세: js/core/ACCESS-SPEC.md
//   공개(누구나) < 학부모(가족마다 코드) < 스탭(사람마다 코드, 연락처·회의자료·간식, 쓰기) < 관리자(모든 것 + 코드 발급·회수·역할)
import { createAccess } from './core/access.js';

export const ACCESS_CONFIG = {
  site: 'jayangchoir',
  title: '자양교회 어린이 합창단',
  owner: 'jayangchoir',
  repo: 'jayangchoir.github.io',
  branch: 'main',
  siteUrl: 'https://jayangchoir.github.io/',
  roles: [
    { id: 'public' },
    { id: 'parent', inherits: ['public'] },
    { id: 'staff', name: '스탭', inherits: ['parent'], write: true, labels: ['총무', '부총무', '회계', '서기', '단복', '간식', '스탭'] },
    { id: 'admin', inherits: ['staff'], write: true },
  ],
  // access 가 직접 올리는 파일(스탭 회의자료 첨부) 저장소: choir-files-1, -2 …
  // (사진·악보 PDF 는 js/media.js 가 choir-photos-N 에 올린다 — 수천 장이 되어도 학부모 목록이 커지지 않게 앨범별로 나눠서)
  files: { repos: true, prefix: 'choir-files', limit: 900e6 },
};

// 항목 id (access 등급 목록 안의 이름)
export const ITEM = { public: 'site', content: 'content', staff: 'staff-info', album: id => `album-${id}` };

export const makeAccess = (opts = {}) => createAccess({ ...ACCESS_CONFIG, ...(opts.config || {}) }, opts);
