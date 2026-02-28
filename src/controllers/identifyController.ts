import { Request, Response } from "express";
import {
  findContactsByEmailOrPhone,
  findContactById,
  findLinkedContacts,
  createContact,
  updateContactToSecondary,
  relinkSecondaries,
} from "../services/contactService";
import { formatConsolidatedResponse } from "../utils/response";
import { Contact, IdentifyResponse } from "../types";

/**
 * Gather the full linked group for a set of matched contacts.
 * Returns all unique contacts belonging to the same identity group.
 */
const gatherFullGroup = async (
  matchedContacts: Contact[]
): Promise<Contact[]> => {
  const contactMap = new Map<number, Contact>();

  for (const contact of matchedContacts) {
    contactMap.set(contact.id, contact);

    // If this contact is secondary, fetch its primary
    if (
      contact.link_precedence === "secondary" &&
      contact.linked_id !== null
    ) {
      if (!contactMap.has(contact.linked_id)) {
        const primary = await findContactById(contact.linked_id);
        if (primary) contactMap.set(primary.id, primary);
      }
    }

    // If this contact is primary, fetch its secondaries
    if (contact.link_precedence === "primary") {
      const secondaries = await findLinkedContacts(contact.id);
      for (const sec of secondaries) {
        contactMap.set(sec.id, sec);
      }
    }
  }

  // Also fetch secondaries for any primaries we discovered through linked_id
  const primaries = [...contactMap.values()].filter(
    (c) => c.link_precedence === "primary"
  );
  for (const primary of primaries) {
    const secondaries = await findLinkedContacts(primary.id);
    for (const sec of secondaries) {
      contactMap.set(sec.id, sec);
    }
  }

  return [...contactMap.values()];
};

/**
 * Handle POST /identify — identity reconciliation logic.
 */
export const handleIdentify = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const email: string | null = req.body.email || null;
    const phoneNumber: string | null = req.body.phoneNumber || null;

    // Step 1: Query all existing contacts matching email OR phone
    const matchedContacts = await findContactsByEmailOrPhone(
      email,
      phoneNumber
    );

    // Step 2: No matches — create a new primary contact
    if (matchedContacts.length === 0) {
      const newContact = await createContact({
        email,
        phone_number: phoneNumber,
        link_precedence: "primary",
      });

      console.log(`[IDENTIFY] Created new primary contact id=${newContact.id}`);

      const response: IdentifyResponse = {
        contact: formatConsolidatedResponse(newContact, [newContact]),
      };
      res.status(200).json(response);
      return;
    }

    // Step 3: Gather the full linked group
    let allContacts = await gatherFullGroup(matchedContacts);

    // Step 3c: Determine the primary contacts
    const primaryContacts = allContacts
      .filter((c) => c.link_precedence === "primary")
      .sort(
        (a, b) =>
          new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      );

    let survivingPrimary = primaryContacts[0];

    // Step 3d: If multiple primaries exist, merge groups
    if (primaryContacts.length > 1) {
      for (let i = 1; i < primaryContacts.length; i++) {
        const demotedPrimary = primaryContacts[i];

        console.log(
          `[IDENTIFY] Demoting primary id=${demotedPrimary.id} → secondary of id=${survivingPrimary.id}`
        );

        // Re-link all secondaries of the demoted primary first
        await relinkSecondaries(demotedPrimary.id, survivingPrimary.id);

        // Demote the primary itself
        await updateContactToSecondary(demotedPrimary.id, survivingPrimary.id);
      }

      // Re-gather the full group after merging
      allContacts = await gatherFullGroup([survivingPrimary]);
      // Refresh the surviving primary reference
      const refreshed = await findContactById(survivingPrimary.id);
      if (refreshed) survivingPrimary = refreshed;
    }

    // Step 3e: Check if the request contains new information
    const existingEmails = new Set(
      allContacts.map((c) => c.email).filter(Boolean)
    );
    const existingPhones = new Set(
      allContacts.map((c) => c.phone_number).filter(Boolean)
    );

    const hasNewEmail = email !== null && !existingEmails.has(email);
    const hasNewPhone = phoneNumber !== null && !existingPhones.has(phoneNumber);

    if (hasNewEmail || hasNewPhone) {
      const newSecondary = await createContact({
        email,
        phone_number: phoneNumber,
        linked_id: survivingPrimary.id,
        link_precedence: "secondary",
      });

      console.log(
        `[IDENTIFY] Created new secondary contact id=${newSecondary.id} linked to primary id=${survivingPrimary.id}`
      );

      allContacts.push(newSecondary);
    }

    // Step 3f: Return the consolidated response
    // Sort: primary first, then secondaries by id
    allContacts.sort((a, b) => {
      if (a.id === survivingPrimary.id) return -1;
      if (b.id === survivingPrimary.id) return 1;
      return a.id - b.id;
    });

    const response: IdentifyResponse = {
      contact: formatConsolidatedResponse(survivingPrimary, allContacts),
    };
    res.status(200).json(response);
  } catch (error) {
    console.error("[IDENTIFY] Error:", error);

    const message =
      process.env.NODE_ENV === "production"
        ? "Internal server error"
        : (error as Error).message || "Internal server error";

    res.status(500).json({ error: message });
  }
};
