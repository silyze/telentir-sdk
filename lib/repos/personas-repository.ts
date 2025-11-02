import type {
  EncryptedContent,
  EncryptedHeader,
} from "@mojsoski/server-crypto";
import { HttpClient } from "./http-client";

/** Supported persona gender identifiers. */
export type PersonaGender = "male" | "female" | "other";

/** Persona definition sourced from OpenAI voices. */
export interface OpenAiPersona {
  id: `openai-${string}`;
  name: string;
  countryEmoji: string;
  gender: PersonaGender;
  description: string;
  rating: number;
  tags: string[];
  avatarUrl: string;
  settings: {
    type: "openai";
    voice: string;
    instructions: string[];
  };
}

/** Persona description built from ElevenLabs voice inventory. */
export interface ElevenLabsPersona {
  id: `elevenlabs-${string}`;
  name: string;
  countryEmoji: string;
  gender: PersonaGender | string;
  description: string;
  rating: number;
  tags: string[];
  avatarUrl: string;
  settings: {
    type: "elevenlabs";
    voiceId: string;
    previewUrl?: string;
  };
}

/** Union representing every persona variant. */
export type Persona = OpenAiPersona | ElevenLabsPersona;

/** Payload required to request a persona preview from Telentir. */
export interface PersonaPreviewRequest {
  server: string;
  jwt: string;
}

/** Encrypted audio response produced by persona preview. */
export interface PersonaPreviewResponse {
  header: EncryptedHeader;
  content: EncryptedContent;
}

/**
 * Provides typed access to persona discovery and preview APIs.
 */
export class PersonasRepository {
  constructor(private readonly http: HttpClient) {}

  /** Retrieves a persona definition by identifier. */
  async get(id: string): Promise<Persona> {
    return await this.http.request<Persona>(`/persona/${id}`);
  }

  /** Lists dynamic personas sourced from ElevenLabs. */
  async listExternal(): Promise<Persona[]> {
    return await this.http.request<Persona[]>("/persona/list-external");
  }

  /**
   * Generates a short encrypted audio preview for the supplied persona.
   *
   * @param id - Persona identifier.
   * @param request - Signed JWT and server metadata.
   */
  async preview(
    id: string,
    request: PersonaPreviewRequest
  ): Promise<PersonaPreviewResponse> {
    return await this.http.request<PersonaPreviewResponse>(
      `/persona/${id}/play`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(request),
      }
    );
  }
}
