import { HttpClient, QueryParams } from "./http-client";

/** Redis event emitted when a new encryption key is created. */
export interface KeyCreatedEvent {
  key_id: string;
  user_id: string;
  created_at: string;
}

/** Redis event emitted when an encryption key is deleted. */
export interface KeyDeletedEvent {
  key_id: string;
  user_id: string;
  deleted_at: string;
}

/** Redis event describing an object creation. */
export interface ObjectCreatedEvent {
  id: string;
  user_id: string;
  metadata: Record<string, unknown>;
  key_id: string;
  related_object_id?: string | null;
  content: string;
  auth_tag: string;
  created_at: string;
  updated_at: string;
}

/** Redis event describing an object update. */
export interface ObjectUpdatedEvent {
  object_id: string;
  key_id: string;
  user_id: string;
  updated_at: string;
}

/** Redis event describing an object deletion. */
export interface ObjectDeletedEvent {
  object_id: string;
  user_id: string;
  deleted_at: string;
}

/** Redis event fired when a publish job is created. */
export interface PublishEvent {
  user_id: string;
  type: string;
  related_id: string;
  object_id: string;
  timestamp: string;
}

/** Redis event fired when a publish job is cancelled. */
export interface UnpublishEvent {
  user_id: string;
  type: string;
  related_id: string;
  timestamp: string;
}

/** Mapping of event channel names to their payload shapes. */
export type RedisEventMap = {
  key_created: KeyCreatedEvent;
  key_deleted: KeyDeletedEvent;
  object_created: ObjectCreatedEvent;
  object_updated: ObjectUpdatedEvent;
  object_deleted: ObjectDeletedEvent;
  publish: PublishEvent;
  unpublish: UnpublishEvent;
};

/** Union of supported event channel identifiers. */
export type RedisEventType = keyof RedisEventMap;

/** Type-safe filters accepted by the events API. */
export type PartialPattern<T extends RedisEventType> = T extends
  | "key_created"
  | "key_deleted"
  ? { userId?: string; keyId?: string }
  : T extends "object_created"
  ? { userId?: string; objectId?: string; relatedId?: string }
  : T extends "object_updated" | "object_deleted"
  ? { userId?: string; objectId?: string }
  : T extends "publish"
  ? { userId?: string; type?: string; relatedId?: string; objectId?: string }
  : T extends "unpublish"
  ? { userId?: string; type?: string; relatedId?: string }
  : never;

/** Additional configuration for {@link EventsRepository.listen}. */
export interface EventStreamOptions {
  signal?: AbortSignal;
}

interface ParsedEvent<T> {
  event: string;
  data: T | undefined;
}

/**
 * Consumes Telentir's Redis-backed Server-Sent Event streams.
 */
export class EventsRepository {
  constructor(private readonly http: HttpClient) {}

  /**
   * Subscribes to a Redis event channel and yields parsed payloads.
   *
   * @param type - Redis channel to subscribe to.
   * @param filter - Optional filter query passed to the backend.
   * @param options - Abort signal for cancellation.
   */
  async *listen<T extends RedisEventType>(
    type: T,
    filter?: PartialPattern<T>,
    options?: EventStreamOptions
  ): AsyncGenerator<RedisEventMap[T], void, unknown> {
    const query: QueryParams | undefined = filter
      ? Object.fromEntries(
          Object.entries(filter).map(([key, value]) => [
            key,
            value ?? undefined,
          ])
        )
      : undefined;

    const response = await this.http.request<Response>(`/events/${type}`, {
      method: "GET",
      responseType: "raw",
      query,
      signal: options?.signal,
    });

    const body = response.body;
    if (!body) {
      throw new Error("Event stream is not supported in this environment.");
    }

    const reader = body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";

    try {
      for (;;) {
        const { value, done } = await reader.read();

        if (done) {
          buffer += decoder.decode();
          if (buffer.length) {
            for (const event of this.drainBuffer(buffer)) {
              if (event.event === "error") {
                throw new Error(
                  typeof event.data === "string"
                    ? event.data
                    : "Event stream error."
                );
              }
              if (event.data !== undefined) {
                yield event.data as RedisEventMap[T];
              }
            }
          }
          break;
        }

        buffer += decoder.decode(value, { stream: true });

        const separator = buffer.lastIndexOf("\n\n");
        if (separator === -1) {
          continue;
        }

        const chunk = buffer.slice(0, separator);
        buffer = buffer.slice(separator + 2);

        for (const event of this.drainBuffer(chunk)) {
          if (event.event === "error") {
            throw new Error(
              typeof event.data === "string"
                ? event.data
                : "Event stream error."
            );
          }
          if (event.data !== undefined) {
            yield event.data as RedisEventMap[T];
          }
        }
      }
    } finally {
      reader.releaseLock();
      await body.cancel().catch(() => undefined);
    }
  }

  private *drainBuffer(chunk: string): Generator<ParsedEvent<unknown>> {
    const events = chunk.split(/\n\n/);
    for (const rawEvent of events) {
      const trimmed = rawEvent.trim();
      if (!trimmed.length) {
        continue;
      }
      const parsed = this.parseEvent(trimmed);
      if (parsed) {
        yield parsed;
      }
    }
  }

  private parseEvent(line: string): ParsedEvent<unknown> | undefined {
    const rows = line.split(/\r?\n/);
    let eventName = "message";
    const dataLines: string[] = [];

    for (const row of rows) {
      if (!row.length) {
        continue;
      }

      if (row.startsWith(":")) {
        continue;
      }

      const idx = row.indexOf(":");
      const field = idx === -1 ? row : row.slice(0, idx);
      const rest = idx === -1 ? "" : row.slice(idx + 1).replace(/^\s*/, "");

      switch (field) {
        case "event":
          eventName = rest || "message";
          break;
        case "data":
          dataLines.push(rest);
          break;
        default:
          break;
      }
    }

    if (dataLines.length === 0) {
      return { event: eventName, data: undefined };
    }

    const payload = dataLines.join("\n");
    if (!payload.length) {
      return { event: eventName, data: undefined };
    }

    try {
      return {
        event: eventName,
        data: JSON.parse(payload),
      };
    } catch (error) {
      throw new Error(
        `Failed to parse SSE payload: ${
          (error as Error).message
        }\nPayload: ${payload}`
      );
    }
  }
}
