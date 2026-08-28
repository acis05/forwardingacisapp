import pg from 'pg';
const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL belum diisi. Di Railway, hubungkan variable ini ke PostgreSQL service.');
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

export async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS jobs (
      id BIGSERIAL PRIMARY KEY,
      job_no TEXT NOT NULL UNIQUE,
      job_date DATE NOT NULL,
      customer_name TEXT NOT NULL,
      customer_no TEXT,
      po_number TEXT,
      bl_number TEXT,
      container_number TEXT,
      vessel TEXT,
      pol TEXT,
      pod TEXT,
      vendor_name TEXT,
      currency TEXT DEFAULT 'IDR',
      exchange_rate NUMERIC(20,6) DEFAULT 1,
      notes TEXT,
      status TEXT DEFAULT 'DRAFT',
      accurate_so_id TEXT,
      accurate_so_no TEXT,
      sync_error TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS charges (
      id BIGSERIAL PRIMARY KEY,
      job_id BIGINT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
      item_no TEXT,
      description TEXT NOT NULL,
      qty NUMERIC(20,6) NOT NULL DEFAULT 1,
      unit TEXT DEFAULT 'JOB',
      unit_price NUMERIC(20,6) NOT NULL DEFAULT 0,
      tax_code TEXT
    );

    CREATE TABLE IF NOT EXISTS accurate_oauth (
      id SMALLINT PRIMARY KEY CHECK (id = 1),
      access_token TEXT NOT NULL,
      refresh_token TEXT,
      token_type TEXT,
      scope TEXT,
      expires_at TIMESTAMPTZ,
      user_json JSONB,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS oauth_states (
      state TEXT PRIMARY KEY,
      expires_at TIMESTAMPTZ NOT NULL,
      used_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS sync_logs (
      id BIGSERIAL PRIMARY KEY,
      job_id BIGINT REFERENCES jobs(id) ON DELETE SET NULL,
      action TEXT NOT NULL,
      status TEXT NOT NULL,
      message TEXT,
      payload JSONB,
      response JSONB,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
    CREATE INDEX IF NOT EXISTS idx_charges_job_id ON charges(job_id);
    CREATE INDEX IF NOT EXISTS idx_logs_job_id ON sync_logs(job_id);
  `);
}

export async function loadJob(id, client = pool) {
  const jr = await client.query('SELECT * FROM jobs WHERE id=$1', [id]);
  if (!jr.rows[0]) return null;
  const cr = await client.query('SELECT * FROM charges WHERE job_id=$1 ORDER BY id', [id]);
  return { ...jr.rows[0], charges: cr.rows };
}
