import supabase from "../config/supabase";
import { Contact } from "../types";

/**
 * Fetch all non-deleted contacts matching the given email or phone.
 */
export const findContactsByEmailOrPhone = async (
  email: string | null | undefined,
  phone: string | null | undefined
): Promise<Contact[]> => {
  let query = supabase
    .from("contacts")
    .select("*")
    .is("deleted_at", null);

  // Build OR filter
  const orFilters: string[] = [];
  if (email) orFilters.push(`email.eq.${email}`);
  if (phone) orFilters.push(`phone_number.eq.${phone}`);

  if (orFilters.length === 0) return [];

  query = query.or(orFilters.join(","));

  const { data, error } = await query;
  if (error) throw error;
  return (data as Contact[]) || [];
};

/**
 * Fetch a single contact by ID.
 */
export const findContactById = async (
  id: number
): Promise<Contact | null> => {
  const { data, error } = await supabase
    .from("contacts")
    .select("*")
    .eq("id", id)
    .is("deleted_at", null)
    .single();

  if (error && error.code !== "PGRST116") throw error;
  return (data as Contact) || null;
};

/**
 * Fetch all contacts linked to a given primary ID (i.e. its secondaries).
 */
export const findLinkedContacts = async (
  primaryId: number
): Promise<Contact[]> => {
  const { data, error } = await supabase
    .from("contacts")
    .select("*")
    .eq("linked_id", primaryId)
    .is("deleted_at", null);

  if (error) throw error;
  return (data as Contact[]) || [];
};

/**
 * Insert a new contact row.
 */
export const createContact = async (contactData: {
  phone_number?: string | null;
  email?: string | null;
  linked_id?: number | null;
  link_precedence: "primary" | "secondary";
}): Promise<Contact> => {
  const { data, error } = await supabase
    .from("contacts")
    .insert(contactData)
    .select()
    .single();

  if (error) throw error;
  return data as Contact;
};

/**
 * Demote a contact to secondary: set link_precedence, linked_id, and updated_at.
 */
export const updateContactToSecondary = async (
  id: number,
  primaryId: number
): Promise<void> => {
  const { error } = await supabase
    .from("contacts")
    .update({
      link_precedence: "secondary",
      linked_id: primaryId,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);

  if (error) throw error;
};

/**
 * Re-link all secondaries pointing to oldPrimaryId to point to newPrimaryId.
 */
export const relinkSecondaries = async (
  oldPrimaryId: number,
  newPrimaryId: number
): Promise<void> => {
  const { error } = await supabase
    .from("contacts")
    .update({
      linked_id: newPrimaryId,
      updated_at: new Date().toISOString(),
    })
    .eq("linked_id", oldPrimaryId);

  if (error) throw error;
};
