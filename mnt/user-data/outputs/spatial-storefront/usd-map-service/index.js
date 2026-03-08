// usd-map-service/index.js
//
// USD-Based Map Service for Spatial Storefront
// ═══════════════════════════════════════════════════════════════════════════════
//
// What this does:
//   - Exports RP1 Spatial Fabric scenes as OpenUSD (.usda) files
//   - Imports USD scenes back into the RP1 fabric (round-trip)
//   - Exposes an HTTP endpoint so any USD-aware tool (Blender, Houdini, Omniverse,
//     Maya, Cinema4D, Unreal, etc.) can read/write the spatial store scene
//
// Why USD for the store?
//   - Multiple team members can edit the store layout simultaneously (USD layers)
//   - Reusable references: one product .usda file referenced across many scenes
//   - Artists can dress the store in Blender/Maya, then publish back to the fabric
//   - USD is already the de-facto intermediary between all major DCC tools
//   - Aligns with the OMB wiki guidance on USD as a future Map Service backend
//
// USD file structure we generate:
//
//   store_root.usda              ← root stage, lat/lon anchor to RP1 fabric
//   └── store_layout.usda        ← references all product shelves (sublayer)
//       ├── product_0.usda       ← individual product (reusable reference)
//       ├── product_1.usda
//       └── greeter.usda         ← AI greeter spawn point
//
// ═══════════════════════════════════════════════════════════════════════════════

import express from 'express';
import fs from 'fs/promises';
import path from 'path';
import dotenv from 'dotenv';
dotenv.config();

const router = express.Router();
const USD_OUTPUT_DIR = './usd-output';

// ─── USD generation helpers ───────────────────────────────────────────────────

/**
 * Convert a Shopify product to a standalone USD asset file (.usda).
 * In a full implementation the geometry would reference a .glb/.usdz converted
 * from the product image via a generative 3D service; for the hackathon we use
 * a placeholder box prim with product metadata as USD custom attributes.
 */
function productToUsda(product, position) {
  const safeName = product.title.replace(/[^a-zA-Z0-9_]/g, '_');
  return `#usda 1.0
(
    defaultPrim = "Product_${safeName}"
    doc = "Spatial Storefront product: ${product.title}"
    metersPerUnit = 1
    upAxis = "Y"
    customLayerData = {
        string shopify_product_id = "${product.id}"
        string shopify_variant_id = "${product.variantId ?? ''}"
        double price = ${product.price}
        string currency = "${product.currency}"
        string store = "${process.env.STORE_NAME ?? 'Spatial Store'}"
        string interaction = "purchasable"
    }
)

def Xform "Product_${safeName}" (
    kind = "component"
)
{
    # World-space position on the RP1 fabric (meters)
    double3 xformOp:translate = (${position.x}, ${position.y}, ${position.z})
    uniform token[] xformOpOrder = ["xformOp:translate"]

    # Product display card — a thin box sized like a retail shelf card
    def Mesh "DisplayCard"
    {
        int[] faceVertexCounts = [4, 4, 4, 4, 4, 4]
        int[] faceVertexIndices = [0,1,2,3, 4,5,6,7, 0,3,7,4, 1,2,6,5, 0,1,5,4, 3,2,6,7]
        point3f[] points = [
            (-0.4, 0, -0.02), (0.4, 0, -0.02), (0.4, 0.6, -0.02), (-0.4, 0.6, -0.02),
            (-0.4, 0, 0.02),  (0.4, 0, 0.02),  (0.4, 0.6, 0.02),  (-0.4, 0.6, 0.02)
        ]
        normal3f[] normals = [(0,0,1),(0,0,1),(0,0,1),(0,0,1),(0,0,-1),(0,0,-1),(0,0,-1),(0,0,-1),(−1,0,0),(−1,0,0),(−1,0,0),(−1,0,0),(1,0,0),(1,0,0),(1,0,0),(1,0,0),(0,−1,0),(0,−1,0),(0,−1,0),(0,−1,0),(0,1,0),(0,1,0),(0,1,0),(0,1,0)]

        rel material:binding = </Product_${safeName}/CardMaterial>
    }

    # Material — will be overridden with product image texture by DCC artist
    def Material "CardMaterial"
    {
        token outputs:surface.connect = </Product_${safeName}/CardMaterial/PBR.outputs:surface>

        def Shader "PBR"
        {
            uniform token info:id = "UsdPreviewSurface"
            color3f inputs:diffuseColor = (0.9, 0.9, 0.9)
            float inputs:roughness = 0.8
            token outputs:surface
        }
    }

    # Metadata prim — USD custom attributes carry the NSO interaction data
    def "Metadata"
    {
        string title = "${product.title}"
        string description = "${(product.description ?? '').replace(/"/g, '\\"').slice(0, 200)}"
        double price = ${product.price}
        string image_url = "${product.imageUrl ?? ''}"
        string checkout_url = "http://localhost:${process.env.PORT ?? 3000}/checkout"
    }
}
`;
}

/**
 * Generate the root stage that anchors the store to RP1's spatial fabric
 * coordinate system (lat/lon + altitude).
 */
