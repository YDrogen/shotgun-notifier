/**
 * Represents the current state of a ticket event
 */
export type EventState = 'available' | 'sold_out' | 'unknown';

/**
 * Represents a ticket category within an event
 */
export interface TicketCategory {
  name: string;
  status: EventState;
  price?: string;
}

/**
 * Represents the status of a monitored event
 */
export interface EventStatus {
  url: string;
  state: EventState;
  categories: TicketCategory[];
  lastChecked: Date;
  consecutiveFailures: number;
}

/**
 * Configuration for a single event to monitor
 */
export interface EventConfig {
  url: string;
  name: string;
}

/**
 * Root application configuration
 */
export interface Config {
  events: EventConfig[];
  discordWebhookUrl: string;
  pollIntervalMs: number;
}

/**
 * Result from scraping an event page
 */
export interface ScrapeResult {
  state: EventState;
  categories: TicketCategory[];
  raw?: unknown;
}
