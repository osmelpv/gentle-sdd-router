import crypto from 'node:crypto';

export const HOST_ADOPTION_MANAGED_BLOCK_START = '<!-- gsr:managed:start -->';
export const HOST_ADOPTION_MANAGED_BLOCK_END = '<!-- gsr:managed:end -->';
export const HOST_ADOPTION_GUARDRAIL_LINE = 'router-skill: host-local';

export function createManagedBlock(managedLine = HOST_ADOPTION_GUARDRAIL_LINE) {
  return [
    HOST_ADOPTION_MANAGED_BLOCK_START,
    managedLine,
    HOST_ADOPTION_MANAGED_BLOCK_END,
  ].join('\n');
}

export function findManagedBlock(text) {
  const startIndexes = findAllIndexes(text, HOST_ADOPTION_MANAGED_BLOCK_START);
  const endIndexes = findAllIndexes(text, HOST_ADOPTION_MANAGED_BLOCK_END);

  if (startIndexes.length === 0 && endIndexes.length === 0) {
    return null;
  }

  if (startIndexes.length !== 1 || endIndexes.length !== 1) {
    throw new Error('Host adoption managed markers must appear exactly once.');
  }

  const startIndex = startIndexes[0];
  const endIndex = endIndexes[0];

  if (endIndex < startIndex) {
    throw new Error('Host adoption managed markers are out of order.');
  }

  const blockStart = startIndex + HOST_ADOPTION_MANAGED_BLOCK_START.length;
  const rawBody = text.slice(blockStart, endIndex);
  const body = rawBody.replace(/^\r?\n/, '').replace(/\r?\n$/, '');

  return {
    startIndex,
    endIndex,
    body,
    bodyHash: hashText(body),
    blockHash: hashText(text.slice(startIndex, endIndex + HOST_ADOPTION_MANAGED_BLOCK_END.length)),
    raw: text.slice(startIndex, endIndex + HOST_ADOPTION_MANAGED_BLOCK_END.length),
  };
}

export function upsertManagedBlock(text, managedLine = HOST_ADOPTION_GUARDRAIL_LINE) {
  const block = createManagedBlock(managedLine);
  const parsed = findManagedBlock(text);

  if (!parsed) {
    const nextText = text.endsWith('\n') || text.length === 0 ? text : `${text}\n`;
    return `${nextText}${block}\n`;
  }

  return `${text.slice(0, parsed.startIndex)}${block}${text.slice(parsed.endIndex + HOST_ADOPTION_MANAGED_BLOCK_END.length)}`;
}

export function removeManagedBlock(text) {
  const parsed = findManagedBlock(text);

  if (!parsed) {
    throw new Error('Host adoption managed markers were not found.');
  }

  const before = text.slice(0, parsed.startIndex).replace(/\s*$/, '');
  const after = text.slice(parsed.endIndex + HOST_ADOPTION_MANAGED_BLOCK_END.length).replace(/^\s*/, '');
  const combined = `${before}${before && after ? '\n' : ''}${after}`;

  return combined.length > 0 ? `${combined}\n` : '';
}

function findAllIndexes(text, needle) {
  const indexes = [];
  let index = text.indexOf(needle);

  while (index !== -1) {
    indexes.push(index);
    index = text.indexOf(needle, index + needle.length);
  }

  return indexes;
}

function hashText(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}
