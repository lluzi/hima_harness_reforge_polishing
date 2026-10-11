import type { Pool } from 'pg';

/** Application facts only. DBOS owns all scheduling and its own receipt schema. */
export async function migrateRunStore(pool: Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(684462031)');
    await client.query(`
      CREATE SCHEMA IF NOT EXISTS hima;
      CREATE TABLE IF NOT EXISTS hima.schema_version(version integer PRIMARY KEY);
      INSERT INTO hima.schema_version SELECT 1 WHERE NOT EXISTS(SELECT 1 FROM hima.schema_version);
      CREATE TABLE IF NOT EXISTS hima.host_exit (
        singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton), active_request text);
      INSERT INTO hima.host_exit(singleton) VALUES(true) ON CONFLICT DO NOTHING;
      CREATE TABLE IF NOT EXISTS hima.host_exit_requests (
        request_id text PRIMARY KEY, mode text NOT NULL, released_at timestamptz,
        accepted_at timestamptz NOT NULL DEFAULT clock_timestamp());
      ALTER TABLE hima.host_exit ADD COLUMN IF NOT EXISTS finalizing boolean NOT NULL DEFAULT false;
      ALTER TABLE hima.host_exit_requests ADD COLUMN IF NOT EXISTS replaces_request text;
      CREATE TABLE IF NOT EXISTS hima.runs (
        run_id text PRIMARY KEY, engine text NOT NULL DEFAULT 'dbos/5.2.11', schema_version integer NOT NULL DEFAULT 1, input_sha256 text NOT NULL, application_version text NOT NULL,
        opening jsonb NOT NULL, owner text NOT NULL, deadline_at timestamptz NOT NULL,
        epoch integer NOT NULL DEFAULT 0, revision integer NOT NULL DEFAULT 0,
        hold text, cancelled boolean NOT NULL DEFAULT false, fact_seq integer NOT NULL DEFAULT 0,
        created_at timestamptz NOT NULL DEFAULT clock_timestamp());
      ALTER TABLE hima.runs ADD COLUMN IF NOT EXISTS hold_source text;
      CREATE TABLE IF NOT EXISTS hima.commands (
        run_id text NOT NULL REFERENCES hima.runs, command_id text NOT NULL, digest text NOT NULL,
        command jsonb NOT NULL, receipt jsonb NOT NULL, PRIMARY KEY(run_id,command_id));
      CREATE TABLE IF NOT EXISTS hima.effects (
        effect_id text PRIMARY KEY, run_id text NOT NULL REFERENCES hima.runs, input_sha256 text NOT NULL,
        identity jsonb NOT NULL, intent jsonb NOT NULL, phase text NOT NULL DEFAULT 'intent', fact jsonb);
      ALTER TABLE hima.effects ADD COLUMN IF NOT EXISTS admitted_at timestamptz;
      CREATE TABLE IF NOT EXISTS hima.effect_facts (
        effect_id text NOT NULL REFERENCES hima.effects, phase text NOT NULL, fact jsonb NOT NULL,
        PRIMARY KEY(effect_id,phase));
      CREATE TABLE IF NOT EXISTS hima.effect_dispatches (
        effect_id text NOT NULL REFERENCES hima.effects, dispatch_id text NOT NULL,
        input_sha256 text NOT NULL, started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
        PRIMARY KEY(effect_id,dispatch_id));
      CREATE TABLE IF NOT EXISTS hima.effect_leases (
        effect_id text PRIMARY KEY REFERENCES hima.effects, site_id text NOT NULL,
        claim jsonb NOT NULL, released_at timestamptz, proof jsonb);
      CREATE INDEX IF NOT EXISTS effect_leases_site ON hima.effect_leases(site_id) WHERE released_at IS NULL;
      CREATE TABLE IF NOT EXISTS hima.results (
        effect_id text PRIMARY KEY REFERENCES hima.effects, run_id text NOT NULL REFERENCES hima.runs,
        input_sha256 text NOT NULL, result_sha256 text NOT NULL, result jsonb NOT NULL);
      CREATE TABLE IF NOT EXISTS hima.outbox (
        fact_id text PRIMARY KEY, run_id text NOT NULL REFERENCES hima.runs, seq integer NOT NULL,
        kind text NOT NULL, payload jsonb NOT NULL, at timestamptz NOT NULL DEFAULT clock_timestamp(),
        acknowledged_at timestamptz, UNIQUE(run_id,seq));
      CREATE INDEX IF NOT EXISTS outbox_pending ON hima.outbox(run_id,seq) WHERE acknowledged_at IS NULL;
      CREATE INDEX IF NOT EXISTS outbox_flow_state_effect ON hima.outbox(run_id,(payload->>'effectId'),seq DESC) WHERE kind='flow-state';
      CREATE TABLE IF NOT EXISTS hima.flow_facts (
        run_id text NOT NULL REFERENCES hima.runs, name text NOT NULL, digest text NOT NULL,
        value jsonb NOT NULL, PRIMARY KEY(run_id,name));
      CREATE TABLE IF NOT EXISTS hima.flow_invocations (
        effect_id text PRIMARY KEY, run_id text NOT NULL REFERENCES hima.runs,
        task_id text NOT NULL, version integer NOT NULL, branches jsonb NOT NULL,
        invocation jsonb NOT NULL);
      CREATE TABLE IF NOT EXISTS hima.flow_branch_controls (
        run_id text NOT NULL REFERENCES hima.runs, scope_digest text NOT NULL, branches jsonb NOT NULL,
        hold text, cancelled boolean NOT NULL DEFAULT false, PRIMARY KEY(run_id,scope_digest));
      ALTER TABLE hima.flow_branch_controls ADD COLUMN IF NOT EXISTS hold_source text;
      CREATE TABLE IF NOT EXISTS hima.flow_derived_effects (
        child_effect_id text PRIMARY KEY, parent_effect_id text NOT NULL,
        run_id text NOT NULL REFERENCES hima.runs, parent_identity jsonb NOT NULL, child_identity jsonb NOT NULL, purpose text NOT NULL DEFAULT 'business',
        CHECK(child_effect_id<>parent_effect_id));
      ALTER TABLE hima.flow_derived_effects ADD COLUMN IF NOT EXISTS purpose text NOT NULL DEFAULT 'business';
    `);
    const { rows } = await client.query<{version: number}>('SELECT version FROM hima.schema_version');
    if (rows.length !== 1 || ![1, 2, 3, 4].includes(rows[0]!.version)) throw new Error('Unsupported Hima application database schema; reopen with its original App version');
    if (rows[0]!.version === 1) {
      await client.query(`
        CREATE TABLE hima.host_operator(singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton), actor_id text NOT NULL UNIQUE);
        CREATE TABLE hima.teams(team_id text PRIMARY KEY, project_id text NOT NULL, version integer NOT NULL CHECK(version>0));
        CREATE TABLE hima.team_versions(team_id text NOT NULL REFERENCES hima.teams, version integer NOT NULL CHECK(version>0),
          sha256 text NOT NULL, definition jsonb NOT NULL, PRIMARY KEY(team_id,version));
        CREATE TABLE hima.team_members(team_id text NOT NULL REFERENCES hima.teams, member_id text NOT NULL, PRIMARY KEY(team_id,member_id));
        CREATE TABLE hima.team_tasks(task_id text PRIMARY KEY, team_id text NOT NULL, definition_version integer NOT NULL,
          project_id text NOT NULL, request_id text NOT NULL, request_sha256 text NOT NULL, task jsonb NOT NULL,
          FOREIGN KEY(team_id,definition_version) REFERENCES hima.team_versions, UNIQUE(project_id,team_id,request_id));
        CREATE TABLE hima.task_actor_grants(grant_id text PRIMARY KEY, task_id text NOT NULL REFERENCES hima.team_tasks,
          token_sha256 text NOT NULL UNIQUE, grant_data jsonb NOT NULL);
        UPDATE hima.schema_version SET version=2 WHERE version=1;
      `);
    }
    if (rows[0]!.version <= 2) {
      await client.query(`CREATE TABLE hima.team_service_receipts(
        seq bigserial PRIMARY KEY, receipt_id text NOT NULL UNIQUE, service_id text NOT NULL,
        generation text NOT NULL, digest text NOT NULL, receipt jsonb NOT NULL);
        CREATE INDEX team_service_receipts_generation ON hima.team_service_receipts(service_id,generation,seq DESC);
        UPDATE hima.schema_version SET version=3;`);
    }
    if (rows[0]!.version < 4) {
      await client.query(`
        ALTER TABLE hima.flow_invocations ADD COLUMN created_at timestamptz;
        ALTER TABLE hima.flow_invocations ALTER COLUMN created_at SET DEFAULT clock_timestamp();
        ALTER TABLE hima.flow_invocations ADD COLUMN admitted_generation integer;
        CREATE TABLE hima.team_attachments(stage_id text PRIMARY KEY, task_id text NOT NULL REFERENCES hima.team_tasks,
          project_id text NOT NULL, actor_id text NOT NULL, request_id text NOT NULL, digest text NOT NULL,
          original jsonb NOT NULL, staged jsonb NOT NULL, parser_completed boolean NOT NULL DEFAULT false, removed boolean NOT NULL DEFAULT false,
          UNIQUE(task_id,actor_id,request_id));
        CREATE TABLE hima.team_messages(seq bigint GENERATED ALWAYS AS IDENTITY UNIQUE, message_id text PRIMARY KEY,
          task_id text NOT NULL REFERENCES hima.team_tasks, request_id text NOT NULL, digest text NOT NULL,
          envelope jsonb NOT NULL, UNIQUE(task_id,request_id));
        CREATE TABLE hima.team_message_deliveries(delivery_id text PRIMARY KEY, message_id text NOT NULL REFERENCES hima.team_messages,
          recipient_member_id text NOT NULL, delivery jsonb NOT NULL, UNIQUE(message_id,recipient_member_id));
        CREATE TABLE hima.team_delivery_attempts(delivery_id text NOT NULL REFERENCES hima.team_message_deliveries,
          attempt_id text NOT NULL, attempt jsonb NOT NULL, PRIMARY KEY(delivery_id,attempt_id));
        CREATE TABLE hima.team_material_links(task_id text NOT NULL REFERENCES hima.team_tasks,
          stage_id text NOT NULL REFERENCES hima.team_attachments, message_id text NOT NULL REFERENCES hima.team_messages,
          member_ids jsonb NOT NULL, PRIMARY KEY(task_id,stage_id,message_id));
        UPDATE hima.schema_version SET version=4;
      `);
    }
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}
