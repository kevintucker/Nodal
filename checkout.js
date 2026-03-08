// server/checkout.js
// Handles Stripe checkout initiated from the spatial store.
// When a visitor "picks up" (interacts with) a product in the RP1 browser,
// the fabric sends a purchase intent event → we create a Stripe session.

import Stripe from 'stripe';
import dotenv from 'dotenv';
dotenv.config();

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

/**
 * Create a Stripe Checkout Session for a spatial product purchase.
 * The RP1 browser will open this URL in a panel overlay.
 *
 * @param {object} product - normalized Shopify product
 * @param {string} visitorId - RP1 visitor session ID (for tracking)
 * @returns {string} Stripe checkout URL
 */
export async function createCheckoutSession(product, visitorId) {
  const session = await stripe.checkout.sessions.create({
    payment_method_types: ['card'],
    line_items: [
      {
        price_data: {
          currency: product.currency.toLowerCase(),
          product_data: {
            name: product.title,
            description: product.description?.slice(0, 255),
            images: product.imageUrl ? [product.imageUrl] : [],
            metadata: {
              shopify_product_id: product.id,
              shopify_variant_id: product.variantId,
            },
          },
          unit_amount: Math.round(product.price * 100), // Stripe uses cents
        },
        quantity: 1,
      },
    ],
    mode: 'payment',
    success_url: `${process.env.BASE_URL ?? 'http://localhost:3000'}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url:  `${process.env.BASE_URL ?? 'http://localhost:3000'}/checkout/cancelled`,
    metadata: {
      visitor_id: visitorId,
      store: process.env.STORE_NAME,
      source: 'spatial_storefront',
    },
  });

  return session.url;
}

/**
 * Handle Stripe webhook — called after successful payment.
 * In production, you'd forward this to Shopify to create the actual order.
 */
export async function handleWebhook(rawBody, signature) {
  let event;
  try {
    event = stripe.webhooks.constructEvent(
      rawBody,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    throw new Error(`Webhook signature verification failed: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    console.log(`✅ Payment received for visitor ${session.metadata.visitor_id}`);
    console.log(`   Amount: ${session.amount_total / 100} ${session.currency.toUpperCase()}`);
    // TODO: create Shopify order via Admin API using session.metadata.shopify_variant_id
  }

  return event;
}
