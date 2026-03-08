// shopify/products.js
// Fetches product catalog from Shopify Storefront API

import fetch from 'node-fetch';
import dotenv from 'dotenv';
dotenv.config();

const SHOPIFY_STOREFRONT_URL = `https://${process.env.SHOPIFY_STORE}/api/2024-01/graphql.json`;

const PRODUCTS_QUERY = `
  query GetProducts($first: Int!) {
    products(first: $first) {
      edges {
        node {
          id
          title
          description
          handle
          featuredImage {
            url
            altText
          }
          priceRange {
            minVariantPrice {
              amount
              currencyCode
            }
          }
          variants(first: 1) {
            edges {
              node {
                id
                title
                price {
                  amount
                  currencyCode
                }
              }
            }
          }
        }
      }
    }
  }
`;

/**
 * Fetch products from Shopify and normalize for scene building
 * @param {number} limit - max products to fetch
 * @returns {Array} normalized product list
 */
export async function fetchProducts(limit = 12) {
  const res = await fetch(SHOPIFY_STOREFRONT_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Storefront-Access-Token': process.env.SHOPIFY_STOREFRONT_TOKEN,
    },
    body: JSON.stringify({
      query: PRODUCTS_QUERY,
      variables: { first: limit },
    }),
  });

  if (!res.ok) {
    throw new Error(`Shopify API error: ${res.status} ${res.statusText}`);
  }

  const json = await res.json();

  if (json.errors) {
    throw new Error(`Shopify GraphQL errors: ${JSON.stringify(json.errors)}`);
  }

  return json.data.products.edges.map(({ node }) => ({
    id: node.id,
    title: node.title,
    description: node.description,
    handle: node.handle,
    imageUrl: node.featuredImage?.url ?? null,
    imageAlt: node.featuredImage?.altText ?? node.title,
    price: parseFloat(node.priceRange.minVariantPrice.amount),
    currency: node.priceRange.minVariantPrice.currencyCode,
    variantId: node.variants.edges[0]?.node.id ?? null,
  }));
}
