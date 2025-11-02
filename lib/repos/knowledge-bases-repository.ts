import { HttpClient } from "./http-client";

/** Metadata describing a knowledge base within Telentir. */
export interface KnowledgeBase {
  id: string;
  user_id: string;
  name: string;
  description?: string | null;
  created_at?: string;
  updated_at?: string;
}

/** Alias representing items returned by list endpoints. */
export type KnowledgeBaseListItem = KnowledgeBase;

/** Document persisted within a knowledge base. */
export type KnowledgeBaseDocument = {
  id: number;
  name: string;
  [key: string]: unknown;
};

/** Response when a document is created. */
export type CreatedDocument = {
  id: number;
  name: string;
};

/** Knowledge base enriched with its document list. */
export interface KnowledgeBaseWithDocuments extends KnowledgeBase {
  documents: KnowledgeBaseDocument[];
}

/** Result entry returned from `/search`. */
export interface KnowledgeBaseSearchHit {
  document: number | string;
  distance: number;
  text: string;
}

/** Uploadable source material for knowledge base ingestion. */
export type UploadSource =
  | File
  | Blob
  | Uint8Array
  | ArrayBuffer
  | { name: string; type?: string; data: Blob | Uint8Array | ArrayBuffer };

/** Payload accepted by the create endpoint. */
export interface KnowledgeBaseCreateInput {
  name: string;
  description?: string;
}

/** Partial update payload. */
export interface KnowledgeBaseUpdateInput {
  name?: string;
  description?: string | null;
}

/**
 * Client that wraps Telentir knowledge base CRUD and ingestion endpoints.
 */
export class KnowledgeBasesRepository {
  constructor(private readonly http: HttpClient) {}

  /** Lists all knowledge bases for the current user. */
  async list(): Promise<KnowledgeBaseListItem[]> {
    return await this.http.request<KnowledgeBaseListItem[]>("/knowledge-bases");
  }

  /** Creates a new knowledge base. */
  async create(
    input: KnowledgeBaseCreateInput
  ): Promise<KnowledgeBaseListItem> {
    return await this.http.request<KnowledgeBaseListItem>("/knowledge-bases", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
  }

  /** Retrieves knowledge base metadata along with its documents. */
  async get(id: string): Promise<KnowledgeBaseWithDocuments> {
    return await this.http.request<KnowledgeBaseWithDocuments>(
      `/knowledge-bases/${id}`
    );
  }

  /**
   * Applies a partial update to a knowledge base.
   *
   * @remarks No network call is made when the payload is empty.
   */
  async update(id: string, input: KnowledgeBaseUpdateInput): Promise<void> {
    const payload: Record<string, unknown> = {};

    if (input.name !== undefined) {
      payload.name = input.name;
    }
    if (input.description !== undefined) {
      payload.description = input.description;
    }

    if (!Object.keys(payload).length) {
      return;
    }

    await this.http.request(`/knowledge-bases/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      responseType: "void",
    });
  }

  /** Deletes a knowledge base. */
  async delete(id: string): Promise<void> {
    await this.http.request(`/knowledge-bases/${id}`, {
      method: "DELETE",
      responseType: "void",
    });
  }

  async uploadDocuments(
    id: string,
    files: UploadSource[]
  ): Promise<CreatedDocument[]> {
    const formData = new FormData();
    for (const file of files) {
      const { name, blob } = this.normalizeUpload(file);
      formData.append("files", blob, name);
    }

    return await this.http.request<CreatedDocument[]>(
      `/knowledge-bases/${id}`,
      {
        method: "POST",
        body: formData,
      }
    );
  }

  async uploadLinks(id: string, urls: string[]): Promise<CreatedDocument[]> {
    return await this.http.request<CreatedDocument[]>(
      `/knowledge-bases/${id}/links`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ urls }),
      }
    );
  }

  async search(id: string, text: string): Promise<KnowledgeBaseSearchHit[]> {
    return await this.http.request<KnowledgeBaseSearchHit[]>(
      `/knowledge-bases/${id}/search`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text }),
      }
    );
  }

  async deleteDocument(id: string, documentId: number): Promise<void> {
    await this.http.request(`/knowledge-bases/${id}/${documentId}`, {
      method: "DELETE",
      responseType: "void",
    });
  }

  private normalizeUpload(source: UploadSource): { name: string; blob: Blob } {
    if (typeof File !== "undefined" && source instanceof File) {
      return { name: source.name, blob: source };
    }

    if (source instanceof Blob) {
      return { name: "file", blob: source };
    }

    if (source instanceof Uint8Array) {
      const buffer = toArrayBuffer(source);
      return {
        name: "file",
        blob: new Blob([buffer], { type: "application/octet-stream" }),
      };
    }

    if (source instanceof ArrayBuffer) {
      return {
        name: "file",
        blob: new Blob([toArrayBuffer(source)], {
          type: "application/octet-stream",
        }),
      };
    }

    const normalizedName = source.name ?? "file";
    const type = source.type ?? "application/octet-stream";
    const data = source.data;

    if (data instanceof Blob) {
      return { name: normalizedName, blob: new Blob([data], { type }) };
    }

    const buffer = toArrayBuffer(
      data instanceof Uint8Array ? data : (data as ArrayBuffer)
    );

    return {
      name: normalizedName,
      blob: new Blob([buffer], { type }),
    };
  }
}

/**
 * Normalises binary data into a standalone {@link ArrayBuffer}.
 */
function toArrayBuffer(input: Uint8Array | ArrayBuffer): ArrayBuffer {
  if (input instanceof Uint8Array) {
    return input.slice().buffer;
  }
  return input.slice(0);
}
