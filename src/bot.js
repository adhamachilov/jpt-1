import TelegramBot from 'node-telegram-bot-api';
import { normalizeNumericId } from './storage.js';
import { buildProvidersFromEnv, generateStudyReply } from './llm.js';
import { createStoreFromEnv } from './store_factory.js';

export async function createBot({ mode }) {
  const env = process.env;

  const BOT_TOKEN = env.TELEGRAM_BOT_TOKEN;
  if (!BOT_TOKEN) throw new Error('Missing TELEGRAM_BOT_TOKEN');

  const ADMIN_IDS = String(env.ADMIN_IDS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => normalizeNumericId(s))
    .filter((n) => n !== null);

  if (ADMIN_IDS.length === 0) throw new Error('Missing/invalid ADMIN_IDS');

  const store = await createStoreFromEnv(env);
  const providers = buildProvidersFromEnv(env);

  const bot =
    mode === 'polling'
      ? new TelegramBot(BOT_TOKEN, { polling: true })
      : new TelegramBot(BOT_TOKEN);

  const usage = {
    startedAt: Date.now(),
    messagesTotal: 0,
    aiRequestsTotal: 0,
    perUserAiRequests: new Map(),
    modelUsedCounts: { Groq: 0, DeepSeek: 0 },
  };

  const adminPending = new Map();

  function isAdmin(userId) {
    return ADMIN_IDS.includes(userId);
  }

  function sanitizeUserText(text) {
    const t = String(text || '').replace(/\u0000/g, '').trim();
    if (!t) return '';
    return t;
  }

  function trimToMaxChars(text, maxChars) {
    const t = String(text);
    if (t.length <= maxChars) return t;
    return t.slice(0, maxChars);
  }

  async function getStatus(userId) {
    const approved = (await store.isApproved(userId)) || isAdmin(userId);
    const role = isAdmin(userId) ? 'admin' : 'user';
    return { approved, role };
  }

  function todayKey() {
    return new Date().toISOString().slice(0, 10);
  }

  function formatStart({ userId, approved }) {
    return [
      '👋 Welcome to JPT Bot',
      '',
      `Your User ID: ${userId}`,
      '',
      `Status: ${approved ? '✅ Approved' : '❌ Not approved'}`,
      approved ? 'You can start chatting.' : 'Ask the admin to approve you.',
    ].join('\n');
  }

  function formatDenied(userId) {
    return ['❌ Access denied.', `Your User ID: ${userId}`, 'Ask the admin to approve you.'].join('\n');
  }

  function formatStatus({ userId, approved, role, modelHint }) {
    return [
      `Your User ID: ${userId}`,
      `Approval: ${approved ? '✅ Approved' : '❌ Not approved'}`,
      `Role: ${role}`,
      `Model: ${modelHint}`,
    ].join('\n');
  }

  function formatAdminHelp() {
    return [
      '🛠 Admin Panel',
      '',
      '/admin add <user_id>',
      '/admin remove <user_id>',
      '/admin list',
      '/admin stats',
      '/admin usage',
      '/admin broadcast <message>',
      '/admin switch_model',
    ].join('\n');
  }

  function formatUsageSummary(usageObj) {
    const usageState =
      usageObj || { total: { prompt: 0, completion: 0, total: 0 }, by_day: {}, by_model: {}, by_user: {} };
    const day = todayKey();
    const dayUsage = usageState.by_day?.[day] || { prompt: 0, completion: 0, total: 0 };

    const byModelLines = Object.entries(usageState.by_model || {})
      .sort((a, b) => (b[1]?.total || 0) - (a[1]?.total || 0))
      .slice(0, 5)
      .map(([k, v]) => `${k}: ${Number(v?.total || 0)}`);

    return [
      '🧾 Token Usage',
      '',
      `Today (${day}): ${Number(dayUsage.total || 0)} (p=${Number(dayUsage.prompt || 0)}, c=${Number(
        dayUsage.completion || 0,
      )})`,
      `Total: ${Number(usageState.total?.total || 0)} (p=${Number(usageState.total?.prompt || 0)}, c=${Number(
        usageState.total?.completion || 0,
      )})`,
      '',
      'By model (top):',
      ...(byModelLines.length ? byModelLines : ['(no data yet)']),
    ].join('\n');
  }

  async function sendAdminPanel(chatId) {
    const preferred = await store.getPreferredPrimaryModel();
    const text = ['🛠 Admin Panel', '', `Primary model: ${preferred === 'deepseek' ? 'DeepSeek' : 'Groq'}`].join('\n');

    await bot.sendMessage(chatId, text, {
      reply_markup: {
        inline_keyboard: [
          [
            { text: '✅ Approve user', callback_data: 'adm:approve' },
            { text: '🚫 Remove user', callback_data: 'adm:remove' },
          ],
          [
            { text: '📄 List users', callback_data: 'adm:list' },
            { text: '📊 Stats', callback_data: 'adm:stats' },
          ],
          [{ text: '🧾 Usage', callback_data: 'adm:usage' }],
          [
            { text: '📣 Broadcast', callback_data: 'adm:broadcast' },
            { text: '🔁 Switch model', callback_data: 'adm:model' },
          ],
          [{ text: '🔄 Refresh', callback_data: 'adm:refresh' }],
        ],
      },
    });
  }

  function parseAdminArgs(text) {
    const parts = String(text || '').trim().split(/\s+/);
    return {
      cmd: parts[1] || '',
      arg: parts[2] || '',
    };
  }

  async function onStart(msg) {
    const userId = msg.from?.id;
    if (!userId) return;

    const { approved } = await getStatus(userId);
    await bot.sendMessage(msg.chat.id, formatStart({ userId, approved }));
  }

  async function onStatus(msg) {
    const userId = msg.from?.id;
    if (!userId) return;

    const { approved, role } = await getStatus(userId);
    const preferred = await store.getPreferredPrimaryModel();
    const modelHint = `${preferred === 'deepseek' ? 'DeepSeek' : 'Groq'} (fallback enabled)`;
    await bot.sendMessage(msg.chat.id, formatStatus({ userId, approved, role, modelHint }));
  }

  async function onAdmin(msg) {
    const userId = msg.from?.id;
    if (!userId) return;

    if (!isAdmin(userId)) {
      await bot.sendMessage(msg.chat.id, '❌ Admin only.');
      return;
    }

    const { cmd, arg } = parseAdminArgs(msg.text);
    if (!cmd) {
      await sendAdminPanel(msg.chat.id);
      return;
    }

    if (cmd === 'add') {
      const target = normalizeNumericId(arg);
      if (!target) {
        await bot.sendMessage(msg.chat.id, 'Usage: /admin add <user_id>');
        return;
      }
      const list = await store.addApproved(target);
      await bot.sendMessage(msg.chat.id, `✅ Added ${target}. Approved users: ${list.length}`);
      return;
    }

    if (cmd === 'remove') {
      const target = normalizeNumericId(arg);
      if (!target) {
        await bot.sendMessage(msg.chat.id, 'Usage: /admin remove <user_id>');
        return;
      }
      const list = await store.removeApproved(target);
      await bot.sendMessage(msg.chat.id, `✅ Removed ${target}. Approved users: ${list.length}`);
      return;
    }

    if (cmd === 'list') {
      const list = await store.listApproved();
      const text = list.length ? ['✅ Approved users:', ...list.map((id) => String(id))].join('\n') : 'No approved users yet.';
      await bot.sendMessage(msg.chat.id, text);
      return;
    }

    if (cmd === 'stats') {
      const up = Math.floor((Date.now() - usage.startedAt) / 1000);
      const groqUsed = usage.modelUsedCounts.Groq;
      const deepUsed = usage.modelUsedCounts.DeepSeek;
      const preferred = await store.getPreferredPrimaryModel();
      const persistedUsage = await store.getUsage();
      const day = todayKey();
      const dayUsage = persistedUsage.by_day?.[day] || { total: 0 };
      await bot.sendMessage(
        msg.chat.id,
        [
          '📊 Stats',
          `Uptime: ${up}s`,
          `Messages: ${usage.messagesTotal}`,
          `AI requests: ${usage.aiRequestsTotal}`,
          `Model usage: Groq=${groqUsed}, DeepSeek=${deepUsed}`,
          `Primary model: ${preferred === 'deepseek' ? 'DeepSeek' : 'Groq'}`,
          `Tokens today: ${Number(dayUsage.total || 0)}`,
          `Tokens total: ${Number(persistedUsage.total?.total || 0)}`,
        ].join('\n'),
      );
      return;
    }

    if (cmd === 'usage') {
      const persistedUsage = await store.getUsage();
      await bot.sendMessage(msg.chat.id, formatUsageSummary(persistedUsage));
      return;
    }

    if (cmd === 'broadcast') {
      const message = String(msg.text || '').split(/\s+/).slice(2).join(' ').trim();
      if (!message) {
        await bot.sendMessage(msg.chat.id, 'Usage: /admin broadcast <message>');
        return;
      }
      const chats = await store.listChats();
      let ok = 0;
      let fail = 0;
      for (const chatId of chats) {
        try {
          await bot.sendMessage(chatId, `📣 Admin broadcast\n\n${message}`);
          ok += 1;
        } catch {
          fail += 1;
        }
      }
      await bot.sendMessage(msg.chat.id, `✅ Broadcast sent. ok=${ok}, fail=${fail}, chats=${chats.length}`);
      return;
    }

    if (cmd === 'switch_model') {
      const current = await store.getPreferredPrimaryModel();
      const next = current === 'deepseek' ? 'groq' : 'deepseek';
      await store.setPreferredPrimaryModel(next);
      await bot.sendMessage(msg.chat.id, `✅ Primary model set to ${next === 'deepseek' ? 'DeepSeek' : 'Groq'}`);
      return;
    }

    await bot.sendMessage(msg.chat.id, formatAdminHelp());
  }

  async function onCallbackQuery(q) {
    const userId = q.from?.id;
    const chatId = q.message?.chat?.id;
    const data = q.data;
    if (!userId || !chatId || !data) return;

    if (!isAdmin(userId)) {
      await bot.answerCallbackQuery(q.id, { text: 'Admin only.', show_alert: true });
      return;
    }

    const answer = async (text) => bot.answerCallbackQuery(q.id, { text });

    if (data === 'adm:refresh') {
      await answer('Refreshed');
      await sendAdminPanel(chatId);
      return;
    }

    if (data === 'adm:list') {
      await answer('Listing');
      const list = await store.listApproved();
      const text = list.length ? ['✅ Approved users:', ...list.map((id) => String(id))].join('\n') : 'No approved users yet.';
      await bot.sendMessage(chatId, text);
      return;
    }

    if (data === 'adm:stats') {
      await answer('Stats');
      const up = Math.floor((Date.now() - usage.startedAt) / 1000);
      const groqUsed = usage.modelUsedCounts.Groq;
      const deepUsed = usage.modelUsedCounts.DeepSeek;
      const preferred = await store.getPreferredPrimaryModel();
      const persistedUsage = await store.getUsage();
      const day = todayKey();
      const dayUsage = persistedUsage.by_day?.[day] || { total: 0 };
      await bot.sendMessage(
        chatId,
        [
          '📊 Stats',
          `Uptime: ${up}s`,
          `Messages: ${usage.messagesTotal}`,
          `AI requests: ${usage.aiRequestsTotal}`,
          `Model usage: Groq=${groqUsed}, DeepSeek=${deepUsed}`,
          `Primary model: ${preferred === 'deepseek' ? 'DeepSeek' : 'Groq'}`,
          `Tokens today: ${Number(dayUsage.total || 0)}`,
          `Tokens total: ${Number(persistedUsage.total?.total || 0)}`,
        ].join('\n'),
      );
      return;
    }

    if (data === 'adm:usage') {
      await answer('Usage');
      const persistedUsage = await store.getUsage();
      await bot.sendMessage(chatId, formatUsageSummary(persistedUsage));
      return;
    }

    if (data === 'adm:model') {
      const current = await store.getPreferredPrimaryModel();
      const next = current === 'deepseek' ? 'groq' : 'deepseek';
      await store.setPreferredPrimaryModel(next);
      await answer(`Primary: ${next === 'deepseek' ? 'DeepSeek' : 'Groq'}`);
      await sendAdminPanel(chatId);
      return;
    }

    if (data === 'adm:approve') {
      adminPending.set(userId, { type: 'approve' });
      await answer('Send user ID');
      await bot.sendMessage(chatId, 'Send the user ID to approve (just the number).');
      return;
    }

    if (data === 'adm:remove') {
      adminPending.set(userId, { type: 'remove' });
      await answer('Send user ID');
      await bot.sendMessage(chatId, 'Send the user ID to remove (just the number).');
      return;
    }

    if (data === 'adm:broadcast') {
      adminPending.set(userId, { type: 'broadcast' });
      await answer('Send message');
      await bot.sendMessage(chatId, 'Send the broadcast message text.');
      return;
    }

    await answer('Unknown action');
  }

  async function onMessage(msg) {
    const userId = msg.from?.id;
    if (!userId) return;

    if (msg.chat?.id) {
      await store.recordChat(msg.chat.id);
    }

    usage.messagesTotal += 1;

    if (msg.text && /^\//.test(msg.text.trim())) return;

    const text = sanitizeUserText(msg.text);
    if (!text) return;

    if (isAdmin(userId)) {
      const pending = adminPending.get(userId);
      if (pending?.type === 'approve') {
        const target = normalizeNumericId(text);
        if (!target) {
          await bot.sendMessage(msg.chat.id, 'Invalid user ID. Send a number.');
          return;
        }
        adminPending.delete(userId);
        const list = await store.addApproved(target);
        await bot.sendMessage(msg.chat.id, `✅ Added ${target}. Approved users: ${list.length}`);
        return;
      }

      if (pending?.type === 'remove') {
        const target = normalizeNumericId(text);
        if (!target) {
          await bot.sendMessage(msg.chat.id, 'Invalid user ID. Send a number.');
          return;
        }
        adminPending.delete(userId);
        const list = await store.removeApproved(target);
        await bot.sendMessage(msg.chat.id, `✅ Removed ${target}. Approved users: ${list.length}`);
        return;
      }

      if (pending?.type === 'broadcast') {
        const message = text;
        adminPending.delete(userId);
        const chats = await store.listChats();
        let ok = 0;
        let fail = 0;
        for (const chatId of chats) {
          try {
            await bot.sendMessage(chatId, `📣 Admin broadcast\n\n${message}`);
            ok += 1;
          } catch {
            fail += 1;
          }
        }
        await bot.sendMessage(msg.chat.id, `✅ Broadcast sent. ok=${ok}, fail=${fail}, chats=${chats.length}`);
        return;
      }
    }

    const { approved } = await getStatus(userId);
    if (!approved) {
      await bot.sendMessage(msg.chat.id, formatDenied(userId));
      return;
    }

    const maxChars = Number(env.MAX_INPUT_CHARS || 4000);
    const safeText = trimToMaxChars(text, maxChars);

    usage.aiRequestsTotal += 1;
    usage.perUserAiRequests.set(userId, (usage.perUserAiRequests.get(userId) || 0) + 1);

    try {
      const primary = await store.getPreferredPrimaryModel();
      const result = await generateStudyReply({
        message: safeText,
        groq: providers.groq,
        deepseek: providers.deepseek,
        primary,
        maxOutputTokens: providers.maxOutputTokens,
      });

      const modelKey = result.used;
      await store.recordTokenUsage({
        day: todayKey(),
        model: modelKey,
        userId,
        promptTokens: Number(result.promptTokens || 0),
        completionTokens: Number(result.completionTokens || 0),
        totalTokens: Number(result.totalTokens || 0),
      });

      usage.modelUsedCounts[result.used] += 1;

      const logLine = {
        ts: new Date().toISOString(),
        userId,
        used: result.used,
        fallbackFrom: result.fallbackFrom || null,
      };
      console.log(JSON.stringify(logLine));

      await bot.sendMessage(msg.chat.id, result.text);
    } catch (e) {
      console.error('LLM error', e);
      await bot.sendMessage(msg.chat.id, '⚠️ Something went wrong. Try again in a moment.');
    }
  }

  bot.onText(/^(\/start)(\s.*)?$/i, onStart);
  bot.onText(/^(\/status)(\s.*)?$/i, onStatus);
  bot.onText(/^(\/admin)(\s.*)?$/i, onAdmin);
  bot.on('callback_query', onCallbackQuery);
  bot.on('message', onMessage);

  async function handleUpdate(update) {
    if (!update || typeof update !== 'object') return;
    if (update.callback_query) {
      await onCallbackQuery(update.callback_query);
      return;
    }
    if (update.message) {
      const text = String(update.message.text || '').trim();
      if (/^\/start(\s|$)/i.test(text)) {
        await onStart(update.message);
        return;
      }
      if (/^\/status(\s|$)/i.test(text)) {
        await onStatus(update.message);
        return;
      }
      if (/^\/admin(\s|$)/i.test(text)) {
        await onAdmin(update.message);
        return;
      }

      await onMessage(update.message);
    }
  }

  return { bot, handleUpdate };
}
