import { z } from 'zod';
import { readFileSync } from 'fs';
import type { Config } from './types.js';

export const eventConfigSchema = z.object({
  url: z.string().url(),
  name: z.string().min(1),
});

export const configSchema = z.object({
  events: z.array(eventConfigSchema).min(1),
  discordWebhookUrl: z.string().url(),
  discordUserId: z.string().optional(),
  pollIntervalMs: z.number().int().min(30000).default(60000),
});

export function loadConfig(path: string): Config {
  const content = readFileSync(path, 'utf-8');
  const raw = JSON.parse(content);
  return configSchema.parse(raw);
}