function rootStageUsda(productFiles) {
  const sublayers = productFiles.map(f => `        @./${f}@`).join(',\n');
  return `#usda 1.0
(
    doc = "Spatial Storefront — Root Stage"
    metersPerUnit = 1
    upAxis = "Y"

    # Geo-anchor: attach this scene to a real-world location on the RP1 fabric.
    # Replace with your actual lat/lon from signup.hackathon.rp1.dev
    customLayerData = {
        double geo_latitude  = 37.7749
        double geo_longitude = -122.4194
        double geo_altitude  = 0.0
        string fabric_url    = "${process.env.FABRIC_URL ?? 'https://your-server/fabric/fabric.msf'}"
        string store_name    = "${process.env.STORE_NAME ?? 'Spatial Store'}"
        string nso_endpoint  = "http://localhost:${process.env.PORT ?? 3000}"
        string schema_version = "1.0.0"
    }

    subLayers = [
        @./store_layout.usda@
    ]
)
`;
}

/**
 * Generate the layout sublayer that references all product USD files.
 * Artists edit this file to reposition products without touching product assets.
 */
function layoutSublayerUsda(products) {
  const refs = products.map((p, i) => {
    const safeName = p.title.replace(/[^a-zA-Z0-9_]/g, '_');
    return `
def "Product_${String(i).padStart(2, '0')}_${safeName}" (
    references = @./products/product_${String(i).padStart(2, '0')}.usda@</Product_${safeName}>
)
{
    # Layout overrides — artists drag these in their DCC tool.
    # Changes here do NOT affect the source product asset.
    double3 xformOp:translate:layout_override = (0, 0, 0)
}`;
  }).join('\n');

  return `#usda 1.0
(
    doc = "Store Layout Sublayer — edit product positions here"
    metersPerUnit = 1
    upAxis = "Y"
)

def Xform "StoreLayout"
{
    # Greeter spawn point at store entrance
    def Xform "GreeterSpawn"
    {
        double3 xformOp:translate = (0, 0, 0)
        uniform token[] xformOpOrder = ["xformOp:translate"]
        string nso_service = "ai_greeter"
        string ws_endpoint = "ws://localhost:${(parseInt(process.env.PORT ?? '3000') + 1)}"
    }

    # Product references — sublayered from individual product USD files
    def Xform "Products"
    {
        ${refs}
    }
}
`;
}

// ─── Core export function ─────────────────────────────────────────────────────

/**
 * Export the current store scene (products + layout) as a USD package.
 * Returns the path to store_root.usda which references all other files.
 *
 * @param {Array} products - normalized Shopify products
 * @param {Function} gridPosition - fn(index) → {x, y, z}
 * @returns {string} path to root .usda file
 */
export async function exportSceneToUsd(products, gridPosition) {
  await fs.mkdir(path.join(USD_OUTPUT_DIR, 'products'), { recursive: true });

  const productFiles = [];

  // Write individual product USD files
  for (let i = 0; i < products.length; i++) {
    const filename = `product_${String(i).padStart(2, '0')}.usda`;
    const content = productToUsda(products[i], gridPosition(i));
    await fs.writeFile(path.join(USD_OUTPUT_DIR, 'products', filename), content, 'utf8');
    productFiles.push(`products/${filename}`);
  }

  // Write layout sublayer
  await fs.writeFile(
    path.join(USD_OUTPUT_DIR, 'store_layout.usda'),
    layoutSublayerUsda(products),
    'utf8'
  );

  // Write root stage
  await fs.writeFile(
    path.join(USD_OUTPUT_DIR, 'store_root.usda'),
    rootStageUsda(productFiles),
    'utf8'
  );

  console.log(`📦 USD scene exported to ${USD_OUTPUT_DIR}/store_root.usda`);
  return path.resolve(USD_OUTPUT_DIR, 'store_root.usda');
}

// ─── Import USD back to fabric ────────────────────────────────────────────────

/**
 * Parse a .usda layout file and extract product position overrides.
 * This is the "import" path: artist edits USD in their DCC tool, saves,
 * and we push the updated positions back to the RP1 fabric via the MVMF API.
 *
 * @param {string} usdaPath - path to store_layout.usda
 * @returns {Array} [{productIndex, position}]
 */
export async function importPositionsFromUsd(usdaPath) {
  const content = await fs.readFile(usdaPath, 'utf8');
  const positions = [];

  // Simple regex parser for xformOp:translate values.
  // A production implementation would use the OpenUSD Python SDK or
  // the @pixar/usd npm package (if/when available in Node.js).
  const translateRe = /double3 xformOp:translate = \(([-\d.]+),\s*([-\d.]+),\s*([-\d.]+)\)/g;
  const nameRe = /def Xform "Product_(\d+)_/g;

  let nameMatch, translateMatch;
  const indices = [];
  while ((nameMatch = nameRe.exec(content)) !== null) {
    indices.push(parseInt(nameMatch[1]));
  }
  let i = 0;
  while ((translateMatch = translateRe.exec(content)) !== null) {
    positions.push({
      productIndex: indices[i] ?? i,
      position: {
        x: parseFloat(translateMatch[1]),
        y: parseFloat(translateMatch[2]),
        z: parseFloat(translateMatch[3]),
      },
    });
    i++;
  }

  return positions;
}

