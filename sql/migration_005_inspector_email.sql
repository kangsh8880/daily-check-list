-- ============================================================================
-- migration_005: 점검자 이메일 필드 추가
-- 목적: "오늘 점검목록" 자동 이메일 발송 기능의 선행 데이터 항목
-- 적용방법: Supabase 프로젝트 > SQL Editor 에 전체 붙여넣기 후 Run
-- ============================================================================

alter table inspectors add column if not exists email text;

-- 기존 6-인자 버전 제거 후 email 파라미터가 추가된 버전으로 재정의
drop function if exists fn_upsert_inspector(uuid, text, text, text, text, text);

create or replace function fn_upsert_inspector(
  p_id uuid, p_emp_no text, p_name text, p_department text, p_role text, p_pin text, p_email text default null
) returns uuid language plpgsql security definer as $$
declare v_id uuid;
begin
  if p_id is null then
    insert into inspectors(emp_no, name, department, role, pin, email)
      values (p_emp_no, p_name, p_department, p_role, p_pin, p_email)
      returning id into v_id;
  else
    update inspectors set emp_no = p_emp_no, name = p_name, department = p_department,
      role = p_role, pin = coalesce(p_pin, pin), email = coalesce(p_email, email), updated_at = now()
      where id = p_id returning id into v_id;
  end if;
  return v_id;
end;
$$;

grant execute on function fn_upsert_inspector(uuid, text, text, text, text, text, text) to anon, authenticated;

-- 완료
