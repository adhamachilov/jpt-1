import 'dotenv/config';
import { createBot } from './bot.js';

await createBot({ mode: 'polling' });
console.log('StudyBot is running (polling).');
