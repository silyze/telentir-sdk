import { ICryptoProvider } from "@mojsoski/server-crypto";
import { ObjectManager, ObjectManagerConfig } from "./crypto";
import { Agent, Call, Campaign, Contact, Pathway, Task } from "./models";
import {
  ObjectRepository,
  HttpClient,
  BillingRepository,
  CreditsRepository,
  EventsRepository,
  InboundConfigurationsRepository,
  KnowledgeBasesRepository,
  PersonasRepository,
  PhoneNumbersRepository,
  SessionsRepository,
  ContactsRepository,
} from "./repos";

/** Configuration required to instantiate the Telentir SDK. */
export interface TelentirConfig {
  apiKey: string;
  api?: string;
}

/** Options accepted by {@link Telentir.connect}. */
export type TelentirCreateOptions<T> = TelentirConfig &
  ObjectManagerConfig & { crypto: ICryptoProvider<T> };

/**
 * Primary entry point that surfaces typed access to Telentir services.
 */
export class Telentir<T> {
  private readonly http: HttpClient;
  private contactsRepository?: ContactsRepository<T>;
  private billingRepository?: BillingRepository;
  private creditsRepository?: CreditsRepository;
  private eventsRepository?: EventsRepository;
  private inboundRepository?: InboundConfigurationsRepository;
  private knowledgeBasesRepository?: KnowledgeBasesRepository;
  private personasRepository?: PersonasRepository;
  private phoneNumbersRepository?: PhoneNumbersRepository;
  private sessionsRepository?: SessionsRepository<T>;

  constructor(
    private readonly manager: ObjectManager<T>,
    private readonly config: TelentirConfig
  ) {
    this.http = new HttpClient(config);
  }

  /**
   * Establishes an authenticated connection and returns a configured client instance.
   */
  static async connect<T>(options: TelentirCreateOptions<T>) {
    const manager = await ObjectManager.create(options.crypto, options);
    return new Telentir(manager, options);
  }

  /** Direct access to the underlying {@link ObjectManager}. */
  get objects() {
    return this.manager;
  }

  /** Encrypted repository for agent objects. */
  get agents() {
    return ObjectRepository.create<T, Agent>(this.manager, "agents");
  }

  /** Encrypted repository for call records. */
  get calls() {
    return ObjectRepository.create<T, Call>(this.manager, "calls");
  }

  /** Contact repository with additional lead-fetch helpers. */
  get contacts() {
    if (!this.contactsRepository) {
      const base = ObjectRepository.create<T, Contact>(
        this.manager,
        "contacts"
      );
      this.contactsRepository = new ContactsRepository(base, this.http);
    }
    return this.contactsRepository;
  }

  /** Encrypted repository for campaign definitions. */
  get campaigns() {
    return ObjectRepository.create<T, Campaign>(this.manager, "campaigns");
  }

  /** Encrypted repository for task objects. */
  get tasks() {
    return ObjectRepository.create<T, Task>(this.manager, "tasks");
  }

  /** Encrypted repository for conversational pathways. */
  get pathways() {
    return ObjectRepository.create<T, Pathway>(
      this.manager,
      "conversational-pathways"
    );
  }

  /** Billing helper for plan and portal management. */
  get billing() {
    if (!this.billingRepository) {
      this.billingRepository = new BillingRepository(this.http);
    }
    return this.billingRepository;
  }

  /** Stripe credit balance utilities. */
  get credits() {
    if (!this.creditsRepository) {
      this.creditsRepository = new CreditsRepository(this.http);
    }
    return this.creditsRepository;
  }

  /** Access to Redis event streams for key/object/publish updates. */
  get events() {
    if (!this.eventsRepository) {
      this.eventsRepository = new EventsRepository(this.http);
    }
    return this.eventsRepository;
  }

  /** CRUD operations for inbound call configurations. */
  get inboundConfigurations() {
    if (!this.inboundRepository) {
      this.inboundRepository = new InboundConfigurationsRepository(this.http);
    }
    return this.inboundRepository;
  }

  /** Knowledge base CRUD and ingestion helpers. */
  get knowledgeBases() {
    if (!this.knowledgeBasesRepository) {
      this.knowledgeBasesRepository = new KnowledgeBasesRepository(this.http);
    }
    return this.knowledgeBasesRepository;
  }

  /** Persona listing and preview helpers. */
  get personas() {
    if (!this.personasRepository) {
      this.personasRepository = new PersonasRepository(this.http);
    }
    return this.personasRepository;
  }

  /** Phone number management utilities. */
  get phoneNumbers() {
    if (!this.phoneNumbersRepository) {
      this.phoneNumbersRepository = new PhoneNumbersRepository(this.http);
    }
    return this.phoneNumbersRepository;
  }

  /** Session call JWT and execution utilities. */
  get sessions() {
    if (!this.sessionsRepository) {
      this.sessionsRepository = new SessionsRepository(this.manager, this.http);
    }
    return this.sessionsRepository;
  }
}

/** Convenience re-export of {@link Telentir.connect}. */
export const connect = Telentir.connect;
