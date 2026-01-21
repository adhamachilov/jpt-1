import { createBot } from '../../src/bot.js';

let singleton;

async function getApp() {
  if (!singleton) {
    singleton = await createBot({ mode: 'webhook' });
  }
  return singleton;
}

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (secret) {
    const headerSecret = event.headers?.['x-telegram-bot-api-secret-token'] || event.headers?.['X-Telegram-Bot-Api-Secret-Token'];
    if (headerSecret !== secret) {
      return { statusCode: 401, body: 'Unauthorized' };
    }
  }

  let update;
  try {
    update = event.body ? JSON.parse(event.body) : null;
  } catch {
    return { statusCode: 400, body: 'Invalid JSON' };
  }

  if (!update) return { statusCode: 200, body: 'OK' };

  try {
    const app = await getApp();
    await app.handleUpdate(update);
    return { statusCode: 200, body: 'OK' };
  } catch (e) {
    console.error('webhook error', e);
    return { statusCode: 500, body: 'Error' };
  }
};
