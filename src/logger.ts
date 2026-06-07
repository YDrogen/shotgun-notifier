import pino from 'pino';

/**
 * Pino singleton logger for shotgun-notif
 * Provides structured JSON output for production
 */
const logger = pino({
  level: 'info',
  name: 'shotgun-notif',
});

export default logger;

/**
 * Create a child logger with component context
 * @param component - Name of the component (e.g., 'scraper', 'orchestrator', 'notifier')
 */
export function createLogger(component: string) {
  return logger.child({ component });
}
