# Stripe Integration TODO

This file tracks the remaining Stripe setup for PennyBuys.

## Values to Replace

The repository template contains environment placeholders. Set real test values in your private local `.env` and in Railway Variables; never commit `.env` or paste secret keys into chat.

**Files containing placeholders:**

- [.env.example](.env.example)

| Field | Current Value | What to Set |
|-------|---------------|-------------|
| `STRIPE_SECRET_KEY` | `sk_test_replace_me` | Your Stripe test secret key from the Dashboard. Keep this server-only. |
| `STRIPE_PUBLISHABLE_KEY` | `pk_test_replace_me` | Your Stripe test publishable key. It is sent to the browser to initialize Stripe.js. |
| `STRIPE_WEBHOOK_SECRET` | `whsec_replace_me` | The webhook signing secret printed by `stripe listen` locally, and the endpoint signing secret in Railway. |

The existing `mode` is `payment` because PennyBuys sells one-time product purchases. `line_items` use current, server-validated catalog prices and have no placeholder Price IDs to replace.

## Configured Parameters

These Checkout Studio parameters are already configured in the integration.

**Files containing these parameters:**

- [server.js](server.js)
- [checkout.html](checkout.html)
- [checkout.js](checkout.js)

| Parameter | Value |
|-----------|-------|
| `ui_mode` | `form` |
| Contact, billing, and shipping collection | Disabled in the Stripe Session; PennyBuys collects order details locally |
| `automatic_tax.enabled` | `false` |
| `submit_type` | `auto` |
| `integration_identifier` | `custom_embedded_web_0001` |

`payment_method_collection` is omitted because this is a one-time `payment` Session; Stripe only accepts that parameter in `subscription` mode. PennyBuys collects contact and delivery details locally and stores them on the pending order. The Checkout Session receives no customer, phone, billing-address, or shipping-address fields. PennyBuys keeps those details on the pending order in MongoDB. The country menu lists ISO country and territory codes, with the United Kingdom selected by default. The Stripe form uses Roboto via its font stylesheet and Appearance API. Stripe handles payment details; a payment method can still require billing fields. A `return_url` is configured for redirect-based payment methods.

## Setup and Next Steps

1. Confirm your Stripe account has access to the Checkout Form beta (`ui_mode: form`).
2. Add real `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, and `STRIPE_WEBHOOK_SECRET` values to `.env`. For local testing set `PUBLIC_BASE_URL=http://localhost:3000`. Add the same keys to Railway, with `PUBLIC_BASE_URL=https://pennybuys.co.uk`.
3. Run `npm install`, then start the site with `npm start`.
4. In another terminal run `stripe login` if needed, then `stripe listen --events checkout.session.completed,checkout.session.async_payment_succeeded,checkout.session.expired --forward-to localhost:3000/api/stripe/webhook`. Copy the printed `whsec_...` into `.env` as `STRIPE_WEBHOOK_SECRET` and restart the site.
5. In Stripe Dashboard, configure a production webhook at `https://pennybuys.co.uk/api/stripe/webhook` for `checkout.session.completed`, `checkout.session.async_payment_succeeded`, and `checkout.session.expired`. Put that endpoint's signing secret in Railway Variables.
6. Automatic Tax is currently disabled because Checkout Studio specified `automatic_tax.enabled: false`. Configure Stripe Tax, product tax categories and tax registrations, then change this setting only when you are ready to enable tax calculation.

## How the integration works

The browser submits customer contact details and basket product IDs/quantities. The server reloads catalog prices, applies accepted offers and delivery pricing, creates a pending MongoDB order, and creates a Stripe Checkout Session. The page renders Stripe's hosted-in-iframe Checkout Form using the Session client secret. A verified Stripe webhook marks the order paid and processing; the customer is returned to the private order-tracking page.

## Project structure

- [server.js](server.js) creates the Checkout Session with server-validated products and handles signed payment webhooks.
- [checkout.html](checkout.html) loads Stripe.js and contains the embedded form mount point.
- [checkout.js](checkout.js) requests the Session client secret, initializes and confirms the form, then opens order tracking.
- [commerce.css](commerce.css) styles payment form errors and layout.
- [order-page.js](order-page.js) clears the basket after payment return and refreshes the order status.
- [STRIPE_INTEGRATION_TODO.md](STRIPE_INTEGRATION_TODO.md) is the setup checklist and source of truth for remaining work.

## Testing

Use Stripe test keys and test mode before switching to live keys. For a standard successful test card, use `4242 4242 4242 4242`, a future expiry date, and any three-digit CVC. Use Stripe's [test card reference](https://docs.stripe.com/testing) for declines and other payment outcomes. Verify cancellation, payment confirmation, webhook delivery, order status, delivery address, and the total charged.

## Remaining product and fulfillment work

- PennyBuys sends dynamic inline prices from MongoDB products, so separate Stripe Price IDs are not needed for current one-time products.
- Configure the correct tax treatment for the store and product categories before enabling Automatic Tax or accepting live sales.
- Ensure the Stripe webhook endpoint is active in Railway before processing live orders; order fulfillment starts only after a verified paid event.
- Admins can manage packing, tracking numbers, and delivery status from the existing order dashboard.

## Resources

- [Stripe support](https://support.stripe.com)
- [Stripe docs and MCP](https://docs.stripe.com/mcp)
- [Checkout Session API](https://docs.stripe.com/api/checkout/sessions/create?api-version=2026-03-25.dahlia)
- [Stripe test cards](https://docs.stripe.com/testing)
