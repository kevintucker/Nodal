// server/index.js
// Main server — runs the NSO (Network Service Object) layer for the spatial store.
// This is what the RP1 fabric connects to for AI greeter, product info, and checkout.

import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
dotenv.config();

import { fetchProducts } from '../shopify/products.js';
import { startGreeterServer } from '../ai-greeter/greeter.js';
import { createCheckoutSession, handleWebhook } from './checkout.js';
import usdRouter from '../usd-map-service/index.js';

const app = express();
const PORT = parseInt(process.env.PORT ?? '3000');
const GREETER_WS_PORT = PORT + 1;
const STORE_NAME = process.env.STORE_NAME ?? 'Spatial Store';

app.use(cors());

// Raw body needed for Stripe webhook verification
app.use('/webhook', express.raw({ type: 'application/json' }));
app.use(express.json());

// ─── Cache products at startup ────────────────────────────────────────────────
let products = [];

async function loadProducts() {
  try {
    products = await fetchProducts(9);
    console.log(`🛍  Loaded ${products.length} products from Shopify`);
  } catch (err) {
    console.warn(`⚠️  Could not load Shopify products: ${err.message}`);
    console.warn('    Running with mock products for demo purposes.');
    products = getMockProducts();
  }
}

function getMockProducts() {
  return [
    { id: 'mock-1', title: 'Spatial Sneakers', description: 'Premium sneakers for the metaverse era.', price: 129.99, currency: 'USD', variantId: 'mock-v1', imageUrl: null, handle: 'spatial-sneakers' },
    { id: 'mock-2', title: 'Holo Hoodie',      description: 'Lightweight hoodie with holographic print.', price: 89.99,  currency: 'USD', variantId: 'mock-v2', imageUrl: null, handle: 'holo-hoodie' },
    { id: 'mock-3', title: 'AR Cap',           description: 'Cap designed for AR headset compatibility.', price: 49.99,  currency: 'USD', variantId: 'mock-v3', imageUrl: null, handle: 'ar-cap' },
  ];
}

// ─── Routes ───────────────────────────────────────────────────────────────────

// Health check / NSO manifest
app.get('/', (req, res) => {
  res.json({
    service: 'Spatial Storefront NSO',
    store: STORE_NAME,
    version: '1.0.0',
    endpoints: {
      products:   'GET /products',
      checkout:   'POST /checkout',
      greeterWs:  `ws://localhost:${GREETER_WS_PORT}`,
      health:     'GET /health',
    },
  });
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', products: products.length, store: STORE_NAME });
});

// Product catalog — RP1 fabric can poll this to display product info panels
app.get('/products', (req, res) => {
  res.json(products);
});

// Single product by Shopify ID
app.get('/products/:id', (req, res) => {
  const product = products.find(p => p.id === req.params.id || p.handle === req.params.id);
  if (!product) return res.status(404).json({ error: 'Product not found' });
  res.json(product);
});

// Checkout — called when visitor "picks up" a product in the spatial store
// The RP1 browser opens the returned URL in a panel overlay
app.post('/checkout', async (req, res) => {
  const { productId, visitorId } = req.body;
  if (!productId) return res.status(400).json({ error: 'productId required' });

  const product = products.find(p => p.id === productId);
  if (!product) return res.status(404).json({ error: 'Product not found' });

  try {
    const checkoutUrl = await createCheckoutSession(product, visitorId ?? 'anonymous');
    res.json({ checkoutUrl });
  } catch (err) {
    console.error('Checkout error:', err.message);
    res.status(500).json({ error: 'Could not create checkout session' });
  }
});

// USD Map Service — export/import scene as OpenUSD files
// Any USD-capable tool (Blender, Houdini, Omniverse, Unreal, Maya) can
// fetch GET /usd/export to open the live store scene, edit it, and POST
// the modified layout back to update product positions on the RP1 fabric.
app.use('/usd', usdRouter);

// Stripe webhook
app.post('/webhook', async (req, res) => {
  const sig = req.headers['stripe-signature'];
  try {
    await handleWebhook(req.body, sig);
    res.json({ received: true });
  } catch (err) {
    console.error('Webhook error:', err.message);
    res.status(400).json({ error: err.message });
  }
});

// Checkout result pages (linked in Stripe session)
app.get('/checkout/success', (req, res) => {
  res.send('<h1>✅ Purchase complete! Return to the spatial store.</h1>');
});
app.get('/checkout/cancelled', (req, res) => {
  res.send('<h1>Purchase cancelled. Return to the spatial store.</h1>');
});

// ─── Start ────────────────────────────────────────────────────────────────────

async function start() {
  await loadProducts();

  // Start AI greeter WebSocket on PORT+1
  startGreeterServer(GREETER_WS_PORT, products, STORE_NAME);

  app.listen(PORT, () => {
    console.log(`\n🚀 Spatial Storefront NSO running`);
    console.log(`   HTTP API:  http://localhost:${PORT}`);
    console.log(`   Greeter WS: ws://localhost:${GREETER_WS_PORT}`);
    console.log(`   Store: ${STORE_NAME}\n`);
  });
}

start().catch(err => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
