import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JsonStore } from './storage.js';
import { BlobsStore } from './blobs_store.js';

export async function createStoreFromEnv(env) {
  const isNetlify = Boolean(env.NETLIFY);
  if (isNetlify) {
    const store = new BlobsStore({ storeName: env.BLOBS_STORE_NAME || 'studybot', key: 'state' });
    await store.init();
    return store;
  }

  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const storePath = env.STORE_PATH || path.join(__dirname, '..', 'data', 'state.json');
  const store = new JsonStore(storePath);
  await store.init();
  return store;
}
