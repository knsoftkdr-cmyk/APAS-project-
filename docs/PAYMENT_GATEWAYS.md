# Payment gateways - setup guide

APAS supports **Razorpay, Stripe, PayU and Cashfree** for one-shot fee payments and instalments. A school's admin switches gateways on/off
in **ERP & Fees > Payment Gateways**. A gateway can only be switched on once its secrets exist on the server.

No new edge functions are used (your plan's function quota is full). All gateways go through the two existing functions:

| Function | Purpose |
|---|---|
| `create-razorpay-order` | start a payment (any gateway) and `list_gateways` |
| `verify-razorpay-payment` | browser confirmation, receipts, **and every gateway's webhook / PayU return** (`verify_jwt = false`, each path authenticates itself) |

Deploy: `supabase functions deploy create-razorpay-order` and `supabase functions deploy verify-razorpay-payment`.
Delete the old `_shared/instalmentHandlers.ts` from your project (replaced by `_shared/paymentHandlers.ts`).

## Secrets (Supabase > Edge Functions > Secrets, or `supabase secrets set NAME=value`)

| Gateway | Secrets | Where to get them |
|---|---|---|
| Common | `APP_BASE_URL` (e.g. `https://app.yourschool.com`, no trailing slash) | your deployed site; needed for Stripe / PayU / Cashfree returns |
| Razorpay | `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` | Razorpay Dashboard > Settings > API Keys / Webhooks |
| Stripe | `STRIPE_SECRET_KEY` (sk_...), `STRIPE_WEBHOOK_SECRET` (whsec_...) | Stripe Dashboard > Developers > API keys / Webhooks |
| PayU | `PAYU_KEY`, `PAYU_SALT`, `PAYU_ENV` = `test` or `live` | PayU Dashboard > Payment Gateway > Merchant key & salt (v1) |
| Cashfree | `CASHFREE_APP_ID`, `CASHFREE_SECRET_KEY`, `CASHFREE_ENV` = `sandbox` or `production` | Cashfree Dashboard > Developers > API Keys |

Never put these in frontend code or `.env` files that ship to the browser. The browser only receives public keys / one-time session ids.

## Webhooks (replace `<ref>` with your Supabase project ref)

| Gateway | URL | Events |
|---|---|---|
| Razorpay | `https://<ref>.supabase.co/functions/v1/verify-razorpay-payment` | payment.captured, payment.failed, order.paid, refund.processed |
| Stripe | `.../verify-razorpay-payment?gateway=stripe&hook=1` | checkout.session.completed, checkout.session.async_payment_succeeded, checkout.session.async_payment_failed, checkout.session.expired, charge.refunded |
| PayU | `.../verify-razorpay-payment?gateway=payu&hook=1` | Success + Failure webhooks (browser return URL is set automatically per payment) |
| Cashfree | `.../verify-razorpay-payment?gateway=cashfree&hook=1` | PAYMENT_SUCCESS_WEBHOOK, PAYMENT_FAILED_WEBHOOK, REFUND_STATUS_WEBHOOK |

## Database

Run `supabase/migrations/20261111000000_payment_gateways.sql` (after `20261110000000_fee_instalments.sql`). Safe to re-run.

## Known limits

* **Currency:** fees are held in INR and every gateway charges INR. Stripe "international payments" means international *cardholders* paying in INR;
  Stripe India accounts need INR + export-compliance approval on the Stripe side. No currency conversion is performed.
* **PayU refunds** are not pushed to merchants: refund in the PayU dashboard and adjust the record in ERP manually.
* **Refunds** for Razorpay / Stripe / Cashfree are reflected automatically from the gateway's webhook; refunds are *issued* in each gateway's dashboard.
* Parent contact needs: PayU requires a valid email, Cashfree a 10-digit mobile number on the student record.
