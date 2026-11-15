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
      const count = await collection.countDocuments();
      if (count === 0) {
        const now = new Date();
        await collection.insertMany(getDemoProducts().map(product => ({ ...product, inventory: 10, createdAt: now, updatedAt: now })));
      }
      await collection.createIndex({ id: 1 }, { unique: true });
      return collection;
    }).catch(error => {
      databasePromise = null;
      throw error;
    });
  }
  return databasePromise;
}

async function getStoreProducts() {
  const collection = await getProductsCollection();
  if (!collection) return getDemoProducts();
  const records = await collection.find({}, { projection: { _id: 0 } }).sort({ createdAt: -1 }).toArray();
  return records.length ? records : getDemoProducts();
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

app.post('/api/products', requireAdmin, upload.fields([{ name: 'images', maxCount: 5 }, { name: 'video', maxCount: 1 }]), async (req, res) => {
  const name = String(req.body.name || '').trim();
  const category = String(req.body.category || '').trim();
  const group = String(req.body.group || '').trim();
  const description = String(req.body.description || '').trim();
  const price = Number(req.body.price);
  const inventory = Number(req.body.inventory);
  const images = req.files?.images || [];
  const video = req.files?.video?.[0];

  if (name.length < 2 || name.length > 140) return res.status(400).json({ error: 'Product name must be between 2 and 140 characters.' });
  if (!category || !group) return res.status(400).json({ error: 'Choose a product category.' });
  if (!Number.isFinite(price) || price <= 0 || price > 100000) return res.status(400).json({ error: 'Enter a valid product price.' });
  if (!Number.isInteger(inventory) || inventory < 0 || inventory > 1000000) return res.status(400).json({ error: 'Enter stock as a whole number from 0 to 1,000,000.' });
  if (!description || description.length > 3000) return res.status(400).json({ error: 'Add a product description under 3,000 characters.' });
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
      video: videoAsset?.secure_url || '',
      inventory, description,
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

app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.use(express.static(root, { extensions: ['html'], maxAge: '1d', setHeaders(res, filePath) {
  if (/\.(html|js|css)$/.test(filePath)) res.setHeader('Cache-Control', 'no-cache');
} }));
app.use((error, _req, res, _next) => {
  if (error instanceof multer.MulterError) return res.status(400).json({ error: error.code === 'LIMIT_FILE_SIZE' ? 'Each file must be smaller than 100 MB.' : 'Choose up to five images and one video.' });
  if (error) return res.status(400).json({ error: error.message || 'The request could not be processed.' });
  res.status(500).json({ error: 'Unexpected server error.' });
});

const server = http.createServer(app);
server.listen(port, '0.0.0.0', () => console.log(`PennyBuys running on port ${port}`));

async function close() {
  server.close();
  if (client) await client.close().catch(() => {});
}
process.on('SIGTERM', close);
process.on('SIGINT', close);
