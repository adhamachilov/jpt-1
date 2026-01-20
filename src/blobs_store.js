import { getStore } from '@netlify/blobs';

const DEFAULT_STATE = {
  approved_users: [],
  known_chats: [],
  preferred_primary_model: 'groq',
  usage: {
    total: { prompt: 0, completion: 0, total: 0 },
    by_day: {},
    by_model: {},
    by_user: {},
  },
};

function normalizeState(input) {
  const parsed = input && typeof input === 'object' ? input : {};
  return {
    approved_users: Array.isArray(parsed?.approved_users) ? parsed.approved_users : [],
    known_chats: Array.isArray(parsed?.known_chats) ? parsed.known_chats : [],
    preferred_primary_model: parsed?.preferred_primary_model === 'deepseek' ? 'deepseek' : 'groq',
    usage: {
      total: {
        prompt: Number(parsed?.usage?.total?.prompt || 0),
        completion: Number(parsed?.usage?.total?.completion || 0),
        total: Number(parsed?.usage?.total?.total || 0),
      },
      by_day: typeof parsed?.usage?.by_day === 'object' && parsed?.usage?.by_day ? parsed.usage.by_day : {},
      by_model:
        typeof parsed?.usage?.by_model === 'object' && parsed?.usage?.by_model ? parsed.usage.by_model : {},
      by_user:
        typeof parsed?.usage?.by_user === 'object' && parsed?.usage?.by_user ? parsed.usage.by_user : {},
    },
  };
}

export class BlobsStore {
  constructor({ storeName = 'studybot', key = 'state' } = {}) {
    this.storeName = storeName;
    this.key = key;
    this._store = null;
  }

  async init() {
    this._store = getStore(this.storeName);
    const existing = await this._store.get(this.key, { type: 'json' });
    if (existing === null) {
      await this._store.setJSON(this.key, DEFAULT_STATE);
    }
  }

  async read() {
    const data = await this._store.get(this.key, { type: 'json' });
    if (data === null) return normalizeState(DEFAULT_STATE);
    return normalizeState(data);
  }

  async write(state) {
    const safe = normalizeState(state);
    await this._store.setJSON(this.key, safe);
  }

  async isApproved(userId) {
    const state = await this.read();
    return state.approved_users.includes(userId);
  }

  async addApproved(userId) {
    const state = await this.read();
    if (!state.approved_users.includes(userId)) state.approved_users.push(userId);
    state.approved_users.sort((a, b) => a - b);
    await this.write(state);
    return state.approved_users;
  }

  async removeApproved(userId) {
    const state = await this.read();
    state.approved_users = state.approved_users.filter((id) => id !== userId);
    await this.write(state);
    return state.approved_users;
  }

  async listApproved() {
    const state = await this.read();
    return state.approved_users;
  }

  async recordChat(chatId) {
    const state = await this.read();
    if (!state.known_chats.includes(chatId)) state.known_chats.push(chatId);
    await this.write(state);
    return state.known_chats;
  }

  async listChats() {
    const state = await this.read();
    return state.known_chats;
  }

  async getPreferredPrimaryModel() {
    const state = await this.read();
    return state.preferred_primary_model;
  }

  async setPreferredPrimaryModel(value) {
    const state = await this.read();
    state.preferred_primary_model = value === 'deepseek' ? 'deepseek' : 'groq';
    await this.write(state);
    return state.preferred_primary_model;
  }

  async recordTokenUsage({ day, model, userId, promptTokens, completionTokens, totalTokens }) {
    const state = await this.read();

    const d = String(day);
    const m = String(model);
    const u = String(userId);

    const p = Number(promptTokens || 0);
    const c = Number(completionTokens || 0);
    const t = Number(totalTokens || 0);

    const bump = (obj) => {
      obj.prompt = Number(obj.prompt || 0) + p;
      obj.completion = Number(obj.completion || 0) + c;
      obj.total = Number(obj.total || 0) + t;
    };

    bump(state.usage.total);

    if (!state.usage.by_day[d]) state.usage.by_day[d] = { prompt: 0, completion: 0, total: 0 };
    bump(state.usage.by_day[d]);

    if (!state.usage.by_model[m]) state.usage.by_model[m] = { prompt: 0, completion: 0, total: 0 };
    bump(state.usage.by_model[m]);

    if (!state.usage.by_user[u]) state.usage.by_user[u] = { prompt: 0, completion: 0, total: 0 };
    bump(state.usage.by_user[u]);

    await this.write(state);
    return state.usage;
  }

  async getUsage() {
    const state = await this.read();
    return state.usage;
  }
}
