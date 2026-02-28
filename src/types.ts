export interface Contact {
  id: number;
  phone_number: string | null;
  email: string | null;
  linked_id: number | null;
  link_precedence: "primary" | "secondary";
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface IdentifyRequest {
  email?: string | null;
  phoneNumber?: string | null;
}

export interface ConsolidatedContact {
  primaryContactId: number;
  emails: string[];
  phoneNumbers: string[];
  secondaryContactIds: number[];
}

export interface IdentifyResponse {
  contact: ConsolidatedContact;
}
