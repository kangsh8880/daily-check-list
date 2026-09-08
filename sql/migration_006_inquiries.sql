-- ============================================================================
-- migration_006: 문의사항(Q&A) 기능 추가
-- 목적: 시스템에 대한 기능요구사항/불편사항/기타 문의를 누구나(모든 역할) 등록하고
--       누구나(모든 역할) 답변할 수 있는 게시판 기능 (별도 권한 제한 없음)
-- 적용방법: Supabase 프로젝트 > SQL Editor 에 전체 붙여넣기 후 Run
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. 문의사항 (Inquiries)
-- ----------------------------------------------------------------------------
create table if not exists inquiries (
  id            uuid primary key default gen_random_uuid(),
  category      text not null default 'ETC'
                check (category in ('FEATURE','INCONVENIENCE','ETC')),  -- 기능요구사항 / 불편사항 / 기타
  title         text not null,
  content       text not null,
  author_id     uuid not null references inspectors(id),
  status        text not null default 'OPEN'
                check (status in ('OPEN','ANSWERED','CLOSED')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists idx_inquiries_created on inquiries(created_at desc);
create index if not exists idx_inquiries_status on inquiries(status);

-- ----------------------------------------------------------------------------
-- 2. 문의사항 답변 (Inquiry Replies) - 점검자/조치담당자/관리자 누구나 답변 가능
-- ----------------------------------------------------------------------------
create table if not exists inquiry_replies (
  id            uuid primary key default gen_random_uuid(),
  inquiry_id    uuid not null references inquiries(id) on delete cascade,
  content       text not null,
  replier_id    uuid not null references inspectors(id),
  created_at    timestamptz not null default now()
);
create index if not exists idx_inquiry_replies_inquiry on inquiry_replies(inquiry_id);

-- ----------------------------------------------------------------------------
-- 3. RPC 함수 (쓰기는 전부 함수로 - anon 직접 write 차단, 기존 원칙과 동일)
-- ----------------------------------------------------------------------------

-- 3.1 문의 등록 (역할 제한 없음 - 누구나 작성 가능)
create or replace function fn_create_inquiry(
  p_title    text,
  p_content  text,
  p_category text,
  p_author_id uuid
) returns uuid language plpgsql security definer as $$
declare v_id uuid;
begin
  insert into inquiries(title, content, category, author_id)
    values (p_title, p_content, coalesce(p_category,'ETC'), p_author_id)
    returning id into v_id;
  return v_id;
end;
$$;

-- 3.2 답변 등록 (역할 제한 없음 - 누구나 답변 가능) - 답변 등록 시 상태를 '답변완료'로 자동 전환
create or replace function fn_reply_inquiry(
  p_inquiry_id uuid,
  p_content    text,
  p_replier_id uuid
) returns uuid language plpgsql security definer as $$
declare v_id uuid;
begin
  insert into inquiry_replies(inquiry_id, content, replier_id)
    values (p_inquiry_id, p_content, p_replier_id)
    returning id into v_id;

  update inquiries set status = 'ANSWERED', updated_at = now() where id = p_inquiry_id;
  return v_id;
end;
$$;

-- 3.3 문의 상태 변경 (완료/재오픈 등 - 역할 제한 없음)
create or replace function fn_set_inquiry_status(
  p_inquiry_id uuid,
  p_status     text
) returns void language plpgsql security definer as $$
begin
  update inquiries set status = p_status, updated_at = now() where id = p_inquiry_id;
end;
$$;

grant execute on function fn_create_inquiry(text, text, text, uuid) to anon, authenticated;
grant execute on function fn_reply_inquiry(uuid, text, uuid) to anon, authenticated;
grant execute on function fn_set_inquiry_status(uuid, text) to anon, authenticated;

-- ----------------------------------------------------------------------------
-- 4. RLS 활성화 + 정책 (읽기: 공개 허용 / 쓰기: RPC 경유만 허용 - 기존 원칙과 동일)
-- ----------------------------------------------------------------------------
alter table inquiries enable row level security;
alter table inquiry_replies enable row level security;

drop policy if exists inquiries_select on inquiries;
create policy inquiries_select on inquiries for select using (true);

drop policy if exists inquiry_replies_select on inquiry_replies;
create policy inquiry_replies_select on inquiry_replies for select using (true);

revoke insert, update, delete on inquiries, inquiry_replies from anon, authenticated;
grant select on inquiries, inquiry_replies to anon, authenticated;

-- 완료
