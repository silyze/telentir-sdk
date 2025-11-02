import { assert } from "@mojsoski/assert";
import { ObjectManager } from "../crypto";
import { Agent, Contact, Pathway } from "../models";
import { HttpClient } from "./http-client";

/** Utility type ensuring an entity carries its identifier. */
export type Identified<T> = T & { id: string };

/** Shared call payload properties applicable to prompt and pathway calls. */
export type SessionCallBase = {
  contact: Identified<Contact>;
  agent: Identified<Agent>;
  humanAgents?: Identified<Agent>[];
  knowledgeBase?: string;
};

/** Payload for calls triggered directly from a prompt. */
export type SessionCallPromptPayload = SessionCallBase & {
  type: "prompt";
  prompt: string;
  pathway?: never;
};

/** Payload for calls executed via a conversational pathway. */
export type SessionCallPathwayPayload = SessionCallBase & {
  type: "pathway";
  pathway: Identified<Pathway>;
  prompt?: never;
};

/**
 * Union of call payloads accepted by {@link SessionsRepository.createCallJwt},
 * {@link SessionsRepository.startCall} and {@link SessionsRepository.call}.
 */
export type SessionCallPayload =
  | SessionCallPromptPayload
  | SessionCallPathwayPayload;

/** Optional overrides when generating a call JWT. */
export interface SessionCallJwtOptions {
  /**
   * Optional expiration for the signed JWT, defaults to 10 minutes.
   */
  expiresIn?: string;
  /**
   * Override the server that should sign the JWT. Defaults to the first available current server.
   */
  serverName?: string;
  /**
   * Override the remote server that should encrypt the payload. Defaults to the API's current server.
   */
  remoteName?: string;
}

/** JWT authentication payload that activates a Telentir session call. */
export interface SessionCallAuth {
  server: string;
  jwt: string;
}

/**
 * Repository that encapsulates JWT creation and call initiation workflows.
 */
export class SessionsRepository<T> {
  constructor(
    private readonly manager: ObjectManager<T>,
    private readonly http: HttpClient
  ) {}

  private sanitizeCallPayload(payload: SessionCallPayload): SessionCallPayload {
    const agent = { ...payload.agent, avatar: "" };
    const humanAgents = (payload.humanAgents ?? []).map((agentItem) => ({
      ...agentItem,
      avatar: "",
    }));

    const knowledgeBase =
      payload.knowledgeBase !== undefined ? payload.knowledgeBase : undefined;

    if (payload.type === "prompt") {
      assert(
        typeof payload.prompt === "string" && payload.prompt.length > 0,
        "Session call payload requires a prompt."
      );
      return {
        type: "prompt",
        prompt: payload.prompt,
        contact: payload.contact,
        agent,
        humanAgents,
        ...(knowledgeBase !== undefined ? { knowledgeBase } : {}),
      };
    }

    assert(payload.pathway, "Session call payload requires a pathway.");

    return {
      type: "pathway",
      pathway: payload.pathway,
      contact: payload.contact,
      agent,
      humanAgents,
      ...(knowledgeBase !== undefined ? { knowledgeBase } : {}),
    };
  }

  /**
   * Creates a signed JWT capable of starting a Telentir voice session.
   *
   * @param payload - Call description including the contact and agent.
   * @param options - Overrides for signing server, remote encryption and expiry.
   */
  async createCallJwt(
    payload: SessionCallPayload,
    options?: SessionCallJwtOptions
  ): Promise<SessionCallAuth> {
    const sanitized = this.sanitizeCallPayload(payload);

    const serverName =
      options?.serverName ?? this.manager.defaultCurrentServerName();
    const remoteName = options?.remoteName ?? this.manager.remoteName;

    const serverManager = this.manager.serverManagerOf(serverName);
    const remoteServer = serverManager.get(remoteName);

    assert(remoteServer, `Remote server '${remoteName}' was not found.`);
    assert(
      serverManager.self,
      "Current server with private key is not available."
    );

    const data = await remoteServer.encryptBase64(sanitized);
    const jwt = await serverManager.self.signJwt(
      { data },
      options?.expiresIn ?? "10 minutes"
    );

    return { jwt, server: serverManager.self.name };
  }

  /**
   * Initiates a call by posting the generated JWT to `/api/session/call`.
   *
   * @param auth - Output from {@link createCallJwt}.
   */
  async startCall(auth: SessionCallAuth): Promise<void> {
    await this.http.request("/session/call", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(auth),
      responseType: "void",
    });
  }

  /**
   * Convenience wrapper that both generates the JWT and initiates the call.
   *
   * @param payload - Call description including the contact and agent.
   * @param options - Overrides for signing server, remote encryption and expiry.
   * @returns The generated call authentication payload for logging or retries.
   */
  async call(
    payload: SessionCallPayload,
    options?: SessionCallJwtOptions
  ): Promise<SessionCallAuth> {
    const auth = await this.createCallJwt(payload, options);
    await this.startCall(auth);
    return auth;
  }
}
