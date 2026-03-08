# 🛍️ Spatial Storefront — RP1 Hackathon Project

Turn any Shopify store into a self-hosted 3D spatial experience on the Open Metaverse (RP1).

## Architecture

```
Shopify API → scene-builder → RP1 Fabric (via ManifolderClient / MVMF)
                    ↓
             usd-map-service  ←→  Blender / Houdini / Omniverse / Unreal / Maya
                    ↓
         AI Greeter (NSO/WebSocket) + Stripe checkout
```

## USD Map Service

The `usd-map-service/` module adds a full OpenUSD round-trip to the store:

**Why USD?**
- Multiple team members can edit store layout simultaneously via USD sublayers
- Reusable product references: one `product_00.usda` file, referenced anywhere
- Artists dress and light the store in their preferred DCC tool, then publish back
- USD is already the de-facto intermediary between Blender, Houdini, Maya, Omniverse, Unreal, Cinema4D, and Apple Reality Composer
- Aligns with the OMB wiki guidance on USD as a future Map Service backend

**USD file structure:**
```
usd-output/
  store_root.usda          ← geo-anchored root stage (lat/lon → RP1 fabric)
  store_layout.usda        ← artist-editable layout sublayer
  products/
    product_00.usda        ← reusable product asset (independent USD file)
    product_01.usda
    ...
```

**USD HTTP endpoints:**
| Endpoint | Description |
|---|---|
| `GET /usd/export` | Download `store_root.usda` — open directly in any USD tool |
| `GET /usd/export/layout` | Download layout sublayer only |
| `GET /usd/export/products/:n` | Download individual product USD |
| `POST /usd/import` | Send modified `store_layout.usda`, push positions back to RP1 |
| `GET /usd/manifest` | JSON index of all available USD files |

**DCC workflow:**
```bash
# 1. Export current store to USD
curl http://localhost:3000/usd/export -o store_root.usda

# 2. Open in Blender (with USD plugin) or Omniverse, reposition products

# 3. Push layout changes back to RP1 fabric
curl -X POST http://localhost:3000/usd/import \
  --data-binary @store_layout.usda \
  -H "Content-Type: text/plain"
```

## Stack
- **RP1 / Open Metaverse Spatial Fabric** — 3D world hosting (MVMF protocol)
- **OpenUSD** — scene interchange for DCC tools (Blender, Houdini, Omniverse, Unreal)
- **ManifolderClient** — scene object manipulation on the RP1 fabric
- **Shopify Storefront API** — product catalog source
- **Claude API** — AI greeter agent
- **Stripe** — checkout
- **Node.js / Express** — NSO service layer

## Quick Start

```bash
cp .env.example .env
# Fill in SHOPIFY_STORE, SHOPIFY_TOKEN, ANTHROPIC_API_KEY, STRIPE_SECRET_KEY
# FABRIC_URL and FABRIC_ADMIN_KEY from signup.hackathon.rp1.dev
npm install
npm run build-scene   # Pull Shopify → build RP1 scene → export USD files
npm start             # Start NSO + greeter + USD map service
```

## File Structure
```
spatial-storefront/
  shopify/products.js          Shopify Storefront API → normalized products
  scene-builder/build.js       Build RP1 3D scene + export USD
  usd-map-service/index.js     OpenUSD export/import + HTTP endpoints
  ai-greeter/greeter.js        Claude-powered WebSocket greeter
  server/index.js              Main NSO Express server
  server/checkout.js           Stripe checkout sessions
  public/index.html            Hackathon demo dashboard
  usd-output/                  Generated USD files (git-ignored in production)
```

## Monetization
- **SaaS**: $99/mo per merchant for a hosted spatial storefront
- **Revenue share**: 1% of spatial checkout transactions
- **USD consulting**: help brands import their existing 3D product assets
- **White-label**: sell to Shopify agencies as a premium add-on
