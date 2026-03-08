// scene-builder/build.js
// Reads Shopify products and builds a 3D store layout on the RP1 Spatial Fabric
// Uses the ManifolderClient protocol (MVMF) directly via HTTP to the fabric server.
//
// Run with:  node scene-builder/build.js

import dotenv from 'dotenv';
dotenv.config();

import { fetchProducts } from '../shopify/products.js';
import { exportSceneToUsd } from '../usd-map-service/index.js';
import fetch from 'node-fetch';

const FABRIC_URL = process.env.FABRIC_URL;         // e.g. https://your-server/fabric/fabric.msf
const ADMIN_KEY  = process.env.FABRIC_ADMIN_KEY;   // from signup.hackathon.rp1.dev
const STORE_NAME = process.env.STORE_NAME ?? 'Spatial Store';

// ─── Fabric helpers ──────────────────────────────────────────────────────────

async function fabricRequest(method, path, body = null) {
  const res = await fetch(`${FABRIC_URL}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${ADMIN_KEY}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`Fabric ${method} ${path} → ${res.status}: ${await res.text()}`);
  return res.json();
}

// Create or fetch the root scene for the store
async function ensureStoreScene() {
  console.log('📦 Setting up store scene…');
  const scenes = await fabricRequest('GET', '/scenes');
  const existing = scenes.find(s => s.name === STORE_NAME);
  if (existing) {
    console.log(`  ↩ Reusing scene "${STORE_NAME}" (id: ${existing.id})`);
    return existing.id;
  }
  const scene = await fabricRequest('POST', '/scenes', { name: STORE_NAME });
  console.log(`  ✓ Created scene "${STORE_NAME}" (id: ${scene.id})`);
  return scene.id;
}

// Place a product card as a 3D object in the scene
async function placeProductObject(sceneId, product, position) {
  const obj = await fabricRequest('POST', `/scenes/${sceneId}/objects`, {
    name: product.title,
    type: 'container',
    transform: {
      position,             // { x, y, z } in meters
      rotation: { x: 0, y: 0, z: 0, w: 1 },
      scale:    { x: 1, y: 1, z: 1 },
    },
    properties: {
      // Custom properties the AI greeter and checkout service read at runtime
      shopify_product_id: product.id,
      shopify_variant_id: product.variantId,
      price:              product.price,
      currency:           product.currency,
      description:        product.description,
      image_url:          product.imageUrl,
      interaction:        'purchasable',   // triggers checkout NSO on proximity
    },
  });
  console.log(`  ✓ Placed "${product.title}" at (${position.x}, ${position.y}, ${position.z})`);
  return obj;
}

// Place an AI greeter agent object at the store entrance
async function placeGreeter(sceneId) {
  const obj = await fabricRequest('POST', `/scenes/${sceneId}/objects`, {
    name: 'Store Greeter',
    type: 'action_resource',
    transform: {
      position: { x: 0, y: 0, z: 0 },    // entrance position
      rotation: { x: 0, y: 0, z: 0, w: 1 },
      scale:    { x: 1, y: 1.8, z: 1 },  // roughly human-height
    },
    resource: 'action://showtext',
    properties: {
      service_url:  `http://localhost:${process.env.PORT ?? 3000}/greeter/ws`,
      interaction:  'ai_greeter',
      greeting:     `Welcome to ${STORE_NAME}! Walk up to any product to learn more.`,
    },
  });
  console.log(`  ✓ Placed AI Greeter at scene entrance`);
  return obj;
}

// ─── Layout ───────────────────────────────────────────────────────────────────

/**
 * Arrange products in a grid layout.
 * 3 columns, rows auto-expand, spaced 2.5 m apart, shelves at y=1m.
 */
function gridPosition(index) {
  const cols = 3;
  const spacing = 2.5;
  const col = index % cols;
  const row = Math.floor(index / cols);
  return {
    x: (col - 1) * spacing,    // center column at x=0
    y: 1.0,                     // shelf height
    z: -(row * spacing) - 3,   // start 3m back from entrance
  };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function buildScene() {
  console.log('\n🏗  Building Spatial Storefront…\n');

  const products = await fetchProducts(9);  // max 9 = 3x3 grid
  console.log(`🛍  Fetched ${products.length} products from Shopify\n`);

  const sceneId = await ensureStoreScene();

  await placeGreeter(sceneId);

  for (let i = 0; i < products.length; i++) {
    await placeProductObject(sceneId, products[i], gridPosition(i));
  }

  console.log(`\n✅ Scene ready!`);
  console.log(`   Open in RP1 browser: ${FABRIC_URL.replace('/fabric/fabric.msf', '')}`);
  console.log(`   Scene: "${STORE_NAME}"\n`);

  // Also export the scene as USD for DCC tool interop
  console.log('📐 Exporting scene as OpenUSD…');
  await exportSceneToUsd(products, gridPosition);
  console.log(`   USD files: ./usd-output/store_root.usda`);
  console.log(`   Live USD endpoint: http://localhost:${process.env.PORT ?? 3000}/usd/export\n`);
  console.log('   Import workflow:');
  console.log('     1. Open usd-output/store_root.usda in Blender / Houdini / Omniverse');
  console.log('     2. Reposition products, dress the store');
  console.log('     3. POST store_layout.usda to http://localhost:3000/usd/import');
  console.log('     4. Updated positions push back to RP1 fabric automatically\n');
}

buildScene().catch(err => {
  console.error('❌ Scene build failed:', err.message);
  process.exit(1);
});
