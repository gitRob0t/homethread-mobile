-- Secure conversation and approval trail for Coh, the Chief of Home.
create type public.assistant_action_status as enum (
  'draft',
  'pending_confirmation',
  'approved',
  'executed',
  'canceled',
  'failed'
);

create table public.assistant_conversations (
  id uuid primary key default gen_random_uuid(),
  household_id uuid references public.households(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  title text check (title is null or char_length(title) between 1 and 120),
  state jsonb not null default '{}'::jsonb,
  last_response_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.assistant_turns (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.assistant_conversations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null check (char_length(content) between 1 and 8000),
  structured_data jsonb,
  created_at timestamptz not null default now()
);

create table public.assistant_actions (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.assistant_conversations(id) on delete cascade,
  household_id uuid references public.households(id) on delete cascade,
  requested_by uuid not null references public.profiles(id) on delete cascade,
  action_type text not null check (action_type in ('create_event', 'create_chore', 'create_note')),
  status public.assistant_action_status not null default 'draft',
  payload jsonb not null default '{}'::jsonb,
  executed_record_id uuid,
  created_at timestamptz not null default now(),
  approved_at timestamptz,
  executed_at timestamptz
);

alter table public.assistant_conversations enable row level security;
alter table public.assistant_turns enable row level security;
alter table public.assistant_actions enable row level security;

create policy "users manage own assistant conversations"
on public.assistant_conversations for all
using (
  user_id = auth.uid()
  and (household_id is null or public.is_household_member(household_id))
)
with check (
  user_id = auth.uid()
  and (household_id is null or public.is_household_member(household_id))
);

create policy "users manage turns in own conversations"
on public.assistant_turns for all
using (
  user_id = auth.uid()
  and exists (
    select 1 from public.assistant_conversations conversation
    where conversation.id = conversation_id and conversation.user_id = auth.uid()
  )
)
with check (
  user_id = auth.uid()
  and exists (
    select 1 from public.assistant_conversations conversation
    where conversation.id = conversation_id and conversation.user_id = auth.uid()
  )
);

create policy "users manage own assistant actions"
on public.assistant_actions for all
using (
  requested_by = auth.uid()
  and (household_id is null or public.is_household_member(household_id))
)
with check (
  requested_by = auth.uid()
  and (household_id is null or public.is_household_member(household_id))
);

create index assistant_conversations_user_updated_idx
  on public.assistant_conversations(user_id, updated_at desc);
create index assistant_turns_conversation_created_idx
  on public.assistant_turns(conversation_id, created_at);
create index assistant_actions_conversation_created_idx
  on public.assistant_actions(conversation_id, created_at desc);

alter publication supabase_realtime add table public.assistant_turns;
alter publication supabase_realtime add table public.assistant_actions;
