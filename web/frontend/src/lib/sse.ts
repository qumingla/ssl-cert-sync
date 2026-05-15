import type { SystemEvent } from "../types/api";
import { API_BASE_URL } from "./api";

type EventCallback = (event: SystemEvent) => void;

class MockEventSource {
  private callbacks: EventCallback[] = [];

  constructor() {
    import("./mock").then(({ eventStreamSubscribers }) => {
      eventStreamSubscribers.push((evt) => {
        this.callbacks.forEach(cb => cb(evt));
      });
    });
  }

  onMessage(cb: EventCallback) {
    this.callbacks.push(cb);
  }

  close() {
    this.callbacks = [];
  }
}

class RealEventSource {
  private es: EventSource | null = null;
  private callbacks: EventCallback[] = [];
  private url: string;
  private retryTimeout: number | undefined;

  constructor() {
    this.url = `${API_BASE_URL}/admin/events/stream`;
    this.connect();
  }

  private connect() {
    const token = localStorage.getItem('auth_token');
    // Using standard EventSource. In a real scenario, passing headers via native EventSource is tricky.
    // We append token to query string for auth.
    const urlWithToken = `${this.url}?token=${token || ''}`;
    
    this.es = new EventSource(urlWithToken);

    this.es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        this.callbacks.forEach(cb => cb(data));
      } catch (err) {
        console.error("Failed to parse SSE message", err);
      }
    };

    this.es.onerror = () => {
      this.es?.close();
      // Auto reconnect
      clearTimeout(this.retryTimeout);
      this.retryTimeout = setTimeout(() => this.connect(), 5000);
    };
  }

  onMessage(cb: EventCallback) {
    this.callbacks.push(cb);
  }

  close() {
    this.es?.close();
    this.callbacks = [];
    clearTimeout(this.retryTimeout);
  }
}

export function createEventStream(): { onMessage: (cb: EventCallback) => void; close: () => void } {
  if (import.meta.env.VITE_USE_MOCKS === 'true') {
    return new MockEventSource();
  }
  return new RealEventSource();
}
