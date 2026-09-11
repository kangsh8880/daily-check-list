-- ============================================================================
-- migration_007: 조치 처리 이력(action_history) 추가
-- 목적: actions 테이블은 조치 1건당 "현재 상태" 한 줄만 유지하는 구조라, 반려 후
--       재배정 → 재조치 → 재승인처럼 같은 조치가 여러 사이클을 거치면 이전 반려
--       사유/처리자 등 지난 이력이 다음 단계에서 덮어써져 사라진다. 배정/완료/승인/
--       반려가 일어날 때마다 이벤트 1건을 별도 테이블에 남겨, "이 조치가 언제 누구에게
--       배정됐고, 언제 반려됐고, 그 다음 누구에게 재배정됐는지" 전체 흐름을 점검 이력
--       조회·조치 관리 화면에서 타임라인으로 확인할 수 있게 한다.
-- 적용방법: Supabase 프로젝트 > SQL Editor 에 전체 붙여넣기 후 Run
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. 조치 처리 이력 테이블
-- ----------------------------------------------------------------------------
create table if not exists action_history (
  id                uuid primary key default gen_random_uuid(),
  action_id         uuid not null references actions(id) on delete cascade,
  event_type        text not null check (event_type in ('ASSIGN','COMPLETE','APPROVE','REJECT')),
  actor_id          uuid references inspectors(id),   -- 이 이벤트를 수행한 사람
  assignee_id       uuid references inspectors(id),   -- ASSIGN: 새로 지정된 담당자
  due_date          date,                               -- ASSIGN: 지정된 기한
  action_taken      text,                               -- COMPLETE: 조치 내용
  action_photo_url  text,                               -- COMPLETE: 조치 사진
  reject_reason     text,                               -- REJECT: 반려 사유
  event_at          timestamptz not null default now()
);
create index if not exists idx_action_history_action on action_history(action_id, event_at);

-- ----------------------------------------------------------------------------
-- 2. 기존 RPC 함수 3종 수정 - 상태 변경과 동시에 이력 1행을 함께 기록한다.
--    fn_assign_action은 "누가 배정했는지"를 남기기 위해 p_by 파라미터를 추가한다
--    (인자 개수가 4개 -> 5개로 바뀌므로, 기존 4-인자 버전은 명시적으로 제거한다).
-- ----------------------------------------------------------------------------
drop function if exists fn_assign_action(uuid, uuid, date, text);

create or replace function fn_assign_action(p_action_id uuid, p_assignee_id uuid, p_due_date date, p_severity text, p_by uuid)
returns void language plpgsql security definer as $$
begin
  update actions set assignee_id = p_assignee_id, due_date = p_due_date,
    severity = coalesce(p_severity, severity), status = 'IN_PROGRESS', updated_at = now()
    where id = p_action_id;
  insert into action_history(action_id, event_type, actor_id, assignee_id, due_date)
    values (p_action_id, 'ASSIGN', p_by, p_assignee_id, p_due_date);
end;
$$;

create or replace function fn_complete_action(p_action_id uuid, p_action_taken text, p_photo_url text, p_by uuid)
returns void language plpgsql security definer as $$
begin
  update actions set
    status = 'DONE', action_taken = p_action_taken, action_photo_url = p_photo_url,
    completed_by = p_by, completed_at = now(), updated_at = now()
  where id = p_action_id;
  insert into action_history(action_id, event_type, actor_id, action_taken, action_photo_url)
    values (p_action_id, 'COMPLETE', p_by, p_action_taken, p_photo_url);
end;
$$;

create or replace function fn_review_action(p_action_id uuid, p_approve boolean, p_by uuid, p_reject_reason text)
returns void language plpgsql security definer as $$
begin
  if p_approve then
    update actions set status = 'APPROVED', approved_by = p_by, approved_at = now(), updated_at = now()
      where id = p_action_id;
    insert into action_history(action_id, event_type, actor_id)
      values (p_action_id, 'APPROVE', p_by);
  else
    update actions set status = 'REJECTED', approved_by = p_by, approved_at = now(),
      reject_reason = p_reject_reason, updated_at = now()
      where id = p_action_id;
    insert into action_history(action_id, event_type, actor_id, reject_reason)
      values (p_action_id, 'REJECT', p_by, p_reject_reason);
  end if;
end;
$$;

grant execute on function fn_assign_action(uuid, uuid, date, text, uuid) to anon, authenticated;
grant execute on function fn_complete_action(uuid, text, text, uuid) to anon, authenticated;
grant execute on function fn_review_action(uuid, boolean, uuid, text) to anon, authenticated;

-- ----------------------------------------------------------------------------
-- 3. RLS: 읽기는 공개 허용, 쓰기는 위 RPC 경유만 허용 (기존 원칙과 동일)
-- ----------------------------------------------------------------------------
alter table action_history enable row level security;

drop policy if exists action_history_select on action_history;
create policy action_history_select on action_history for select using (true);

revoke insert, update, delete on action_history from anon, authenticated;
grant select on action_history to anon, authenticated;

-- 완료
