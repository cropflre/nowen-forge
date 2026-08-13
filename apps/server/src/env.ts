import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const explicit = process.env.ENV_FILE?.trim();
const candidates = [
  explicit || null,
  fileURLToPath(new URL('../../../.env', import.meta.url)),
  fileURLToPath(new URL('../../../.env.local', import.meta.url))
].filter((value): value is string => Boolean(value));

for (const candidate of candidates) {
  if (!existsSync(candidate)) continue;
  try {
    process.loadEnvFile(candidate);
  } catch (error) {
    // Keep startup resilient when an optional local env file is malformed.
    console.warn(`[Nowen Forge] Failed to load env file: ${candidate}`, error);
  }
}
