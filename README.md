# PennyBuys storefront

A responsive, UK focused ecommerce storefront prototype. The product catalog uses demo items and photography while the store is being built.

The landing page now follows a marketplace style inspired by eBay: a compact utility row, prominent category-aware search, a separate category navigation row, and denser product discovery. Its CSS requests eBay's `Market Sans` family with Arial as the fallback; the proprietary Market Sans font file is not bundled.

The compact hero promotes four product edits and advances every five seconds. Visitors can use the arrows or slide dots, pause or resume rotation, and the carousel pauses while hovered or focused.

Category navigation and product searches open `catalog.html` with URL parameters. The catalog page filters the shared demo product data by category or related search terms, offers price/rating sorting, and shares the demo shopping bag with the landing page.

## Run locally

Requires Node.js 20 or newer. Install dependencies, copy `.env.example` to `.env`, fill in the service credentials, then run:

```sh
npm install
npm start
```

Then open `http://localhost:3000`.

## Product admin, MongoDB and Cloudinary

Open `http://localhost:3000/admin-products.html` and enter the server-side `ADMIN_TOKEN` to manage products. Add a name, category, description, price, stock quantity, one to five images, and an optional video. The server uploads media to the `pennybuys/products` Cloudinary folder and stores product records in the MongoDB `products` collection.

Configure these environment variables locally in `.env` or in Railway's service variables:

- `ADMIN_TOKEN`: a long, private token for the product admin page.
- `MONGODB_URI` and optional `MONGODB_DB_NAME` (defaults to `pennybuys`).
- Either `CLOUDINARY_URL` or `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, and `CLOUDINARY_API_SECRET`.
- `PORT` is provided by Railway; local default is `3000`.
- `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` are server-only. `STRIPE_PUBLISHABLE_KEY` is safe to return to the browser. Set `STRIPE_TAX_BEHAVIOR` to `inclusive` (default) or `exclusive`, and `PUBLIC_BASE_URL` to the public HTTPS site URL.

The first MongoDB connection seeds the collection with the current demo products when it is empty. The storefront's `/products-data.js` endpoint then serves current MongoDB products to the home, catalog, product and checkout pages. If MongoDB is unconfigured or temporarily unreachable, the storefront and admin inventory list fall back to the bundled demo data; adding products still requires a working database. Replace `MONGODB_URI` in your local `.env` with the real URI from MongoDB Atlas. Keep `.env` and all API secrets out of source control; `.env.example` contains placeholders only.

## Deploy on Railway

Create a Railway service from this repository. Railway can use the included `npm start` command; add the variables above to the service's environment settings. The server listens on Railway's `PORT` variable.

For Railway's optional deployment health check, use `/health`. In service Networking settings, make sure the public domain's target port matches the port shown in the deployment log.

## Current demo behavior

- Product search and category tabs filter the MongoDB catalog (or bundled sample products when MongoDB is not configured).
- Product cards open a detail page with descriptions, highlights, care, delivery and returns information.
- Favourites are visual only and are not saved.
- The shopping bag is saved in the current browser using local storage.
- Customer accounts are stored in MongoDB; passwords are stored as salted hashes, and sign-in uses a protected session cookie.
- Newsletter subscriptions are saved in MongoDB and can be viewed in the admin Subscribers section.
- Checkout embeds Stripe's Checkout Form. Product prices, accepted offers, delivery fees and order contents are recalculated on the server; card details stay in Stripe's iframe. Automatic Tax is disabled by the current Checkout Studio settings, and signed Stripe webhook confirmation is required before an order changes to processing.
- Customers can look up an order using its number and checkout email. Staff can use the Orders section in `admin-products.html` to change status and add the tracking number shown to the customer once the order is on the way. `admin-orders.html` redirects to that section.
- Order statuses are: Order is being processed, Packed and ready for delivery, On the way for delivery, and Delivered.
- Pending and paid order records and delivery status changes are stored in MongoDB so they can be managed across devices.
- Existing demo product photography is loaded from Unsplash. New admin uploads are stored in Cloudinary and appear in the storefront catalog.

Basket contents remain in browser storage, while customer accounts and order records are stored in MongoDB. The product admin is protected by a shared server-side token; replace it with full user and role management before opening the admin to multiple staff members. Keep payment credentials and Cloudinary secrets on the server, not in browser code.

## Stripe Payments and Tax setup

The Stripe CLI and Stripe Codex agent plugin were installed during setup. The requested `stripe_implementation_planner` MCP tool is not exposed in this environment, so this integration follows Stripe's Checkout Form API reference directly.

1. In Stripe Dashboard, create test API keys and set local `.env` variables `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY` and `STRIPE_WEBHOOK_SECRET`; never commit secret keys. Set `PUBLIC_BASE_URL=http://localhost:3000` for local use.
2. Request/enable access to Stripe's Checkout Form beta for `ui_mode: form`. The current Checkout Studio settings disable automatic tax; tax must be configured separately before launch if required. PennyBuys sells varied goods, so review product tax treatment and business registrations before live transactions.
3. Start the app with `npm start`, then run `stripe login` and `stripe listen --events checkout.session.completed,checkout.session.async_payment_succeeded,checkout.session.expired --forward-to localhost:3000/api/stripe/webhook` in a separate terminal. Copy its `whsec_...` value into `.env` as `STRIPE_WEBHOOK_SECRET` and restart the server.
4. In Railway, set `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET` and `PUBLIC_BASE_URL=https://pennybuys.co.uk`. Add a Stripe Dashboard webhook endpoint at `https://pennybuys.co.uk/api/stripe/webhook` for `checkout.session.completed`, `checkout.session.async_payment_succeeded`, and `checkout.session.expired`; copy its signing secret into Railway Variables.
5. Verify the full flow in Stripe test mode, including successful and cancelled payment and webhook-driven order status. Automatic Tax is disabled in the current Session configuration; before switching to live keys, confirm tax handling is correctly configured for PennyBuys.

## Live support chat and browser notifications

- Customers can message the PennyBuys team from `contact.html`; conversations and replies are saved in MongoDB and appear in the admin Support chat inbox.
- New orders are saved in MongoDB. Admins can update their delivery status and tracking number; the customer order page refreshes status from the server.
- Customers can opt in to browser alerts at checkout or on the contact page. Staff can enable new chat and order alerts from the Support chat page. Admins can also send an important update from Commercials. New arrivals and order status changes trigger push notifications for matching subscriptions.
- Browser push requires HTTPS and VAPID keys. Generate a key pair with `npx web-push generate-vapid-keys`, then set `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, and `VAPID_SUBJECT` in Railway Variables (or local `.env`). Keep the private key secret and do not commit it. The browser permission prompt is shown only after a customer or staff member chooses to enable alerts.
- Push alerts are optional; customers can still browse, chat and track their order when browser push is unavailable. Stripe checkout requires its server environment keys and webhook endpoint to be configured.


## Installable PennyBuys shopping app

- `app.html` is the compact installable shopping experience. It supports product search, category browsing and quick add-to-basket, with links to the existing product details, basket, checkout, order tracking and account pages.
- The site footer links to the app. A slim install banner appears for visitors who have not installed it; Chromium browsers can open the native install prompt, and iPhone visitors are guided to Add to Home Screen.
- The app shell and public product catalogue are cached for basic offline browsing. Checkout, live inventory, chat and order tracking require a connection.
- Visitors are offered an optional browser-notification prompt after 40 seconds of browsing. Push remains opt-in and requires the VAPID variables described above.