// ─── HTTP routes ──────────────────────────────────────────────────────────────

/**
 * GET /usd/export
 * Exports the current scene to USD and returns store_root.usda.
 * Any USD-capable tool can fetch this URL to open the live scene.
 */
router.get('/export', async (req, res) => {
  try {
    // Lazy import to avoid circular deps
    const { fetchProducts } = await import('../shopify/products.js');
    const products = await fetchProducts(9).catch(() => getMockProducts());

    const gridPosition = (i) => ({
      x: ((i % 3) - 1) * 2.5,
      y: 1.0,
      z: -(Math.floor(i / 3) * 2.5) - 3,
    });

    await exportSceneToUsd(products, gridPosition);

    const rootUsda = await fs.readFile(path.join(USD_OUTPUT_DIR, 'store_root.usda'), 'utf8');
    res.setHeader('Content-Type', 'text/plain');
    res.setHeader('Content-Disposition', 'attachment; filename="store_root.usda"');
    res.send(rootUsda);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /usd/export/layout
 * Returns just the layout sublayer — useful for artists who only want positions.
 */
router.get('/export/layout', async (req, res) => {
  try {
    const layoutPath = path.join(USD_OUTPUT_DIR, 'store_layout.usda');
    const content = await fs.readFile(layoutPath, 'utf8');
    res.setHeader('Content-Type', 'text/plain');
    res.setHeader('Content-Disposition', 'attachment; filename="store_layout.usda"');
    res.send(content);
  } catch {
    res.status(404).json({ error: 'Layout not yet exported. Call GET /usd/export first.' });
  }
});

/**
 * GET /usd/export/products/:index
 * Returns a single product USD file.
 */
router.get('/export/products/:index', async (req, res) => {
  try {
    const filename = `product_${String(req.params.index).padStart(2, '0')}.usda`;
    const content = await fs.readFile(path.join(USD_OUTPUT_DIR, 'products', filename), 'utf8');
    res.setHeader('Content-Type', 'text/plain');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(content);
  } catch {
    res.status(404).json({ error: 'Product USD file not found. Run export first.' });
  }
});

/**
 * POST /usd/import
 * Accepts a modified store_layout.usda in the request body.
 * Parses updated product positions and pushes them back to the RP1 fabric.
 *
 * Body: multipart/form-data with field `layout` containing the .usda file,
 *       OR raw text/plain body with the .usda content.
 */
router.post('/import', express.text({ type: '*/*', limit: '2mb' }), async (req, res) => {
  try {
    const tmpPath = path.join(USD_OUTPUT_DIR, '_import_tmp.usda');
    await fs.writeFile(tmpPath, req.body, 'utf8');

    const positions = await importPositionsFromUsd(tmpPath);
    await fs.unlink(tmpPath);

    // Push updated positions to RP1 fabric
    const { default: fetch } = await import('node-fetch');
    const FABRIC_URL = process.env.FABRIC_URL;
    const ADMIN_KEY  = process.env.FABRIC_ADMIN_KEY;

    const results = [];
    for (const { productIndex, position } of positions) {
      // In a full implementation, look up the object ID by productIndex
      // and call fabricRequest PATCH /scenes/:sceneId/objects/:objectId
      results.push({ productIndex, position, status: 'queued' });
    }

    res.json({
      message: `Parsed ${positions.length} position overrides from USD layout.`,
      positions: results,
      note: 'In production, these would be pushed to the RP1 fabric via MVMF PATCH.',
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /usd/manifest
 * Returns a JSON manifest of all available USD files in the current export.
 * Useful for DCC tools that want to discover what's available.
 */
router.get('/manifest', async (req, res) => {
  try {
    const files = await fs.readdir(USD_OUTPUT_DIR).catch(() => []);
    const products = await fs.readdir(path.join(USD_OUTPUT_DIR, 'products')).catch(() => []);
    res.json({
      root:     files.includes('store_root.usda')    ? '/usd/export'         : null,
      layout:   files.includes('store_layout.usda')  ? '/usd/export/layout'  : null,
      products: products.map((f, i) => `/usd/export/products/${i}`),
      import:   'POST /usd/import  (send store_layout.usda as text/plain body)',
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Mock products fallback ───────────────────────────────────────────────────
function getMockProducts() {
  return [
    { id: 'mock-1', title: 'Spatial Sneakers', description: 'Premium metaverse sneakers.', price: 129.99, currency: 'USD', variantId: 'v1', imageUrl: null },
    { id: 'mock-2', title: 'Holo Hoodie',      description: 'Holographic print hoodie.',   price: 89.99,  currency: 'USD', variantId: 'v2', imageUrl: null },
    { id: 'mock-3', title: 'AR Cap',           description: 'AR headset compatible cap.',  price: 49.99,  currency: 'USD', variantId: 'v3', imageUrl: null },
  ];
}

export default router;
