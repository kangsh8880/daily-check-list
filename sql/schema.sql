-- ============================================================================
-- 부품 일상점검 시스템 (Daily Check List) - Supabase 스키마
-- 대상: PostgreSQL 15+ (Supabase)
-- 적용방법: Supabase 프로젝트 > SQL Editor 에 전체 붙여넣기 후 Run
-- ============================================================================

-- 확장 --------------------------------------------------------------------
create extension if not exists "pgcrypto";

-- ============================================================================
-- 1. 점검자 (Inspectors) - 점검자 / 조치담당자 / 관리자
-- ============================================================================
create table if not exists inspectors (
  id            uuid primary key default gen_random_uuid(),
  emp_no        text unique,                 -- 사번 (선택입력)
  name          text not null,
  department    text,                        -- 소속(라인/부서)
  role          text not null default 'inspector'
                check (role in ('inspector','action_owner','admin')),
  pin           text,                        -- 4자리 간편 PIN (선택)
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- ============================================================================
-- 2. 부품유형 (Part Types) - 코드 접두어 + 점검항목 템플릿의 기준
-- ============================================================================
create table if not exists part_types (
  id            uuid primary key default gen_random_uuid(),
  type_name     text not null unique,        -- 예: 모터, 센서, 배관/밸브
  code_prefix   text not null unique,        -- 예: MTR, SNR, VLV (부품코드 접두어)
  description   text,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- 유형+구매일자별 코드 채번 시퀀스 (동시입력 경합 방지)
-- 부품코드 = 유형-YYMMDD(구매일자)-시리얼4자리, 시리얼은 (유형+구매일자) 조합별로 0001부터 리셋
create table if not exists part_type_counters (
  part_type_id  uuid not null references part_types(id) on delete cascade,
  seq_date      date not null,
  last_seq      integer not null default 0,
  primary key (part_type_id, seq_date)
);

-- ============================================================================
-- 3. 점검항목 템플릿 (유형 기준 표준 항목)
-- ============================================================================
create table if not exists checklist_templates (
  id            uuid primary key default gen_random_uuid(),
  part_type_id  uuid not null references part_types(id) on delete cascade,
  item_order    integer not null default 1,
  item_name     text not null,
  judge_type    text not null default 'OX'
                check (judge_type in ('OX','NUMERIC','SELECT')),
  unit          text,                        -- NUMERIC일 때 단위 (예: ℃, bar)
  lower_limit   numeric,                     -- NUMERIC 판정 하한
  upper_limit   numeric,                     -- NUMERIC 판정 상한
  select_options text,                       -- SELECT일 때 콤마구분 옵션 (예: 정상,마모,누유)
  photo_required boolean not null default false,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now()
);

-- ============================================================================
-- 4. 부품 마스터
-- ============================================================================
create table if not exists parts (
  id            uuid primary key default gen_random_uuid(),
  part_code     text not null unique,        -- 자동채번 (예: MTR-0001)
  part_name     text not null,
  part_type_id  uuid not null references part_types(id),
  spec          text,                        -- 규격/사양
  location      text,                        -- 보관위치 (예: A동 2층 랙-03)
  department    text,                        -- 담당부서/라인
  status        text not null default 'IN_USE'
                check (status in ('IN_USE','STORAGE','DISPOSED')),
  purchase_date date,
  qr_version    integer not null default 1,  -- QR 재발행시 +1
  qr_issued_at  timestamptz,
  cycle_type    text not null default 'DAILY'
                check (cycle_type in ('DAILY','WEEKLY','MONTHLY')), -- 점검주기
  cycle_weekdays integer[],                  -- WEEKLY용: 0=일,1=월,...,6=토
  cycle_day_of_month smallint
                check (cycle_day_of_month is null or cycle_day_of_month between 1 and 31), -- MONTHLY용: 1~31일
  is_deleted    boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists idx_parts_type on parts(part_type_id);
create index if not exists idx_parts_deleted on parts(is_deleted);

-- 부품별 점검항목 (등록시 템플릿에서 복사, 개별 추가/제외 가능)
create table if not exists part_checklist_items (
  id            uuid primary key default gen_random_uuid(),
  part_id       uuid not null references parts(id) on delete cascade,
  item_order    integer not null default 1,
  item_name     text not null,
  judge_type    text not null default 'OX'
                check (judge_type in ('OX','NUMERIC','SELECT')),
  unit          text,
  lower_limit   numeric,
  upper_limit   numeric,
  select_options text,
  photo_required boolean not null default false,
  is_active     boolean not null default true
);
create index if not exists idx_pci_part on part_checklist_items(part_id);

-- QR 재발행 이력
create table if not exists qr_reissue_log (
  id            uuid primary key default gen_random_uuid(),
  part_id       uuid not null references parts(id) on delete cascade,
  qr_version    integer not null,
  reason        text,
  reissued_by   uuid references inspectors(id),
  reissued_at   timestamptz not null default now()
);

-- ============================================================================
-- 5. 담당자 배정 (부품 ↔ 점검자)
-- ============================================================================
create table if not exists assignments (
  id            uuid primary key default gen_random_uuid(),
  part_id       uuid not null references parts(id) on delete cascade,
  inspector_id  uuid not null references inspectors(id) on delete cascade,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  unique(part_id, inspector_id)
);

-- ============================================================================
-- 6. 점검 (Inspections) - 헤더/상세
-- ============================================================================
create table if not exists inspections (
  id            uuid primary key default gen_random_uuid(),
  part_id       uuid not null references parts(id),
  inspector_id  uuid not null references inspectors(id),
  inspected_at  timestamptz not null default now(),
  inspect_date  date not null default (now() at time zone 'Asia/Bangkok')::date,
  overall_result text not null default 'NORMAL'
                check (overall_result in ('NORMAL','ABNORMAL')),
  note          text,
  created_at    timestamptz not null default now()
);
create index if not exists idx_insp_date on inspections(inspect_date);
create index if not exists idx_insp_part on inspections(part_id);

create table if not exists inspection_results (
  id            uuid primary key default gen_random_uuid(),
  inspection_id uuid not null references inspections(id) on delete cascade,
  item_name     text not null,               -- 스냅샷 (템플릿 변경과 무관하게 기록 보존)
  judge_type    text not null,
  input_value   text,                        -- OX: 'OK'/'NG', NUMERIC: 숫자문자열, SELECT: 선택값
  judge_result  text not null default 'NORMAL'
                check (judge_result in ('NORMAL','ABNORMAL')),
  photo_url     text
);
create index if not exists idx_ir_inspection on inspection_results(inspection_id);

-- ============================================================================
-- 7. 조치 (Actions) - 2단계 승인형 (조치완료 등록 → 점검자/관리자 승인)
-- ============================================================================
create table if not exists actions (
  id              uuid primary key default gen_random_uuid(),
  inspection_id   uuid references inspections(id),
  inspection_result_id uuid references inspection_results(id),
  part_id         uuid not null references parts(id),
  issue_desc      text not null,
  severity        text not null default 'MINOR'
                  check (severity in ('MINOR','MAJOR','CRITICAL')),
  assignee_id     uuid references inspectors(id),
  due_date        date,
  status          text not null default 'OPEN'
                  check (status in ('OPEN','IN_PROGRESS','DONE','APPROVED','REJECTED')),
  action_taken    text,
  action_photo_url text,
  completed_by    uuid references inspectors(id),
  completed_at    timestamptz,
  approved_by     uuid references inspectors(id),
  approved_at     timestamptz,
  reject_reason   text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists idx_actions_status on actions(status);
create index if not exists idx_actions_part on actions(part_id);

-- ============================================================================
-- 8. RPC 함수 (쓰기는 전부 함수로 - anon 직접 write 차단)
-- ============================================================================

-- 8.1 부품 등록 (코드 자동채번 + 템플릿 항목 복사)
create or replace function fn_create_part(
  p_part_name   text,
  p_part_type_id uuid,
  p_spec        text,
  p_location    text,
  p_department  text,
  p_purchase_date date,
  p_cycle_type  text default 'DAILY',
  p_cycle_weekdays integer[] default null,
  p_cycle_day_of_month smallint default null
) returns table(id uuid, part_code text) language plpgsql security definer as $$
declare
  v_prefix text;
  v_seq    integer;
  v_code   text;
  v_id     uuid;
begin
  if p_purchase_date is null then
    raise exception '구매일자는 필수입니다 (부품코드 채번에 사용됩니다)';
  end if;

  select code_prefix into v_prefix from part_types where part_types.id = p_part_type_id;
  if v_prefix is null then
    raise exception '유효하지 않은 부품유형입니다';
  end if;

  insert into part_type_counters(part_type_id, seq_date, last_seq)
    values (p_part_type_id, p_purchase_date, 1)
    on conflict (part_type_id, seq_date) do update set last_seq = part_type_counters.last_seq + 1
    returning last_seq into v_seq;

  v_code := v_prefix || '-' || to_char(p_purchase_date, 'YYMMDD') || '-' || lpad(v_seq::text, 4, '0');

  insert into parts(part_code, part_name, part_type_id, spec, location, department, purchase_date,
                     cycle_type, cycle_weekdays, cycle_day_of_month)
    values (v_code, p_part_name, p_part_type_id, p_spec, p_location, p_department, p_purchase_date,
            coalesce(p_cycle_type,'DAILY'), p_cycle_weekdays, p_cycle_day_of_month)
    returning parts.id into v_id;

  insert into part_checklist_items(part_id, item_order, item_name, judge_type, unit, lower_limit, upper_limit, select_options, photo_required)
    select v_id, ct.item_order, ct.item_name, ct.judge_type, ct.unit, ct.lower_limit, ct.upper_limit, ct.select_options, ct.photo_required
    from checklist_templates ct
    where ct.part_type_id = p_part_type_id and ct.is_active = true
    order by ct.item_order;

  return query select v_id, v_code;
end;
$$;

-- 8.2 부품 수정
create or replace function fn_update_part(
  p_id uuid, p_part_name text, p_spec text, p_location text,
  p_department text, p_status text, p_purchase_date date,
  p_cycle_type text default 'DAILY', p_cycle_weekdays integer[] default null, p_cycle_day_of_month smallint default null
) returns void language plpgsql security definer as $$
begin
  update parts set
    part_name = p_part_name,
    spec = p_spec,
    location = p_location,
    department = p_department,
    status = coalesce(p_status, status),
    purchase_date = p_purchase_date,
    cycle_type = coalesce(p_cycle_type, 'DAILY'),
    cycle_weekdays = p_cycle_weekdays,
    cycle_day_of_month = p_cycle_day_of_month,
    updated_at = now()
  where id = p_id;
end;
$$;

-- 8.3 부품 삭제 (소프트 삭제)
create or replace function fn_delete_part(p_id uuid) returns void
language sql security definer as $$
  update parts set is_deleted = true, updated_at = now() where id = p_id;
$$;

-- 8.4 QR 재발행
create or replace function fn_reissue_qr(p_part_id uuid, p_reason text, p_by uuid)
returns integer language plpgsql security definer as $$
declare v_ver integer;
begin
  update parts set qr_version = qr_version + 1, qr_issued_at = now()
    where id = p_part_id returning qr_version into v_ver;
  insert into qr_reissue_log(part_id, qr_version, reason, reissued_by)
    values (p_part_id, v_ver, p_reason, p_by);
  return v_ver;
end;
$$;

-- 8.5 QR 최초발행(발행일시 기록)
create or replace function fn_issue_qr(p_part_id uuid) returns void
language sql security definer as $$
  update parts set qr_issued_at = now() where id = p_part_id and qr_issued_at is null;
$$;

-- 8.6 점검결과 제출 (헤더+상세 일괄, 이상항목은 자동 조치티켓 생성)
-- p_results: jsonb 배열 [{item_name, judge_type, input_value, judge_result, photo_url}]
create or replace function fn_submit_inspection(
  p_part_id uuid,
  p_inspector_id uuid,
  p_note text,
  p_results jsonb
) returns uuid language plpgsql security definer as $$
declare
  v_inspection_id uuid;
  v_overall text := 'NORMAL';
  v_item jsonb;
  v_result_id uuid;
begin
  if exists (select 1 from jsonb_array_elements(p_results) r where r->>'judge_result' = 'ABNORMAL') then
    v_overall := 'ABNORMAL';
  end if;

  insert into inspections(part_id, inspector_id, note, overall_result)
    values (p_part_id, p_inspector_id, p_note, v_overall)
    returning id into v_inspection_id;

  for v_item in select * from jsonb_array_elements(p_results) loop
    insert into inspection_results(inspection_id, item_name, judge_type, input_value, judge_result, photo_url)
      values (
        v_inspection_id,
        v_item->>'item_name',
        v_item->>'judge_type',
        v_item->>'input_value',
        coalesce(v_item->>'judge_result','NORMAL'),
        v_item->>'photo_url'
      ) returning id into v_result_id;

    if coalesce(v_item->>'judge_result','NORMAL') = 'ABNORMAL' then
      insert into actions(inspection_id, inspection_result_id, part_id, issue_desc, severity, due_date)
        values (
          v_inspection_id, v_result_id, p_part_id,
          coalesce(v_item->>'item_name','점검항목') || ' 이상 발견 (측정값: ' || coalesce(v_item->>'input_value','-') || ')',
          'MINOR',
          (now() + interval '3 day')::date
        );
    end if;
  end loop;

  return v_inspection_id;
end;
$$;

-- 8.7 조치 담당자 지정 / 수정
create or replace function fn_assign_action(p_action_id uuid, p_assignee_id uuid, p_due_date date, p_severity text)
returns void language sql security definer as $$
  update actions set assignee_id = p_assignee_id, due_date = p_due_date,
    severity = coalesce(p_severity, severity), status = 'IN_PROGRESS', updated_at = now()
    where id = p_action_id;
$$;

-- 8.8 조치 완료 등록 (1단계)
create or replace function fn_complete_action(p_action_id uuid, p_action_taken text, p_photo_url text, p_by uuid)
returns void language sql security definer as $$
  update actions set
    status = 'DONE',
    action_taken = p_action_taken,
    action_photo_url = p_photo_url,
    completed_by = p_by,
    completed_at = now(),
    updated_at = now()
  where id = p_action_id;
$$;

-- 8.9 조치 승인 / 반려 (2단계)
create or replace function fn_review_action(p_action_id uuid, p_approve boolean, p_by uuid, p_reject_reason text)
returns void language plpgsql security definer as $$
begin
  if p_approve then
    update actions set status = 'APPROVED', approved_by = p_by, approved_at = now(), updated_at = now()
      where id = p_action_id;
  else
    update actions set status = 'REJECTED', approved_by = p_by, approved_at = now(),
      reject_reason = p_reject_reason, updated_at = now()
      where id = p_action_id;
  end if;
end;
$$;

-- 8.10 부품유형 / 템플릿 / 점검자 / 배정 upsert (관리화면 공용)
create or replace function fn_upsert_part_type(p_id uuid, p_type_name text, p_code_prefix text, p_description text)
returns uuid language plpgsql security definer as $$
declare v_id uuid;
begin
  if p_id is null then
    insert into part_types(type_name, code_prefix, description) values (p_type_name, upper(p_code_prefix), p_description) returning id into v_id;
  else
    update part_types set type_name = p_type_name, code_prefix = upper(p_code_prefix), description = p_description, updated_at = now()
      where id = p_id returning id into v_id;
  end if;
  return v_id;
end;
$$;

create or replace function fn_delete_part_type(p_id uuid) returns void
language sql security definer as $$
  update part_types set is_active = false, updated_at = now() where id = p_id;
$$;

create or replace function fn_upsert_checklist_item(
  p_id uuid, p_part_type_id uuid, p_item_order int, p_item_name text,
  p_judge_type text, p_unit text, p_lower numeric, p_upper numeric,
  p_select_options text, p_photo_required boolean
) returns uuid language plpgsql security definer as $$
declare v_id uuid;
begin
  if p_id is null then
    insert into checklist_templates(part_type_id, item_order, item_name, judge_type, unit, lower_limit, upper_limit, select_options, photo_required)
      values (p_part_type_id, p_item_order, p_item_name, p_judge_type, p_unit, p_lower, p_upper, p_select_options, p_photo_required)
      returning id into v_id;
  else
    update checklist_templates set
      item_order = p_item_order, item_name = p_item_name, judge_type = p_judge_type,
      unit = p_unit, lower_limit = p_lower, upper_limit = p_upper,
      select_options = p_select_options, photo_required = p_photo_required
      where id = p_id returning id into v_id;
  end if;
  return v_id;
end;
$$;

create or replace function fn_delete_checklist_item(p_id uuid) returns void
language sql security definer as $$
  update checklist_templates set is_active = false where id = p_id;
$$;

create or replace function fn_upsert_inspector(
  p_id uuid, p_emp_no text, p_name text, p_department text, p_role text, p_pin text
) returns uuid language plpgsql security definer as $$
declare v_id uuid;
begin
  if p_id is null then
    insert into inspectors(emp_no, name, department, role, pin) values (p_emp_no, p_name, p_department, p_role, p_pin)
      returning id into v_id;
  else
    update inspectors set emp_no = p_emp_no, name = p_name, department = p_department,
      role = p_role, pin = coalesce(p_pin, pin), updated_at = now()
      where id = p_id returning id into v_id;
  end if;
  return v_id;
end;
$$;

create or replace function fn_delete_inspector(p_id uuid) returns void
language sql security definer as $$
  update inspectors set is_active = false, updated_at = now() where id = p_id;
$$;

create or replace function fn_set_assignment(p_part_id uuid, p_inspector_id uuid, p_active boolean)
returns void language plpgsql security definer as $$
begin
  insert into assignments(part_id, inspector_id, is_active)
    values (p_part_id, p_inspector_id, p_active)
    on conflict (part_id, inspector_id) do update set is_active = p_active;
end;
$$;

-- ============================================================================
-- 9. RLS 활성화 + 정책 (읽기: 공개 허용 / 쓰기: RPC 경유만 허용, 테이블 직접쓰기 차단)
-- ============================================================================
alter table inspectors enable row level security;
alter table part_types enable row level security;
alter table part_type_counters enable row level security;
alter table checklist_templates enable row level security;
alter table parts enable row level security;
alter table part_checklist_items enable row level security;
alter table qr_reissue_log enable row level security;
alter table assignments enable row level security;
alter table inspections enable row level security;
alter table inspection_results enable row level security;
alter table actions enable row level security;

-- 읽기 정책 (anon 포함 전체 허용 - 사내 전용 시스템 전제)
do $$
declare t text;
begin
  foreach t in array array['inspectors','part_types','part_type_counters','checklist_templates',
                            'parts','part_checklist_items','qr_reissue_log','assignments',
                            'inspections','inspection_results','actions']
  loop
    execute format('drop policy if exists %I on %I;', t||'_select', t);
    execute format('create policy %I on %I for select using (true);', t||'_select', t);
  end loop;
end $$;

-- anon/authenticated 의 테이블 직접 insert/update/delete 권한 회수 (RPC로만 쓰기 가능)
revoke insert, update, delete on all tables in schema public from anon, authenticated;
grant select on all tables in schema public to anon, authenticated;
grant execute on all functions in schema public to anon, authenticated;

-- ============================================================================
-- 10. 초기 시드 데이터 (예시 부품유형 3종 + 표준 점검항목)
-- ============================================================================
insert into part_types (type_name, code_prefix, description) values
  ('모터', 'MTR', '각종 구동 모터'),
  ('센서', 'SNR', '온도/압력/근접 센서'),
  ('배관/밸브', 'VLV', '배관 및 밸브류')
on conflict (type_name) do nothing;

-- 시드 재실행시 중복 방지용 유니크 제약 (유형+항목명 기준)
alter table checklist_templates drop constraint if exists uq_checklist_templates_type_item;
alter table checklist_templates add constraint uq_checklist_templates_type_item unique (part_type_id, item_name);

insert into checklist_templates (part_type_id, item_order, item_name, judge_type, unit, lower_limit, upper_limit, photo_required)
select id, 1, '외관 손상/오염 여부', 'OX', null::text, null::numeric, null::numeric, false from part_types where code_prefix='MTR'
union all
select id, 2, '이상소음/진동', 'OX', null::text, null::numeric, null::numeric, false from part_types where code_prefix='MTR'
union all
select id, 3, '작동온도', 'NUMERIC', '℃', 0, 80, false from part_types where code_prefix='MTR'
on conflict (part_type_id, item_name) do nothing;

insert into checklist_templates (part_type_id, item_order, item_name, judge_type, unit, lower_limit, upper_limit, photo_required)
select id, 1, '센서 오염/이물질', 'OX', null::text, null::numeric, null::numeric, true from part_types where code_prefix='SNR'
union all
select id, 2, '측정값 정상범위', 'OX', null::text, null::numeric, null::numeric, false from part_types where code_prefix='SNR'
on conflict (part_type_id, item_name) do nothing;

insert into checklist_templates (part_type_id, item_order, item_name, judge_type, unit, lower_limit, upper_limit, photo_required)
select id, 1, '누유/누수 여부', 'OX', null::text, null::numeric, null::numeric, true from part_types where code_prefix='VLV'
union all
select id, 2, '개폐 작동상태', 'SELECT', null::text, null::numeric, null::numeric, false from part_types where code_prefix='VLV'
on conflict (part_type_id, item_name) do nothing;

update checklist_templates set select_options = '정상,뻑뻑함,작동불가' where item_name = '개폐 작동상태';

-- 완료
