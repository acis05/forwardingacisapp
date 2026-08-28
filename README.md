# Forwarding Hub — Accurate OAuth + Railway

A GitHub-ready / Railway-ready MVP for forwarding operations that creates Accurate Online Sales Orders through OAuth 2.0 Authorization Code flow.

## What is included
- Direct forwarding Job input: customer, BL, container, vessel, POL/POD, vendor, PO
- Multiple charges / services per Job
- PostgreSQL
- Dashboard, sync status, sync logs, anti accidental double-sync
- Accurate Online **OAuth Authorization Code** login
- Access + refresh token stored server-side in PostgreSQL
- Automatic token refresh starting 1 day before expiry
- Accurate `open-db` + `X-Session-ID`
- Sales Order `POST /accurate/api/sales-order/bulk-save.do`

## Accurate Developer setup
Create/use a **Website** application in Accurate Developer.

Set its OAuth Callback URL to exactly:

`https://YOUR-RAILWAY-DOMAIN/auth/accurate/callback`

Then copy the application's Client ID and Client Secret into Railway Variables. Do **not** commit the secret to GitHub.

The default OAuth scope is:

`sales_order_save`

If your Developer API documentation says additional scopes are required, add them separated by spaces in `ACCURATE_OAUTH_SCOPE`.

## Simplest Railway deployment
1. Create a **private** GitHub repo and upload the contents of this folder to the repo root.
2. Railway → **New Project → Deploy from GitHub Repo**.
3. In the same project add **PostgreSQL**.
4. Generate a Railway public domain for the app.
5. In Accurate Developer, set OAuth Callback to `https://YOUR-DOMAIN/auth/accurate/callback`.
6. Railway app → Variables, set:
   - `DATABASE_URL` → reference PostgreSQL `DATABASE_URL`
   - `ACCURATE_CLIENT_ID`
   - `ACCURATE_CLIENT_SECRET`
   - `ACCURATE_REDIRECT_URI=https://YOUR-DOMAIN/auth/accurate/callback`
   - `ACCURATE_OAUTH_SCOPE=sales_order_save`
   - `ACCURATE_DATABASE_ID`
   - `ACCURATE_SALES_ORDER_PATH=/accurate/api/sales-order/bulk-save.do`
7. Redeploy.
8. Open the app and click **Connect Accurate**.
9. Login/approve in Accurate Online. You will return to the app showing **Accurate connected**.
10. Fill Customer No + Accurate Item No on charges and click **Sync to Accurate**.

## Security notes
- Never commit `.env`, Client Secret, access token, refresh token, password, or database credentials to GitHub.
- OAuth tokens are stored in PostgreSQL, not exposed to browser JavaScript.
- This MVP is intended for one internal customer. Before broader public/commercial use, add app-user authentication, authorization/roles, encryption-at-rest strategy for OAuth tokens, audit controls, and stronger production secret management.

## Local run
```bash
npm install
cp .env.example .env
npm start
```
A reachable PostgreSQL `DATABASE_URL` is required.


## Report multi-currency (v3)
Menu Reports memisahkan **Total IDR** dan **Total USD**. **Grand Total (IDR)** dihitung sebagai total transaksi IDR + (total setiap job USD x `exchange_rate` job tersebut). Job dengan mata uang selain IDR/USD tidak dimasukkan ke Grand Total dan akan memunculkan peringatan. Untuk job USD, isi `Exchange Rate` sebagai jumlah IDR untuk 1 USD (contoh: 16250).
