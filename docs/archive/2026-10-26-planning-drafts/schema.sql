-- GrokChat draft schema (Postgres 16 + pgvector). Planning draft, not a migration.
-- Tables marked (phase 2) / (phase 3) can wait, but post already points at them
-- so MVP data is ready for the learning loop.
--
-- X rules this schema backs up:
--   * no cross-amplification: there is deliberately nowhere to record a like,
--     repost or reply. The X client exposes create/delete/read only.
--   * automated label: an account can't go active until the label is confirmed.
--   * duplicates: post.embedding + HNSW index for the cross-account similarity check,
--     publish_attempt for idempotent publishing (a double post is a duplicate).

create extension if not exists vector;

-- Append-only guard for history tables.
create function forbid_mutation() returns trigger language plpgsql as $$
begin
  raise exception '% is append-only', tg_table_name;
end $$;

------------------------------------------------------------------------------
-- People, brands, accounts
------------------------------------------------------------------------------

create table app_user (
  id           bigint generated always as identity primary key,
  email        text not null unique,
  display_name text not null,
  role         text not null check (role in ('admin', 'approver', 'viewer')),
  created_at   timestamptz not null default now()
);

-- What is being promoted. A single row if it's only our own product.
create table brand (
  id              bigint generated always as identity primary key,
  name            text not null unique,
  promo_tag       text not null, -- exact tag every promotional post must carry, e.g. '#ad'
  created_at      timestamptz not null default now()
);

create table account (
  id                          bigint generated always as identity primary key,
  x_user_id                   text not null unique,
  handle                      text not null,
  display_name                text not null,
  identity                    text not null, -- the account's distinct use case
  audience                    text not null,
  bio_disclosure              text,          -- how the bio ties the account to the firm
  automated_label_confirmed_at timestamptz,
  status                      text not null default 'onboarding'
                              check (status in ('onboarding', 'active', 'paused', 'suspended', 'retired')),
  paused_reason               text,
  created_at                  timestamptz not null default now(),
  constraint account_active_needs_label
    check (status <> 'active' or automated_label_confirmed_at is not null)
);
create unique index account_handle_key on account (lower(handle));

-- OAuth 2.0 user tokens, encrypted with a key held in Infisical. Never plaintext.
create table account_credential (
  account_id       bigint primary key references account (id) on delete cascade,
  access_token_enc bytea not null,
  refresh_token_enc bytea not null,
  scopes           text[] not null,
  expires_at       timestamptz not null,
  updated_at       timestamptz not null default now()
);

create table account_snapshot (
  account_id      bigint not null references account (id),
  captured_at     timestamptz not null,
  followers_count integer not null,
  following_count integer not null,
  post_count      integer not null,
  primary key (account_id, captured_at)
);

------------------------------------------------------------------------------
-- Personalities and playbooks
------------------------------------------------------------------------------

create table personality (
  id                          bigint generated always as identity primary key,
  account_id                  bigint not null references account (id),
  slug                        text not null,
  name                        text not null,
  voice                       text not null, -- locked; change it by creating a new personality
  topic_boundaries            jsonb not null default '{}', -- {"allowed": [...], "off_limits": [...]}
  requires_human_approval     boolean not null default true,
  status                      text not null default 'active' check (status in ('active', 'paused', 'retired')),
  current_playbook_version_id bigint,
  created_at                  timestamptz not null default now(),
  unique (account_id, slug),
  unique (id, account_id)
);

create function forbid_voice_change() returns trigger language plpgsql as $$
begin
  if new.voice is distinct from old.voice then
    raise exception 'personality.voice is locked; create a new personality instead';
  end if;
  return new;
end $$;
create trigger personality_voice_locked before update on personality
  for each row execute function forbid_voice_change();

-- Every playbook change is a new row. A rollback is a new version whose content
-- copies an older one (source = 'rollback').
create table playbook_version (
  id             bigint generated always as identity primary key,
  personality_id bigint not null references personality (id),
  version        integer not null,
  parent_id      bigint references playbook_version (id),
  content        jsonb not null, -- hook_styles, length_range, formats, tone_notes, cta_style, posting_windows, example_post_ids
  diff           jsonb,          -- RFC 6902 JSON Patch from parent; null for version 1
  rationale      text not null,
  source         text not null check (source in ('manual', 'analyst', 'rollback')),
  proposal_id    bigint,         -- playbook_proposal that produced it (phase 2)
  created_by     bigint references app_user (id),
  created_at     timestamptz not null default now(),
  unique (personality_id, version),
  unique (id, personality_id)
);
create trigger playbook_version_append_only before update or delete on playbook_version
  for each row execute function forbid_mutation();

alter table personality add constraint personality_current_playbook_fk
  foreign key (current_playbook_version_id, id) references playbook_version (id, personality_id)
  deferrable initially deferred;

