// In-process fan-out of notification events to the SSE connections of one
// user (routes/notifications.ts keeps a listener per open stream). Nothing
// is stored here: a server that did not emit the event never knows about
// it, which is fine because the client polls as a fallback and the row is
// in hbs_notifications either way.

// "thread": a message arrived in one of the user's conversations
// (lib/messaging.ts); the data carries the thread and the new unread total.
export type StreamEvent = { type: "notification" | "unread" | "thread"; data: unknown };
export type StreamListener = (event: StreamEvent) => void;

const listeners = new Map<string, Set<StreamListener>>();

export function subscribe(userId: string, listener: StreamListener): () => void {
  let set = listeners.get(userId);
  if (!set) { set = new Set(); listeners.set(userId, set); }
  set.add(listener);
  return () => {
    const current = listeners.get(userId);
    if (!current) return;
    current.delete(listener);
    if (current.size === 0) listeners.delete(userId);
  };
}

// A listener that throws (a closed socket, say) must not stop the others.
export function emit(userId: string, event: StreamEvent): void {
  const set = listeners.get(userId);
  if (!set) return;
  for (const listener of [...set]) {
    try {
      listener(event);
    } catch {
      set.delete(listener);
    }
  }
  if (set.size === 0) listeners.delete(userId);
}

export function subscriberCount(userId?: string): number {
  if (userId !== undefined) return listeners.get(userId)?.size ?? 0;
  let total = 0;
  for (const set of listeners.values()) total += set.size;
  return total;
}
