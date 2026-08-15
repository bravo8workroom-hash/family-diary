-- ============================================================
--  우리집 다이어리 — Supabase 스키마
--
--  Supabase 대시보드 → SQL Editor 에 이 파일을 통째로 붙여넣고
--  [Run] 을 한 번 누르면 끝입니다.
--
--  안전장치: 이미 있는 표와 데이터는 건드리지 않습니다
--  (create ... if not exists). 실수로 다시 Run 해도 기록은 안 지워집니다.
-- ============================================================


-- ── 1) 가족 명단 ─────────────────────────────────────────────
--  여기에 적힌 이메일만 데이터를 읽고 쓸 수 있습니다.
--  이 표가 비어 있으면 아무도 못 들어옵니다 (그게 기본값입니다).
create table if not exists family_allow (
  email text primary key
);

alter table family_allow enable row level security;

-- 로그인한 사람이 "내가 명단에 있는지"만 확인할 수 있게 (남의 이메일은 안 보임)
drop policy if exists family_allow_self on family_allow;
create policy family_allow_self on family_allow
  for select to authenticated
  using (email = (auth.jwt() ->> 'email'));


-- ── 2) 가족 데이터 ───────────────────────────────────────────
--  일정·피드·할일·스티커·용돈·가계부·낚시도감이 doc 한 칸에
--  통째로 들어갑니다. rev 는 "몇 번째 저장인지" 세는 번호로,
--  두 사람이 동시에 저장할 때 서로의 기록을 덮어쓰지 않게 막아줍니다.
create table if not exists family_state (
  id         text primary key,
  doc        jsonb       not null default '{}'::jsonb,
  rev        bigint      not null default 1,
  updated_at timestamptz not null default now()
);

alter table family_state enable row level security;

-- 명단에 있는 가족만 읽기 / 만들기 / 고치기
drop policy if exists family_state_read on family_state;
create policy family_state_read on family_state
  for select to authenticated
  using (exists (select 1 from family_allow a where a.email = (auth.jwt() ->> 'email')));

drop policy if exists family_state_insert on family_state;
create policy family_state_insert on family_state
  for insert to authenticated
  with check (exists (select 1 from family_allow a where a.email = (auth.jwt() ->> 'email')));

drop policy if exists family_state_update on family_state;
create policy family_state_update on family_state
  for update to authenticated
  using (exists (select 1 from family_allow a where a.email = (auth.jwt() ->> 'email')))
  with check (exists (select 1 from family_allow a where a.email = (auth.jwt() ->> 'email')));

-- 한 사람이 바꾸면 다른 가족 화면도 바로 따라 바뀌게
do $$
begin
  alter publication supabase_realtime add table family_state;
exception
  when duplicate_object then null;
end $$;


-- ── 3) AI 부탁 대기열 ────────────────────────────────────────
--  가족이 앱에서 "캡처 정리해줘" 를 누르면 여기 쌓입니다.
--  사용자님이 VS코드에서 담당(/family-diary)을 부르면 대기 중인 것을
--  읽어 처리하고 결과를 family_state 에 넣은 뒤 완료로 바꿉니다.
create table if not exists family_jobs (
  id         bigint generated always as identity primary key,
  kind       text        not null,                  -- receipt(가계부 캡처)
  payload    jsonb       not null default '{}'::jsonb,
  status     text        not null default '대기',    -- 대기 | 완료 | 실패
  note       text,                                   -- 결과 또는 실패 이유 한 줄
  asked_by   text,                                   -- 부탁한 사람 (프로필 이름)
  created_at timestamptz not null default now(),
  done_at    timestamptz
);

create index if not exists family_jobs_waiting on family_jobs (status, created_at);

alter table family_jobs enable row level security;

drop policy if exists family_jobs_all on family_jobs;
create policy family_jobs_all on family_jobs
  for all to authenticated
  using (exists (select 1 from family_allow a where a.email = (auth.jwt() ->> 'email')))
  with check (exists (select 1 from family_allow a where a.email = (auth.jwt() ->> 'email')));


-- ── 4) 사진 보관함 ───────────────────────────────────────────
--  피드 사진과 낚시 사진이 여기 들어갑니다.
--  public = false → 주소를 알아도 로그인 없이는 못 엽니다.
insert into storage.buckets (id, name, public)
values ('family-photos', 'family-photos', false)
on conflict (id) do nothing;

drop policy if exists family_photos_read on storage.objects;
create policy family_photos_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'family-photos'
    and exists (select 1 from family_allow a where a.email = (auth.jwt() ->> 'email'))
  );

drop policy if exists family_photos_write on storage.objects;
create policy family_photos_write on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'family-photos'
    and exists (select 1 from family_allow a where a.email = (auth.jwt() ->> 'email'))
  );

drop policy if exists family_photos_delete on storage.objects;
create policy family_photos_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'family-photos'
    and exists (select 1 from family_allow a where a.email = (auth.jwt() ->> 'email'))
  );


-- ============================================================
--  마지막 한 줄 — 가족 이메일 넣기
--
--  Authentication → Users → Add user 로 가족 계정을 만든 다음,
--  아래 줄의 이메일을 그 계정으로 바꿔서 실행하세요.
--  (계정을 여러 개 만들었으면 줄을 늘려서 다 넣으면 됩니다.)
-- ============================================================
-- insert into family_allow (email) values ('가족계정@example.com')
--   on conflict (email) do nothing;