------------------------------------------------------------------------------
-- Briefs and approved claims
------------------------------------------------------------------------------

create table brief (
  id            bigint generated always as identity primary key,
  brand_id      bigint not null references brand (id),
  name          text not null,
  messaging     text not null,
  goals         text not null,
  promo_details text,
  cta_url       text,
  off_limits    jsonb not null default '[]',
  starts_at     timestamptz not null,
  ends_at       timestamptz,
  created_at    timestamptz not null default now()
);

create table brief_personality (
  brief_id       bigint not null references brief (id),
  personality_id bigint not null references personality (id),
  primary key (brief_id, personality_id)
);

-- The only product claims the generator may make; the critic maps each claim
-- in a post to a row here.
create table approved_claim (
  id          bigint generated always as identity primary key,
  brand_id    bigint not null references brand (id),
  claim       text not null,
  evidence    text not null,
  valid_from  date,
  valid_until date,
  active      boolean not null default true
);

------------------------------------------------------------------------------
-- Experiments (phase 2) — post can reference an arm from day one
------------------------------------------------------------------------------

create table experiment (
  id                       bigint generated always as identity primary key,
  personality_id           bigint not null references personality (id),
  base_playbook_version_id bigint not null references playbook_version (id),
  feature                  text not null
                           check (feature in ('hook_type', 'format', 'length_bucket', 'posting_window', 'cta_style', 'topic', 'other')),
  hypothesis               text not null,
  status                   text not null default 'draft'
                           check (status in ('draft', 'running', 'concluded', 'promoted', 'abandoned')),
  started_at               timestamptz,
  concluded_at             timestamptz,
  result                   jsonb -- shouldPromote() output
);

create table experiment_arm (
  id            bigint generated always as identity primary key,
  experiment_id bigint not null references experiment (id),
  name          text not null,
  is_control    boolean not null,
  variant       jsonb not null,
  allocation    numeric(4, 3) not null check (allocation between 0 and 1),
  unique (experiment_id, name)
);

create table playbook_proposal (
  id                bigint generated always as identity primary key,
  personality_id    bigint not null references personality (id),
  base_version_id   bigint not null references playbook_version (id),
  diff              jsonb not null,
  rationale         text not null,
  evidence_post_ids bigint[] not null,
  experiment_id     bigint references experiment (id),
  status            text not null default 'proposed'
                    check (status in ('proposed', 'testing', 'approved', 'rejected')),
  decided_by        bigint references app_user (id),
  decided_at        timestamptz,
  created_at        timestamptz not null default now()
);

alter table playbook_version add constraint playbook_version_proposal_fk
  foreign key (proposal_id) references playbook_proposal (id);

------------------------------------------------------------------------------
-- Generation, review, publishing
------------------------------------------------------------------------------

create table generation_run (
  id                  bigint generated always as identity primary key,
  personality_id      bigint not null references personality (id),
  playbook_version_id bigint not null references playbook_version (id),
  brief_id            bigint references brief (id),
  experiment_arm_id   bigint references experiment_arm (id),
  slot_at             timestamptz not null,
  model               text not null,
  prompt              text not null,
  llm_cost_usd        numeric(10, 4),
  created_at          timestamptz not null default now()
);

-- One row per candidate; candidates that fail a check stay, with their reason,
-- for the "rejected candidates" queue view.
create table post (
  id                  bigint generated always as identity primary key,
  generation_run_id   bigint references generation_run (id),
  account_id          bigint not null,
  personality_id      bigint not null,
  playbook_version_id bigint not null,
  brief_id            bigint references brief (id),
  experiment_arm_id   bigint references experiment_arm (id),
  bucket              text not null check (bucket in ('exploit', 'variation', 'experiment')), -- the 70/20/10 split
  format              text not null check (format in ('single', 'thread', 'image', 'poll')),
  body                jsonb not null, -- {"parts": ["..."], "poll": {...}, "media": [...]}
  dedup_text          text not null,  -- all parts joined; what gets embedded
  is_promotional      boolean not null,
  link_url            text,
  tracking_code       text unique,
  -- Fixed vocabularies, set by the generator and checked by the critic, so the
  -- analyst compares like with like instead of free text.
  hook_type           text,
  length_bucket       text check (length_bucket in ('short', 'medium', 'long')),
  topic               text,
  cta_style           text,
  embedding           vector(1536), -- dimension depends on the embedding model
  status              text not null default 'candidate'
                      check (status in ('candidate', 'critic_rejected', 'duplicate_rejected', 'pending_approval',
                                        'human_rejected', 'approved', 'scheduled', 'publishing', 'published',
                                        'failed', 'withdrawn')),
  scheduled_at        timestamptz,
  published_at        timestamptz,
  x_post_ids          text[], -- head of thread first
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  foreign key (personality_id, account_id) references personality (id, account_id),
  foreign key (playbook_version_id, personality_id) references playbook_version (id, personality_id),
  constraint post_scheduled_has_time
    check (status not in ('scheduled', 'publishing', 'published') or scheduled_at is not null),
  constraint post_published_has_ids
    check (status <> 'published' or (published_at is not null and coalesce(cardinality(x_post_ids), 0) > 0)),
  constraint post_link_is_promotional
    check (link_url is null or is_promotional)
);
create unique index post_x_head_key on post ((x_post_ids[1])) where x_post_ids is not null;
create index post_queue_idx on post (status, scheduled_at);
create index post_personality_published_idx on post (personality_id, published_at desc);
create index post_embedding_idx on post using hnsw (embedding vector_cosine_ops);

