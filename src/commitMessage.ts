import { hasStagedChanges, getStagedDiff, getShortStatus } from './git';
import { runOllama, DEFAULT_OLLAMA_MODEL } from './ollama';

export const DIFF_LIMIT = 100_000;

const COMMIT_PROMPT = [
  'Write ONLY a Conventional Commits style message in English for this git diff.',
  'Rules:',
  '- Output plain text ONLY (no JSON, no code fences, no quotes, no backticks).',
  '- Format: <type>(<optional scope>): <title>',
  '- type ∈ {feat, fix, refactor, docs, test, chore, perf, build, ci}',
  '- Title ≤72 characters.',
  '- Optionally add 1–3 short body lines if needed.',
  '- Do NOT include explanations or metadata.',
  '',
  'Diff:',
  '',
].join('\n');

const JSON_FIELDS = ['message', 'commit', 'response', 'text', 'content'];

export interface CommitMessageOptions {
  model?: string;
  fallbackMessage?: string;
}

export interface CommitMessageResult {
  message: string;
  raw: string;
  source: 'ollama' | 'fallback';
  model: string;
  truncatedDiff: boolean;
  diff?: string;
  context?: 'staged' | 'custom';
}

export async function generateCommitMessage(workspacePath: string, options: CommitMessageOptions = {}): Promise<CommitMessageResult> {
  if (!workspacePath) {
    throw new Error('No workspace folder open.');
  }

  if (!(await hasStagedChanges(workspacePath))) {
    throw new Error('No staged changes found. Stage files before requesting a commit message.');
  }

  const { diff, truncated } = await getStagedDiff(workspacePath, DIFF_LIMIT);
  if (!diff.trim()) {
    throw new Error('Unable to read staged diff.');
  }

  const model = options.model ?? DEFAULT_OLLAMA_MODEL;
  const fallbackMessage = await buildFallbackMessage(workspacePath, options.fallbackMessage);

  return runCommitMessageGeneration({
    diff,
    truncated,
    model,
    fallbackMessage,
    context: 'staged',
  });
}

export async function generateCommitMessageFromDiff(diffInput: string, options: CommitMessageOptions = {}): Promise<CommitMessageResult> {
  if (!diffInput || !diffInput.trim()) {
    throw new Error('Diff content is empty.');
  }

  const truncated = diffInput.length > DIFF_LIMIT;
  const diff = truncated ? diffInput.slice(0, DIFF_LIMIT) : diffInput;
  const model = options.model ?? DEFAULT_OLLAMA_MODEL;
  const fallbackMessage = options.fallbackMessage?.trim()?.length
    ? options.fallbackMessage
    : 'chore: test diff (manual input)';

  return runCommitMessageGeneration({
    diff,
    truncated,
    model,
    fallbackMessage,
    context: 'custom',
  });
}

interface GenerationArgs {
  diff: string;
  truncated: boolean;
  model: string;
  fallbackMessage: string;
  context: 'staged' | 'custom';
}

async function runCommitMessageGeneration(args: GenerationArgs): Promise<CommitMessageResult> {
  const { diff, truncated, model, fallbackMessage, context } = args;
  const prompt = buildPrompt(diff, truncated);
  const raw = await runOllama(prompt, { model });
  const sanitized = sanitizeCommitMessage(raw);

  if (sanitized) {
    return { message: sanitized, raw, source: 'ollama', model, truncatedDiff: truncated, diff, context };
  }

  const fallback = fallbackMessage.trim() ? fallbackMessage : 'chore: update files';
  return { message: fallback, raw, source: 'fallback', model, truncatedDiff: truncated, diff, context };
}

function buildPrompt(diff: string, truncated: boolean): string {
  const prompt = `${COMMIT_PROMPT}${diff}`;
  return truncated ? `${prompt}\n\n[Diff truncated to ${DIFF_LIMIT} characters]` : prompt;
}

async function buildFallbackMessage(workspacePath: string, override?: string): Promise<string> {
  if (override && override.trim()) {
    return override;
  }

  const status = await getShortStatus(workspacePath);
  const fallbackLines = ['chore: update files'];
  if (status) {
    fallbackLines.push('', status);
  }
  return fallbackLines.join('\n');
}

function sanitizeCommitMessage(raw: string): string | undefined {
  if (!raw) {
    return undefined;
  }

  let text = stripEmptyEdges(raw);
  if (!text) {
    return undefined;
  }

  text = stripCodeFences(text);
  text = text.trim();

  if (!text) {
    return undefined;
  }

  const maybeJson = text.trimStart();
  if (maybeJson.startsWith('{')) {
    const fromJson = tryParseJsonForMessage(text);
    if (fromJson) {
      text = fromJson;
    }
  }

  text = stripOuterQuotes(text);
  text = stripEmptyEdges(text);

  return text || undefined;
}

function stripEmptyEdges(value: string): string {
  const lines = value.split(/\r?\n/);
  while (lines.length && !lines[0].trim()) {
    lines.shift();
  }
  while (lines.length && !lines[lines.length - 1].trim()) {
    lines.pop();
  }
  return lines.map(line => line.replace(/\s+$/u, '')).join('\n');
}

function stripCodeFences(value: string): string {
  const lines = value.split(/\r?\n/);
  while (lines.length && isFence(lines[0])) {
    lines.shift();
  }
  while (lines.length && isFence(lines[lines.length - 1])) {
    lines.pop();
  }
  return lines.join('\n');
}

function isFence(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.startsWith('```');
}

function stripOuterQuotes(value: string): string {
  return value.replace(/^[`"'“”‘’\u00AB\u00BB]+/, '').replace(/[`"'“”‘’\u00AB\u00BB]+$/, '');
}

function tryParseJsonForMessage(value: string): string | undefined {
  try {
    const parsed = JSON.parse(value);
    if (typeof parsed === 'string') {
      return parsed.trim();
    }
    if (parsed && typeof parsed === 'object') {
      for (const field of JSON_FIELDS) {
        const candidate = (parsed as Record<string, unknown>)[field];
        if (typeof candidate === 'string' && candidate.trim()) {
          return candidate.trim();
        }
      }
    }
  } catch (error) {
    // ignore JSON parse errors
  }
  return undefined;
}
