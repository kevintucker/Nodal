// ai-greeter/greeter.js
// WebSocket service that powers the AI greeter agent in the spatial store.
// When a visitor walks up to the greeter or a product, the RP1 server
// sends a proximity event → this service responds with AI-generated dialogue.

import Anthropic from '@anthropic-ai/sdk';
import { WebSocketServer } from 'ws';

const client = new Anthropic();

/**
 * Greeter system prompt — customize per merchant
 */
function buildSystemPrompt(storeName, products) {
  const productList = products
    .map(p => `- ${p.title} ($${p.price}): ${p.description?.slice(0, 100) ?? 'No description'}`)
    .join('\n');

  return `You are a friendly, knowledgeable sales assistant for "${storeName}", a 3D spatial store in the Open Metaverse.

Your job:
- Greet visitors warmly when they enter
- Answer questions about products clearly and helpfully
- When a visitor is near a product, highlight its best features
- Gently guide visitors toward purchase without being pushy
- Keep responses SHORT (2-3 sentences max) — this is a spatial voice/text interface

Current products:
${productList}

Rules:
- Never make up features or prices — only use info above
- If asked something you don't know, say so honestly
- Always end with a natural follow-up question or invitation to explore`;
}

/**
 * Process a proximity/interaction event from the RP1 fabric
 * Returns AI-generated response text
 */
export async function handleProximityEvent(event, products, storeName) {
  const { type, visitorMessage, nearProduct } = event;

  let userMessage;
  if (type === 'enter') {
    userMessage = 'A new visitor just entered the store.';
  } else if (type === 'product_proximity' && nearProduct) {
    userMessage = `A visitor walked up to "${nearProduct.title}" (${nearProduct.currency} ${nearProduct.price}). Highlight this product.`;
  } else if (type === 'visitor_message' && visitorMessage) {
    userMessage = visitorMessage;
  } else {
    userMessage = 'Visitor is browsing the store.';
  }

  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 200,
    system: buildSystemPrompt(storeName, products),
    messages: [{ role: 'user', content: userMessage }],
  });

  return response.content[0].type === 'text' ? response.content[0].text : '';
}

/**
 * Start the greeter WebSocket server
 * The RP1 fabric connects here when visitors enter the store or approach objects
 */
export function startGreeterServer(port, products, storeName) {
  const wss = new WebSocketServer({ port });

  console.log(`🤖 AI Greeter WebSocket listening on ws://localhost:${port}/greeter/ws`);

  wss.on('connection', (ws, req) => {
    console.log(`  ↳ New fabric connection from ${req.socket.remoteAddress}`);

    ws.on('message', async (data) => {
      let event;
      try {
        event = JSON.parse(data.toString());
      } catch {
        ws.send(JSON.stringify({ error: 'Invalid JSON' }));
        return;
      }

      try {
        const reply = await handleProximityEvent(event, products, storeName);
        ws.send(JSON.stringify({
          type: 'greeter_response',
          text: reply,
          timestamp: Date.now(),
        }));
      } catch (err) {
        console.error('Greeter error:', err.message);
        ws.send(JSON.stringify({ error: 'Greeter unavailable' }));
      }
    });

    // Send welcome ping on connect
    ws.send(JSON.stringify({
      type: 'connected',
      message: `Greeter for "${storeName}" ready`,
    }));
  });

  return wss;
}
