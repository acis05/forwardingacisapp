import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { pool, initDb, loadJob } from './db.js';
import { createSalesOrder, clearAccurateSessionCache } from './accurate.js';
import { createAuthorizationUrl, exchangeAuthorizationCode, oauthStatus, disconnectOAuth } from './oauth.js';

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

const __dirname = path.dirname(fileURLToPath(import.meta.url));
app.use(express.static(path.join(__dirname, '../public')));

app.get('/auth/accurate', async (_req, res) => {
  try {
    res.redirect(await createAuthorizationUrl());
  } catch (e) {
    res.status(500).send(`Gagal memulai OAuth Accurate: ${e.message}`);
  }
});

app.get('/auth/accurate/callback', async (req, res) => {
  try {
    if (req.query.error) throw new Error(String(req.query.error_description || req.query.error));
    if (!req.query.code) throw new Error('Authorization code tidak diterima dari Accurate.');
    await exchangeAuthorizationCode(String(req.query.code), String(req.query.state || ''));
    clearAccurateSessionCache();
    res.redirect('/?accurate=connected');
  } catch (e) {
    res.redirect(`/?accurate=error&message=${encodeURIComponent(e.message)}`);
  }
});

app.get('/api/accurate/status', async (_req, res) => {
  try { res.json(await oauthStatus()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/accurate/disconnect', async (_req, res) => {
  await disconnectOAuth();
  clearAccurateSessionCache();
  res.json({ ok: true });
});

app.get('/api/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ ok: true, database: 'connected' });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get('/api/dashboard', async (_req, res) => {
  const r = await pool.query(`SELECT
    COUNT(*)::int total,
    COUNT(*) FILTER (WHERE status IN ('DRAFT','FAILED'))::int ready,
    COUNT(*) FILTER (WHERE status='SYNCED')::int synced,
    COUNT(*) FILTER (WHERE status='FAILED')::int failed
    FROM jobs`);
  res.json(r.rows[0]);
});

app.get('/api/jobs', async (_req, res) => {
  const r = await pool.query(`SELECT j.*,
    COALESCE((SELECT SUM(qty*unit_price) FROM charges c WHERE c.job_id=j.id),0)::float8 total_amount
    FROM jobs j ORDER BY j.id DESC`);
  res.json(r.rows);
});

app.get('/api/jobs/:id', async (req, res) => {
  const job = await loadJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job tidak ditemukan' });
  res.json(job);
});

app.post('/api/jobs', async (req, res) => {
  const b = req.body;
  if (!b.job_no || !b.job_date || !b.customer_name) {
    return res.status(400).json({ error: 'job_no, job_date, customer_name wajib diisi.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const r = await client.query(`INSERT INTO jobs
      (job_no,job_date,customer_name,customer_no,po_number,bl_number,container_number,vessel,pol,pod,vendor_name,currency,exchange_rate,notes,status)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'DRAFT') RETURNING id`, [
      b.job_no,b.job_date,b.customer_name,b.customer_no||null,b.po_number||null,b.bl_number||null,
      b.container_number||null,b.vessel||null,b.pol||null,b.pod||null,b.vendor_name||null,
      b.currency||'IDR',Number(b.exchange_rate||1),b.notes||null
    ]);
    const id = r.rows[0].id;
    for (const c of (b.charges || [])) {
      if (!c.description) continue;
      await client.query(`INSERT INTO charges (job_id,item_no,description,qty,unit,unit_price,tax_code)
        VALUES ($1,$2,$3,$4,$5,$6,$7)`, [id,c.item_no||null,c.description,Number(c.qty||1),c.unit||'JOB',Number(c.unit_price||0),c.tax_code||null]);
    }
    await client.query('COMMIT');
    res.status(201).json(await loadJob(id));
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(400).json({ error: e.message });
  } finally { client.release(); }
});

app.put('/api/jobs/:id', async (req, res) => {
  const id = Number(req.params.id); const b = req.body;
  if (!await loadJob(id)) return res.status(404).json({ error: 'Job tidak ditemukan' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`UPDATE jobs SET job_no=$1,job_date=$2,customer_name=$3,customer_no=$4,po_number=$5,
      bl_number=$6,container_number=$7,vessel=$8,pol=$9,pod=$10,vendor_name=$11,currency=$12,
      exchange_rate=$13,notes=$14,status='DRAFT',updated_at=NOW() WHERE id=$15`, [
      b.job_no,b.job_date,b.customer_name,b.customer_no||null,b.po_number||null,b.bl_number||null,b.container_number||null,
      b.vessel||null,b.pol||null,b.pod||null,b.vendor_name||null,b.currency||'IDR',Number(b.exchange_rate||1),b.notes||null,id]);
    await client.query('DELETE FROM charges WHERE job_id=$1', [id]);
    for (const c of (b.charges||[])) if(c.description) {
      await client.query(`INSERT INTO charges (job_id,item_no,description,qty,unit,unit_price,tax_code)
        VALUES ($1,$2,$3,$4,$5,$6,$7)`, [id,c.item_no||null,c.description,Number(c.qty||1),c.unit||'JOB',Number(c.unit_price||0),c.tax_code||null]);
    }
    await client.query('COMMIT');
    res.json(await loadJob(id));
  } catch(e) {
    await client.query('ROLLBACK'); res.status(400).json({error:e.message});
  } finally { client.release(); }
});

app.post('/api/jobs/:id/sync', async (req, res) => {
  const id = Number(req.params.id);
  const job = await loadJob(id);
  if (!job) return res.status(404).json({ error: 'Job tidak ditemukan' });
  if (job.status === 'SYNCED' && !req.body?.force) return res.status(409).json({ error: 'Job sudah pernah sync. Gunakan force=true jika memang ingin kirim ulang.' });
  if (!job.charges.length) return res.status(400).json({ error: 'Minimal satu charge diperlukan.' });
  await pool.query("UPDATE jobs SET status='SYNCING',sync_error=NULL WHERE id=$1", [id]);
  try {
    const result = await createSalesOrder(job, job.charges);
    const r = result.response?.r || {};
    await pool.query("UPDATE jobs SET status='SYNCED', accurate_so_id=$1, accurate_so_no=$2, sync_error=NULL, updated_at=NOW() WHERE id=$3",
      [r.id ? String(r.id) : null, r.no || r.number || null, id]);
    await pool.query(`INSERT INTO sync_logs(job_id,action,status,message,payload,response) VALUES ($1,$2,$3,$4,$5,$6)`,
      [id,'CREATE_SALES_ORDER','SUCCESS','Sales Order berhasil dibuat',result.payload,result.response]);
    res.json(await loadJob(id));
  } catch (e) {
    await pool.query("UPDATE jobs SET status='FAILED',sync_error=$1,updated_at=NOW() WHERE id=$2", [e.message,id]);
    await pool.query('INSERT INTO sync_logs(job_id,action,status,message) VALUES ($1,$2,$3,$4)', [id,'CREATE_SALES_ORDER','FAILED',e.message]);
    res.status(502).json({ error: e.message, job: await loadJob(id) });
  }
});

app.get('/api/logs', async (_req,res) => {
  const r = await pool.query(`SELECT l.*,j.job_no FROM sync_logs l LEFT JOIN jobs j ON j.id=l.job_id ORDER BY l.id DESC LIMIT 50`);
  res.json(r.rows);
});

app.get('*', (_req,res)=>res.sendFile(path.join(__dirname,'../public/index.html')));

const port = Number(process.env.PORT || 3000);
await initDb();
app.listen(port, '0.0.0.0', () => console.log(`Forwarding Hub running on port ${port}`));