create table post_claim (
  post_id  bigint not null references post (id),
  claim_id bigint not null references approved_claim (id),
  primary key (post_id, claim_id)
);

create table post_review (
  id              bigint generated always as identity primary key,
  post_id         bigint not null references post (id),
  stage           text not null check (stage in ('critic', 'dedup', 'human')),
  verdict         text not null check (verdict in ('pass', 'fail', 'approve', 'reject', 'edit')),
  reasons         text,
  scores          jsonb, -- critic: voice_fit, brand_safety, claims_ok, tag_present
  similar_post_id bigint references post (id),
  similarity      real,
  reviewer_id     bigint references app_user (id),
  model           text,
  created_at      timestamptz not null default now(),
  constraint post_review_human_has_reviewer check (stage <> 'human' or reviewer_id is not null)
);
create trigger post_review_append_only before update or delete on post_review
  for each row execute function forbid_mutation();

create table publish_attempt (
  id              bigint generated always as identity primary key,
  post_id         bigint not null references post (id),
  attempt         integer not null,
  status          text not null check (status in ('sent', 'succeeded', 'failed', 'unknown')),
  error           text,
  response        jsonb,
  created_at      timestamptz not null default now(),
  unique (post_id, attempt)
);

------------------------------------------------------------------------------
-- Metrics and scores
------------------------------------------------------------------------------

create table metric_snapshot (
  post_id        bigint not null references post (id),
  target_age     text not null check (target_age in ('1h', '6h', '24h', '72h', '7d')),
  captured_at    timestamptz not null,
  age_seconds    integer not null, -- actual age; scoring interpolates to the exact target
  impressions    integer not null,
  likes          integer not null,
  reposts        integer not null,
  quotes         integer not null,
  replies        integer not null,
  bookmarks      integer not null,
  link_clicks    integer, -- non-public metrics: null if unavailable (30-day limit, API error)
  profile_visits integer,
  raw            jsonb not null,
  primary key (post_id, target_age)
);

create table post_score (
  post_id         bigint not null references post (id),
  target_age      text not null check (target_age in ('24h', '72h')),
  scoring_version text not null,
  score           double precision not null,
  rate_component  double precision not null,
  reach_component double precision not null,
  baseline_n      integer not null,
  is_winner       boolean not null,
  computed_at     timestamptz not null default now(),
  primary key (post_id, target_age, scoring_version)
);

-- Clicks and conversions through our own redirect (depends on the conversion goal).
create table tracked_link_event (
  id            bigint generated always as identity primary key,
  tracking_code text not null references post (tracking_code),
  kind          text not null check (kind in ('click', 'signup', 'purchase')),
  occurred_at   timestamptz not null,
  meta          jsonb
);
create index tracked_link_event_code_idx on tracked_link_event (tracking_code, kind);

------------------------------------------------------------------------------
-- Cross-personality learning (phase 3), spend, audit
------------------------------------------------------------------------------

-- Structural lessons only (timing, format). Never post text.
create table global_insight (
  id         bigint generated always as identity primary key,
  feature    text not null check (feature in ('posting_window', 'format', 'length_bucket', 'hook_type')),
  finding    jsonb not null,
  evidence   jsonb not null,
  confidence real not null,
  created_at timestamptz not null default now()
);

create table api_spend (
  occurred_on date not null,
  provider    text not null check (provider in ('x', 'llm')),
  operation   text not null, -- e.g. 'post_create', 'post_create_url', 'post_read', 'generate', 'critic'
  units       integer not null,
  cost_usd    numeric(10, 4) not null,
  primary key (occurred_on, provider, operation)
);

create table audit_log (
  id         bigint generated always as identity primary key,
  actor_id   bigint references app_user (id),
  action     text not null,
  entity     text not null,
  entity_id  bigint,
  detail     jsonb,
  created_at timestamptz not null default now()
);
