import fs from 'node:fs/promises';
import path from 'node:path';

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

export function normalizeNumericId(value) {
  const n = Number(String(value).trim());
  if (!Number.isSafeInteger(n) || n <= 0) return null;
  return n;
}

export class JsonStore {
  constructor(filePath) {
    this.filePath = filePath;
  }

  async init() {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    try {
      await fs.access(this.filePath);
    } catch {
      await fs.writeFile(this.filePath, JSON.stringify(DEFAULT_STATE, null, 2));
    }
  }

  async read() {
    const raw = await fs.readFile(this.filePath, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      approved_users: Array.isArray(parsed?.approved_users) ? parsed.approved_users : [],
      known_chats: Array.isArray(parsed?.known_chats) ? parsed.known_chats : [],
      preferred_primary_model:
        parsed?.preferred_primary_model === 'deepseek' ? 'deepseek' : 'groq',
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

  async write(state) {
    const safe = {
      approved_users: Array.isArray(state?.approved_users) ? state.approved_users : [],
      known_chats: Array.isArray(state?.known_chats) ? state.known_chats : [],
      preferred_primary_model:
        state?.preferred_primary_model === 'deepseek' ? 'deepseek' : 'groq',
      usage: state?.usage || DEFAULT_STATE.usage,
    };
    await fs.writeFile(this.filePath, JSON.stringify(safe, null, 2));
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

    if (!state.usage) state.usage = JSON.parse(JSON.stringify(DEFAULT_STATE.usage));

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
