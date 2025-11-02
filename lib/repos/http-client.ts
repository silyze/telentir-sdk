import type { TelentirConfig } from "../sdk";

/** Primitive values accepted for query-string construction. */
export type QueryValue = string | number | boolean | null | undefined;

/** Query-string representation used by {@link HttpClient}. */
export type QueryParams = Record<string, QueryValue>;

/** Response parsing strategy for {@link HttpClient.request}. */
export type ResponseType = "json" | "text" | "void" | "raw";

/**
 * Error that surfaces failed Telentir API requests alongside status metadata.
 */
export class TelentirApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly statusText: string,
    public readonly body?: unknown
  ) {
    super(message);
    this.name = "TelentirApiError";
  }
}

/**
 * Options accepted by {@link HttpClient.request}.
 */
export interface RequestOptions extends RequestInit {
  /** Additional query parameters to append to the URL. */
  query?: QueryParams;
  /** When true, the Authorization header is omitted. */
  skipAuth?: boolean;
  /** How the response body should be parsed. */
  responseType?: ResponseType;
}

/**
 * Lightweight wrapper around `fetch` that injects Telentir authentication and conveniences.
 */
export class HttpClient {
  private readonly baseUrl: string;

  constructor(private readonly config: TelentirConfig) {
    this.baseUrl = (config.api ?? "https://telentir.com/api").replace(
      /\/$/,
      ""
    );
  }

  private buildUrl(input: string, query?: QueryParams): string {
    if (/^https?:\/\//i.test(input)) {
      return this.appendQuery(new URL(input), query).toString();
    }

    const path = input.startsWith("/") ? input : `/${input}`;
    const url = new URL(this.baseUrl + path);
    return this.appendQuery(url, query).toString();
  }

  private appendQuery(url: URL, query?: QueryParams): URL {
    if (!query) {
      return url;
    }

    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null) {
        continue;
      }
      url.searchParams.set(key, String(value));
    }

    return url;
  }

  private async parseErrorBody(response: Response) {
    const contentType = response.headers.get("content-type") ?? "";
    try {
      if (contentType.includes("application/json")) {
        return await response.json();
      }
      const text = await response.text();
      return text.length ? text : undefined;
    } catch {
      return undefined;
    }
  }

  private async ensureOk(response: Response) {
    if (response.ok) {
      return;
    }

    const body = await this.parseErrorBody(response);
    const message =
      typeof body === "string"
        ? body
        : body && typeof body === "object" && "message" in body
        ? String((body as { message: unknown }).message)
        : `${response.status} ${response.statusText}`;

    throw new TelentirApiError(
      message,
      response.status,
      response.statusText,
      body
    );
  }

  /**
   * Executes a request against the Telentir API.
   *
   * @param input - Path or absolute URL.
   * @param options - Request modifiers, including query parameters and response parsing.
   */
  async request<T = unknown>(
    input: string,
    options: RequestOptions = {}
  ): Promise<T> {
    const {
      query,
      skipAuth = false,
      responseType = "json",
      headers,
      ...init
    } = options;

    const url = this.buildUrl(input, query);
    const finalHeaders = new Headers(headers ?? {});

    if (!skipAuth) {
      finalHeaders.set("authorization", `Bearer ${this.config.apiKey}`);
    }

    if (responseType !== "raw" && !finalHeaders.has("accept")) {
      finalHeaders.set("accept", "application/json");
    }

    const response = await fetch(url, { ...init, headers: finalHeaders });
    await this.ensureOk(response);

    switch (responseType) {
      case "raw":
        return response as unknown as T;
      case "void":
        // Drain body if present to free resources.
        if (response.body) {
          await response.arrayBuffer();
        }
        return undefined as T;
      case "text":
        return (await response.text()) as T;
      case "json":
      default: {
        if (response.status === 204) {
          return undefined as T;
        }

        const contentLength = response.headers.get("content-length");
        if (contentLength === "0") {
          return undefined as T;
        }

        const bodyText = await response.text();
        if (!bodyText.length) {
          return undefined as T;
        }

        try {
          return JSON.parse(bodyText) as T;
        } catch (error) {
          throw new Error(
            `Failed to parse JSON response from ${url}: ${
              (error as Error).message
            }\n${bodyText}`
          );
        }
      }
    }
  }
}
