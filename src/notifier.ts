import type { EventConfig, EventStatus } from './types.ts';
import logger from './logger.ts';

interface DiscordEmbed {
  title: string;
  description: string;
  fields: { name: string; value: string; inline: boolean }[];
  url: string;
  timestamp: string;
  color: number;
}

export async function sendNotification(
  webhookUrl: string,
  event: EventConfig,
  status: EventStatus,
  userId?: string,
): Promise<void> {
  const log = logger.child({ component: 'notifier' });

  const fields = status.categories.map((cat) => ({
    name: cat.name,
    value: cat.price ?? cat.status,
    inline: true,
  }));

  const stateText = status.state === 'available' ? 'Available' : status.state === 'sold_out' ? 'Sold Out' : 'Unknown';

  const embed: DiscordEmbed = {
    title: event.name,
    description: `Status: ${stateText}`,
    fields,
    url: event.url,
    timestamp: new Date().toISOString(),
    color: status.state === 'available' ? 3066993 : 15105570,
  };

  const body: Record<string, unknown> = { embeds: [embed] };
  if (userId) {
    body.content = `<@${userId}>`;
  }

  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (response.status === 204 || response.status === 200) {
      log.info({ event: event.name }, 'Notification sent');
      return;
    }

    if (response.status === 429) {
      log.warn({ event: event.name }, 'Rate limited by Discord');
      return;
    }

    const errorText = await response.text();
    log.error({ status: response.status, error: errorText }, 'Discord webhook failed');
    throw new Error(`Webhook failed with status ${response.status}`);
  } catch (error) {
    log.error({ error }, 'Failed to send notification');
    throw error;
  }
}

export async function sendUnhealthyAlert(
  webhookUrl: string,
  event: EventConfig,
  failureCount: number,
  userId?: string,
): Promise<void> {
  const log = logger.child({ component: 'notifier' });

  const embed: DiscordEmbed = {
    title: `⚠️ ${event.name}`,
    description: `Failed to fetch after ${failureCount} attempts`,
    fields: [],
    url: event.url,
    timestamp: new Date().toISOString(),
    color: 15158332,
  };

  const body: Record<string, unknown> = { embeds: [embed] };
  if (userId) {
    body.content = `<@${userId}>`;
  }

  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (response.status === 204 || response.status === 200) {
      log.warn({ event: event.name, failureCount }, 'Unhealthy alert sent');
      return;
    }

    if (response.status === 429) {
      log.warn({ event: event.name }, 'Rate limited while sending unhealthy alert');
      return;
    }

    log.error({ status: response.status }, 'Failed to send unhealthy alert');
  } catch (error) {
    log.error({ error }, 'Error sending unhealthy alert');
  }
}

export async function validateWebhookUrl(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, { method: 'GET' });
    return response.status === 200 || response.status === 204;
  } catch {
    return false;
  }
}
