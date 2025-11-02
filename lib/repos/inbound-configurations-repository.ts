import type { Agent, CampaignSource } from "../models";
import type { PhoneNumberRecord } from "./phone-numbers-repository";
import { HttpClient } from "./http-client";

/** Agent reference enriched with an identifier property. */
export type AgentReference = Agent & { id: string };

/** Inbound call configuration persisted in Telentir. */
export interface InboundConfiguration {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  knowledge_base_id: string | null;
  metadata: Record<string, unknown>;
  agent: AgentReference;
  humanAgents: AgentReference[];
  source: CampaignSource;
  created_at?: string;
  updated_at?: string;
}

/** Payload required to create a new inbound configuration. */
export interface InboundConfigurationCreateInput {
  name: string;
  description?: string | null;
  knowledgeBaseId?: string | null;
  agent: AgentReference;
  source: CampaignSource;
  humanAgents?: AgentReference[];
}

/** Alias for {@link InboundConfigurationCreateInput}. */
export interface InboundConfigurationUpdateInput
  extends InboundConfigurationCreateInput {}

/** Partial update payload for an existing configuration. */
export interface InboundConfigurationPatchInput {
  name?: string;
  description?: string | null;
  knowledgeBaseId?: string | null;
  agent?: AgentReference;
  source?: CampaignSource;
  humanAgents?: AgentReference[] | null;
}

/** Response envelope returned when attaching or detaching phone numbers. */
export interface PhoneLinkResponse {
  ok: boolean;
  phone_number: PhoneNumberRecord;
}

/**
 * High-level client for Telentir inbound configuration endpoints.
 */
export class InboundConfigurationsRepository {
  constructor(private readonly http: HttpClient) {}

  /** Lists all inbound configurations owned by the authenticated user. */
  async list(): Promise<InboundConfiguration[]> {
    return await this.http.request<InboundConfiguration[]>(
      "/inbound-configurations"
    );
  }

  /**
   * Creates a new inbound configuration.
   *
   * @param input - Configuration properties, including the primary agent.
   */
  async create(
    input: InboundConfigurationCreateInput
  ): Promise<InboundConfiguration> {
    const payload = this.serializeInput(input);
    const response = await this.http.request<InboundConfiguration>(
      "/inbound-configurations",
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      }
    );
    return this.normalize(response);
  }

  /** Retrieves a single inbound configuration by identifier. */
  async get(id: string): Promise<InboundConfiguration> {
    const response = await this.http.request<InboundConfiguration>(
      `/inbound-configurations/${id}`
    );
    return this.normalize(response);
  }

  /** Permanently removes an inbound configuration. */
  async delete(id: string): Promise<void> {
    await this.http.request(`/inbound-configurations/${id}`, {
      method: "DELETE",
      responseType: "void",
    });
  }

  /**
   * Replaces persisted properties for an inbound configuration.
   *
   * @param id - Configuration identifier.
   * @param input - Replacement properties.
   */
  async update(
    id: string,
    input: InboundConfigurationUpdateInput
  ): Promise<InboundConfiguration> {
    const payload = this.serializeInput(input);
    const response = await this.http.request<InboundConfiguration>(
      `/inbound-configurations/${id}`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      }
    );
    return this.normalize(response);
  }

  /**
   * Applies a partial update to an inbound configuration.
   *
   * @throws Error when no fields are provided.
   */
  async patch(
    id: string,
    input: InboundConfigurationPatchInput
  ): Promise<InboundConfiguration> {
    const payload: Record<string, unknown> = {};

    if ("name" in input && input.name !== undefined) {
      payload.name = input.name;
    }
    if ("description" in input) {
      payload.description = input.description;
    }
    if ("knowledgeBaseId" in input) {
      payload.knowledge_base_id = input.knowledgeBaseId;
    }
    if ("agent" in input && input.agent !== undefined) {
      payload.agent = input.agent;
    }
    if ("source" in input && input.source !== undefined) {
      payload.source = input.source;
    }
    if ("humanAgents" in input) {
      payload.humanAgents = input.humanAgents ?? [];
    }

    if (!Object.keys(payload).length) {
      throw new Error("No fields to update");
    }

    const response = await this.http.request<InboundConfiguration>(
      `/inbound-configurations/${id}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      }
    );
    return this.normalize(response);
  }

  /**
   * Associates a phone number with an inbound configuration.
   */
  async attachPhoneNumber(
    id: string,
    phoneNumberId: string
  ): Promise<PhoneLinkResponse> {
    return await this.http.request<PhoneLinkResponse>(
      `/inbound-configurations/${id}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "attach",
          phone_number_id: phoneNumberId,
        }),
      }
    );
  }

  /**
   * Detaches an inbound configuration from a phone number.
   */
  async detachPhoneNumber(
    id: string,
    phoneNumberId: string
  ): Promise<PhoneLinkResponse> {
    return await this.http.request<PhoneLinkResponse>(
      `/inbound-configurations/${id}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "detach",
          phone_number_id: phoneNumberId,
        }),
      }
    );
  }

  private serializeInput(
    input: InboundConfigurationCreateInput
  ): Record<string, unknown> {
    const payload: Record<string, unknown> = {
      name: input.name,
      agent: input.agent,
      source: input.source,
      humanAgents: input.humanAgents ?? [],
    };

    if (input.description !== undefined) {
      payload.description = input.description;
    }

    if (input.knowledgeBaseId !== undefined) {
      payload.knowledge_base_id = input.knowledgeBaseId;
    }

    return payload;
  }

  private normalize(configuration: InboundConfiguration): InboundConfiguration {
    return {
      ...configuration,
      humanAgents: configuration.humanAgents ?? [],
    };
  }
}
