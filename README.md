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
- Sign-in and sign-up pages provide local prototype accounts; the email-link option creates a demo link in the same browser and does not send email.
- Newsletter signup shows a local confirmation only. It does not collect or send email addresses.
- Demo checkout creates an order record in the current browser, then shows a confirmation with a direct order status link.
- Customers can look up an order using its number and checkout email. Staff can use `admin-orders.html` to change status and add the tracking number shown to the customer once the order is on the way.
- Order statuses are: Order is being processed, Packed and ready for delivery, On the way for delivery, and Delivered.
- Checkout and order management are front-end demos. Orders and status updates are stored in the current browser only; payment is not connected.
- Existing demo product photography is loaded from Unsplash. New admin uploads are stored in Cloudinary and appear in the storefront catalog.

Orders and customer accounts still use the browser prototype storage, and payment is not connected. The product admin is protected by a shared server-side token; replace it with full user and role management before opening the admin to multiple staff members. Keep payment credentials and Cloudinary secrets on the server, not in browser code.
