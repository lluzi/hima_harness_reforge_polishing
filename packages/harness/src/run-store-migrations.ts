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
      INSERT INTO hima.schema_version VALUES (1) ON CONFLICT DO NOTHING;
      CREATE TABLE IF NOT EXISTS hima.runs (
        run_id text PRIMARY KEY, engine text NOT NULL DEFAULT 'dbos/5.2.11', schema_version integer NOT NULL DEFAULT 1, input_sha256 text NOT NULL, application_version text NOT NULL,
        opening jsonb NOT NULL, owner text NOT NULL, deadline_at timestamptz NOT NULL,
        epoch integer NOT NULL DEFAULT 0, revision integer NOT NULL DEFAULT 0,
        hold text, cancelled boolean NOT NULL DEFAULT false, fact_seq integer NOT NULL DEFAULT 0,
        created_at timestamptz NOT NULL DEFAULT clock_timestamp());
      CREATE TABLE IF NOT EXISTS hima.commands (
        run_id text NOT NULL REFERENCES hima.runs, command_id text NOT NULL, digest text NOT NULL,
        command jsonb NOT NULL, receipt jsonb NOT NULL, PRIMARY KEY(run_id,command_id));
      CREATE TABLE IF NOT EXISTS hima.effects (
        effect_id text PRIMARY KEY, run_id text NOT NULL REFERENCES hima.runs, input_sha256 text NOT NULL,
        identity jsonb NOT NULL, intent jsonb NOT NULL, phase text NOT NULL DEFAULT 'intent', fact jsonb);
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
    `);
    const { rows } = await client.query<{version: number}>('SELECT version FROM hima.schema_version');
    if (rows.length !== 1 || rows[0]?.version !== 1) throw new Error('Unsupported Hima application database schema; reopen with its original App version');
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}
