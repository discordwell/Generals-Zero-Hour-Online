/**
 * Claude CLI wrapper — shells out to `claude -p` for each agent call.
 * Uses the user's existing Claude Code authentication.
 */

import { spawn } from 'node:child_process';

export interface ClaudeOptions {
  model?: string | null;
  timeoutMs?: number;
}

/**
 * Send a single-turn prompt to the Claude CLI and return the text response.
 * Pipes the prompt via stdin to handle arbitrarily long prompts.
 */
export async function queryClaude(
  prompt: string,
  options?: ClaudeOptions,
): Promise<string> {
  const args = ['-p', '--output-format', 'text'];
  if (options?.model) {
    args.push('--model', options.model);
  }

  const timeoutMs = options?.timeoutMs ?? 600_000; // 10 min default

  return new Promise((resolve, reject) => {
    const proc = spawn('claude', args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: timeoutMs,
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    proc.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    proc.on('error', (err) => {
      reject(new Error(`Failed to spawn claude CLI: ${err.message}`));
    });

    proc.on('close', (code) => {
      if (code !== 0) {
        reject(
          new Error(
            `claude exited with code ${code}:\n${stderr || '(no stderr)'}`,
          ),
        );
      } else {
        resolve(stdout);
      }
    });

    proc.stdin.write(prompt);
    proc.stdin.end();
  });
}

/**
 * Extract a fenced code block from a Claude response.
 * Tries ```typescript, ```ts, ```cpp, then any ``` block, then returns raw text.
 */
export function extractCodeBlock(
  response: string,
  language?: string,
): string {
  // Try language-specific fence first
  if (language) {
    const langPattern = new RegExp(
      '```' + language + '\\n([\\s\\S]*?)```',
    );
    const langMatch = response.match(langPattern);
    if (langMatch) return langMatch[1]!.trim();
  }

  // Try common TypeScript/JavaScript fences
  const tsMatch = response.match(
    /```(?:typescript|ts|tsx)\n([\s\S]*?)```/,
  );
  if (tsMatch) return tsMatch[1]!.trim();

  // Try C++ fences
  const cppMatch = response.match(
    /```(?:cpp|c\+\+|c)\n([\s\S]*?)```/,
  );
  if (cppMatch) return cppMatch[1]!.trim();

  // Try any fenced block
  const anyMatch = response.match(/```\w*\n([\s\S]*?)```/);
  if (anyMatch) return anyMatch[1]!.trim();

  // No code fence — return the whole response trimmed
  return response.trim();
}

/**
 * Extract a JSON object/array from a Claude response.
 */
export function extractJson<T = unknown>(response: string): T {
  // Try JSON code fence first
  const jsonMatch = response.match(/```json\n([\s\S]*?)```/);
  if (jsonMatch) return JSON.parse(jsonMatch[1]!.trim()) as T;

  // Try any code fence
  const anyMatch = response.match(/```\w*\n([\s\S]*?)```/);
  if (anyMatch) {
    try {
      return JSON.parse(anyMatch[1]!.trim()) as T;
    } catch {
      // Not JSON in the code fence, fall through
    }
  }

  // Try parsing the raw response
  // Find the first { or [ and last } or ]
  const firstBrace = response.indexOf('{');
  const firstBracket = response.indexOf('[');
  const start = Math.min(
    firstBrace === -1 ? Infinity : firstBrace,
    firstBracket === -1 ? Infinity : firstBracket,
  );

  if (start === Infinity) {
    throw new Error('No JSON found in response');
  }

  const isObject = response[start] === '{';
  const closer = isObject ? '}' : ']';
  const lastClose = response.lastIndexOf(closer);

  if (lastClose === -1) {
    throw new Error('No JSON found in response');
  }

  return JSON.parse(response.slice(start, lastClose + 1)) as T;
}
