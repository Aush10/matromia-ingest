import path from 'node:path';
import { mutateJson, readJson } from './store.mjs';

const OPINIONS_FALLBACK = {
  version: 1,
  description: 'Listener-owned runtime state.',
  globalMood: 0,
  people: {},
  subjects: {}
};
const IGNORE_REPLIES = ['k', 'whatever', 'error 407 no point of conversation'];
const NAP_MESSAGE = '*yaaawn* Okay, my tails are officially out of stories. I’m stretching, curling up, and closing this conversation now—nap time. Wake me when the boss says “wakeup autumn.”';

export function approximateTokens(value) {
  return Math.max(1, Math.ceil(String(value ?? '').length / 4));
}

function personState(data, userId) {
  data.people ??= {};
  data.people[userId] ??= {
    mood: 0,
    mode: 'active',
    rejectionCount: 0,
    ignoreReplies: 0,
    usedTokens: 0,
    yawned: false,
    authoritySeen: false,
    updatedAt: null
  };
  return data.people[userId];
}

function moodDelta(message) {
  const lower = message.toLowerCase();
  let delta = 0;
  if (/\b(thank|please|friend|love|great|nice|hello|hi|hey)\b/.test(lower)) delta += 1;
  if (/\b(stupid|shut up|hate|idiot|useless)\b/.test(lower)) delta -= 2;
  return delta;
}

export class AutumnListeners {
  constructor(dataDirectory, tokenBudget = 2400) {
    this.opinionsFile = path.join(dataDirectory, 'opinions.json');
    this.tokenBudget = Math.max(800, Number(tokenBudget) || 2400);
  }

  async begin(userId, message, isAuthor) {
    return mutateJson(this.opinionsFile, OPINIONS_FALLBACK, (data) => {
      const person = personState(data, userId);
      person.updatedAt = new Date().toISOString();
      person.authoritySeen = Boolean(isAuthor);
      const wakeCommand = /^wakeup autumn[.!?\s]*$/i.test(message.trim());

      if (person.mode === 'asleep') {
        if (isAuthor && wakeCommand) {
          Object.assign(person, {
            mode: 'active', rejectionCount: 0, ignoreReplies: 0,
            usedTokens: 0, yawned: false, mood: Math.max(person.mood, 1)
          });
          return { proceed: false, reply: 'Mmmrrh—ears up! I’m awake, boss! Did the world behave while I was napping? :)', woke: true };
        }
        return { proceed: false, noReply: true, asleep: true };
      }

      if (person.mode === 'ignored') {
        if (isAuthor) {
          Object.assign(person, { mode: 'active', rejectionCount: 0, ignoreReplies: 0 });
        } else {
          person.ignoreReplies += 1;
          if (person.ignoreReplies <= 3) {
            return { proceed: false, reply: IGNORE_REPLIES[(person.ignoreReplies - 1) % IGNORE_REPLIES.length], ignored: true };
          }
          return { proceed: false, noReply: true, ignored: true };
        }
      }

      const projected = person.usedTokens + approximateTokens(message);
      if (projected >= this.tokenBudget) {
        person.mode = 'asleep';
        person.usedTokens = this.tokenBudget;
        return { proceed: false, reply: NAP_MESSAGE, asleep: true };
      }

      const delta = moodDelta(message);
      person.mood = Math.max(-10, Math.min(10, person.mood + delta));
      data.globalMood = Math.max(-25, Math.min(25, Number(data.globalMood || 0) + delta));
      const shouldYawn = projected >= this.tokenBudget * 0.8 && !person.yawned;
      if (shouldYawn) person.yawned = true;
      return { proceed: true, shouldYawn, mood: person.mood, remainingTokens: this.tokenBudget - projected };
    });
  }

  async finish(userId, message, visibleReply, { rejected = false, shouldYawn = false } = {}) {
    return mutateJson(this.opinionsFile, OPINIONS_FALLBACK, (data) => {
      const person = personState(data, userId);
      person.usedTokens += approximateTokens(message) + approximateTokens(visibleReply);
      person.updatedAt = new Date().toISOString();
      if (rejected) {
        person.rejectionCount += 1;
        person.mood = Math.max(-10, person.mood - 1);
      } else {
        person.rejectionCount = 0;
      }

      if (person.rejectionCount >= 4) {
        person.mode = 'ignored';
        person.ignoreReplies = 1;
        return { reply: IGNORE_REPLIES[0], ignored: true, remainingTokens: Math.max(0, this.tokenBudget - person.usedTokens) };
      }
      if (person.usedTokens >= this.tokenBudget) {
        person.mode = 'asleep';
        return { reply: NAP_MESSAGE, asleep: true, remainingTokens: 0 };
      }
      const prefix = shouldYawn ? '*little yawn, ears flicking* Sorry—long day. ' : '';
      return {
        reply: `${prefix}${visibleReply}`,
        remainingTokens: Math.max(0, this.tokenBudget - person.usedTokens),
        mood: person.mood
      };
    });
  }

  async context(userId) {
    const data = await readJson(this.opinionsFile, OPINIONS_FALLBACK);
    const person = data.people?.[userId] ?? { mood: 0, usedTokens: 0, mode: 'active' };
    const flavor = person.mood >= 5 ? 'delighted and openly affectionate'
      : person.mood >= 1 ? 'bright and friendly'
        : person.mood <= -5 ? 'bristly, guarded, and easily annoyed'
          : person.mood <= -1 ? 'a little wary but still sociable'
            : 'curious and easygoing';
    return { ...person, flavor, remainingTokens: Math.max(0, this.tokenBudget - Number(person.usedTokens || 0)) };
  }
}
