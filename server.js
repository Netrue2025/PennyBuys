const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const vm = require('node:vm');
const { promisify } = require('node:util');
const express = require('express');
const multer = require('multer');
const { MongoClient, ObjectId } = require('mongodb');
const { v2: cloudinary } = require('cloudinary');
const webpush = require('web-push');
const Stripe = require('stripe');

const root = __dirname;
const app = express();
const port = Number(process.env.PORT || 3000);
const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2026-03-25.dahlia' }) : null;
const stripePublishableKey = process.env.STRIPE_PUBLISHABLE_KEY || '';
const stripeTaxBehavior = process.env.STRIPE_TAX_BEHAVIOR === 'exclusive' ? 'exclusive' : 'inclusive';
const configuredMongoUri = (process.env.MONGODB_URI || '').trim();
const mongoUri = configuredMongoUri && !/cluster\.example\.mongodb\.net|username:password@/i.test(configuredMongoUri) ? configuredMongoUri : '';
const mongoDbName = process.env.MONGODB_DB_NAME || 'pennybuys';
const adminToken = process.env.ADMIN_TOKEN || '';
const customerSessionSecret = process.env.CUSTOMER_SESSION_SECRET || adminToken || crypto.randomBytes(32).toString('hex');
const scrypt = promisify(crypto.scrypt);
const maxUploadBytes = 100 * 1024 * 1024;
const vapidPublicKey = process.env.VAPID_PUBLIC_KEY || '';
const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY || '';
const pushConfigured = Boolean(vapidPublicKey && vapidPrivateKey);
if (pushConfigured) webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:hello@pennybuys.co.uk', vapidPublicKey, vapidPrivateKey);
const mongoUriIsPlaceholder = /cluster\.example\.mongodb\.net|username:password@/i.test(configuredMongoUri);
const client = mongoUri ? new MongoClient(mongoUri, { serverSelectionTimeoutMS: 7000 }) : null;
let databasePromise;
let demoProducts;
const storeIndexPromises = new Map();

if (!process.env.CLOUDINARY_URL && process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET) {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
    secure: true
  });
}

function getDemoProducts() {
  if (!demoProducts) {
    const sandbox = { window: {} };
    const source = fs.readFileSync(path.join(root, 'products-data.js'), 'utf8');
    new vm.Script(source, { filename: 'products-data.js' }).runInNewContext(sandbox, { timeout: 1000 });
    demoProducts = sandbox.window.STORE_PRODUCTS;
  }
  return demoProducts;
}

async function getProductsCollection() {
  if (!client) return null;
  if (!databasePromise) {
    databasePromise = client.connect().then(async () => {
      const collection = client.db(mongoDbName).collection('products');
      await collection.createIndex({ id: 1 }, { unique: true });
      return collection;
    }).catch(error => {
      databasePromise = null;
      throw error;
    });
  }
  return databasePromise;
}

async function getStoreCollection(name) {
  await getProductsCollection();
  if (!client) return null;
  const collection = client.db(mongoDbName).collection(name);
  const indexes = { orders: [[{ id: 1 }, { unique: true }]], supportConversations: [[{ id: 1 }, { unique: true }]], supportMessages: [[{ conversationId: 1, createdAt: 1 }, {}]], pushSubscriptions: [[{ endpoint: 1 }, { unique: true }]] }[name] || [];
  if (!storeIndexPromises.has(name)) storeIndexPromises.set(name, Promise.all(indexes.map(([keys, options]) => collection.createIndex(keys, options))).catch(error => { storeIndexPromises.delete(name); throw error; }));
  await storeIndexPromises.get(name);
  return collection;
}

async function dispatchPush(filter, notification) {
  if (!pushConfigured || !client) return;
  try {
    const subscriptions = await getStoreCollection('pushSubscriptions');
    if (!subscriptions) return;
    const targets = await subscriptions.find(filter).project({ _id: 0, endpoint: 1, subscription: 1 }).toArray();
    await Promise.allSettled(targets.map(async target => {
      try { await webpush.sendNotification(target.subscription, JSON.stringify(notification)); }
      catch (error) {
        if (error.statusCode === 404 || error.statusCode === 410) await subscriptions.deleteOne({ endpoint: target.endpoint });
        else console.warn('Push delivery failed:', error.message);
      }
    }));
  } catch (error) { console.warn('Push notification could not be sent:', error.message); }
}

async function getDeletedDemoProductIds() {
  if (!client) return new Set();
  const records = await client.db(mongoDbName).collection('catalogOverrides').find({ type: 'deleted-demo-product' }, { projection: { id: 1, _id: 0 } }).toArray();
  return new Set(records.map(record => record.id));
}

async function getStoreProducts() {
  const collection = await getProductsCollection();
  const records = collection ? await collection.find({}, { projection: { _id: 0 } }).sort({ createdAt: -1 }).toArray() : [];
  const deletedDemoIds = await getDeletedDemoProductIds();
  const recordIds = new Set(records.map(product => product.id));
  const demoProducts = getDemoProducts().filter(product => !deletedDemoIds.has(product.id) && !recordIds.has(product.id));
  const products = [...records, ...demoProducts];
  const reviewCollection = client?.db(mongoDbName).collection('productReviews');
  const summaries = reviewCollection ? await reviewCollection.aggregate([
    { $match: { status: 'published' } },
    { $group: { _id: '$productId', count: { $sum: 1 }, average: { $avg: '$rating' } } }
  ]).toArray() : [];
  const summaryByProduct = new Map(summaries.map(item => [item._id, item]));
  return products.map(product => {
    const summary = summaryByProduct.get(product.id);
    return { ...product, rating: summary ? Number(summary.average).toFixed(1) : '5.0', reviews: summary?.count || 0 };
  });
}

function withDefaultReviewStats(products) {
  return products.map(product => ({ ...product, rating: '5.0', reviews: 0 }));
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function requireAdmin(req, res, next) {
  if (!adminToken) return res.status(503).json({ error: 'Admin uploads are disabled. Configure ADMIN_TOKEN on the server.' });
  if (!safeEqual(req.get('x-admin-token') || '', adminToken)) return res.status(401).json({ error: 'Enter a valid admin token.' });
  next();
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { files: 6, fileSize: maxUploadBytes, fields: 12, fieldSize: 20000 },
  fileFilter(_req, file, callback) {
    const isImage = file.fieldname === 'images' && /^image\/(jpeg|png|webp|avif|gif)$/.test(file.mimetype);
    const isVideo = file.fieldname === 'video' && /^video\/(mp4|webm|quicktime)$/.test(file.mimetype);
    if (isImage || isVideo) callback(null, true);
    else callback(new Error('Use JPG, PNG, WebP, AVIF or GIF images and MP4, WebM or MOV videos.'));
  }
});

function uploadToCloudinary(file, resourceType, folder) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream({ resource_type: resourceType, folder, unique_filename: true }, (error, result) => {
      if (error) reject(error);
      else resolve(result);
    });
    stream.end(file.buffer);
  });
}

function slugify(value) {
  return String(value).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 70) || 'product';
}

function publicIdFromUrl(value, resourceType) {
  try {
    const url = new URL(value);
    if (url.hostname !== 'res.cloudinary.com') return null;
    const marker = `/${resourceType}/upload/`;
    const markerIndex = url.pathname.indexOf(marker);
    if (markerIndex < 0) return null;
    const parts = url.pathname.slice(markerIndex + marker.length).split('/').filter(Boolean);
    const folderIndex = parts.findIndex((part, index) => part === 'pennybuys' && parts[index + 1] === 'products');
    if (folderIndex < 0) return null;
    const publicId = parts.slice(folderIndex).join('/');
    return publicId.replace(/\.[^/.]+$/, '') || null;
  } catch { return null; }
}

function productAssetIds(product, resourceType) {
  if (resourceType === 'image') {
    const stored = Array.isArray(product.cloudinaryImageIds) ? product.cloudinaryImageIds.filter(Boolean) : [];
    if (stored.length) return stored;
    return [product.image, ...(Array.isArray(product.gallery) ? product.gallery : [])].map(url => publicIdFromUrl(url, 'image')).filter(Boolean);
  }
  return [product.cloudinaryVideoId || publicIdFromUrl(product.video, 'video')].filter(Boolean);
}

async function destroyProductAssets(ids, resourceType) {
  if (!ids.length) return;
  const results = await Promise.allSettled(ids.map(publicId => cloudinary.uploader.destroy(publicId, { resource_type: resourceType, invalidate: true })));
  results.filter(result => result.status === 'rejected').forEach(result => console.warn(`Cloudinary ${resourceType} cleanup failed:`, result.reason?.message || 'Unknown error'));
}

