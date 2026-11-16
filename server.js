const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const vm = require('node:vm');
const express = require('express');
const multer = require('multer');
const { MongoClient } = require('mongodb');
const { v2: cloudinary } = require('cloudinary');

const root = __dirname;
const app = express();
const port = Number(process.env.PORT || 3000);
const configuredMongoUri = (process.env.MONGODB_URI || '').trim();
const mongoUri = configuredMongoUri && !/cluster\.example\.mongodb\.net|username:password@/i.test(configuredMongoUri) ? configuredMongoUri : '';
const mongoDbName = process.env.MONGODB_DB_NAME || 'pennybuys';
const adminToken = process.env.ADMIN_TOKEN || '';
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
  return [...records, ...demoProducts];
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

app.get('/products-data.js', async (_req, res) => {
  try {
    const products = await getStoreProducts();
    res.type('js').set('Cache-Control', 'no-store').send(`window.STORE_PRODUCTS = ${JSON.stringify(products)};`);
  } catch (error) {
    console.warn('MongoDB unavailable; serving demo catalog:', error.message);
    res.type('js').set('Cache-Control', 'no-store').send(`window.STORE_PRODUCTS = ${JSON.stringify(getDemoProducts())};`);
  }
});

app.get('/api/products', async (_req, res) => {
  try { res.json(await getStoreProducts()); }
  catch (error) {
    console.warn('MongoDB unavailable; serving demo catalog:', error.message);
    res.set('X-Catalog-Source', 'demo').json(getDemoProducts());
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
    const reviews = await collection.find({ productId: req.params.id, status: 'published' }, { projection: { _id: 0, name: 1, rating: 1, text: 1, createdAt: 1 } }).sort({ createdAt: -1 }).limit(100).toArray();
    res.set('Cache-Control', 'no-store').json({ reviews });
  } catch (error) { console.error('Product reviews could not be loaded:', error.message); res.status(503).json({ error: 'Product reviews are temporarily unavailable.' }); }
});

app.post('/api/products/:id/reviews', async (req, res) => {
  const name = String(req.body?.name || '').trim();
  const text = String(req.body?.text || '').trim();
  const rating = Number(req.body?.rating);
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
    const review = { productId: product.id, name, rating, text, status: 'published', createdAt: new Date() };
    await collection.insertOne(review);
    res.status(201).json({ review: { name, rating, text, createdAt: review.createdAt.toISOString() } });
  } catch (error) { console.error('Product review could not be saved:', error.message); res.status(503).json({ error: 'Your review could not be saved right now. Please try again later.' }); }
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
