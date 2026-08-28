import axios from 'axios';
import { getAccessToken } from './oauth.js';

const accountBase = 'https://account.accurate.id';
let cachedHost = '';
let cachedSession = '';
let cachedToken = '';

export function clearAccurateSessionCache() {
  cachedHost = '';
  cachedSession = '';
  cachedToken = '';
}

export async function openDatabase() {
  const accessToken = await getAccessToken();
  if (cachedHost && cachedSession && cachedToken === accessToken) return { host: cachedHost, session: cachedSession };
  if (!process.env.ACCURATE_DATABASE_ID) {
    throw new Error('ACCURATE_DATABASE_ID belum diisi di environment.');
  }

  const res = await axios.get(`${accountBase}/api/open-db.do`, {
    params: { id: process.env.ACCURATE_DATABASE_ID },
    headers: { Authorization: `Bearer ${accessToken}` },
    maxRedirects: 5,
    validateStatus: () => true
  });

  if (res.status >= 400 || !res.data?.s || !res.data?.host || !res.data?.session) {
    throw new Error(`Open DB Accurate gagal (${res.status}): ${JSON.stringify(res.data)}`);
  }

  cachedHost = res.data.host;
  cachedSession = res.data.session;
  cachedToken = accessToken;
  return { host: cachedHost, session: cachedSession, accessToken };
}

function formatAccurateDate(value) {
  const raw = String(value || '').slice(0, 10);
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : raw;
}

function buildDescription(job) {
  return [
    `Job: ${job.job_no}`,
    job.bl_number ? `BL: ${job.bl_number}` : '',
    job.container_number ? `Container: ${job.container_number}` : '',
    job.vessel ? `Vessel: ${job.vessel}` : '',
    job.pol || job.pod ? `Route: ${job.pol || '-'} → ${job.pod || '-'}` : '',
    job.vendor_name ? `Vendor: ${job.vendor_name}` : '',
    job.notes || ''
  ].filter(Boolean).join(' | ');
}

function validateSalesOrder(job, charges) {
  if (!job.customer_no) throw new Error('Customer No Accurate wajib diisi sebelum sync.');
  if (!charges?.length) throw new Error('Minimal satu charge diperlukan untuk membuat Sales Order.');
  const invalid = charges.find((c) => !c.item_no || c.unit_price === null || c.unit_price === undefined || c.unit_price === '');
  if (invalid) throw new Error(`Item No Accurate dan Unit Price wajib diisi. Charge bermasalah: ${invalid.description || '(tanpa nama)'}`);
}

export function buildSalesOrderForm(job, charges) {
  validateSalesOrder(job, charges);
  const form = new URLSearchParams();
  const p = 'data[0]';

  form.append(`${p}.customerNo`, job.customer_no);
  form.append(`${p}.transDate`, formatAccurateDate(job.job_date));
  form.append(`${p}.currencyCode`, job.currency || 'IDR');
  form.append(`${p}.description`, buildDescription(job));
  if (job.po_number) form.append(`${p}.poNumber`, job.po_number);
  if (job.exchange_rate && Number(job.exchange_rate) !== 1) form.append(`${p}.rate`, String(job.exchange_rate));

  charges.forEach((c, i) => {
    const d = `${p}.detailItem[${i}]`;
    form.append(`${d}.itemNo`, c.item_no);
    form.append(`${d}.unitPrice`, String(c.unit_price));
    form.append(`${d}.quantity`, String(c.qty || 1));
    if (c.description) form.append(`${d}.detailName`, c.description);
    if (c.unit) form.append(`${d}.itemUnitName`, c.unit);
  });
  return form;
}

export async function createSalesOrder(job, charges) {
  const { host, session, accessToken } = await openDatabase();
  const path = process.env.ACCURATE_SALES_ORDER_PATH || '/accurate/api/sales-order/bulk-save.do';
  const payload = buildSalesOrderForm(job, charges);

  const res = await axios.post(`${host}${path}`, payload, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'X-Session-ID': session,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    maxRedirects: 5,
    validateStatus: () => true
  });

  if (res.status >= 400 || !res.data?.s) throw new Error(`Accurate Sales Order gagal (${res.status}): ${JSON.stringify(res.data)}`);
  return { payload: Object.fromEntries(payload.entries()), response: res.data };
}