app.disable('x-powered-by');
// Stripe signs the exact request bytes, so this route must run before express.json().
app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  if (!stripe || !process.env.STRIPE_WEBHOOK_SECRET) return res.status(503).send('Stripe webhook is not configured.');
  let event;
  try { event = stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], process.env.STRIPE_WEBHOOK_SECRET); }
  catch (error) { return res.status(400).send(`Webhook signature verification failed: ${error.message}`); }
  const session = event.data.object;
  try {
    if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
      if (session.payment_status !== 'paid') return res.json({ received: true });
      const orders = await getStoreCollection('orders');
      const order = await orders?.findOne({ stripeSessionId: session.id });
      if (!order) return res.status(404).send('Pending order not found.');
      const orderId = order.id;
      if (order.paymentStatus !== 'paid') {
        const now = new Date();
        const details = session.customer_details || {};
        const address = session.shipping_details?.address || details.address || {};
        const history = [...(order.history || []), { status: 'processing', at: now }];
        const paidUpdate = await orders.updateOne({ id: orderId, paymentStatus: { $ne: 'paid' } }, { $set: {
          status: 'processing', paymentStatus: 'paid', paymentMethod: 'Stripe', stripePaymentIntent: session.payment_intent || '',
          total: Number(session.amount_total || 0) / 100, tax: Number(session.total_details?.amount_tax || 0) / 100,
          customer: { ...order.customer, email: details.email || session.customer_email || order.customer.email, phone: details.phone || order.customer.phone },
          address: { line1: address.line1 || '', line2: address.line2 || '', city: address.city || '', postcode: address.postal_code || '', country: address.country || '' },
          history, paidAt: now, updatedAt: now
        } });
        if (paidUpdate.modifiedCount) {
          const offerId = String(order.offerId || '');
          if (offerId) await client.db(mongoDbName).collection('storeCommercials').updateOne({ type: 'customer-offer', email: order.customer.email, offerId, status: 'accepted' }, { $set: { status: 'redeemed', redeemedAt: now } });
          void dispatchPush({ audience: 'admin' }, { title: 'Paid PennyBuys order', body: `${order.customer.name} paid for ${orderId}.`, url: '/admin-order-management.html', tag: `order-${orderId}` });
          void dispatchPush({ email: order.customer.email }, { title: 'Order received', body: `Order ${orderId} is now being processed.`, url: `/order.html?id=${encodeURIComponent(orderId)}`, tag: `order-${orderId}` });
        }
      }
    } else if (event.type === 'checkout.session.expired') {
      const orders = await getStoreCollection('orders');
      await orders?.updateOne({ stripeSessionId: session.id, paymentStatus: 'pending' }, { $set: { paymentStatus: 'expired', updatedAt: new Date() } });
    }
    res.json({ received: true });
  } catch (error) { console.error('Stripe webhook processing failed:', error.message); res.status(500).send('Webhook processing failed.'); }
});
app.use(express.json({ limit: '1mb' }));

function readCustomer(req) {
  const cookie = String(req.headers.cookie || '').split(';').map(part => part.trim()).find(part => part.startsWith('pennybuys_session='));
  if (!cookie) return null;
  let token;
  try { token = decodeURIComponent(cookie.slice('pennybuys_session='.length)); } catch { return null; }
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return null;
  const expected = crypto.createHmac('sha256', customerSessionSecret).update(payload).digest('base64url');
  if (!safeEqual(signature, expected)) return null;
  try {
    const session = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!session.email || !session.exp || session.exp < Date.now()) return null;
    return { email: session.email, name: session.name };
  } catch { return null; }
}

function issueCustomerCookie(req, res, user) {
  const payload = Buffer.from(JSON.stringify({ email: user.email, name: user.name, exp: Date.now() + 30 * 24 * 60 * 60 * 1000 })).toString('base64url');
  const signature = crypto.createHmac('sha256', customerSessionSecret).update(payload).digest('base64url');
  const secure = req.secure || req.get('x-forwarded-proto') === 'https';
  res.append('Set-Cookie', `pennybuys_session=${encodeURIComponent(`${payload}.${signature}`)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000${secure ? '; Secure' : ''}`);
}

async function getCustomerCollection() {
  await getProductsCollection();
  if (!client) return null;
  const collection = client.db(mongoDbName).collection('customerAccounts');
  await collection.createIndex({ email: 1 }, { unique: true });
  return collection;
}

app.get('/api/auth/session', (req, res) => {
  const customer = readCustomer(req);
  res.set('Cache-Control', 'no-store').json({ user: customer });
});

app.post('/api/auth/signup', async (req, res) => {
  const name = String(req.body?.name || '').trim();
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  if (name.length < 2 || name.length > 100) return res.status(400).json({ error: 'Enter your name (2 to 100 characters).' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 160) return res.status(400).json({ error: 'Enter a valid email address.' });
  if (password.length < 8 || password.length > 200) return res.status(400).json({ error: 'Choose a password with at least 8 characters.' });
  try {
    const collection = await getCustomerCollection();
    if (!collection) return res.status(503).json({ error: 'Account creation needs a MongoDB connection.' });
    const salt = crypto.randomBytes(16).toString('hex');
    const passwordHash = await scrypt(password, salt, 64);
    const user = { email, name, salt, passwordHash: passwordHash.toString('hex'), updates: req.body?.updates === true, createdAt: new Date() };
    try { await collection.insertOne(user); }
    catch (error) { if (error.code === 11000) return res.status(409).json({ error: 'An account with that email already exists. Please sign in.' }); throw error; }
    issueCustomerCookie(req, res, user);
    res.status(201).json({ user: { email, name } });
  } catch (error) { console.error('Customer signup failed:', error.message); res.status(503).json({ error: 'We could not create your account right now. Please try again.' }); }
});

app.post('/api/auth/signin', async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !password) return res.status(400).json({ error: 'Enter your email address and password.' });
  try {
    const collection = await getCustomerCollection();
    if (!collection) return res.status(503).json({ error: 'Sign-in needs a MongoDB connection.' });
    const user = await collection.findOne({ email });
    if (!user) return res.status(401).json({ error: 'We could not find an account with that email.' });
    const passwordHash = await scrypt(password, user.salt, 64);
    if (!safeEqual(passwordHash.toString('hex'), user.passwordHash)) return res.status(401).json({ error: 'That password does not match this account.' });
    issueCustomerCookie(req, res, user);
    res.json({ user: { email: user.email, name: user.name } });
  } catch (error) { console.error('Customer sign-in failed:', error.message); res.status(503).json({ error: 'Sign-in is unavailable right now. Please try again.' }); }
});

app.post('/api/auth/signout', (req, res) => {
  const secure = req.secure || req.get('x-forwarded-proto') === 'https';
  res.append('Set-Cookie', `pennybuys_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`);
  res.json({ ok: true });
});
app.use((req, _res, next) => { req.customer = readCustomer(req); next(); });

app.get('/api/notifications/config', (_req, res) => res.set('Cache-Control', 'no-store').json({ enabled: pushConfigured, publicKey: pushConfigured ? vapidPublicKey : '' }));
function validPushEndpoint(endpoint) {
  try {
    const url = new URL(endpoint);
    const host = url.hostname.toLowerCase();
    const supportedProvider = ['fcm.googleapis.com', 'updates.push.services.mozilla.com', 'push.services.mozilla.com', 'web.push.apple.com'].includes(host) || host.endsWith('.notify.windows.com');
    return url.protocol === 'https:' && !url.username && !url.password && (!url.port || url.port === '443') && supportedProvider;
  } catch { return false; }
}

app.post('/api/notifications/subscribe', async (req, res) => {
  const subscription = req.body?.subscription;
  const endpoint = String(subscription?.endpoint || '');
  const email = String(req.customer?.email || req.body?.email || '').trim().toLowerCase();
  const conversationId = String(req.body?.conversationId || '').slice(0, 80);
  if (!pushConfigured) return res.status(503).json({ error: 'Browser notifications are not configured yet.' });
  if (!validPushEndpoint(endpoint) || !subscription?.keys?.p256dh || !subscription?.keys?.auth) return res.status(400).json({ error: 'The browser notification subscription is invalid.' });
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Enter a valid email address for order notifications.' });
  try {
    const collection = await getStoreCollection('pushSubscriptions');
    if (!collection) return res.status(503).json({ error: 'Notifications need a MongoDB connection.' });
    await collection.updateOne({ endpoint }, { $set: { endpoint, subscription, email, conversationId, audience: 'customer', updatedAt: new Date() }, $setOnInsert: { createdAt: new Date() } }, { upsert: true });
    res.status(201).json({ ok: true });
  } catch (error) { console.error('Push subscription save failed:', error.message); res.status(503).json({ error: 'Your notification settings could not be saved.' }); }
});

