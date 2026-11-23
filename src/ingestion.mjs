import { promises as fs } from 'node:fs';
import path from 'node:path';

const BLOCKED_DIRECTORIES = new Set([
  '.git', '.autumn-cache', 'node_modules', 'src', 'public', 'test', 'data', 'output', 'tmp'
]);
const BLOCKED_FILES = new Set(['AUTUMN_AI.md', '.env', '.env.example', 'package.json']);

function normalizeHeading(value) {
  return String(value).trim().replace(/^#+\s*/, '').toLowerCase();
}

export function resolveContentPath(root, requestedPath) {
  if (typeof requestedPath !== 'string' || !requestedPath.trim()) {
    throw new Error('A repository-relative .md or .txt path is required.');
  }
  const relative = requestedPath.trim().replaceAll('\\', '/').replace(/^\/+/, '');
  const parts = relative.split('/');
  if (parts.some((part) => !part || part === '..' || BLOCKED_DIRECTORIES.has(part))) {
    throw new Error('That path is not an editable archive-content location.');
  }
  if (!/\.(md|txt)$/i.test(relative) || BLOCKED_FILES.has(path.basename(relative))) {
    throw new Error('Only archive .md and .txt content files may be edited.');
  }
  const absolute = path.resolve(root, relative);
  const rootPrefix = `${path.resolve(root).toLowerCase()}${path.sep}`;
  if (!absolute.toLowerCase().startsWith(rootPrefix)) throw new Error('Path escaped the repository.');
  return { absolute, relative };
}

export function editSection(original, { section = '', content, mode = 'append' }) {
  if (typeof content !== 'string' || !content.trim()) throw new Error('Content cannot be empty.');
  if (!['append', 'replace'].includes(mode)) throw new Error('Mode must be append or replace.');
  const cleanContent = content.trim();
  if (!section.trim()) {
    if (mode === 'replace') return `${cleanContent}\n`;
    return `${String(original).trimEnd()}${String(original).trim() ? '\n\n' : ''}${cleanContent}\n`;
  }

  const lines = String(original).replace(/\r\n/g, '\n').split('\n');
  const headings = [];
  lines.forEach((line, index) => {
    const match = line.match(/^(#{1,6})\s+(.+?)\s*$/);
    if (match) headings.push({ index, level: match[1].length, title: match[2] });
  });
  const wanted = normalizeHeading(section);
  const targetIndex = headings.findIndex((heading) => normalizeHeading(heading.title) === wanted);
  if (targetIndex < 0) {
    if (mode === 'replace') throw new Error(`Section not found: ${section}`);
    return `${String(original).trimEnd()}\n\n## ${section.trim()}\n\n${cleanContent}\n`;
  }
  const target = headings[targetIndex];
  const next = headings.slice(targetIndex + 1).find((heading) => heading.level <= target.level);
  const end = next?.index ?? lines.length;
  if (mode === 'replace') {
    lines.splice(target.index + 1, end - target.index - 1, '', ...cleanContent.split('\n'), '');
  } else {
    lines.splice(end, 0, '', ...cleanContent.split('\n'), '');
  }
  return `${lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd()}\n`;
}

export async function ingestContent(root, payload) {
  const { absolute, relative } = resolveContentPath(root, payload.path);
  const mode = payload.mode ?? 'append';
  if (mode === 'create') {
    if (typeof payload.content !== 'string' || !payload.content.trim()) throw new Error('Content cannot be empty.');
    try {
      await fs.access(absolute);
      throw new Error(`File already exists: ${relative}`);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    await fs.mkdir(path.dirname(absolute), { recursive: true });
    await fs.writeFile(absolute, `${String(payload.content ?? '').trim()}\n`, 'utf8');
    return { path: relative, mode, section: null };
  }
  let original;
  try {
    original = await fs.readFile(absolute, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') throw new Error(`File not found: ${relative}`);
    throw error;
  }
  const updated = editSection(original, payload);
  await fs.writeFile(absolute, updated, 'utf8');
  return { path: relative, mode, section: payload.section?.trim() || null };
}
