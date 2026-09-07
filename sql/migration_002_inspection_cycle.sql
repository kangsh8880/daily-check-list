-- ============================================================================
-- migration_002: 부품별 점검주기(매일/매주/매월) 추가
-- 이미 schema.sql을 실행한 기존 프로젝트에 적용하는 증분 마이그레이션.
-- Supabase SQL Editor에서 전체를 그대로 실행하세요 (기존 데이터에 영향 없음,
-- 기존 부품은 전부 cycle_type='DAILY'로 자동 설정되어 지금까지의 동작과 동일하게 유지됩니다).
-- ============================================================================

-- 1) parts 테이블에 점검주기 컬럼 추가
alter table parts add column if not exists cycle_type text not null default 'DAILY'
  check (cycle_type in ('DAILY','WEEKLY','MONTHLY'));
alter table parts add column if not exists cycle_weekdays integer[]; -- WEEKLY용: 0=일,1=월,2=화,3=수,4=목,5=금,6=토
alter table parts add column if not exists cycle_day_of_month smallint
  check (cycle_day_of_month is null or cycle_day_of_month between 1 and 31); -- MONTHLY용: 1~31일

-- 2) 부품 등록 함수 갱신 (주기 파라미터 추가, 기본값 DAILY라 기존 호출과도 호환)
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
  select code_prefix into v_prefix from part_types where part_types.id = p_part_type_id;
  if v_prefix is null then
    raise exception '유효하지 않은 부품유형입니다';
  end if;

  insert into part_type_counters(part_type_id, last_seq)
    values (p_part_type_id, 1)
    on conflict (part_type_id) do update set last_seq = part_type_counters.last_seq + 1
    returning last_seq into v_seq;

  v_code := v_prefix || '-' || lpad(v_seq::text, 4, '0');

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

-- 3) 부품 수정 함수 갱신
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

grant execute on function fn_create_part(text,uuid,text,text,text,date,text,integer[],smallint) to anon, authenticated;
grant execute on function fn_update_part(uuid,text,text,text,text,text,date,text,integer[],smallint) to anon, authenticated;