app.post('/api/admin/notifications/subscribe', requireAdmin, async (req, res) => {
  const subscription = req.body?.subscription;
  const endpoint = String(subscription?.endpoint || '');
  if (!pushConfigured) return res.status(503).json({ error: 'Browser notifications are not configured yet.' });
  if (!validPushEndpoint(endpoint) || !subscription?.keys?.p256dh || !subscription?.keys?.auth) return res.status(400).json({ error: 'The browser notification subscription is invalid.' });
  try {
    const collection = await getStoreCollection('pushSubscriptions');
    if (!collection) return res.status(503).json({ error: 'Notifications need a MongoDB connection.' });
    await collection.updateOne({ endpoint }, { $set: { endpoint, subscription, email: '', audience: 'admin', updatedAt: new Date() }, $setOnInsert: { createdAt: new Date() } }, { upsert: true });
    res.status(201).json({ ok: true });
  } catch (error) { console.error('Admin push subscription save failed:', error.message); res.status(503).json({ error: 'Admin notifications could not be enabled.' }); }
});

app.post('/api/notifications/unsubscribe', async (req, res) => {
  const endpoint = String(req.body?.endpoint || '');
  if (!endpoint) return res.status(400).json({ error: 'Choose a browser subscription to remove.' });
  try { const collection = await getStoreCollection('pushSubscriptions'); if (collection) await collection.deleteOne({ endpoint }); res.json({ ok: true }); }
  catch (error) { console.error('Push unsubscribe failed:', error.message); res.status(503).json({ error: 'Your notification subscription could not be removed.' }); }
});

app.post('/api/admin/notifications/broadcast', requireAdmin, async (req, res) => {
  const title = String(req.body?.title || '').trim().slice(0, 80);
  const body = String(req.body?.body || '').trim().slice(0, 220);
  if (!title || !body) return res.status(400).json({ error: 'Add a notification title and message.' });
  if (!pushConfigured) return res.status(503).json({ error: 'Configure VAPID keys before sending browser notifications.' });
  void dispatchPush({ audience: 'customer' }, { title, body, url: String(req.body?.url || '/').slice(0, 240), tag: `pennybuys-news-${Date.now()}` });
  res.json({ ok: true });
});

app.get('/api/admin/orders', requireAdmin, async (_req, res) => {
  try { const collection = await getStoreCollection('orders'); if (!collection) return res.status(503).json({ error: 'MongoDB is not configured.' }); const orders = await collection.find({}, { projection: { _id: 0, accessKeyHash: 0 } }).sort({ createdAt: -1 }).limit(500).toArray(); res.json({ orders }); }
  catch (error) { console.error('Admin orders could not load:', error.message); res.status(503).json({ error: 'Orders could not be loaded from MongoDB.' }); }
});

app.post('/api/admin/orders/import-browser-history', requireAdmin, async (req, res) => {
  const source = Array.isArray(req.body?.orders) ? req.body.orders.slice(0, 500) : [];
  const records = source.filter(order => /^PB-[A-Z0-9-]{8,60}$/i.test(String(order?.id || ''))).map(order => ({
    id: String(order.id), createdAt: new Date(order.createdAt || Date.now()), status: ['processing', 'packed', 'in_transit', 'delivered'].includes(order.status) ? order.status : 'processing', trackingNumber: String(order.trackingNumber || '').slice(0, 80),
    customer: { name: String(order.customer?.name || 'Customer').slice(0, 100), email: String(order.customer?.email || '').trim().toLowerCase().slice(0, 160), phone: String(order.customer?.phone || '').slice(0, 40) },
    address: Object.fromEntries(Object.entries(order.address || {}).map(([key, value]) => [key, String(value || '').slice(0, 180)])), paymentMethod: String(order.paymentMethod || 'Legacy browser order').slice(0, 50),
    items: Array.isArray(order.items) ? order.items.slice(0, 100).map(item => ({ id: String(item.id || '').slice(0, 100), name: String(item.name || '').slice(0, 160), image: String(item.image || '').slice(0, 1200), price: Math.max(0, Number(item.price) || 0), qty: Math.min(99, Math.max(1, Math.floor(Number(item.qty) || 1))), weightKg: Math.max(0.01, Number(item.weightKg) || 0.5), freeDelivery: item.freeDelivery === true })) : [],
    subtotal: Number(order.subtotal) || 0, discount: Number(order.discount) || 0, offerTitle: String(order.offerTitle || '').slice(0, 100), delivery: Number(order.delivery) || 0, total: Number(order.total) || 0,
    history: Array.isArray(order.history) ? order.history.slice(-20).map(item => ({ status: String(item.status || 'processing').slice(0, 30), at: new Date(item.at || Date.now()) })) : [{ status: 'processing', at: new Date(order.createdAt || Date.now()) }], migratedFromBrowser: true
  }));
  try {
    const collection = await getStoreCollection('orders'); if (!collection) return res.status(503).json({ error: 'MongoDB is not configured.' });
    for (const order of records) await collection.updateOne({ id: order.id }, { $setOnInsert: order }, { upsert: true });
    res.json({ ok: true, imported: records.length });
  } catch (error) { console.error('Browser order migration failed:', error.message); res.status(503).json({ error: 'Existing browser orders could not be migrated.' }); }
});

