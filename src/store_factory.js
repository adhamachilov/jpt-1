import path from 'node:path';
import { JsonStore } from './storage.js';
import { BlobsStore } from './blobs_store.js';

export async function createStoreFromEnv(env) {
  const isNetlify = Boolean(
    env.NETLIFY ||
      env.NETLIFY_SITE_ID ||
      env.DEPLOY_URL ||
      env.URL ||
      env.AWS_LAMBDA_FUNCTION_NAME ||
      env.LAMBDA_TASK_ROOT,
  );

  if (isNetlify) {
    try {
      const store = new BlobsStore({ storeName: env.BLOBS_STORE_NAME || 'studybot', key: 'state' });
      await store.init();
      return store;
    } catch (e) {
      if (e?.name === 'MissingBlobsEnvironmentError') {
        console.warn('Netlify Blobs not configured; falling back to /tmp JsonStore');
      } else {
        console.error('BlobsStore init failed, falling back to /tmp JsonStore', e);
      }
      const storePath = env.STORE_PATH || path.join('/tmp', 'state.json');
      const store = new JsonStore(storePath);
      await store.init();
      return store;
    }
  }

  const storePath = env.STORE_PATH || path.join(process.cwd(), 'data', 'state.json');
  const store = new JsonStore(storePath);
  await store.init();
  return store;
}
