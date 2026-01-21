import path from 'node:path';
import { JsonStore } from './storage.js';
import { BlobsStore } from './blobs_store.js';

export async function createStoreFromEnv(env) {
  const isNetlify = Boolean(env.NETLIFY || env.NETLIFY_SITE_ID);
  if (isNetlify) {
    const store = new BlobsStore({ storeName: env.BLOBS_STORE_NAME || 'studybot', key: 'state' });
    await store.init();
    return store;
  }

  const storePath = env.STORE_PATH || path.join(process.cwd(), 'data', 'state.json');
  const store = new JsonStore(storePath);
  await store.init();
  return store;
}
