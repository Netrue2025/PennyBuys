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
- Checkout saves each order to MongoDB and shows a confirmation with a private order status link. Payment is still a demo and no payment card details are collected.
- Customers can look up an order using its number and checkout email. Staff can use the Orders section in `admin-products.html` to change status and add the tracking number shown to the customer once the order is on the way. `admin-orders.html` redirects to that section.
- Order statuses are: Order is being processed, Packed and ready for delivery, On the way for delivery, and Delivered.
- Payment is not connected; order records and delivery status changes are stored in MongoDB so they can be managed across devices.
- Existing demo product photography is loaded from Unsplash. New admin uploads are stored in Cloudinary and appear in the storefront catalog.

Basket contents remain in browser storage, while customer accounts and order records are stored in MongoDB. Payment is not connected. The product admin is protected by a shared server-side token; replace it with full user and role management before opening the admin to multiple staff members. Keep payment credentials and Cloudinary secrets on the server, not in browser code.

## Live support chat and browser notifications

- Customers can message the PennyBuys team from `contact.html`; conversations and replies are saved in MongoDB and appear in the admin Support chat inbox.
- New orders are saved in MongoDB. Admins can update their delivery status and tracking number; the customer order page refreshes status from the server.
- Customers can opt in to browser alerts at checkout or on the contact page. Staff can enable new chat and order alerts from the Support chat page. Admins can also send an important update from Commercials. New arrivals and order status changes trigger push notifications for matching subscriptions.
- Browser push requires HTTPS and VAPID keys. Generate a key pair with `npx web-push generate-vapid-keys`, then set `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, and `VAPID_SUBJECT` in Railway Variables (or local `.env`). Keep the private key secret and do not commit it. The browser permission prompt is shown only after a customer or staff member chooses to enable alerts.
- Push alerts are optional; customers can still browse, chat and track their order when browser push is unavailable. The payment method is still a demo and is not connected to a payment processor.


## Installable PennyBuys shopping app

- `app.html` is the compact installable shopping experience. It supports product search, category browsing and quick add-to-basket, with links to the existing product details, basket, checkout, order tracking and account pages.
- The site footer links to the app. A slim install banner appears for visitors who have not installed it; Chromium browsers can open the native install prompt, and iPhone visitors are guided to Add to Home Screen.
- The app shell and public product catalogue are cached for basic offline browsing. Checkout, live inventory, chat and order tracking require a connection.
- Visitors are offered an optional browser-notification prompt after 40 seconds of browsing. Push remains opt-in and requires the VAPID variables described above.
