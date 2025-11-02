/** Common relation metadata embedded on Telentir objects. */
interface WithRelations {
  relations: Record<string, string>;
}

/** Representation of a human agent. */
interface HumanAgent {
  type: "human";
  phoneNumber: string;
}

/** Representation of an AI agent referencing a persona. */
interface AiAgent {
  type: "ai";
  persona: string;
}

type AgentType = HumanAgent | AiAgent;

type AgentData = {
  avatar: string;
  firstName: string;
  lastName: string;
  language: string;
};

/** Telentir agent model combining human/AI specific properties. */
export type Agent = Partial<WithRelations> & AgentType & AgentData;

/** Encrypted call record tracked inside Telentir. */
export interface Call extends WithRelations {
  startDate: string | Date;
  conversationStartDate?: string | Date;

  endDate?: string | Date;

  contact: {
    id?: string;
    name?: string;
    phone: string;
  };

  phone: {
    id: string;
    number: string;
  };

  stage: string;

  direction: "inbound" | "outbound";
  status: "completed" | "missed" | "voicemail" | "callback" | "ongoing";

  notes?: string;

  agents: { id: string; name: string }[];

  knowledgeBase?: string;

  relations: {
    transcription?: string;
    audio?: string;
  };
}

interface PromptCampaign {
  type: "prompt";
  prompt: {
    text: string;
  };
}

interface Index {
  id: string;
}

/** Contact information persisted in Telentir. */
export interface Contact extends Partial<WithRelations> {
  name?: string;
  company?: string;
  tags: string[];
  phone: string;
  email?: string;
  status: string;
  notes?: string[];
}

/** Conversational pathway definition used by campaigns. */
export interface Pathway extends Partial<WithRelations> {
  name: string;
  description: string;
  status: "live" | "draft";
  nodes: any[];
  edges: any[];
}

interface PathwayCampaign {
  type: "pathway";
  pathway: {
    id: string;
    name: string;
    nodes: Pathway["nodes"];
    edges: Pathway["edges"];
  } | null;
}

/** Source union describing how a campaign targets contacts. */
export type CampaignSource = PromptCampaign | PathwayCampaign;

interface CampaignData extends WithRelations {
  contacts: {
    tags: string[];
    items: (Contact & Index)[];
  };
  name: string;
  agents: (Agent & Index)[];
  relations: {
    "call-logs"?: string;
    "answered-logs"?: string;
    "duration-logs"?: string;
  };
  knowledgeBase?: string;
}

/** Campaign model combining contact sources and metadata. */
export type Campaign = CampaignSource & CampaignData;

/** Task assigned to a user within Telentir. */
export interface Task extends Partial<WithRelations> {
  title: string;
  contact?: {
    id: string;
    name: string;
  };
  due: string | Date;
  priority: "low" | "medium" | "high";
  status: "pending" | "in-progress" | "completed";
  assignedTo: string;
}
