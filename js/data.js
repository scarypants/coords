// Supabase 호출만 모은다. 실패하면 예외를 던지고, 화면(app.js)이 알림을 띄운다
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

export const configured = !SUPABASE_URL.includes('YOUR-') && !SUPABASE_ANON_KEY.includes('YOUR-');
// 세션은 supabase-js가 localStorage에 저장하므로 같은 기기에서는 자동 로그인이 된다
export const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const ok = ({ data, error }) => { if (error) throw error; return data; };
// RLS 때문에 남의 행은 에러 없이 0개가 바뀐다. 그것도 실패로 본다
const one = (rows) => { if (!rows.length) throw new Error('바뀐 행이 없음'); };

/* ---------- 입장 ---------- */
// 내 이름. 세션이 없거나 멤버가 아니면 null
export async function currentName() {
  const { data: { session } } = await sb.auth.getSession();
  return session ? ok(await sb.rpc('current_name')) : null;
}

// 방장이 SQL로 만들어 준 아이디와 비밀번호로 로그인. 기기마다 익명 계정을 하나 만들어 그 아이디에 묶는다
// { status: 'ok' | 'wrong' | 'locked' | 'no_auth', name?, left?, retry_after? }
export async function login(name, password) {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) ok(await sb.auth.signInAnonymously());
  return ok(await sb.rpc('login', { p_name: name, p_password: password }));
}

// { status: 'ok' | 'wrong' | 'locked' | 'bad_password' | 'not_member', ... }. 성공하면 내 다른 기기는 로그아웃
export const changePassword = async (oldPw, newPw) => ok(await sb.rpc('change_my_password', { p_old: oldPw, p_new: newPw }));

/* ---------- 좌표 ---------- */
export const fetchPlaces = async () => ok(await sb.from('places').select('*').order('created_at', { ascending: false }));
export const insertPlace = async (row) => { ok(await sb.from('places').insert(row)); };
export const updatePlace = async (id, row) => one(ok(await sb.from('places').update(row).eq('id', id).select('id')));
export const removePlace = async (id) => one(ok(await sb.from('places').delete().eq('id', id).select('id')));

/* ---------- 서버 주소 (읽기만. 변경은 SQL Editor의 set_server_address) ---------- */
export const fetchServer = async () => ok(await sb.from('server_info').select('server_addr, updated_at').eq('id', 1).maybeSingle());

/* ---------- 나침반 (주운 좌표) ---------- */
export const fetchScraps = async (owner) => ok(await sb.from('bookmarks').select('place_id').eq('owner_name', owner)).map((r) => r.place_id);
// 다른 기기에서 이미 주웠어도 에러가 나지 않게 중복은 무시
export const addScrap = async (owner, id) => { ok(await sb.from('bookmarks').upsert({ owner_name: owner, place_id: id }, { onConflict: 'owner_name,place_id', ignoreDuplicates: true })); };
export const removeScrap = async (owner, id) => { ok(await sb.from('bookmarks').delete().eq('owner_name', owner).eq('place_id', id)); };

/* ---------- 인벤토리 (칸 배치와 스킨, 이름별 한 줄. 나중에 저장한 기기가 이김) ---------- */
export const fetchLayout = async (owner) => ok(await sb.from('inventory_layout').select('layout').eq('owner_name', owner).maybeSingle())?.layout ?? null;
export const saveLayout = async (owner, layout) => { ok(await sb.from('inventory_layout').upsert({ owner_name: owner, layout }, { onConflict: 'owner_name' })); };
// 갑옷은 방장이 SQL Editor의 give_armor()로만 준다
export const fetchArmor = async (owner) => ok(await sb.from('armor').select('slot, material, given_at').eq('owner_name', owner));

/* ---------- Realtime: 바뀌었다는 신호만 받고, 화면이 다시 조회한다 ---------- */
let channel = null;
export function unsubscribe() {
  if (channel) { sb.removeChannel(channel); channel = null; }
}
export function subscribe(onPlaces, onServer) {
  unsubscribe();
  channel = sb.channel('zwa')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'places' }, onPlaces)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'server_info' }, onServer)
    .subscribe();
}
