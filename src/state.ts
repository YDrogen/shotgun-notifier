import type { EventConfig, EventStatus, StateChange } from './types.ts';

class EventStateTracker {
  private states = new Map<string, EventStatus>();
  
  getState(url: string): EventStatus | undefined {
    return this.states.get(url);
  }
  
  updateState(url: string, event: EventConfig, newStatus: EventStatus): StateChange[] {
    const changes: StateChange[] = [];
    const current = this.states.get(url);
    
    if (!current) {
      changes.push({
        event,
        previousState: 'unknown',
        newState: newStatus.state,
        categories: newStatus.categories,
      });
    } else if (current.state !== newStatus.state) {
      changes.push({
        event,
        previousState: current.state,
        newState: newStatus.state,
        categories: newStatus.categories,
      });
    }
    
    this.states.set(url, newStatus);
    return changes;
  }
  
  incrementFailure(url: string): number {
    const current = this.states.get(url);
    if (current) {
      current.consecutiveFailures++;
      this.states.set(url, current);
      return current.consecutiveFailures;
    }
    return 1;
  }
  
  resetFailures(url: string): void {
    const current = this.states.get(url);
    if (current) {
      current.consecutiveFailures = 0;
      this.states.set(url, current);
    }
  }
  
  isUnhealthy(url: string): boolean {
    const current = this.states.get(url);
    return (current?.consecutiveFailures ?? 0) >= 5;
  }
}

export default EventStateTracker;