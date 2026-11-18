// 실행: node tests/domain.test.mjs
import assert from 'node:assert/strict';
import { CATS, catOf, SKINS, skinOf, SKIN_DATA_PREFIX, SKIN_DATA_MAX, tpCmd, coordText, counterpart, normalize, syncLayout, swap, sameLayout } from '../js/domain.js';

/* tp 명령어와 대응 좌표 */
assert.equal(tpCmd({ dimension: 'overworld', x: 1, y: 64, z: -3 }), '/tp @s 1 64 -3');
assert.equal(tpCmd({ dimension: 'overworld', x: 1, y: null, z: -3 }), '/tp @s 1 ~ -3');
assert.equal(tpCmd({ dimension: 'nether', x: 1, y: 0, z: 2 }), '/execute in minecraft:the_nether run tp @s 1 0 2');
assert.equal(tpCmd({ dimension: 'end', x: 0, y: null, z: 0 }), '/execute in minecraft:the_end run tp @s 0 ~ 0');
assert.equal(coordText({ x: 5, y: 0, z: 7 }), '5  0  7'); // y=0 을 '~'로 착각하면 안 됨
assert.deepEqual(counterpart({ dimension: 'overworld', x: -1, z: 17 }), { label: '네더 대응 좌표', x: -1, z: 2 }); // 내림
assert.deepEqual(counterpart({ dimension: 'nether', x: -3, z: 2 }), { label: '오버월드 대응 좌표', x: -24, z: 16 });
assert.equal(counterpart({ dimension: 'end', x: 0, z: 0 }), null);

/* 카테고리와 스킨 */
assert.equal(new Set(CATS.map((c) => c.id)).size, CATS.length);
assert.equal(new Set(CATS.map((c) => c.ch)).size, CATS.length); // 임시 타일 글자가 서로 달라야 구분됨
assert.equal(CATS.at(-1).id, 'other');
assert.equal(catOf('없는id').id, 'other');
assert.equal(skinOf('없는id'), SKINS[0]);

/* 인벤토리 칸 배치 */
const count = (l, id) => [...l.hotbar, ...l.bag].filter((v) => v === id).length;

let l = syncLayout(normalize(null), [1, 2, 3]); // 빈 배치: 27칸, 순서대로
assert.equal(l.hotbar.length, 9);
assert.equal(l.bag.length, 27);
assert.deepEqual(l.bag.slice(0, 4), [1, 2, 3, null]);

l = normalize({ hotbar: ['x', 2, 1.5], bag: 'nope', skin: 3 }); // 깨진 값은 버린다
assert.deepEqual(l.hotbar, [null, 2, null, null, null, null, null, null, null]);
assert.deepEqual(l.bag, []);
assert.equal(l.skin, null);

l = syncLayout({ ...normalize(null), hotbar: [7, null, null, null, null, null, null, null, null] }, [7, 8]); // 핫바에 둔 것은 가방에 다시 안 들어감
assert.equal(count(l, 7), 1);
assert.equal(l.hotbar[0], 7);
assert.equal(l.bag[0], 8);

l = syncLayout({ ...normalize(null), hotbar: [5, null, null, null, null, null, null, null, null], bag: [5, 9, 4] }, [4]); // 자격 잃은 것과 중복은 빠짐
assert.equal(count(l, 5) + count(l, 9), 0);
assert.equal(count(l, 4), 1);

const many = Array.from({ length: 30 }, (_, i) => i + 1); // 27개를 넘으면 9칸 단위로 늘어남
l = syncLayout(normalize(null), many);
assert.equal(l.bag.length, 36);
for (const id of many) assert.equal(count(l, id), 1);
assert.equal(syncLayout(l, [1]).bag.length, 27); // 줄어들면 접히지만 27칸 밑으로는 안 내려감

const far = normalize({ bag: Object.assign(new Array(41).fill(null), { 40: 3 }) }); // 뒤쪽 줄에 둔 아이템이 있으면 그 줄까지 유지
l = syncLayout(far, [3]);
assert.equal(l.bag.length, 45);
assert.equal(l.bag[40], 3);
assert.ok(l.bag.every((v) => v === null || Number.isInteger(v))); // 빈 자리(undefined) 없음

const base = syncLayout(normalize({ skin: 'snowman' }), [1, 2]); // 교환: 원본 유지, 핫바 <-> 가방, 스킨 유지
const moved = swap(base, { zone: 'bag', i: 0 }, { zone: 'hotbar', i: 3 });
assert.equal(base.bag[0], 1);
assert.equal(moved.bag[0], null);
assert.equal(moved.hotbar[3], 1);
assert.equal(moved.skin, 'snowman');
const swapped = swap(base, { zone: 'bag', i: 0 }, { zone: 'bag', i: 1 });
assert.deepEqual(swapped.bag.slice(0, 2), [2, 1]);
assert.ok(sameLayout(swap(swapped, { zone: 'bag', i: 0 }, { zone: 'bag', i: 1 }), base));

/* 올린 스킨: PNG data URL이고 크기 제한 안일 때만 받는다. 정리와 이동을 거쳐도 남는다 */
const png = SKIN_DATA_PREFIX + 'iVBORw0KGgo=';
assert.equal(normalize({ skinData: png }).skinData, png);
assert.equal(normalize({ skinData: 'data:text/html;base64,PHNjcmlwdD4=' }).skinData, null);
assert.equal(normalize({ skinData: SKIN_DATA_PREFIX + 'A'.repeat(SKIN_DATA_MAX) }).skinData, null);
const custom = syncLayout(normalize({ skin: 'custom', skinData: png }), [1, 2]);
assert.equal(swap(custom, { zone: 'bag', i: 0 }, { zone: 'bag', i: 1 }).skinData, png);

console.log('ok');
