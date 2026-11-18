-- 좌표 어디더라 — Supabase 스키마
-- Supabase 대시보드의 SQL Editor에 통째로 붙여넣고 Run. 여러 번 실행해도 안전하다(이미 있는 것은 건드리지 않음).
-- 계정은 이 파일에 없다. 실행 후 SQL Editor에서 `select set_player('아이디', '비밀번호');` 로 친구마다 만든다.

create extension if not exists pgcrypto with schema extensions;

-- ===================== 계정, 멤버 =====================
-- players: 방장이 만들어 준 아이디와 비밀번호(bcrypt 해시). 클라이언트에는 절대 안 내려간다.
-- members: 로그인에 성공한 기기(익명 계정)와 그 아이디. 폰과 PC는 서로 다른 기기라 줄이 따로 생긴다.

create table if not exists players (
  name text primary key check (char_length(name) between 1 and 16),
  pw_hash text not null,
  fail_count int not null default 0,
  lock_level int not null default 0,
  locked_until timestamptz,
  created_at timestamptz not null default now()
);
alter table players enable row level security;       -- 정책이 없으므로 아무도 직접 못 읽음
revoke all on players from anon, authenticated;

create table if not exists members (
  user_id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 16),
  joined_at timestamptz not null default now()
);
alter table members enable row level security;       -- 정책 없음: 함수(SECURITY DEFINER)로만 접근
revoke all on members from anon, authenticated;

-- 내 이름. 멤버가 아니면 null. RLS 정책과 클라이언트가 같이 쓴다.
create or replace function current_name() returns text
language sql stable security definer set search_path = public as
$$ select display_name from members where user_id = auth.uid() $$;

-- ===================== 좌표 =====================

