import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const CACHE_DIR = path.join(REPO_ROOT, '.autumn-cache');
export const INDEX_FILE = path.join(CACHE_DIR, 'inventory-index.json');

const EXCLUDED_DIRS = new Set([
  '.git', '.autumn-cache', 'node_modules', 'output', 'tmp', 'audio_script',
  'data', 'public', 'src', 'test'
]);
const EXCLUDED_FILES = new Set([
  'AUTUMN_AI.md', 'Matromia_Audio_Instructions.txt', 'README.md'
]);
const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'been', 'but', 'by', 'for', 'from',
  'had', 'has', 'have', 'he', 'her', 'hers', 'him', 'his', 'i', 'in', 'is', 'it',
  'its', 'me', 'my', 'of', 'on', 'or', 'our', 'she', 'that', 'the', 'their',
  'them', 'they', 'this', 'to', 'was', 'we', 'were', 'what', 'when', 'where',
  'which', 'who', 'will', 'with', 'you', 'your'
]);

export function tokenize(value) {
  return [...new Set(
    String(value)
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^\p{L}\p{N}'-]+/gu, ' ')
      .split(/\s+/)
      .map((word) => word.replace(/^[-']+|[-']+$/g, ''))
      .filter((word) => word.length > 1 && !STOP_WORDS.has(word))
  )];
}

function sourceAuthority(relativePath) {
  const lower = relativePath.toLowerCase().replaceAll('\\', '/');
  if (lower === 'rules.txt') return { rank: 1, tier: 'current rules' };
  if (lower.includes('allsesh recap') || lower.includes('sesh recap')) {
    return { rank: 2, tier: 'session recap' };
  }
  if (lower.includes('cram_guide') || lower.includes('overview')) {
    return { rank: 2, tier: 'curated current guide' };
  }
  if (/(casper|oshi|ashrek|kohanykil|blyss|thaumiel|sonaht)/.test(lower)) {
    return { rank: 3, tier: 'player-authored character record' };
  }
  if (lower.includes('gazetteer') || lower.includes('profiles') || lower.includes('lookup_index')) {
    return { rank: 4, tier: 'curated reference' };
  }
  if (lower.includes('news')) return { rank: 5, tier: 'in-world news' };
  return { rank: 6, tier: 'archive or speculative notes' };
}

export function chunkText(text, relativePath, maxChars = 1400) {
  const clean = String(text).replaceAll('\0', '').replace(/\r\n/g, '\n');
  const lines = clean.split('\n');
  const sections = [];
  let heading = path.basename(relativePath);
  let buffer = [];

  const flush = () => {
    const sectionText = buffer.join('\n').trim();
    if (!sectionText) return;
    const paragraphs = sectionText.split(/\n{2,}/).map((part) => part.trim()).filter(Boolean);
    let chunk = '';
    for (const paragraph of paragraphs) {
      if (chunk && chunk.length + paragraph.length + 2 > maxChars) {
        sections.push({ section: heading, text: chunk });
        chunk = '';
      }
      if (paragraph.length > maxChars) {
        if (chunk) sections.push({ section: heading, text: chunk });
        for (let start = 0; start < paragraph.length; start += maxChars) {
          sections.push({ section: heading, text: paragraph.slice(start, start + maxChars) });
        }
      } else {
        chunk += `${chunk ? '\n\n' : ''}${paragraph}`;
      }
    }
    if (chunk) sections.push({ section: heading, text: chunk });
  };

  for (const line of lines) {
    const match = line.match(/^#{1,6}\s+(.+?)\s*$/);
    if (match) {
      flush();
      buffer = [];
      heading = match[1].trim();
    } else {
      buffer.push(line);
    }
  }
  flush();
  return sections;
}

async function walk(directory, root, output) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith('.') && entry.name !== '.') {
      if (entry.isDirectory() || entry.name !== '.keep') continue;
    }
    const absolute = path.join(directory, entry.name);
    const relative = path.relative(root, absolute).replaceAll('\\', '/');
    if (entry.isDirectory()) {
      if (!EXCLUDED_DIRS.has(entry.name)) await walk(absolute, root, output);
      continue;
    }
    if (!/\.(md|txt)$/i.test(entry.name) || EXCLUDED_FILES.has(entry.name)) continue;
    output.push({ absolute, relative });
  }
}

export async function buildInventory({ root = REPO_ROOT, cacheFile = INDEX_FILE } = {}) {
  const files = [];
  await walk(root, root, files);
  const entries = [];
  for (const file of files.sort((a, b) => a.relative.localeCompare(b.relative))) {
    const text = await fs.readFile(file.absolute, 'utf8');
    const authority = sourceAuthority(file.relative);
    const chunks = chunkText(text, file.relative);
    chunks.forEach((chunk, ordinal) => {
      const identity = `${file.relative}|${chunk.section}|${ordinal}`;
      entries.push({
        id: createHash('sha256').update(identity).digest('hex').slice(0, 18),
        path: file.relative,
        section: chunk.section,
        text: chunk.text,
        keywords: tokenize(`${file.relative} ${chunk.section} ${chunk.text}`),
        sourceRank: authority.rank,
        sourceTier: authority.tier
      });
    });
  }
  const inventory = {
    version: 1,
    generatedAt: new Date().toISOString(),
    fileCount: files.length,
    entryCount: entries.length,
    entries
  };
  await fs.mkdir(path.dirname(cacheFile), { recursive: true });
  await fs.writeFile(cacheFile, `${JSON.stringify(inventory)}\n`, 'utf8');
  return inventory;
}

export function searchInventory(inventory, query, limit = 8) {
  const phrase = String(query).trim().toLowerCase();
  const terms = tokenize(phrase);
  if (!phrase || !terms.length) return [];
  return inventory.entries
    .map((entry) => {
      const haystack = `${entry.path} ${entry.section} ${entry.text}`.toLowerCase();
      const keywordSet = new Set(entry.keywords);
      let score = 0;
      for (const term of terms) {
        if (keywordSet.has(term)) score += 4;
        if (entry.path.toLowerCase().includes(term)) score += 5;
        if (entry.section.toLowerCase().includes(term)) score += 6;
        const matches = haystack.split(term).length - 1;
        score += Math.min(matches, 4);
      }
      if (phrase.length > 3 && haystack.includes(phrase)) score += 18;
      score += Math.max(0, 7 - entry.sourceRank) * 0.2;
      return { ...entry, score: Number(score.toFixed(2)) };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.sourceRank - b.sourceRank)
    .slice(0, Math.max(1, Math.min(Number(limit) || 8, 20)))
    .map(({ keywords, ...entry }) => ({ ...entry, text: entry.text.slice(0, 1100) }));
}