app.post('/api/stripe/checkout-session', async (req, res) => {
  if (!stripe || !stripePublishableKey) return res.status(503).json({ error: 'Configure STRIPE_SECRET_KEY and STRIPE_PUBLISHABLE_KEY on the server before accepting payments.' });
  const customer = req.body?.customer || {};
  const name = String(customer.name || req.customer?.name || '').trim().slice(0, 100);
  const email = String(customer.email || req.customer?.email || '').trim().toLowerCase();
  const phone = String(customer.phone || '').trim().slice(0, 40);
  const requested = Array.isArray(req.body?.items) ? req.body.items.slice(0, 50) : [];
  if (name.length < 2 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !requested.length) return res.status(400).json({ error: 'Enter valid contact details and add at least one product.' });
  const quantities = new Map();
  for (const line of requested) {
    const id = String(line?.id || '').slice(0, 100);
    const qty = Math.floor(Number(line?.qty));
    if (!id || !Number.isInteger(qty) || qty < 1 || qty > 99) return res.status(400).json({ error: 'One or more basket quantities are invalid.' });
    quantities.set(id, (quantities.get(id) || 0) + qty);
  }
  if ([...quantities.values()].some(qty => qty > 99)) return res.status(400).json({ error: 'A product quantity cannot exceed 99.' });
  try {
    const catalogue = await getStoreProducts();
    const byId = new Map(catalogue.map(product => [String(product.id), product]));
    const items = [...quantities].map(([id, qty]) => {
      const product = byId.get(id);
      if (!product || !Number.isFinite(Number(product.price)) || Number(product.price) < 0) throw new Error(`Product ${id} is unavailable.`);
      return { id, name: String(product.name || 'PennyBuys product').slice(0, 200), image: product.image || '', price: Number(product.price), qty, weightKg: Math.max(0.01, Number(product.weightKg) || 0.5), freeDelivery: product.freeDelivery === true };
    });
    const subtotal = items.reduce((sum, item) => sum + item.price * item.qty, 0);
    const count = items.reduce((sum, item) => sum + item.qty, 0);
    const allWeight = items.reduce((sum, item) => sum + item.weightKg * item.qty, 0);
    const chargeableWeight = items.reduce((sum, item) => sum + (item.freeDelivery ? 0 : item.weightKg * item.qty), 0);
    const commercials = client ? await getCommercialsCollection() : null;
    const config = await commercials?.findOne({ key: 'active' }, { projection: { _id: 0 } }) || {};
    const freeDeliveryCount = config.freeDelivery?.enabled ? Math.max(1, Number(config.freeDelivery.itemCount) || 3) : 0;
    const campaignFree = freeDeliveryCount > 0 && count >= freeDeliveryCount;
    const weightPricing = config.weightDelivery?.enabled === true;
    let delivery = campaignFree ? 0 : weightPricing ? chargeableWeight * Math.max(0, Number(config.weightDelivery.ratePerKg) || 0) : (subtotal >= 35 || chargeableWeight === 0 ? 0 : 3.95);
    const acceptedOffer = req.customer ? await commercials?.findOne({ type: 'customer-offer', email: req.customer.email, status: 'accepted' }, { projection: { _id: 0 } }) : null;
    const discountPercent = Math.min(90, Math.max(0, Number(acceptedOffer?.percent) || 0));
    const discount = subtotal * discountPercent / 100;
    const discountedProducts = items.map(item => {
      const unit = Math.max(0, Math.round(item.price * (1 - discountPercent / 100) * 100));
      const imageUrl = /^https:\/\//i.test(item.image) ? item.image : undefined;
      return { quantity: item.qty, price_data: { currency: 'gbp', unit_amount: unit, tax_behavior: stripeTaxBehavior, product_data: { name: item.name, ...(imageUrl ? { images: [imageUrl] } : {}) } } };
    });
    const baseUrl = String(process.env.PUBLIC_BASE_URL || 'https://pennybuys.co.uk').replace(/\/$/, '');
    const id = `PB-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
    const accessKey = crypto.randomBytes(32).toString('base64url');
    const now = new Date();
    const order = { id, createdAt: now, status: 'pending_payment', paymentStatus: 'pending', trackingNumber: '', customer: { name, email, phone }, address: {}, paymentMethod: 'Stripe', items, subtotal, discount, offerId: acceptedOffer?.offerId || '', offerTitle: acceptedOffer?.title || '', delivery, deliveryWeightKg: allWeight, chargeableDeliveryWeightKg: chargeableWeight, total: Math.max(0, subtotal - discount) + delivery, history: [], accessKeyHash: crypto.createHash('sha256').update(accessKey).digest('hex') };
    const orders = await getStoreCollection('orders');
    if (!orders) return res.status(503).json({ error: 'Order checkout needs a MongoDB connection.' });
    await orders.insertOne(order);
    try {
      const lineItems = [...discountedProducts];
      if (delivery > 0) lineItems.push({ quantity: 1, price_data: { currency: 'gbp', unit_amount: Math.round(delivery * 100), tax_behavior: stripeTaxBehavior, product_data: { name: 'Delivery' } } });
      const checkoutSession = await stripe.checkout.sessions.create({
        ui_mode: 'form',
        mode: 'payment',
        line_items: lineItems,
        billing_address_collection: 'auto',
        phone_number_collection: { enabled: false },
        automatic_tax: { enabled: false },
        submit_type: 'auto',
        shipping_address_collection: { allowed_countries: ['AD','AL','AT','AX','BA','BE','BG','BY','CH','CZ','DE','DK','EE','ES','FI','FO','FR','GB','GG','GI','GR','HR','HU','IE','IM','IS','IT','JE','LI','LT','LU','LV','MC','MD','ME','MK','MT','NL','NO','PL','PT','RO','RS','RU','SE','SI','SJ','SK','SM','UA','VA'] },
        name_collection: { individual: { enabled: true, optional: true }, business: { enabled: true, optional: true } },
        integration_identifier: 'custom_embedded_web_0001',
        return_url: `${baseUrl}/order.html?id=${encodeURIComponent(id)}&key=${encodeURIComponent(accessKey)}&paid=1&session_id={CHECKOUT_SESSION_ID}`
      });
      await orders.updateOne({ id }, { $set: { stripeSessionId: checkoutSession.id } });
      res.json({ client_secret: checkoutSession.client_secret, publishable_key: stripePublishableKey, order_url: `${baseUrl}/order.html?id=${encodeURIComponent(id)}&key=${encodeURIComponent(accessKey)}&paid=1` });
    } catch (error) { await orders.deleteOne({ id, paymentStatus: 'pending' }); throw error; }
  } catch (error) { console.error('Stripe checkout session failed:', error.message); res.status(503).json({ error: error.message.startsWith('Product ') ? error.message : 'Secure checkout could not be started. Please try again.' }); }
});

app.post('/api/orders/lookup', async (req, res) => {
  const id = String(req.body?.id || '').trim(); const email = String(req.body?.email || '').trim().toLowerCase();
  if (!id || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Enter your order number and checkout email.' });
  try { const collection = await getStoreCollection('orders'); const order = await collection?.findOne({ id, 'customer.email': email }, { projection: { _id: 0, accessKeyHash: 0, stripeSessionId: 0, stripePaymentIntent: 0, stripeUrl: 0, offerId: 0 } }); if (!order) return res.status(404).json({ error: 'We could not find an order with those details.' }); res.json({ order }); }
  catch (error) { console.error('Order lookup failed:', error.message); res.status(503).json({ error: 'Order tracking is temporarily unavailable.' }); }
});

app.get('/api/orders/:id', async (req, res) => {
  const key = String(req.query.key || '');
  if (key.length < 32) return res.status(401).json({ error: 'Use the private order link or enter your order number and email.' });
  try { const collection = await getStoreCollection('orders'); const accessKeyHash = crypto.createHash('sha256').update(key).digest('hex'); const order = await collection?.findOne({ id: req.params.id, accessKeyHash }, { projection: { _id: 0, accessKeyHash: 0, stripeSessionId: 0, stripePaymentIntent: 0, stripeUrl: 0, offerId: 0 } }); if (!order) return res.status(404).json({ error: 'This private order link is not valid.' }); res.set('Cache-Control', 'no-store').json({ order }); }
  catch (error) { console.error('Private order tracking failed:', error.message); res.status(503).json({ error: 'Order tracking is temporarily unavailable.' }); }
});

app.patch('/api/admin/orders/:id', requireAdmin, async (req, res) => {
  const labels = { processing: 'Order is being processed', packed: 'Packed and ready for delivery', in_transit: 'On the way for delivery', delivered: 'Delivered' };
  const status = String(req.body?.status || ''); const trackingNumber = String(req.body?.trackingNumber || '').trim().slice(0, 80);
  if (!labels[status]) return res.status(400).json({ error: 'Choose a valid order status.' });
  if (status === 'in_transit' && !trackingNumber) return res.status(400).json({ error: 'Add the tracking number before marking the order on its way.' });
  try {
    const collection = await getStoreCollection('orders'); if (!collection) return res.status(503).json({ error: 'MongoDB is not configured.' });
    const order = await collection.findOne({ id: req.params.id }); if (!order) return res.status(404).json({ error: 'Order not found.' });
    const now = new Date(); const history = Array.isArray(order.history) ? order.history : [];
    if (history.at(-1)?.status !== status) history.push({ status, at: now });
    await collection.updateOne({ id: order.id }, { $set: { status, trackingNumber, history, updatedAt: now } });
    void dispatchPush({ email: order.customer.email }, { title: 'Your order has an update', body: `${order.id}: ${labels[status]}${trackingNumber && status === 'in_transit' ? ` · Tracking ${trackingNumber}` : ''}`, url: '/order.html', tag: `order-${order.id}` });
    res.json({ ok: true });
  } catch (error) { console.error('Order update failed:', error.message); res.status(503).json({ error: 'The order update could not be saved.' }); }
});

app.delete('/api/admin/orders', requireAdmin, async (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? [...new Set(req.body.ids.map(id => String(id).slice(0, 100)))].slice(0, 500) : [];
  if (!ids.length) return res.status(400).json({ error: 'Select at least one order to delete.' });
  try { const collection = await getStoreCollection('orders'); if (!collection) return res.status(503).json({ error: 'MongoDB is not configured.' }); const result = await collection.deleteMany({ id: { $in: ids } }); res.json({ ok: true, deletedCount: result.deletedCount }); }
  catch (error) { console.error('Order history deletion failed:', error.message); res.status(503).json({ error: 'Selected orders could not be deleted.' }); }
});

const validConversationId = value => /^[a-f0-9-]{36}$/i.test(String(value || ''));
app.get('/api/support/conversations/:id/messages', async (req, res) => {
  if (!validConversationId(req.params.id)) return res.status(400).json({ error: 'This chat link is invalid.' });
  try { const messages = await getStoreCollection('supportMessages'); if (!messages) return res.status(503).json({ error: 'Chat needs a MongoDB connection.' }); const rows = await messages.find({ conversationId: req.params.id }, { projection: { _id: 0, conversationId: 0 } }).sort({ createdAt: 1 }).limit(200).toArray(); res.set('Cache-Control', 'no-store').json({ messages: rows }); }
  catch (error) { console.error('Support messages could not load:', error.message); res.status(503).json({ error: 'Chat is temporarily unavailable.' }); }
});

app.post('/api/support/conversations/:id/messages', async (req, res) => {
  const conversationId = req.params.id; const message = String(req.body?.message || '').trim().slice(0, 2000);
  const email = String(req.customer?.email || req.body?.email || '').trim().toLowerCase(); const name = String(req.customer?.name || req.body?.name || 'Shopper').trim().slice(0, 100);
  if (!validConversationId(conversationId)) return res.status(400).json({ error: 'This chat link is invalid.' });
  if (!message) return res.status(400).json({ error: 'Write a message before sending.' });
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Enter a valid email address.' });
  try {
    const conversations = await getStoreCollection('supportConversations'); const messages = await getStoreCollection('supportMessages');
    if (!conversations || !messages) return res.status(503).json({ error: 'Chat needs a MongoDB connection.' });
    const now = new Date();
    await conversations.updateOne({ id: conversationId }, { $set: { id: conversationId, name, email, status: 'open', lastMessage: message, lastMessageAt: now, updatedAt: now }, $inc: { unreadAdmin: 1 }, $setOnInsert: { createdAt: now } }, { upsert: true });
    const result = await messages.insertOne({ conversationId, sender: 'customer', name, email, message, createdAt: now });
    void dispatchPush({ audience: 'admin' }, { title: `New message from ${name}`, body: message.slice(0, 130), url: '/admin-support.html', tag: `chat-${conversationId}` });
    res.status(201).json({ message: { id: result.insertedId.toString(), sender: 'customer', name, message, createdAt: now } });
  } catch (error) { console.error('Support message save failed:', error.message); res.status(503).json({ error: 'Your message could not be sent. Please try again.' }); }
});

app.get('/api/admin/support/conversations', requireAdmin, async (_req, res) => {
  try { const collection = await getStoreCollection('supportConversations'); if (!collection) return res.status(503).json({ error: 'MongoDB is not configured.' }); const conversations = await collection.find({}, { projection: { _id: 0 } }).sort({ lastMessageAt: -1 }).limit(300).toArray(); res.json({ conversations }); }
  catch (error) { console.error('Support inbox could not load:', error.message); res.status(503).json({ error: 'Support inbox is temporarily unavailable.' }); }
});

app.get('/api/admin/support/conversations/:id/messages', requireAdmin, async (req, res) => {
  if (!validConversationId(req.params.id)) return res.status(400).json({ error: 'This chat link is invalid.' });
  try { const messages = await getStoreCollection('supportMessages'); if (!messages) return res.status(503).json({ error: 'MongoDB is not configured.' }); const rows = await messages.find({ conversationId: req.params.id }, { projection: { _id: 0, conversationId: 0 } }).sort({ createdAt: 1 }).limit(200).toArray(); const conversations = await getStoreCollection('supportConversations'); await conversations?.updateOne({ id: req.params.id }, { $set: { unreadAdmin: 0 } }); res.json({ messages: rows }); }
  catch (error) { console.error('Admin chat could not load:', error.message); res.status(503).json({ error: 'This conversation could not be loaded.' }); }
});

app.post('/api/admin/support/conversations/:id/messages', requireAdmin, async (req, res) => {
  const conversationId = req.params.id; const message = String(req.body?.message || '').trim().slice(0, 2000);
  if (!validConversationId(conversationId)) return res.status(400).json({ error: 'This chat link is invalid.' });
  if (!message) return res.status(400).json({ error: 'Write a reply before sending.' });
  try {
    const conversations = await getStoreCollection('supportConversations'); const messages = await getStoreCollection('supportMessages'); const conversation = await conversations?.findOne({ id: conversationId });
    if (!conversation || !messages) return res.status(404).json({ error: 'This conversation no longer exists.' });
    const now = new Date(); const result = await messages.insertOne({ conversationId, sender: 'admin', name: 'PennyBuys Support', message, createdAt: now });
    await conversations.updateOne({ id: conversationId }, { $set: { lastMessage: message, lastMessageAt: now, updatedAt: now }, $inc: { unreadCustomer: 1 } });
    void dispatchPush({ $or: [{ email: conversation.email || null }, { conversationId }] }, { title: 'PennyBuys replied', body: message.slice(0, 130), url: '/contact.html', tag: `chat-${conversationId}` });
    res.status(201).json({ message: { id: result.insertedId.toString(), sender: 'admin', name: 'PennyBuys Support', message, createdAt: now } });
  } catch (error) { console.error('Support reply failed:', error.message); res.status(503).json({ error: 'Your reply could not be sent.' }); }
});

async function getCommercialsCollection() {
  await getProductsCollection();
  if (!client) return null;
  return client.db(mongoDbName).collection('storeCommercials');
}

app.get('/api/commercials/active', async (_req, res) => {
  try {
    const collection = await getCommercialsCollection();
    const config = collection ? await collection.findOne({ key: 'active' }, { projection: { _id: 0, key: 0 } }) : null;
    res.set('Cache-Control', 'no-store').json(config || { discount: { enabled: false }, freeDelivery: { enabled: false, itemCount: 3 }, weightDelivery: { enabled: false, ratePerKg: 0 }, announcements: [] });
  } catch (error) { console.warn('Commercials could not be loaded:', error.message); res.json({ discount: { enabled: false }, freeDelivery: { enabled: false, itemCount: 3 }, weightDelivery: { enabled: false, ratePerKg: 0 }, announcements: [] }); }
});

app.get('/api/account/offers', async (req, res) => {
  if (!req.customer) return res.status(401).json({ error: 'Sign in to view your saved offers.' });
  try {
    const collection = await getCommercialsCollection();
    const offers = collection ? await collection.find({ type: 'customer-offer', email: req.customer.email, status: { $in: ['accepted', 'redeemed'] } }, { projection: { _id: 0 } }).sort({ acceptedAt: -1 }).toArray() : [];
    res.set('Cache-Control', 'no-store').json({ offers });
  } catch (error) { console.error('Customer offers could not be loaded:', error.message); res.status(503).json({ error: 'Saved offers are temporarily unavailable.' }); }
});

app.post('/api/account/offers/accept', async (req, res) => {
  if (!req.customer) return res.status(401).json({ error: 'Sign in to save this offer to your account.' });
  const offerId = String(req.body?.offerId || '').slice(0, 120);
  try {
    const collection = await getCommercialsCollection();
    if (!collection) return res.status(503).json({ error: 'Offers need a MongoDB connection.' });
    const config = await collection.findOne({ key: 'active' }, { projection: { _id: 0 } });
    const discount = config?.discount;
    if (!discount?.enabled || discount.offerId !== offerId) return res.status(409).json({ error: 'This offer is no longer available.' });
    const existing = await collection.findOne({ type: 'customer-offer', email: req.customer.email, offerId, status: { $in: ['accepted', 'redeemed'] } }, { projection: { _id: 0 } });
    if (existing) return res.json({ ok: true, offer: existing, alreadySaved: true });
    const offer = { type: 'customer-offer', email: req.customer.email, offerId, title: String(discount.title || 'PennyBuys offer').slice(0, 100), percent: Math.min(90, Math.max(1, Number(discount.percent) || 1)), status: 'accepted', acceptedAt: new Date(), redeemedAt: null };
    await collection.insertOne(offer);
    const { _id, ...saved } = offer;
    res.status(201).json({ ok: true, offer: saved });
  } catch (error) { console.error('Offer could not be saved:', error.message); res.status(503).json({ error: 'We could not save your offer right now.' }); }
});

app.post('/api/account/offers/redeem', async (req, res) => {
  if (!req.customer) return res.status(401).json({ error: 'Sign in to apply your saved offer.' });
  const offerId = String(req.body?.offerId || '').slice(0, 120);
  if (!offerId) return res.status(400).json({ error: 'Select a saved offer first.' });
  try {
    const collection = await getCommercialsCollection();
    if (!collection) return res.status(503).json({ error: 'Offers need a MongoDB connection.' });
    const result = await collection.updateOne({ type: 'customer-offer', email: req.customer.email, offerId, status: 'accepted' }, { $set: { status: 'redeemed', redeemedAt: new Date() } });
    if (!result.modifiedCount) return res.status(409).json({ error: 'This saved offer has already been used.' });
    res.json({ ok: true });
  } catch (error) { console.error('Offer could not be redeemed:', error.message); res.status(503).json({ error: 'We could not apply your offer right now.' }); }
});

app.get('/api/admin/commercials', requireAdmin, async (_req, res) => {
  try {
    const collection = await getCommercialsCollection();
    if (!collection) return res.status(503).json({ error: 'MongoDB is not configured.' });
    const config = await collection.findOne({ key: 'active' }, { projection: { _id: 0, key: 0 } });
    res.json(config || { discount: { enabled: false, offerId: crypto.randomUUID(), title: '', percent: 10, intervalMinutes: 1440 }, freeDelivery: { enabled: false, itemCount: 3, title: '' }, weightDelivery: { enabled: false, ratePerKg: 0 }, announcements: [] });
  } catch (error) { res.status(503).json({ error: 'Commercial settings could not be loaded.' }); }
});

app.put('/api/admin/commercials', requireAdmin, async (req, res) => {
  const discountIn = req.body?.discount || {};
  const deliveryIn = req.body?.freeDelivery || {};
  const announcementInput = Array.isArray(req.body?.announcements) ? req.body.announcements : String(req.body?.announcements || '').split(/\r?\n/);
  const announcements = announcementInput.map(message => String(message || '').trim()).filter(Boolean).slice(0, 8).map(message => message.slice(0, 240));
  const config = {
    key: 'active', updatedAt: new Date(),
    discount: { enabled: discountIn.enabled === true, offerId: crypto.randomUUID(), title: String(discountIn.title || 'A little something for you').trim().slice(0, 100), percent: Math.min(90, Math.max(1, Number(discountIn.percent) || 10)), intervalMinutes: Math.min(43200, Math.max(1, Math.floor(Number(discountIn.intervalMinutes) || (Number(discountIn.intervalHours) || 24) * 60))) },
    freeDelivery: { enabled: deliveryIn.enabled === true, itemCount: Math.min(50, Math.max(1, Math.floor(Number(deliveryIn.itemCount) || 3))), title: String(deliveryIn.title || '').trim().slice(0, 100) },
    weightDelivery: { enabled: req.body?.weightDelivery?.enabled === true, ratePerKg: Math.min(10000, Math.max(0, Number(req.body?.weightDelivery?.ratePerKg) || 0)) },
    announcements
  };
  try {
    const collection = await getCommercialsCollection();
    if (!collection) return res.status(503).json({ error: 'MongoDB is not configured.' });
    await collection.replaceOne({ key: 'active' }, config, { upsert: true });
    res.json({ ok: true, config });
  } catch (error) { console.error('Commercial settings could not be saved:', error.message); res.status(503).json({ error: 'Commercial settings could not be saved.' }); }
});

app.get('/products-data.js', async (_req, res) => {
  try {
    const products = await getStoreProducts();
    res.type('js').set('Cache-Control', 'no-store').send(`window.STORE_PRODUCTS = ${JSON.stringify(products)};`);
  } catch (error) {
    console.warn('MongoDB unavailable; serving demo catalog:', error.message);
    res.type('js').set('Cache-Control', 'no-store').send(`window.STORE_PRODUCTS = ${JSON.stringify(withDefaultReviewStats(getDemoProducts()))};`);
  }
});

app.get('/api/products', async (_req, res) => {
  try { res.json(await getStoreProducts()); }
  catch (error) {
    console.warn('MongoDB unavailable; serving demo catalog:', error.message);
    res.set('X-Catalog-Source', 'demo').json(withDefaultReviewStats(getDemoProducts()));
  }
});

app.get('/api/admin/status', requireAdmin, async (_req, res) => {
  let mongoConnected = false;
  let mongoMessage = mongoUri ? 'MongoDB connected.' : mongoUriIsPlaceholder ? 'MONGODB_URI still contains the example host. Replace it with your real MongoDB Atlas connection string.' : 'Set MONGODB_URI to your real MongoDB Atlas connection string.';
  try { mongoConnected = Boolean(await getProductsCollection()); }
  catch { mongoMessage = 'MongoDB is unreachable. Check the Atlas URI, database user credentials and network access list.'; }
  const cloudinaryConfigured = Boolean(process.env.CLOUDINARY_URL || (process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET));
  res.json({ mongoConnected, mongoUriConfigured: Boolean(mongoUri), mongoMessage, cloudinaryConfigured });
});

app.post('/api/newsletter/subscribe', async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const consent = req.body?.consent === true;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return res.status(400).json({ error: 'Enter a valid email address.' });
  if (!consent) return res.status(400).json({ error: 'Please confirm you want to receive PennyBuys email updates.' });
  let collection;
  try { await getProductsCollection(); collection = client?.db(mongoDbName).collection('newsletterSubscriptions'); }
  catch (error) { console.error('MongoDB newsletter connection failed:', error.message); return res.status(503).json({ error: 'Newsletter sign-up is temporarily unavailable. Please try again later.' }); }
  if (!collection) return res.status(503).json({ error: 'Newsletter sign-up is temporarily unavailable. Please try again later.' });
  try {
    const existing = await collection.findOne({ email });
    if (existing?.status === 'subscribed') return res.json({ ok: true, alreadySubscribed: true });
    const now = new Date();
    await collection.updateOne({ email }, { $set: { email, status: 'subscribed', consent: true, consentVersion: '2026-11-16', subscribedAt: now, updatedAt: now } }, { upsert: true });
    res.status(201).json({ ok: true, alreadySubscribed: false });
  } catch (error) { console.error('Newsletter subscription save failed:', error.message); res.status(503).json({ error: 'Newsletter sign-up is temporarily unavailable. Please try again later.' }); }
});

app.get('/api/admin/newsletter-subscriptions', requireAdmin, async (_req, res) => {
  try {
    await getProductsCollection();
    if (!client) return res.status(503).json({ error: 'MongoDB is not configured.' });
    const subscriptions = await client.db(mongoDbName).collection('newsletterSubscriptions').find({ status: 'subscribed' }, { projection: { _id: 0, email: 1, subscribedAt: 1 } }).sort({ subscribedAt: -1 }).toArray();
    res.json({ subscriptions });
  } catch (error) { console.error('Newsletter subscriptions could not be loaded:', error.message); res.status(503).json({ error: 'Newsletter subscriptions could not be loaded. Check the MongoDB connection.' }); }
});

app.post('/api/newsletter/unsubscribe', async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return res.status(400).json({ error: 'Enter the email address you subscribed with.' });
  try {
    await getProductsCollection();
    if (!client) return res.status(503).json({ error: 'Unsubscribe is temporarily unavailable. Please try again later.' });
    await client.db(mongoDbName).collection('newsletterSubscriptions').deleteOne({ email, status: 'subscribed' });
    res.json({ ok: true });
  } catch (error) { console.error('Newsletter unsubscribe failed:', error.message); res.status(503).json({ error: 'We could not update your subscription right now. Please try again later.' }); }
});

app.get('/api/products/:id/reviews', async (req, res) => {
  try {
    const products = await getStoreProducts();
    if (!products.some(product => product.id === req.params.id)) return res.status(404).json({ error: 'Product not found.' });
    const collection = client?.db(mongoDbName).collection('productReviews');
    if (!collection) return res.status(503).json({ error: 'Product reviews are temporarily unavailable.' });
    const viewerEmail = req.customer?.email || '';
    const reviews = await collection.find({ productId: req.params.id, status: 'published' }, { projection: { _id: 1, reviewId: 1, ownerEmail: 1, name: 1, rating: 1, text: 1, createdAt: 1, updatedAt: 1 } }).sort({ createdAt: -1 }).limit(100).toArray();
    const publicReviews = reviews.map(({ _id, ownerEmail, ...review }) => ({ ...review, reviewId: review.reviewId || String(_id), canManage: Boolean(viewerEmail && ownerEmail === viewerEmail) }));
    const [summary] = await collection.aggregate([
      { $match: { productId: req.params.id, status: 'published' } },
      { $group: { _id: '$productId', count: { $sum: 1 }, average: { $avg: '$rating' } } }
    ]).toArray();
    res.set('Cache-Control', 'no-store').json({ reviews: publicReviews, summary: { count: summary?.count || 0, rating: summary ? Number(summary.average).toFixed(1) : '5.0' } });
  } catch (error) { console.error('Product reviews could not be loaded:', error.message); res.status(503).json({ error: 'Product reviews are temporarily unavailable.' }); }
});

app.post('/api/products/:id/reviews', async (req, res) => {
  const ownerEmail = req.customer?.email || '';
  const name = String(req.customer?.name || req.body?.name || '').trim();
  const text = String(req.body?.text || '').trim();
  const rating = Number(req.body?.rating);
  if (!req.customer) return res.status(401).json({ error: 'Sign in to your PennyBuys account before leaving a review.' });
  if (name.length < 2) return res.status(400).json({ error: 'Enter a name with at least two characters.' });
  if (name.length > 80) return res.status(400).json({ error: 'Keep your display name under 80 characters.' });
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) return res.status(400).json({ error: 'Choose a rating from 1 to 5 stars.' });
  if (text.length < 10) return res.status(400).json({ error: 'Write at least 10 characters in your review.' });
  if (text.length > 2000) return res.status(400).json({ error: 'Keep your review under 2,000 characters.' });
  try {
    const products = await getStoreProducts();
    const product = products.find(item => item.id === req.params.id);
    if (!product) return res.status(404).json({ error: 'Product not found.' });
    const collection = client?.db(mongoDbName).collection('productReviews');
    if (!collection) return res.status(503).json({ error: 'Reviews are temporarily unavailable. Please try again later.' });
    const review = { reviewId: crypto.randomUUID(), productId: product.id, ownerEmail, name, rating, text, status: 'published', createdAt: new Date(), updatedAt: null };
    await collection.insertOne(review);
    res.status(201).json({ review: { reviewId: review.reviewId, name, rating, text, createdAt: review.createdAt.toISOString(), canManage: true } });
  } catch (error) { console.error('Product review could not be saved:', error.message); res.status(503).json({ error: 'Your review could not be saved right now. Please try again later.' }); }
});

app.put('/api/products/:id/reviews/:reviewId', async (req, res) => {
  const ownerEmail = req.customer?.email || '';
  const name = String(req.customer?.name || req.body?.name || '').trim();
  const text = String(req.body?.text || '').trim();
  const rating = Number(req.body?.rating);
  if (!req.customer) return res.status(401).json({ error: 'Sign in to edit your review.' });
  if (name.length < 2 || name.length > 80) return res.status(400).json({ error: 'Enter a display name between 2 and 80 characters.' });
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) return res.status(400).json({ error: 'Choose a rating from 1 to 5 stars.' });
  if (text.length < 10 || text.length > 2000) return res.status(400).json({ error: 'Reviews must be between 10 and 2,000 characters.' });
  try {
    const collection = client?.db(mongoDbName).collection('productReviews');
    if (!collection) return res.status(503).json({ error: 'Reviews are temporarily unavailable. Please try again later.' });
    const result = await collection.updateOne({ productId: req.params.id, reviewId: req.params.reviewId, ownerEmail, status: 'published' }, { $set: { name, rating, text, updatedAt: new Date() } });
    if (!result.matchedCount) return res.status(404).json({ error: 'Review not found, or it does not belong to this account.' });
    res.json({ ok: true });
  } catch (error) { console.error('Product review could not be updated:', error.message); res.status(503).json({ error: 'Your review could not be updated right now.' }); }
});

app.delete('/api/products/:id/reviews/:reviewId', async (req, res) => {
  const ownerEmail = req.customer?.email || '';
  if (!req.customer) return res.status(401).json({ error: 'Sign in to delete your review.' });
  try {
    const collection = client?.db(mongoDbName).collection('productReviews');
    if (!collection) return res.status(503).json({ error: 'Reviews are temporarily unavailable. Please try again later.' });
    const result = await collection.deleteOne({ productId: req.params.id, reviewId: req.params.reviewId, ownerEmail, status: 'published' });
    if (!result.deletedCount) return res.status(404).json({ error: 'Review not found, or it does not belong to this account.' });
    res.json({ ok: true });
  } catch (error) { console.error('Product review could not be deleted:', error.message); res.status(503).json({ error: 'Your review could not be deleted right now.' }); }
});

app.get('/api/admin/reviews', requireAdmin, async (_req, res) => {
  try {
    await getProductsCollection();
    if (!client) return res.status(503).json({ error: 'MongoDB is not configured.' });
    const reviews = await client.db(mongoDbName).collection('productReviews').find({ status: 'published' }, { projection: { _id: 1, reviewId: 1, productId: 1, name: 1, rating: 1, text: 1, createdAt: 1, updatedAt: 1 } }).sort({ createdAt: -1 }).limit(500).toArray();
    const normalizedReviews = reviews.map(({ _id, ...review }) => ({ ...review, reviewId: review.reviewId || String(_id) }));
    res.set('Cache-Control', 'no-store').json({ reviews: normalizedReviews });
  } catch (error) { console.error('Admin reviews could not be loaded:', error.message); res.status(503).json({ error: 'Reviews could not be loaded. Check the MongoDB connection.' }); }
});

app.delete('/api/admin/reviews/:reviewId', requireAdmin, async (req, res) => {
  try {
    await getProductsCollection();
    if (!client) return res.status(503).json({ error: 'MongoDB is not configured.' });
    const id = req.params.reviewId;
    const selector = ObjectId.isValid(id) ? { $or: [{ reviewId: id }, { _id: new ObjectId(id) }] } : { reviewId: id };
    const result = await client.db(mongoDbName).collection('productReviews').deleteOne(selector);
    if (!result.deletedCount) return res.status(404).json({ error: 'Review not found.' });
    res.json({ ok: true });
  } catch (error) { console.error('Admin review deletion failed:', error.message); res.status(503).json({ error: 'The review could not be deleted right now.' }); }
});

app.post('/api/products', requireAdmin, upload.fields([{ name: 'images', maxCount: 5 }, { name: 'video', maxCount: 1 }]), async (req, res) => {
  const name = String(req.body.name || '').trim();
  const category = String(req.body.category || '').trim();
  const group = String(req.body.group || '').trim();
  const description = String(req.body.description || '').trim();
  const deliveryReturns = String(req.body.deliveryReturns || '').trim();
  const price = Number(req.body.price);
  const inventory = Number(req.body.inventory);
  const weightKg = Number(req.body.weightKg);
  const freeDelivery = req.body.freeDelivery === 'true';
  const images = req.files?.images || [];
  const video = req.files?.video?.[0];

  if (name.length < 2 || name.length > 140) return res.status(400).json({ error: 'Product name must be between 2 and 140 characters.' });
  if (!category || !group) return res.status(400).json({ error: 'Choose a product category.' });
  if (!Number.isFinite(price) || price <= 0 || price > 100000) return res.status(400).json({ error: 'Enter a valid product price.' });
  if (!Number.isInteger(inventory) || inventory < 0 || inventory > 1000000) return res.status(400).json({ error: 'Enter stock as a whole number from 0 to 1,000,000.' });
  if (!Number.isFinite(weightKg) || weightKg <= 0 || weightKg > 10000) return res.status(400).json({ error: 'Enter a product weight greater than 0 kg and no more than 10,000 kg.' });
  if (!description || description.length > 3000) return res.status(400).json({ error: 'Add a product description under 3,000 characters.' });
  if (deliveryReturns.length > 2000) return res.status(400).json({ error: 'Keep delivery and returns information under 2,000 characters.' });
  if (!images.length) return res.status(400).json({ error: 'Choose at least one product image.' });
  if (!process.env.CLOUDINARY_URL && !(process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET)) {
    return res.status(503).json({ error: 'Configure Cloudinary credentials on the server before uploading media.' });
  }

  let collection;
  try { collection = await getProductsCollection(); }
  catch (error) {
    console.error('MongoDB connection failed:', error.message);
    return res.status(503).json({ error: 'MongoDB is unavailable. Check MONGODB_URI and try again.' });
  }
  if (!collection) return res.status(503).json({ error: mongoUriIsPlaceholder ? 'Replace the example MONGODB_URI in .env with your real MongoDB Atlas connection string, then restart the server.' : 'Set MONGODB_URI in .env or your Railway variables, then restart the server.' });

  try {
    const imageAssets = await Promise.all(images.map(file => uploadToCloudinary(file, 'image', 'pennybuys/products')));
    const videoAsset = video ? await uploadToCloudinary(video, 'video', 'pennybuys/products') : null;
    const existing = await collection.find({}, { projection: { id: 1, _id: 0 } }).toArray();
    const baseId = slugify(name);
    const id = existing.some(item => item.id === baseId) ? `${baseId}-${Date.now().toString(36)}` : baseId;
    const now = new Date();
    const product = {
      id, name, category, group, price, weightKg, freeDelivery,
      oldPrice: null,
      badge: 'JUST ARRIVED', rating: '5.0', reviews: 0,
      image: imageAssets[0].secure_url,
      gallery: imageAssets.slice(1).map(asset => asset.secure_url),
      cloudinaryImageIds: imageAssets.map(asset => asset.public_id),
      video: videoAsset?.secure_url || '',
      cloudinaryVideoId: videoAsset?.public_id || '',
      inventory, description, deliveryReturns,
      alt: name,
      createdAt: now,
      updatedAt: now
    };
    await collection.insertOne(product);
    void dispatchPush({ audience: 'customer' }, { title: 'New at PennyBuys', body: `${product.name} has just arrived.`, url: `/product.html?id=${encodeURIComponent(product.id)}`, tag: `new-product-${product.id}` });
    res.status(201).json({ product: { ...product, createdAt: now.toISOString(), updatedAt: now.toISOString() }, products: await getStoreProducts() });
  } catch (error) {
    console.error('Product creation failed:', error.message);
    res.status(502).json({ error: 'The upload or product save failed. Check the Cloudinary and MongoDB configuration and try again.' });
  }
});

app.put('/api/products/:id', requireAdmin, upload.fields([{ name: 'images', maxCount: 5 }, { name: 'video', maxCount: 1 }]), async (req, res) => {
  const name = String(req.body.name || '').trim();
  const category = String(req.body.category || '').trim();
  const group = String(req.body.group || '').trim();
  const description = String(req.body.description || '').trim();
  const deliveryReturns = String(req.body.deliveryReturns || '').trim();
  const price = Number(req.body.price);
  const inventory = Number(req.body.inventory);
  const weightKg = Number(req.body.weightKg);
  const freeDelivery = req.body.freeDelivery === 'true';
  const images = req.files?.images || [];
  const video = req.files?.video?.[0];
  if (name.length < 2 || name.length > 140) return res.status(400).json({ error: 'Product name must be between 2 and 140 characters.' });
  if (!category || !group) return res.status(400).json({ error: 'Choose a product category.' });
  if (!Number.isFinite(price) || price <= 0 || price > 100000) return res.status(400).json({ error: 'Enter a valid product price.' });
  if (!Number.isInteger(inventory) || inventory < 0 || inventory > 1000000) return res.status(400).json({ error: 'Enter stock as a whole number from 0 to 1,000,000.' });
  if (!Number.isFinite(weightKg) || weightKg <= 0 || weightKg > 10000) return res.status(400).json({ error: 'Enter a product weight greater than 0 kg and no more than 10,000 kg.' });
  if (!description || description.length > 3000) return res.status(400).json({ error: 'Add a product description under 3,000 characters.' });
  if (deliveryReturns.length > 2000) return res.status(400).json({ error: 'Keep delivery and returns information under 2,000 characters.' });
  if ((images.length || video) && !process.env.CLOUDINARY_URL && !(process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET)) {
    return res.status(503).json({ error: 'Configure Cloudinary credentials on the server before changing product media.' });
  }

  let collection;
  try { collection = await getProductsCollection(); }
  catch (error) {
    console.error('MongoDB connection failed:', error.message);
    return res.status(503).json({ error: 'MongoDB is unavailable. Check MONGODB_URI and try again.' });
  }
  if (!collection) return res.status(503).json({ error: 'Set MONGODB_URI in .env or your Railway variables, then restart the server.' });
  try {
    const existingRecord = await collection.findOne({ id: req.params.id }, { projection: { _id: 0 } });
    const previous = existingRecord || getDemoProducts().find(product => product.id === req.params.id);
    if (!previous) return res.status(404).json({ error: 'Product not found.' });
    const now = new Date();
    const changes = { name, category, group, description, deliveryReturns, price, inventory, weightKg, freeDelivery, alt: name, updatedAt: now };
    let oldImageIds = [];
    let oldVideoIds = [];
    let imagePlan;
    try { imagePlan = req.body.imagePlan ? JSON.parse(req.body.imagePlan) : null; }
    catch { return res.status(400).json({ error: 'The image order is invalid. Refresh the product and try again.' }); }
    if (imagePlan) {
      const previousUrls = [previous.image, ...(Array.isArray(previous.gallery) ? previous.gallery : [])].filter(Boolean);
      if (!imagePlan.length || imagePlan.length > 5) return res.status(400).json({ error: 'Keep between one and five product images.' });
      const requestedUploads = imagePlan.filter(item => item?.kind === 'upload');
      if (requestedUploads.length !== images.length || requestedUploads.some((item, index) => item.index !== index)) return res.status(400).json({ error: 'The uploaded image order is invalid. Refresh the product and try again.' });
      if (imagePlan.some(item => item?.kind !== 'upload' && !(item?.kind === 'existing' && previousUrls.includes(item.url)))) return res.status(400).json({ error: 'The selected product images are invalid. Refresh the product and try again.' });
      const uploadedAssets = await Promise.all(images.map(file => uploadToCloudinary(file, 'image', 'pennybuys/products')));
      const usedUploadIndexes = new Set();
      const ordered = imagePlan.map(item => {
        if (item?.kind === 'existing' && previousUrls.includes(item.url)) return { url: item.url, publicId: publicIdFromUrl(item.url, 'image') };
        if (item?.kind === 'upload' && Number.isInteger(item.index) && uploadedAssets[item.index] && !usedUploadIndexes.has(item.index)) {
          usedUploadIndexes.add(item.index);
          return { url: uploadedAssets[item.index].secure_url, publicId: uploadedAssets[item.index].public_id };
        }
        throw new Error('Invalid image order. Refresh the product and try again.');
      });
      if (usedUploadIndexes.size !== uploadedAssets.length) throw new Error('An uploaded image is missing from the product image order.');
      const storedIds = Array.isArray(previous.cloudinaryImageIds) ? previous.cloudinaryImageIds : [];
      const retainedUrls = new Set(ordered.filter(item => item.publicId || previousUrls.includes(item.url)).map(item => item.url));
      oldImageIds = previousUrls.map((url, index) => ({ url, id: storedIds[index] || publicIdFromUrl(url, 'image') })).filter(item => item.id && !retainedUrls.has(item.url)).map(item => item.id);
      changes.image = ordered[0].url;
      changes.gallery = ordered.slice(1).map(item => item.url);
      changes.cloudinaryImageIds = ordered.map(item => item.publicId || '');
    } else if (images.length) {
      const assets = await Promise.all(images.map(file => uploadToCloudinary(file, 'image', 'pennybuys/products')));
      oldImageIds = productAssetIds(previous, 'image');
      changes.image = assets[0].secure_url;
      changes.gallery = assets.slice(1).map(asset => asset.secure_url);
      changes.cloudinaryImageIds = assets.map(asset => asset.public_id);
    }
    if (video) {
      const asset = await uploadToCloudinary(video, 'video', 'pennybuys/products');
      oldVideoIds = productAssetIds(previous, 'video');
      changes.video = asset.secure_url;
      changes.cloudinaryVideoId = asset.public_id;
    } else if (req.body.removeVideo === 'true') {
      oldVideoIds = productAssetIds(previous, 'video');
      changes.video = '';
      changes.cloudinaryVideoId = '';
    }
    await collection.updateOne({ id: req.params.id }, { $set: { ...previous, ...changes } }, { upsert: true });
    await client.db(mongoDbName).collection('catalogOverrides').deleteOne({ id: req.params.id, type: 'deleted-demo-product' });
    await Promise.all([destroyProductAssets(oldImageIds, 'image'), destroyProductAssets(oldVideoIds, 'video')]);
    const product = await collection.findOne({ id: req.params.id }, { projection: { _id: 0 } });
    res.json({ product, products: await getStoreProducts() });
  } catch (error) {
    console.error('Product update failed:', error.message);
    res.status(502).json({ error: 'The product update or media upload failed. Check the Cloudinary and MongoDB configuration and try again.' });
  }
});

app.delete('/api/products/:id', requireAdmin, async (req, res) => {
  let collection;
  try { collection = await getProductsCollection(); }
  catch (error) {
    console.error('MongoDB connection failed:', error.message);
    return res.status(503).json({ error: 'MongoDB is unavailable. Check MONGODB_URI and try again.' });
  }
  if (!collection) return res.status(503).json({ error: 'Set MONGODB_URI in .env or your Railway variables, then restart the server.' });
  try {
    const product = await collection.findOne({ id: req.params.id }, { projection: { _id: 0 } }) || getDemoProducts().find(item => item.id === req.params.id);
    if (!product) return res.status(404).json({ error: 'Product not found.' });
    await collection.deleteOne({ id: req.params.id });
    if (getDemoProducts().some(item => item.id === req.params.id)) {
      await client.db(mongoDbName).collection('catalogOverrides').updateOne({ id: req.params.id, type: 'deleted-demo-product' }, { $setOnInsert: { id: req.params.id, type: 'deleted-demo-product', deletedAt: new Date() } }, { upsert: true });
    }
    await Promise.all([destroyProductAssets(productAssetIds(product, 'image'), 'image'), destroyProductAssets(productAssetIds(product, 'video'), 'video')]);
    res.json({ products: await getStoreProducts() });
  } catch (error) {
    console.error('Product deletion failed:', error.message);
    res.status(502).json({ error: 'The product could not be deleted. Check the MongoDB connection and try again.' });
  }
});

app.get(['/health', '/api/health'], (_req, res) => res.json({ ok: true }));
app.use(express.static(root, { extensions: ['html'], maxAge: '1d', setHeaders(res, filePath) {
  if (/\.(html|js|css)$/.test(filePath)) res.setHeader('Cache-Control', 'no-cache');
} }));
app.use((error, _req, res, _next) => {
  if (error instanceof multer.MulterError) return res.status(400).json({ error: error.code === 'LIMIT_FILE_SIZE' ? 'Each file must be smaller than 100 MB.' : 'Choose up to five images and one video.' });
  if (error) return res.status(400).json({ error: error.message || 'The request could not be processed.' });
  res.status(500).json({ error: 'Unexpected server error.' });
});

const server = http.createServer(app);
server.listen(port, '0.0.0.0', () => console.log(`PennyBuys listening on 0.0.0.0:${port} (PORT ${process.env.PORT ? 'provided by Railway' : 'using local default'})`));

async function close() {
  server.close();
  if (client) await client.close().catch(() => {});
}
process.on('SIGTERM', close);
process.on('SIGINT', close);
