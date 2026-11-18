// 좌표 어디더라: 화면 전부. 순수 규칙은 domain.js, Supabase 호출은 data.js
import * as db from './data.js';
import {
  CATS, GROUPS, catOf, ARMOR_SLOTS, SKINS, skinOf, DIM_LABEL,
  coordText, tpCmd, counterpart, normalize, syncLayout, swap, sameLayout,
} from './domain.js';

/* ================= 공용 도구 ================= */
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// localStorage가 막힌 환경(시크릿 모드 등)에서도 앱이 죽지 않게 한다. 저장이 안 되면 자동 입력만 안 된다
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* 무시 */ } },
};

let toastTimer;
function toast(text) {
  const t = $('toast');
  t.textContent = text; t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 2400);
}

// navigator.clipboard가 없거나(https가 아닌 주소) 거부되면 textarea 방식으로, 그래도 안 되면 직접 복사하라고 알린다
async function copy(text) {
  if (!text) return toast('복사할 내용이 없습니다');
  let done = false;
  try { await navigator.clipboard.writeText(text); done = true; } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = text; ta.style.cssText = 'position:fixed;opacity:0';
      document.body.append(ta); ta.select();
      done = document.execCommand('copy');
      ta.remove();
    } catch { /* 아래 알림으로 */ }
  }
  toast(done ? '복사됨. 이제 안 물어봐도 됨' : `복사하지 못했습니다: ${text}`);
}

