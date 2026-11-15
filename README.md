# PennyBuys storefront

A responsive, UK focused ecommerce storefront prototype. The product catalog uses demo items and photography while the store is being built.

The landing page now follows a marketplace style inspired by eBay: a compact utility row, prominent category-aware search, a separate category navigation row, and denser product discovery. Its CSS requests eBay's `Market Sans` family with Arial as the fallback; the proprietary Market Sans font file is not bundled.

The compact hero promotes four product edits and advances every five seconds. Visitors can use the arrows or slide dots, pause or resume rotation, and the carousel pauses while hovered or focused.

Category navigation and product searches open `catalog.html` with URL parameters. The catalog page filters the shared demo product data by category or related search terms, offers price/rating sorting, and shares the demo shopping bag with the landing page.

## Run locally

Requires Node.js 20 or newer. From this folder, run:

```sh
npm start
```

Then open `http://localhost:3000`.

## Deploy on Railway

Create a Railway service from this repository. Railway can use the included `npm start` command; the server listens on the `PORT` environment variable. No database or environment secrets are required for this front end demo.

## Current demo behavior

- Product search and category tabs filter the sample products.
- Product cards open a detail page with descriptions, highlights, care, delivery and returns information.
- Favourites are visual only and are not saved.
- The shopping bag is saved in the current browser using local storage.
- Sign-in and sign-up pages provide local prototype accounts; the email-link option creates a demo link in the same browser and does not send email.
- Newsletter signup shows a local confirmation only. It does not collect or send email addresses.
- Demo checkout creates an order record in the current browser, then shows a confirmation with a direct order status link.
- Customers can look up an order using its number and checkout email. Staff can use `admin-orders.html` to change status and add the tracking number shown to the customer once the order is on the way.
- Order statuses are: Order is being processed, Packed and ready for delivery, On the way for delivery, and Delivered.
- Checkout and order management are front-end demos. Orders and status updates are stored in the current browser only; payment is not connected.
- Product photography is loaded from Unsplash URLs for demonstration. Replace these with approved Cloudinary assets when product photography is ready.

MongoDB-backed orders, authenticated admin access, payment processing, shipping/tax rules, and customer accounts belong in the full-stack implementation phase. Keep payment credentials and Cloudinary secrets on the server, not in browser code.
