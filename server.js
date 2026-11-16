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

const root = __dirname;
const app = express();
const port = Number(process.env.PORT || 3000);
const configuredMongoUri = (process.env.MONGODB_URI || '').trim();
const mongoUri = configuredMongoUri && !/cluster\.example\.mongodb\.net|username:password@/i.test(configuredMongoUri) ? configuredMongoUri : '';
const mongoDbName = process.env.MONGODB_DB_NAME || 'pennybuys';
const adminToken = process.env.ADMIN_TOKEN || '';
const customerSessionSecret = process.env.CUSTOMER_SESSION_SECRET || adminToken || crypto.randomBytes(32).toString('hex');
const scrypt = promisify(crypto.scrypt);
const maxUploadBytes = 100 * 1024 * 1024;
const mongoUriIsPlaceholder = /cluster\.example\.mongodb\.net|username:password@/i.test(configuredMongoUri);
const client = mongoUri ? new MongoClient(mongoUri, { serverSelectionTimeoutMS: 7000 }) : null;
let databasePromise;
let demoProducts;

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

async function getCommercialsCollection() {
  await getProductsCollection();
  if (!client) return null;
  return client.db(mongoDbName).collection('storeCommercials');
}

app.get('/api/commercials/active', async (_req, res) => {
  try {
    const collection = await getCommercialsCollection();
    const config = collection ? await collection.findOne({ key: 'active' }, { projection: { _id: 0, key: 0 } }) : null;
    res.set('Cache-Control', 'no-store').json(config || { discount: { enabled: false }, freeDelivery: { enabled: false, itemCount: 3 } });
  } catch (error) { console.warn('Commercials could not be loaded:', error.message); res.json({ discount: { enabled: false }, freeDelivery: { enabled: false, itemCount: 3 } }); }
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
    res.json(config || { discount: { enabled: false, offerId: crypto.randomUUID(), title: '', percent: 10, intervalMinutes: 1440 }, freeDelivery: { enabled: false, itemCount: 3, title: '' } });
  } catch (error) { res.status(503).json({ error: 'Commercial settings could not be loaded.' }); }
});

app.put('/api/admin/commercials', requireAdmin, async (req, res) => {
  const discountIn = req.body?.discount || {};
  const deliveryIn = req.body?.freeDelivery || {};
  const config = {
    key: 'active', updatedAt: new Date(),
    discount: { enabled: discountIn.enabled === true, offerId: crypto.randomUUID(), title: String(discountIn.title || 'A little something for you').trim().slice(0, 100), percent: Math.min(90, Math.max(1, Number(discountIn.percent) || 10)), intervalMinutes: Math.min(43200, Math.max(1, Math.floor(Number(discountIn.intervalMinutes) || (Number(discountIn.intervalHours) || 24) * 60))) },
    freeDelivery: { enabled: deliveryIn.enabled === true, itemCount: Math.min(50, Math.max(1, Math.floor(Number(deliveryIn.itemCount) || 3))), title: String(deliveryIn.title || '').trim().slice(0, 100) }
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
  const images = req.files?.images || [];
  const video = req.files?.video?.[0];

  if (name.length < 2 || name.length > 140) return res.status(400).json({ error: 'Product name must be between 2 and 140 characters.' });
  if (!category || !group) return res.status(400).json({ error: 'Choose a product category.' });
  if (!Number.isFinite(price) || price <= 0 || price > 100000) return res.status(400).json({ error: 'Enter a valid product price.' });
  if (!Number.isInteger(inventory) || inventory < 0 || inventory > 1000000) return res.status(400).json({ error: 'Enter stock as a whole number from 0 to 1,000,000.' });
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
      id, name, category, group, price,
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
  const images = req.files?.images || [];
  const video = req.files?.video?.[0];
  if (name.length < 2 || name.length > 140) return res.status(400).json({ error: 'Product name must be between 2 and 140 characters.' });
  if (!category || !group) return res.status(400).json({ error: 'Choose a product category.' });
  if (!Number.isFinite(price) || price <= 0 || price > 100000) return res.status(400).json({ error: 'Enter a valid product price.' });
  if (!Number.isInteger(inventory) || inventory < 0 || inventory > 1000000) return res.status(400).json({ error: 'Enter stock as a whole number from 0 to 1,000,000.' });
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
    const changes = { name, category, group, description, deliveryReturns, price, inventory, alt: name, updatedAt: now };
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
