-- ============================================================================
-- migration_003: 부품코드 체계 변경 "유형-시리얼4자리" -> "유형-YYMMDD-시리얼4자리"
-- YYMMDD는 부품 등록시 지정하는 "구매일자" 기준입니다 (등록일자 아님).
-- 시리얼 4자리는 (부품유형 + 구매일자) 조합별로 0001부터 리셋됩니다.
-- 이미 발급된 기존 부품의 코드(예: MTR-0001)는 그대로 유지되며, 이 변경은
-- 앞으로 신규 등록되는 부품부터 적용됩니다.
-- Supabase SQL Editor에서 전체를 그대로 실행하세요.
-- ============================================================================

-- 1) 채번 카운터를 "유형+구매일자" 조합 기준으로 재설계
drop table if exists part_type_counters;
create table part_type_counters (
  part_type_id  uuid not null references part_types(id) on delete cascade,
  seq_date      date not null,
  last_seq      integer not null default 0,
  primary key (part_type_id, seq_date)
);
alter table part_type_counters enable row level security;
drop policy if exists part_type_counters_select on part_type_counters;
create policy part_type_counters_select on part_type_counters for select using (true);
revoke insert, update, delete on part_type_counters from anon, authenticated;
grant select on part_type_counters to anon, authenticated;

-- 2) 부품 등록 함수 갱신: 구매일자 필수화 + "유형-YYMMDD-시리얼4자리" 채번
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

grant execute on function fn_create_part(text,uuid,text,text,text,date,text,integer[],smallint) to anon, authenticated;
