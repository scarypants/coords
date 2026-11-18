// 순수 데이터와 규칙. 브라우저 API를 쓰지 않는다 (node tests/domain.test.mjs 로 테스트)

/* ---------- 카테고리 ----------
   id는 DB에 저장되고 아이콘 파일 이름(assets/mc/<id>.png)이라 바꾸지 않는다. name은 자유롭게 바꿔도 된다.
   color, ch: 아이콘 PNG가 없을 때 보이는 임시 색 타일. 'other'는 반드시 마지막 (모르는 id는 기타로 본다) */
export const GROUPS = ['오버월드 구조물', '자연', '네더와 엔드', '우리가 만든 것', '기타'];
const cat = (id, name, g, color, ch) => ({ id, name, group: GROUPS[g], color, ch });
export const CATS = [
  cat('village', '마을', 0, '#a04a2a', '마'),
  cat('outpost', '약탈자 전초기지', 0, '#6b4f2a', '약'),
  cat('mansion', '대저택', 0, '#4a2f18', '대'),
  cat('monument', '바다 신전', 0, '#2d7a73', '신'),
  cat('swamp_hut', '늪 오두막', 0, '#4f6b3a', '늪'),
  cat('igloo', '이글루', 0, '#7fa8c0', '이'),
  cat('ancient', '고대 도시', 0, '#0d6b73', '고'),
  cat('trial', '시련의 방', 0, '#c0714a', '시'),
  cat('stronghold', '엔드 포탈', 0, '#6a6a6a', '요'),
  cat('geode', '자수정 동굴', 1, '#9a5fd0', '자'),
  cat('slime', '슬라임 청크', 1, '#4fa53a', '슬'),
  cat('biome', '바이옴', 1, '#5da130', '바'),
  cat('ore', '광산', 1, '#38a8a8', '광'),
  cat('portal', '지옥문', 2, '#7b2fd6', '문'),
  cat('fortress', '네더 요새', 2, '#6a2330', '네'),
  cat('bastion', '바스티온', 2, '#4a4452', '스'),
  cat('endcity', '엔드 배', 2, '#b08cc0', '배'),
  cat('base', '집', 3, '#c8372d', '집'),
  cat('build', '건축물', 3, '#d98a2b', '건'),
  cat('farm', '농장', 3, '#8fb83a', '농'),
  cat('other', '기타', 4, '#888888', '기'),
];
export const catOf = (id) => CATS.find((c) => c.id === id) ?? CATS[CATS.length - 1];

export const ARMOR_SLOTS = ['helmet', 'chestplate', 'leggings', 'boots'];

/* ---------- 스킨 ----------
   assets/skins/ 의 64x64(또는 옛 64x32) PNG. 사용자는 이 안에서만 고른다. 첫 줄이 기본 스킨 */
export const SKINS = [
  { id: 'santa', name: '산타', file: 'santa-skin.png' },
  { id: 'snowman', name: '눈사람', file: 'snowman-skin.png' },
  { id: 'villager', name: '주민', file: 'villiager-skin.png' },
  { id: 'steve', name: '스티브', file: 'steve-skin.png' },
  { id: 'frog', name: '개구리', file: 'frog-skin.png' },
];
export const skinOf = (id) => SKINS.find((s) => s.id === id) ?? SKINS[0];

/* ---------- 좌표와 tp ---------- */
export const DIM_LABEL = { overworld: '오버월드', nether: '네더', end: '엔드' };
const DIM_ID = { nether: 'minecraft:the_nether', end: 'minecraft:the_end' };

export const coordText = (p) => `${p.x}  ${p.y ?? '~'}  ${p.z}`;

export function tpCmd(p) {
  const base = `tp @s ${p.x} ${p.y ?? '~'} ${p.z}`;
  return p.dimension === 'overworld' ? `/${base}` : `/execute in ${DIM_ID[p.dimension]} run ${base}`;
}

// 오버월드 <-> 네더 대응 좌표 (÷8 내림, ×8). 엔드는 없음
export function counterpart(p) {
  if (p.dimension === 'overworld') return { label: '네더 대응 좌표', x: Math.floor(p.x / 8), z: Math.floor(p.z / 8) };
  if (p.dimension === 'nether') return { label: '오버월드 대응 좌표', x: p.x * 8, z: p.z * 8 };
  return null;
}

/* ---------- 인벤토리 칸 배치 ----------
   { hotbar: [9칸], bag: [9의 배수 칸], skin: 스킨 id | null }, 각 칸은 좌표 id 또는 null.
   스킨 선택도 이름별로 폰과 PC가 같아야 해서 같은 줄에 저장한다 */
const HOTBAR = 9, ROW = 9, MIN_BAG = 27;
const idOrNull = (v) => (Number.isInteger(v) ? v : null);

// DB에서 온 값을 믿지 않고 모양을 맞춘다
export function normalize(raw) {
  return {
    hotbar: Array.from({ length: HOTBAR }, (_, i) => idOrNull(raw?.hotbar?.[i])),
    bag: Array.isArray(raw?.bag) ? raw.bag.map(idOrNull) : [],
    skin: typeof raw?.skin === 'string' ? raw.skin : null,
  };
}

// ids(들어갈 순서대로)가 정확히 한 번씩 들어가게 맞춘다. 자격 없는 것과 중복은 빼고, 빠진 것은 가방 첫 빈 칸에.
// 가방은 마지막 아이템까지 담는 9의 배수(최소 27칸)
export function syncLayout(layout, ids) {
  const want = new Set(ids), seen = new Set();
  const keep = (v) => (v === null || !want.has(v) || seen.has(v) ? null : (seen.add(v), v));
  const hotbar = layout.hotbar.map(keep), bag = layout.bag.map(keep);
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    const free = bag.indexOf(null);
    if (free >= 0) bag[free] = id; else bag.push(id);
  }
  let used = bag.length;
  while (used > 0 && bag[used - 1] === null) used--;
  bag.length = Math.max(MIN_BAG, Math.ceil(used / ROW) * ROW);
  return { ...layout, hotbar, bag: Array.from(bag, (v) => v ?? null) };
}

// 두 칸을 맞바꾼다 (빈 칸으로 옮기기도 교환). a, b: { zone: 'hotbar' | 'bag', i }
export function swap(layout, a, b) {
  const next = { ...layout, hotbar: [...layout.hotbar], bag: [...layout.bag] };
  [next[a.zone][a.i], next[b.zone][b.i]] = [next[b.zone][b.i], next[a.zone][a.i]];
  return next;
}

export const sameLayout = (a, b) => JSON.stringify(a) === JSON.stringify(b);