function ago(iso) {
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return '방금 전';
  if (m < 60) return `${m}분 전`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}시간 전`;
  const d = Math.floor(h / 24);
  if (d === 1) return '어제';
  if (d < 7) return `${d}일 전`;
  return d < 14 ? '일주일 전' : new Date(iso).toLocaleDateString('ko-KR');
}

// 같은 이름은 항상 같은 색. 내 이름은 초록
const NAME_COLORS = ['#0b7285', '#a61e4d', '#c2410c', '#1c4fd8', '#6f42c1', '#8a6d00', '#b5179e', '#5c6b00'];
function ownerColor(name) {
  if (name === state.me) return 'var(--me)';
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  return NAME_COLORS[h % NAME_COLORS.length];
}

/* ---------- 창 (모달) ---------- */
let lastFocus = null, onModalClose = null;

function makeDialog(label, html, tag = 'div', role = 'dialog') {
  const m = document.createElement(tag);
  m.className = 'modal panel'; m.setAttribute('role', role); m.setAttribute('aria-modal', 'true'); m.setAttribute('aria-label', label);
  m.innerHTML = html;
  return m;
}

function openModal(node, onClose = null) {
  closeModal();
  lastFocus = document.activeElement; onModalClose = onClose;
  const ov = document.createElement('div');
  ov.className = 'overlay'; ov.id = 'overlay'; ov.append(node);
  ov.addEventListener('mousedown', (e) => { if (e.target === ov) closeModal(); });
  $('modal-root').append(ov);
  node.querySelector('input,select,textarea,button')?.focus();
}

function closeModal() {
  const o = $('overlay');
  if (!o) return;
  o.remove();
  const cb = onModalClose; onModalClose = null;
  try { lastFocus?.focus(); } catch { /* 이미 사라진 요소 */ }
  cb?.();
}

// 확인을 누르면 true, 취소나 바깥 클릭이나 Esc면 false
function confirmBox(title, body, yesLabel) {
  return new Promise((resolve) => {
    let yes = false;
    const m = makeDialog(title, `<h2>${esc(title)}</h2><p>${esc(body)}</p><div class="actions"><button class="btn" type="button" data-no>취소</button><button class="btn danger" type="button" data-yes>${esc(yesLabel)}</button></div>`, 'div', 'alertdialog');
    openModal(m, () => resolve(yes));
    m.querySelector('[data-no]').addEventListener('click', closeModal);
    m.querySelector('[data-yes]').addEventListener('click', () => { yes = true; closeModal(); });
  });
}

/* ---------- 아이콘 ----------
   assets/mc/<key>.png 가 있으면 그 그림, 없으면 임시 색 타일(또는 fallback HTML)로 바꾼다 */
const TILE_EXTRA = { compass: ['#d23a2f', '침'], helmet: ['#9a9a9a', '투'], chestplate: ['#9a9a9a', '흉'], leggings: ['#9a9a9a', '레'], boots: ['#9a9a9a', '부'] };
const missingIcons = new Set(); // 불러오기에 실패한 키. 다시 요청하지 않는다

function tile(key) {
  const c = CATS.find((x) => x.id === key);
  const [color, ch] = c ? [c.color, c.ch] : (TILE_EXTRA[key] ?? ['#888888', '?']);
  return `<svg class="ico" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><rect width="16" height="16" fill="${color}" shape-rendering="crispEdges"/><rect x=".5" y=".5" width="15" height="15" fill="none" stroke="#000" stroke-opacity=".45" shape-rendering="crispEdges"/><text x="8" y="12.5" text-anchor="middle" font-size="10">${ch}</text></svg>`;
}

function icon(key, fallback = null) {
  if (missingIcons.has(key)) return fallback ?? tile(key);
  return `<img class="ico" src="assets/mc/${key}.png" alt="" draggable="false" data-k="${key}"${fallback ? ` data-fb="${esc(fallback)}"` : ''}>`;
}

// error 이벤트는 버블링이 없어서 capture로 받는다
document.addEventListener('error', (e) => {
  const t = e.target;
  if (t.tagName === 'IMG' && t.dataset.k) { missingIcons.add(t.dataset.k); t.outerHTML = t.dataset.fb ?? tile(t.dataset.k); }
}, true);

/* ================= 상태와 화면 전환 ================= */
// who: '' 이면 전체. scraps: 내가 주운 좌표 id.
// loaded: 서버에서 실제로 받았는지. 못 받은 채로 인벤토리를 정리하면 배치가 지워지므로 확인용
const state = {
  me: null, view: 'login', places: [], scraps: new Set(), loaded: { places: false, scraps: false },
  q: '', cats: new Set(CATS.map((c) => c.id)), who: '',
};

function showView(v) {
  state.view = v;
  $('v-login').hidden = v !== 'login';
  $('v-list').hidden = v !== 'list';
  $('v-inv').hidden = v !== 'inv';
  $('topbar').hidden = v === 'login';
  $('navbtn').textContent = v === 'inv' ? '목록' : '인벤토리';
  window.scrollTo(0, 0);
}

function render() { renderList(); renderInventory(); }

// 요청 실패 공통 처리: 콘솔에 남기고, 알리고, 방 비번이 바뀌어 쫓겨난 건 아닌지 확인
function fail(text, err) {
  console.error(err);
  if (text) toast(text);
  verify();
}

/* ================= 입장, 퇴장 ================= */
const MSG_CHANGED = '방 비번이 변경되었습니다. 새 비번으로 다시 접속하세요';

function showLoginError(text) {
  const e = $('l-err');
  e.textContent = text || ''; e.hidden = !text;
}

function leave(text) {
  db.unsubscribe(); closeServerPop(); closeModal(); resetInventory();
  Object.assign(state, { me: null, who: '', places: [], scraps: new Set(), loaded: { places: false, scraps: false } });
  server = null;
  showView('login');
  $('l-pw').value = '';
  $('l-name').value ||= store.get('zwa_name') ?? '';
  showLoginError(text);
}

async function enter(name) {
  state.me = name;
  store.set('zwa_name', name); store.set('zwa_joined', '1');
  $('who-badge').textContent = name;
  showView('list');
  db.subscribe(refreshPlaces, loadServer);
  await Promise.all([loadPlaces(), loadServer(), loadScraps(), loadLayout(), loadArmor()]);
}

// 아직 멤버인지 확인. 방 비번이 바뀌어 members가 지워졌다면 입장 화면으로
async function verify() {
  if (!state.me) return;
  try { if (!(await db.currentName())) leave(MSG_CHANGED); } catch { /* 네트워크 오류로는 쫓아내지 않는다 */ }
}

const LOGIN_ERRORS = {
  wrong: (r) => `방 비번이 틀렸습니다. 남은 기회 ${r.left}번`,
  locked: (r) => `접속이 잠겼습니다. ${r.retry_after}초 뒤에 다시 시도하세요`,
  bad_name: () => '이름은 1~16자여야 합니다',
  not_configured: () => '방 비번이 아직 설정되지 않았습니다',
};

async function onLogin(e) {
  e.preventDefault();
  const pw = $('l-pw').value.trim(), name = $('l-name').value.trim();
  if (!db.configured) return showLoginError('js/config.js에 Supabase 주소와 키가 필요합니다');
  if (!name) return showLoginError('이름을 입력하세요');
  if (!pw) return showLoginError('방 비번을 입력하세요');
  showLoginError('');
  $('l-btn').disabled = true;
  try {
    const r = await db.join(pw, name);
    if (r.status === 'ok') { await enter(r.name); toast(`${r.name}이(가) 서버에 접속했습니다`); }
    else showLoginError(LOGIN_ERRORS[r.status]?.(r) ?? '접속하지 못했습니다');
  } catch (err) {
    console.error(err);
    showLoginError('서버와의 연결이 끊어졌습니다');
  } finally { $('l-btn').disabled = false; }
}

/* ================= 서버 주소 칩 ================= */
let server = null; // 마지막으로 받은 { server_addr, updated_at }

function fillPop() {
  $('sv-addr').value = server?.server_addr ?? '';
  $('sv-when').textContent = server?.server_addr ? `${ago(server.updated_at)} 변경됨` : '아직 등록되지 않음';
}
function openPop() {
  fillPop();
  $('pop').hidden = false; $('chip').setAttribute('aria-expanded', 'true');
  $('dot').classList.remove('on');
}
function closeServerPop() { $('pop').hidden = true; $('chip').setAttribute('aria-expanded', 'false'); }

async function loadServer() {
  let data;
  try { data = await db.fetchServer(); } catch (e) { return fail(null, e); }
  if (!data) return;
  const changed = server !== null && data.updated_at !== server.updated_at;
  server = data;
  if (!$('pop').hidden) fillPop();
  if (!changed) return;
  toast('서버 주소가 바뀌었습니다');
  if ($('pop').hidden) $('dot').classList.add('on');
  else { const p = $('pop'); p.classList.remove('flash'); void p.offsetWidth; p.classList.add('flash'); }
}

/* ================= 좌표 목록 ================= */
async function loadPlaces() {
  try { state.places = await db.fetchPlaces(); } catch (e) { return fail('좌표를 불러오지 못했습니다', e); }
  state.loaded.places = true;
  renderOwnerFilter();
  render();
}

let refreshTimer;
// Realtime 이벤트가 연달아 와도 한 번만 다시 조회
function refreshPlaces() { clearTimeout(refreshTimer); refreshTimer = setTimeout(loadPlaces, 150); }

function filtered() {
  const q = state.q.trim().toLowerCase();
  return state.places.filter((p) => {
    const c = catOf(p.category);
    if (!state.cats.has(c.id) || (state.who && p.owner_name !== state.who)) return false;
    return !q || `${p.name} ${p.note} ${p.owner_name} ${c.name}`.toLowerCase().includes(q);
  });
}

// 차원: assets/mc/dim_<차원>.png 가 있으면 아이콘, 없으면 색 배지
const dimTag = (d) => `<span class="dimtag" title="${DIM_LABEL[d]}">${icon('dim_' + d, `<span class="badge d-${d}">${DIM_LABEL[d]}</span>`)}</span>`;

function rowHTML(p) {
  const mine = p.owner_name === state.me, on = state.scraps.has(p.id);
  const act = '<button class="btn" type="button" data-act="copy">tp 복사</button>' + (mine
    ? `<button class="btn" type="button" data-act="edit">수정</button><button class="btn danger" type="button" data-act="del" aria-label="${esc(p.name)} 삭제">X</button>`
    : `<button class="btn compass" type="button" data-act="scrap" aria-pressed="${on}" aria-label="${on ? '나침반 버리기' : '나침반 줍기'}"><span class="cico">${icon('compass')}</span></button>`);
  return `<article class="row${mine ? ' mine' : ''}" data-id="${p.id}">`
    + `<div class="ic slot-frame">${icon(catOf(p.category).id)}</div>`
    + `<div class="main"><button class="nm" type="button" data-act="open">${esc(p.name)}</button>`
    + `<div class="meta">${dimTag(p.dimension)}<span style="color:${ownerColor(p.owner_name)}">${esc(p.owner_name)}</span>`
    + (p.is_private ? '<span class="lock">비공개</span>' : '') + `<span>${ago(p.created_at)}</span></div></div>`
    + `<div class="coords">${coordText(p)}</div><div class="act">${act}</div></article>`;
}

function renderList() {
  const arr = filtered();
  $('list').innerHTML = arr.map(rowHTML).join('');
  $('empty').hidden = arr.length > 0;
  $('count').textContent = `${arr.length}개의 좌표`;
  $('catbtn').textContent = state.cats.size === CATS.length ? '종류: 전체' : `종류: ${state.cats.size}개 선택`;
}

// 등록한 사람 선택지. 고른 사람이 목록에서 사라졌으면 전체로
function renderOwnerFilter() {
  const others = [...new Set(state.places.map((p) => p.owner_name))].filter((n) => n !== state.me).sort();
  if (state.who && state.who !== state.me && !others.includes(state.who)) state.who = '';
  $('whosel').innerHTML = `<option value="">전체</option><option value="${esc(state.me)}">내 것만</option>`
    + others.map((n) => `<option value="${esc(n)}">${esc(n)}</option>`).join('');
  $('whosel').value = state.who;
}

/* ---------- 종류 필터 ---------- */
function buildCatGrid() {
  $('catgrid').innerHTML = CATS.map((c) =>
    `<button type="button" class="catopt" data-cat="${c.id}" aria-pressed="${state.cats.has(c.id)}"><span class="ci slot-frame small">${icon(c.id)}</span>${esc(c.name)}</button>`).join('');
}
function closeCat() { $('catpanel').hidden = true; $('catbtn').setAttribute('aria-expanded', 'false'); }

/* ---------- 좌표 추가와 수정 ---------- */
const COORD_MAX = 30000000, Y_MAX = 4096; // schema.sql 의 CHECK 와 같게
const INT = /^-?\d+$/;

// p 를 주면 그 좌표를 수정한다
function openPlaceForm(p = null) {
  const title = p ? '좌표 수정' : '좌표 추가';
  const pickedCat = p ? catOf(p.category).id : CATS[0].id, dim = p ? p.dimension : 'overworld';
  const val = (v) => (v === null || v === undefined ? '' : esc(v));
  const opts = GROUPS.map((g) => `<optgroup label="${g}">${CATS.filter((c) => c.group === g).map((c) => `<option value="${c.id}"${c.id === pickedCat ? ' selected' : ''}>${c.name}</option>`).join('')}</optgroup>`).join('');
  const dims = Object.entries(DIM_LABEL).map(([k, v]) => `<label><input type="radio" name="f-dim" value="${k}"${k === dim ? ' checked' : ''}>${v}</label>`).join('');
  const m = makeDialog(title, `<h2>${title}</h2>`
    + `<label for="f-cat">종류</label><select class="field" id="f-cat">${opts}</select>`
    + `<label for="f-name">이름</label><input class="field" id="f-name" maxlength="40" autocomplete="off" value="${val(p?.name)}">`
    + `<label>차원</label><div class="radios">${dims}</div>`
    + `<div class="grid3"><div><label for="f-x">X</label><input class="field" id="f-x" inputmode="numeric" autocomplete="off" value="${val(p?.x)}"></div>`
    + `<div><label for="f-y">Y (선택)</label><input class="field" id="f-y" inputmode="numeric" autocomplete="off" value="${val(p?.y)}"></div>`
    + `<div><label for="f-z">Z</label><input class="field" id="f-z" inputmode="numeric" autocomplete="off" value="${val(p?.z)}"></div></div>`
    + `<label for="f-note">메모</label><textarea class="field" id="f-note" rows="3" maxlength="200">${val(p?.note)}</textarea>`
    + `<label class="chk"><input type="checkbox" id="f-priv"${p?.is_private ? ' checked' : ''}>나만 보기</label>`
    + '<div class="err" id="f-err" role="alert" hidden></div>'
    + '<div class="actions"><button class="btn" type="button" id="f-cancel">취소</button><button class="btn primary" type="submit" id="f-save">저장</button></div>', 'form');
  m.noValidate = true;

  m.addEventListener('submit', async (e) => {
    e.preventDefault();
    const show = (text) => { $('f-err').textContent = text; $('f-err').hidden = !text; };
    const name = $('f-name').value.trim(), xs = $('f-x').value.trim(), ys = $('f-y').value.trim(), zs = $('f-z').value.trim();
    if (!name) return show('이름을 입력하세요');
    if (!INT.test(xs) || !INT.test(zs)) return show('X, Z는 정수만 입력할 수 있습니다');
    if (ys && !INT.test(ys)) return show('Y는 정수만 입력할 수 있습니다');
    const x = +xs, z = +zs, y = ys ? +ys : null;
    if (Math.abs(x) > COORD_MAX || Math.abs(z) > COORD_MAX || (y !== null && Math.abs(y) > Y_MAX)) return show('좌표 범위를 벗어났습니다');
    const row = {
      category: $('f-cat').value, name, dimension: m.querySelector('input[name="f-dim"]:checked').value,
      x, y, z, note: $('f-note').value.trim(), is_private: $('f-priv').checked,
    };
    show('');
    $('f-save').disabled = true;
    try {
      if (p) await db.updatePlace(p.id, row); else await db.insertPlace({ ...row, owner_name: state.me });
    } catch (err) {
      $('f-save').disabled = false; show('좌표를 설치하지 못했습니다'); return fail(null, err);
    }
    closeModal();
    await loadPlaces();
    toast(p ? '좌표를 수정했습니다' : row.is_private ? '좌표를 설치했습니다 (나만 보기)' : '좌표를 설치했습니다');
  });
  openModal(m);
  $('f-cancel').addEventListener('click', closeModal);
}

async function deletePlace(p) {
  if (!(await confirmBox('정말 파괴하시겠습니까?', `"${p.name}" 좌표가 사라집니다`, '파괴'))) return;
  try { await db.removePlace(p.id); } catch (e) { return fail('좌표를 파괴하지 못했습니다', e); }
  await loadPlaces();
  toast('좌표가 파괴되었습니다');
}

/* ---------- 책 페이지 상세 ---------- */
function openBook(p) {
  const mine = p.owner_name === state.me, c = catOf(p.category), cv = counterpart(p);
  const b = document.createElement('div');
  b.className = 'book'; b.setAttribute('role', 'dialog'); b.setAttribute('aria-modal', 'true'); b.setAttribute('aria-label', `${p.name} 상세`);
  b.innerHTML = `<div class="bk-h"><span class="slot-frame">${icon(c.id)}</span><div><div class="bk-t">${esc(p.name)}</div><div class="bk-s">${c.name} · ${DIM_LABEL[p.dimension]}</div></div></div>`
    + `<div class="bk-c">${coordText(p)}</div>`
    + (cv ? `<div class="bk-v">${cv.label} ${cv.x}  ${cv.z}</div>` : '')
    + `<p class="bk-n">${p.note ? esc(p.note) : '(메모 없음)'}</p>`
    + `<div class="bk-m">등록: ${esc(p.owner_name)} · ${ago(p.created_at)}${p.is_private ? ' · 비공개' : ''}</div>`
    + '<div class="bk-a"></div>';
  const add = (text, cls, fn) => {
    const x = document.createElement('button');
    x.type = 'button'; x.className = `btn ${cls}`; x.textContent = text;
    x.addEventListener('click', fn);
    b.querySelector('.bk-a').append(x);
  };
  add('tp 복사', 'primary', () => copy(tpCmd(p)));
  if (mine) add('수정', '', () => openPlaceForm(p));
  else add(state.scraps.has(p.id) ? '나침반 버리기' : '나침반 줍기', '', async () => { await toggleScrap(p); openBook(p); });
  add('닫기', '', closeModal);
  openModal(b);
}

/* ---------- 나침반 (남의 좌표 줍기) ---------- */
async function loadScraps() {
  try { state.scraps = new Set(await db.fetchScraps(state.me)); } catch (e) { return fail(null, e); }
  state.loaded.scraps = true;
  render();
}

async function toggleScrap(p) {
  const had = state.scraps.has(p.id);
  try { await (had ? db.removeScrap : db.addScrap)(state.me, p.id); } catch (e) { return fail('나침반을 사용하지 못했습니다', e); }
  if (had) state.scraps.delete(p.id); else state.scraps.add(p.id);
  toast(had ? '나침반을 버렸습니다' : '나침반을 얻었습니다!');
  render();
}

/* ================= 인벤토리 ================= */
let layout = null;    // { hotbar, bag, skin }. 서버에서 받기 전에는 null
let sel = null;       // 들고 있는 칸 { zone, i }
let saveTimer = null, dragFrom = null, drawnSkin = null;

const byId = (id) => state.places.find((p) => p.id === id) ?? null;
const isMine = (p) => p.owner_name === state.me;
const placeAt = (at) => (at && layout?.[at.zone][at.i] != null ? byId(layout[at.zone][at.i]) : null);
const slotOf = (el) => { const b = el.closest('[data-z]'); return b ? { zone: b.dataset.z, i: +b.dataset.i } : null; };
const sameSlot = (a, b) => a && b && a.zone === b.zone && a.i === b.i;

async function loadLayout() {
  if (saveTimer) return; // 아직 저장 안 한 내 변경을 서버 값으로 덮어쓰지 않는다
  try { layout = normalize(await db.fetchLayout(state.me)); } catch (e) { return fail('인벤토리를 불러오지 못했습니다', e); }
  renderInventory();
}

function resetInventory() {
  // shortcut: 퇴장 직전 0.5초 안의 마지막 이동은 저장되지 않을 수 있다. 문제가 되면 여기서 즉시 저장할 것
  clearTimeout(saveTimer);
  saveTimer = null; layout = null; sel = null; drawnSkin = null;
}

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    saveTimer = null;
    try { await db.saveLayout(state.me, layout); } catch (e) { fail('칸 배치를 저장하지 못했습니다', e); }
  }, 500);
}

// 내 좌표와 주운 좌표가 정확히 한 번씩 들어가게 맞춘다. 목록을 아직 못 받았으면 건드리지 않는다
function syncInventory() {
  if (!state.loaded.places || !state.loaded.scraps) return;
  const ids = state.places.filter((p) => isMine(p) || state.scraps.has(p.id)).map((p) => p.id).reverse(); // 오래된 것부터
  const next = syncLayout(layout, ids);
  if (!sameLayout(next, layout)) { layout = next; scheduleSave(); }
}

function slotHTML(zone, i) {
  const at = { zone, i }, p = placeAt(at);
  const cls = 'slot' + (p ? (isMine(p) ? ' mine' : ' scrap') : '') + (sameSlot(sel, at) ? ' sel' : '');
  const where = zone === 'hotbar' ? `핫바 ${i + 1}번 ` : '';
  const label = p ? `${where}${p.name} ${coordText(p)} (${isMine(p) ? '내 좌표' : '주운 좌표'})` : `${where}빈 칸`;
  return `<button type="button" class="${cls}" data-z="${zone}" data-i="${i}" draggable="${!!p}" aria-label="${esc(label)}">`
    + (zone === 'hotbar' ? `<span class="num">${i + 1}</span>` : '') + (p ? icon(catOf(p.category).id) : '') + '</button>';
}

function renderInfo() {
  const p = placeAt(sel);
  $('infobar').innerHTML = !p ? '<div class="ib-t">좌표를 선택하세요</div>'
    : `<div class="ib-ic slot-frame small">${icon(catOf(p.category).id)}</div>`
      + `<div class="ib-t"><div>${esc(p.name)}</div><div class="xy">${DIM_LABEL[p.dimension]} · ${coordText(p)}</div></div>`
      + '<button class="btn primary" type="button" data-ib="copy">tp 복사</button><button class="btn" type="button" data-ib="open">상세</button>'
      + (isMine(p) ? '' : '<button class="btn" type="button" data-ib="drop">나침반 버리기</button>');
}

function renderInventory() {
  if (state.view !== 'inv' || !layout) return;
  syncInventory();
  if (sel && layout[sel.zone][sel.i] == null) sel = null; // 들고 있던 것이 사라졌으면 놓는다
  $('bag').innerHTML = layout.bag.map((_, i) => slotHTML('bag', i)).join('');
  $('hot').innerHTML = layout.hotbar.map((_, i) => slotHTML('hotbar', i)).join('');
  const held = [...layout.hotbar, ...layout.bag].map((id) => (id === null ? null : byId(id))).filter(Boolean);
  $('inv-nick').textContent = state.me;
  $('c-mine').textContent = held.filter(isMine).length;
  $('c-scrap').textContent = held.length - held.filter(isMine).length;
  $('c-hot').textContent = `${layout.hotbar.filter((v) => v !== null).length} / 9`;
  $('c-all').textContent = state.places.length;
  $('tip').hidden = true;
  const skin = skinOf(layout.skin);
  if (drawnSkin !== skin.id) { drawnSkin = skin.id; drawSkin($('skin'), skin); }
  renderInfo();
}

function moveSlot(a, b) {
  if (sameSlot(a, b)) return;
  layout = swap(layout, a, b);
  scheduleSave();
}

// 칸을 눌러 들고, 다른 칸을 눌러 옮기거나 맞바꾼다
function onSlotClick(e) {
  const at = slotOf(e.target);
  if (!at || !layout) return;
  if (!sel) { if (layout[at.zone][at.i] !== null) sel = at; }
  else if (sameSlot(sel, at)) sel = null;
  else { moveSlot(sel, at); sel = null; }
  renderInventory();
  document.querySelector(`[data-z="${at.zone}"][data-i="${at.i}"]`)?.focus(); // 다시 그려도 키보드 포커스 유지
}

function moveTip(e) {
  const tip = $('tip');
  let x = e.clientX + 14, y = e.clientY + 14;
  if (x + tip.offsetWidth > window.innerWidth - 8) x = e.clientX - tip.offsetWidth - 14;
  if (y + tip.offsetHeight > window.innerHeight - 8) y = e.clientY - tip.offsetHeight - 14;
  tip.style.left = `${Math.max(4, x)}px`; tip.style.top = `${Math.max(4, y)}px`;
}

function initInventory() {
  $('infobar').addEventListener('click', (e) => {
    const k = e.target.closest('[data-ib]')?.dataset.ib, p = placeAt(sel);
    if (!k || !p) return;
    if (k === 'copy') copy(tpCmd(p));
    else if (k === 'open') openBook(p);
    else { sel = null; toggleScrap(p); }
  });
  $('skinbtn').addEventListener('click', () => {
    if (layout) openSkinPicker(layout.skin, (id) => { layout = { ...layout, skin: id }; scheduleSave(); renderInventory(); toast('스킨을 장착했습니다'); });
  });
  $('armor').addEventListener('click', (e) => {
    const s = e.target.closest('[data-armor]')?.dataset.armor;
    if (s) toast(worn[s] ? `${armorName(worn[s], s)}입니다. 방어력 +0` : '갑옷 칸이 비어 있습니다');
  });
  renderArmor();

  for (const root of [$('bag'), $('hot')]) {
    root.addEventListener('click', onSlotClick);
    // 드래그 앤 드롭 (PC). 터치 기기는 눌러서 옮긴다
    root.addEventListener('dragstart', (e) => {
      dragFrom = slotOf(e.target); $('tip').hidden = true;
      try { e.dataTransfer.setData('text/plain', 'slot'); e.dataTransfer.effectAllowed = 'move'; } catch { /* 일부 브라우저 */ }
    });
    root.addEventListener('dragover', (e) => { if (dragFrom) e.preventDefault(); });
    root.addEventListener('drop', (e) => {
      const to = slotOf(e.target);
      if (!to || !dragFrom) return;
      e.preventDefault();
      moveSlot(dragFrom, to); dragFrom = null; sel = null;
      renderInventory();
    });
    root.addEventListener('dragend', () => { dragFrom = null; });
    // 호버 툴팁 (마우스가 있는 기기)
    root.addEventListener('mouseover', (e) => {
      const p = placeAt(slotOf(e.target)), tip = $('tip');
      if (!p) { tip.hidden = true; return; }
      tip.innerHTML = `<div class="t1">${esc(p.name)}</div><div class="xy">${DIM_LABEL[p.dimension]} · ${coordText(p)}</div>`
        + (isMine(p) ? '<div class="tm">내 좌표</div>' : `<div class="ts">주운 좌표 · ${esc(p.owner_name)}</div>`);
      tip.hidden = false; moveTip(e);
    });
    root.addEventListener('mousemove', (e) => { if (!$('tip').hidden) moveTip(e); });
    root.addEventListener('mouseleave', () => { $('tip').hidden = true; });
  }
}

/* ---------- 갑옷 (방장이 SQL Editor의 give_armor로 준다. 방어력은 0) ---------- */
const PIECES = { helmet: '투구', chestplate: '흉갑', leggings: '레깅스', boots: '부츠' };
const MATERIALS = { leather: '가죽', chainmail: '사슬', iron: '철', gold: '금', diamond: '다이아몬드', netherite: '네더라이트' };
const armorName = (m, s) => `${MATERIALS[m] ?? m} ${PIECES[s]}`;
let worn = {}; // slot -> material

function renderArmor() {
  $('armor').innerHTML = ARMOR_SLOTS.map((s) => {
    const m = worn[s];
    return `<button type="button" class="slot deco ${m ? 'armor-' + m : 'empty'}" data-armor="${s}" aria-label="${m ? armorName(m, s) : PIECES[s] + ' 칸 (비어 있음)'}">${icon(s)}</button>`;
  }).join('');
}

async function loadArmor() {
  let rows;
  try { rows = await db.fetchArmor(state.me); } catch (e) { console.error(e); return; }
  worn = Object.fromEntries(rows.map((r) => [r.slot, r.material]));
  renderArmor();
  // 이 기기에서 마지막으로 본 뒤에 새로 받은 갑옷이 있으면 알린다
  const key = `zwa_armor_seen:${state.me}`, seen = store.get(key) ?? '';
  const newest = rows.filter((r) => r.given_at > seen).sort((a, b) => (a.given_at < b.given_at ? 1 : -1))[0];
  if (newest) { toast(`${armorName(newest.material, newest.slot)}을(를) 얻었습니다!`); store.set(key, newest.given_at); }
}

/* ---------- 스킨 (정면 16x32 그리기와 선택 창) ---------- */
const skinImages = new Map(); // 스킨 id -> Promise<Image | null>

function loadSkinImage(skin) {
  if (!skinImages.has(skin.id)) {
    skinImages.set(skin.id, new Promise((res) => {
      const im = new Image();
      im.onload = () => res(im.width === 64 && (im.height === 64 || im.height === 32) ? im : null);
      im.onerror = () => res(null);
      im.src = `assets/skins/${skin.file}`;
    }));
  }
  return skinImages.get(skin.id);
}

// 스킨 파일이 없을 때 쓰는 캐릭터
function paintFallback(x) {
  const r = (col, a, b, w, h) => { x.fillStyle = col; x.fillRect(a, b, w, h); };
  r('#c58c64', 4, 0, 8, 8); r('#3b2a1e', 4, 0, 8, 3);
  r('#fff', 5, 4, 2, 1); r('#3a4fb0', 6, 4, 1, 1); r('#fff', 9, 4, 2, 1); r('#3a4fb0', 9, 4, 1, 1); r('#8a4a3a', 6, 6, 4, 1);
  r('#c8322b', 4, 8, 8, 12); r('#c58c64', 0, 8, 4, 12); r('#c58c64', 12, 8, 4, 12); r('#c8322b', 0, 8, 4, 4); r('#c8322b', 12, 8, 4, 4);
  r('#4a4a8a', 4, 20, 8, 12); r('#777', 4, 30, 8, 2);
}

// 마크 스킨 배치에서 정면만 잘라 그린다. 모자와 겉옷 층, 얇은 팔(알렉스형), 옛 64x32 스킨의 좌우 반전 포함
function paintSkin(x, img) {
  const legacy = img.height === 32;
  let slim = false;
  if (!legacy) {
    const t = document.createElement('canvas'); t.width = 64; t.height = 64;
    const tx = t.getContext('2d'); tx.drawImage(img, 0, 0);
    slim = tx.getImageData(55, 20, 1, 1).data[3] === 0; // 얇은 팔이면 이 자리가 비어 있다
  }
  const aw = slim ? 3 : 4, ax = slim ? 1 : 0;
  const part = (sx, sy, w, h, dx, dy, flip) => {
    if (!flip) return x.drawImage(img, sx, sy, w, h, dx, dy, w, h);
    x.save(); x.translate(dx + w, dy); x.scale(-1, 1); x.drawImage(img, sx, sy, w, h, 0, 0, w, h); x.restore();
  };
  part(8, 8, 8, 8, 4, 0); part(20, 20, 8, 12, 4, 8);        // 머리, 몸통
  part(44, 20, aw, 12, ax, 8); part(4, 20, 4, 12, 4, 20);    // 오른팔, 오른다리
  if (legacy) { part(44, 20, aw, 12, 12, 8, true); part(4, 20, 4, 12, 8, 20, true); } // 옛 스킨은 왼쪽이 없어 오른쪽을 뒤집는다
  else {
    part(36, 52, aw, 12, 12, 8); part(20, 52, 4, 12, 8, 20); // 왼팔, 왼다리
    part(44, 36, aw, 12, ax, 8); part(52, 52, aw, 12, 12, 8); part(4, 36, 4, 12, 4, 20); part(4, 52, 4, 12, 8, 20); part(20, 36, 8, 12, 4, 8); // 겉옷 층
  }
  part(40, 8, 8, 8, 4, 0); // 모자 층
}

// 늦게 끝난 이전 그리기가 새 스킨을 덮어쓰지 않게 id로 확인한다
async function drawSkin(canvas, skin) {
  canvas.dataset.skin = skin.id;
  const img = await loadSkinImage(skin);
  if (canvas.dataset.skin !== skin.id) return;
  const x = canvas.getContext('2d');
  x.imageSmoothingEnabled = false;
  x.clearRect(0, 0, 16, 32);
  if (img) paintSkin(x, img); else paintFallback(x);
}

function openSkinPicker(currentId, onPick) {
  const current = skinOf(currentId).id;
  const m = makeDialog('스킨 선택', '<h2>스킨 선택</h2><div class="skingrid">'
    + SKINS.map((s) => `<button type="button" class="skinopt" data-skin="${s.id}" aria-pressed="${s.id === current}"><canvas width="16" height="32" aria-hidden="true"></canvas><span>${esc(s.name)}</span></button>`).join('')
    + '</div><div class="actions"><button class="btn" type="button" data-close>닫기</button></div>');
  m.querySelectorAll('.skinopt').forEach((b) => drawSkin(b.querySelector('canvas'), skinOf(b.dataset.skin)));
  m.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) return closeModal();
    const id = e.target.closest('[data-skin]')?.dataset.skin;
    if (!id) return;
    closeModal();
    if (id !== current) onPick(id);
  });
  openModal(m);
}

/* ================= 시작 ================= */
function wire() {
  $('login-form').addEventListener('submit', onLogin);
  $('brand').addEventListener('click', () => { if (state.me) { showView('list'); loadPlaces(); } });
  $('navbtn').addEventListener('click', () => { showView(state.view === 'inv' ? 'list' : 'inv'); sel = null; render(); });

  // 서버 주소
  $('chip').addEventListener('click', () => { if ($('pop').hidden) openPop(); else closeServerPop(); });
  $('sv-close').addEventListener('click', closeServerPop);
  $('sv-copy').addEventListener('click', () => copy($('sv-addr').value));

  // 목록
  $('q').addEventListener('input', (e) => { state.q = e.target.value; renderList(); });
  $('whosel').addEventListener('change', (e) => { state.who = e.target.value; renderList(); });
  $('addbtn').addEventListener('click', () => openPlaceForm());
  // 줄의 버튼이 아닌 곳을 누르면 상세(책 페이지)
  $('list').addEventListener('click', (e) => {
    const row = e.target.closest('.row');
    const p = row && state.places.find((x) => x.id === +row.dataset.id);
    if (!p) return;
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'copy') copy(tpCmd(p));
    else if (act === 'edit') openPlaceForm(p);
    else if (act === 'del') deletePlace(p);
    else if (act === 'scrap') toggleScrap(p);
    else openBook(p);
  });

  // 종류 필터
  $('catbtn').addEventListener('click', () => {
    if (!$('catpanel').hidden) return closeCat();
    buildCatGrid(); $('catpanel').hidden = false; $('catbtn').setAttribute('aria-expanded', 'true');
  });
  $('catgrid').addEventListener('click', (e) => {
    const b = e.target.closest('[data-cat]');
    if (!b) return;
    const id = b.dataset.cat;
    if (state.cats.has(id)) state.cats.delete(id); else state.cats.add(id);
    b.setAttribute('aria-pressed', state.cats.has(id));
    renderList();
  });
  $('cat-all').addEventListener('click', () => { state.cats = new Set(CATS.map((c) => c.id)); buildCatGrid(); renderList(); });
  $('cat-none').addEventListener('click', () => { state.cats = new Set(); buildCatGrid(); renderList(); });

  // 바깥 클릭과 Esc로 열린 것 닫기
  document.addEventListener('mousedown', (e) => {
    if (!$('pop').hidden && !$('pop').contains(e.target) && !$('chip').contains(e.target)) closeServerPop();
    if (!$('catpanel').hidden && !$('catpanel').contains(e.target) && !$('catbtn').contains(e.target)) closeCat();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if ($('overlay')) closeModal(); else { closeServerPop(); closeCat(); }
  });

  // 탭으로 돌아오면 다른 기기에서 바뀐 것까지 다시 받는다 (나침반, 칸 배치, 갑옷은 Realtime이 아님)
  document.addEventListener('visibilitychange', async () => {
    if (document.hidden || !state.me) return;
    await verify();
    if (state.me) { loadPlaces(); loadServer(); loadScraps(); loadLayout(); loadArmor(); }
  });

  initInventory();
}

async function boot() {
  wire();
  if (!db.configured) return leave('js/config.js에 Supabase 주소와 키가 필요합니다');
  try {
    const name = await db.currentName();
    if (name) return await enter(name);
    leave(store.get('zwa_joined') ? MSG_CHANGED : ''); // 입장한 적 있는데 멤버가 아니면 방 비번이 바뀐 것
  } catch (e) {
    console.error(e);
    leave('서버와의 연결이 끊어졌습니다');
  }
}

boot();
