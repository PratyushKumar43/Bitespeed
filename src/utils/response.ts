import { Contact, ConsolidatedContact } from "../types";

/**
 * Format the consolidated response from a primary contact and all contacts in the group.
 */
export const formatConsolidatedResponse = (
  primaryContact: Contact,
  allContacts: Contact[]
): ConsolidatedContact => {
  const emails: string[] = [];
  const phoneNumbers: string[] = [];
  const secondaryContactIds: number[] = [];

  // Primary contact's values go first
  if (primaryContact.email) emails.push(primaryContact.email);
  if (primaryContact.phone_number)
    phoneNumbers.push(primaryContact.phone_number);

  // Add secondary contacts' values
  for (const contact of allContacts) {
    if (contact.id === primaryContact.id) continue;

    secondaryContactIds.push(contact.id);

    if (contact.email && !emails.includes(contact.email)) {
      emails.push(contact.email);
    }
    if (
      contact.phone_number &&
      !phoneNumbers.includes(contact.phone_number)
    ) {
      phoneNumbers.push(contact.phone_number);
    }
  }

  return {
    primaryContactId: primaryContact.id,
    emails,
    phoneNumbers,
    secondaryContactIds,
  };
};