create table if not exists places (
  id bigint generated always as identity primary key,
  category text not null check (char_length(category) between 1 and 32),
  name text not null check (char_length(name) between 1 and 40),
  dimension text not null check (dimension in ('overworld', 'nether', 'end')),
  x integer not null check (x between -30000000 and 30000000),
  y integer check (y between -4096 and 4096),
  z integer not null check (z between -30000000 and 30000000),
  note text not null default '' check (char_length(note) <= 200),
  owner_name text not null check (char_length(owner_name) between 1 and 16),
  is_private boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists places_owner_idx on places (owner_name);

-- 시각은 서버가 정한다. 등록자와 등록 시각은 수정 못 함.
create or replace function places_guard() returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  if tg_op = 'INSERT' then
    new.created_at := now();
  else
    new.created_at := old.created_at;
    new.owner_name := old.owner_name;
  end if;
  return new;
end $$;
drop trigger if exists places_guard on places;
create trigger places_guard before insert or update on places for each row execute function places_guard();

alter table places enable row level security;
drop policy if exists places_select on places;
drop policy if exists places_insert on places;
drop policy if exists places_update on places;
drop policy if exists places_delete on places;
-- 멤버만 보고, 남의 비공개 좌표는 숨긴다
create policy places_select on places for select to authenticated
  using ((select current_name()) is not null and (not is_private or owner_name = (select current_name())));
create policy places_insert on places for insert to authenticated
  with check (owner_name = (select current_name()));
create policy places_update on places for update to authenticated
  using (owner_name = (select current_name())) with check (owner_name = (select current_name()));
create policy places_delete on places for delete to authenticated
  using (owner_name = (select current_name()));

-- ===================== 나침반(스크랩) =====================

create table if not exists bookmarks (
  owner_name text not null check (char_length(owner_name) between 1 and 16),
  place_id bigint not null references places (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (owner_name, place_id)
);
alter table bookmarks enable row level security;
drop policy if exists bookmarks_select on bookmarks;
drop policy if exists bookmarks_insert on bookmarks;
drop policy if exists bookmarks_delete on bookmarks;
create policy bookmarks_select on bookmarks for select to authenticated using (owner_name = (select current_name()));
create policy bookmarks_insert on bookmarks for insert to authenticated with check (owner_name = (select current_name()));
create policy bookmarks_delete on bookmarks for delete to authenticated using (owner_name = (select current_name()));

-- ===================== 인벤토리 칸 배치 =====================

create table if not exists inventory_layout (
  owner_name text primary key check (char_length(owner_name) between 1 and 16),
  layout jsonb not null default '{}'::jsonb check (pg_column_size(layout) < 20000),
  updated_at timestamptz not null default now()
);
create or replace function touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;
drop trigger if exists inventory_layout_touch on inventory_layout;
create trigger inventory_layout_touch before insert or update on inventory_layout for each row execute function touch_updated_at();

alter table inventory_layout enable row level security;
drop policy if exists inventory_select on inventory_layout;
drop policy if exists inventory_insert on inventory_layout;
drop policy if exists inventory_update on inventory_layout;
create policy inventory_select on inventory_layout for select to authenticated using (owner_name = (select current_name()));
create policy inventory_insert on inventory_layout for insert to authenticated with check (owner_name = (select current_name()));
create policy inventory_update on inventory_layout for update to authenticated
  using (owner_name = (select current_name())) with check (owner_name = (select current_name()));

-- ===================== 서버 주소 (한 줄짜리) =====================
-- 앱은 읽기만 한다. 바꾸기 (SQL Editor 전용):  select set_server_address('123.45.67.89:25565');
-- 바꾸면 접속 중인 사람에게 Realtime으로 "서버 주소가 바뀌었습니다"가 뜬다.

create table if not exists server_info (
  id int primary key default 1 check (id = 1),
  server_addr text not null default '' check (char_length(server_addr) <= 100),
  updated_at timestamptz not null default now()
);
insert into server_info (id) values (1) on conflict do nothing;

-- 예전 버전(하마치, 앱에서 수정)의 흔적 정리
alter table server_info drop column if exists hamachi_name, drop column if exists hamachi_pw, drop column if exists updated_by;
drop trigger if exists server_info_guard on server_info;
drop function if exists server_info_guard();
drop policy if exists server_info_update on server_info;

alter table server_info enable row level security;
drop policy if exists server_info_select on server_info;
create policy server_info_select on server_info for select to authenticated using ((select current_name()) is not null);

create or replace function set_server_address(p_addr text) returns void language sql as $$
  update server_info set server_addr = btrim(p_addr), updated_at = now() where id = 1;
$$;
revoke all on function set_server_address(text) from public, anon, authenticated;

-- ===================== 로그인, 비밀번호 =====================

-- 비밀번호 확인 + 아이디별 잠금. 연속 5회 틀리면 1분, 반복되면 2, 4, 8, 최대 15분.
-- 예외를 던지면 실패 횟수 기록이 롤백되므로 결과는 항상 jsonb로 돌려준다.
create or replace function check_player_password(p_name text, p_password text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare pl players%rowtype; secs int;
begin
  select * into pl from players where name = p_name for update;
  if not found then
    perform crypt(coalesce(p_password, ''), gen_salt('bf')); -- 없는 아이디도 비슷한 시간이 걸리게
    return jsonb_build_object('status', 'wrong');
  end if;
  if pl.locked_until is not null and pl.locked_until > now() then
    return jsonb_build_object('status', 'locked', 'retry_after', ceil(extract(epoch from pl.locked_until - now()))::int);
  end if;
  if pl.pw_hash = crypt(coalesce(p_password, ''), pl.pw_hash) then
    update players set fail_count = 0, lock_level = 0, locked_until = null where name = p_name;
    return jsonb_build_object('status', 'ok');
  end if;
  if pl.fail_count + 1 >= 5 then
    secs := least(60 * power(2, least(pl.lock_level, 4))::int, 900);
    update players set fail_count = 0, lock_level = lock_level + 1,
      locked_until = now() + make_interval(secs => secs) where name = p_name;
    return jsonb_build_object('status', 'locked', 'retry_after', secs);
  end if;
  update players set fail_count = fail_count + 1 where name = p_name;
  return jsonb_build_object('status', 'wrong', 'left', 4 - pl.fail_count);
end $$;
revoke all on function check_player_password(text, text) from public, anon, authenticated;

-- 앱의 로그인. 성공하면 이 기기를 그 아이디로 members에 등록한다
create or replace function login(p_name text, p_password text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare nm text := btrim(coalesce(p_name, '')); r jsonb;
begin
  if auth.uid() is null then return jsonb_build_object('status', 'no_auth'); end if;
  r := check_player_password(nm, p_password);
  if r->>'status' <> 'ok' then return r; end if;
  insert into members (user_id, display_name) values (auth.uid(), nm)
    on conflict (user_id) do update set display_name = excluded.display_name;
  return jsonb_build_object('status', 'ok', 'name', nm);
end $$;

-- 앱에서 내 비밀번호 바꾸기. 바꾸면 내 다른 기기는 로그아웃된다
create or replace function change_my_password(p_old text, p_new text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare me text := current_name(); r jsonb;
begin
  if me is null then return jsonb_build_object('status', 'not_member'); end if;
  if coalesce(p_new, '') !~ '^[0-9]{4}$' then return jsonb_build_object('status', 'bad_password'); end if; -- 숫자 4자리
  r := check_player_password(me, p_old);
  if r->>'status' <> 'ok' then return r; end if;
  update players set pw_hash = crypt(p_new, gen_salt('bf')) where name = me;
  delete from members where display_name = me and user_id <> auth.uid();
  return jsonb_build_object('status', 'ok');
end $$;

-- 방장 전용 (SQL Editor): 계정 만들기, 비밀번호 다시 정하기, 지우기
-- set_player는 없으면 만들고 있으면 비밀번호를 바꾼다. 그 아이디로 들어와 있던 기기는 로그아웃된다.
-- remove_player는 계정과 로그인을 지운다. 그 사람이 등록한 좌표는 남는다.
create or replace function set_player(p_name text, p_password text) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare nm text := btrim(coalesce(p_name, ''));
begin
  if char_length(nm) not between 1 and 16 then raise exception '아이디는 1~16자여야 합니다'; end if;
  if coalesce(p_password, '') !~ '^[0-9]{4}$' then raise exception '비밀번호는 숫자 4자리여야 합니다'; end if;
  insert into players (name, pw_hash) values (nm, crypt(p_password, gen_salt('bf')))
    on conflict (name) do update set pw_hash = excluded.pw_hash, fail_count = 0, lock_level = 0, locked_until = null;
  delete from members where display_name = nm;
end $$;
create or replace function remove_player(p_name text) returns void language sql as $$
  delete from players where name = p_name;
  delete from members where display_name = p_name;
$$;
revoke all on function set_player(text, text), remove_player(text) from public, anon, authenticated;

-- 예전 "방 비번" 방식 정리. 방 비번으로 들어와 있던 기기는 모두 로그아웃된다 (처음 한 번만 일어남)
drop function if exists join_room(text, text);
drop function if exists check_room_password(text);
drop function if exists set_room_password(text);
drop function if exists change_room_password(text, text);
do $$ begin
  if to_regclass('public.room_secret') is not null then
    delete from members where true;
    drop table room_secret;
  end if;
end $$;

-- 앱이 부를 수 있는 함수는 로그인한(익명 포함) 사용자만
revoke all on function current_name(), login(text, text), change_my_password(text, text) from public, anon;
grant execute on function current_name(), login(text, text), change_my_password(text, text) to authenticated;
revoke all on places, bookmarks, inventory_layout, server_info from anon;

-- ===================== 갑옷 (방장이 SQL Editor에서만 준다) =====================
-- 주기:   select give_armor('철수', 'helmet', 'diamond');
-- 뺏기:   select take_armor('철수', 'helmet');
-- 부위: helmet, chestplate, leggings, boots / 재료: leather, chainmail, iron, gold, diamond, netherite

create table if not exists armor (
  owner_name text not null check (char_length(owner_name) between 1 and 16),
  slot text not null check (slot in ('helmet', 'chestplate', 'leggings', 'boots')),
  material text not null check (material in ('leather', 'chainmail', 'iron', 'gold', 'diamond', 'netherite')),
  given_at timestamptz not null default now(),
  primary key (owner_name, slot)
);
alter table armor enable row level security;
drop policy if exists armor_select on armor;
create policy armor_select on armor for select to authenticated using (owner_name = (select current_name()));
revoke all on armor from anon;

create or replace function give_armor(p_name text, p_slot text, p_material text) returns void language sql as $$
  insert into armor (owner_name, slot, material) values (p_name, p_slot, p_material)
  on conflict (owner_name, slot) do update set material = excluded.material, given_at = now();
$$;
create or replace function take_armor(p_name text, p_slot text) returns void language sql as $$
  delete from armor where owner_name = p_name and slot = p_slot;
$$;
revoke all on function give_armor(text, text, text), take_armor(text, text) from public, anon, authenticated;

-- ===================== Realtime =====================
-- 접속 중인 사람에게 변경을 알린다. 이벤트를 받으면 클라이언트가 목록을 다시 조회한다.
do $$
declare t text;
begin
  foreach t in array array['places', 'server_info'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
