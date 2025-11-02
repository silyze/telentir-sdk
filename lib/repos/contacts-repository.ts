import type { Contact } from "../models";
import { ObjectRepository } from "./object-repository";
import { HttpClient } from "./http-client";

/** Parameters passed to the lead-generation connect endpoint. */
export interface LeadFetchParams {
  credits: number;
  name?: string;
  company?: string[];
  job?: string[];
  country?: string[];
  city?: string[];
  industry?: string[];
}

/** Object repository facade specialised for contacts plus lead ingestion. */
export class ContactsRepository<T> {
  constructor(
    private readonly base: ObjectRepository<T, Contact>,
    private readonly http: HttpClient
  ) {}

  /** Decrypts all contact records. */
  all(): ReturnType<ObjectRepository<T, Contact>["all"]> {
    return this.base.all();
  }

  /** Retrieves a single contact record. */
  get(id: string): ReturnType<ObjectRepository<T, Contact>["get"]> {
    return this.base.get(id);
  }

  /** Deletes a contact. */
  delete(id: string): ReturnType<ObjectRepository<T, Contact>["delete"]> {
    return this.base.delete(id);
  }

  /** Creates a new contact. */
  create(payload: Contact): ReturnType<ObjectRepository<T, Contact>["create"]> {
    return this.base.create(payload);
  }

  /** Updates an existing contact. */
  update(
    id: string,
    payload: Contact
  ): ReturnType<ObjectRepository<T, Contact>["update"]> {
    return this.base.update(id, payload);
  }

  /**
   * Dispatches a lead generation job that streams new contacts into the encrypted store.
   */
  async fetchLeads(params: LeadFetchParams): Promise<void> {
    const payload: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined) {
        continue;
      }
      if (Array.isArray(value)) {
        if (value.length > 0) {
          payload[key] = value;
        }
        continue;
      }
      payload[key] = value;
    }

    await this.http.request("/connect", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        repository: "contacts",
        path: "/get-leads",
        params: payload,
      }),
      responseType: "void",
    });
  }
}
