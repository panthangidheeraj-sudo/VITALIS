/**
 * Adapts the real, user-entered profile contacts into the shape the server's
 * notification layer takes.
 *
 * THE DEFAULTS HERE ARE DELIBERATE AND CONSERVATIVE:
 *
 *  - WhatsApp on, SMS off. A Twilio trial account can only reach numbers
 *    verified in its console over SMS, and India requires DLT template
 *    registration for A2P SMS besides; the WhatsApp sandbox has neither
 *    restriction. An SMS that is accepted by the API and never delivered is
 *    worse than one that was never attempted, because nothing reports it.
 *
 *  - `canRelay` ONLY for the primary contact. Being someone's emergency contact
 *    and being authorised to answer clinical questions on their behalf are
 *    different permissions, and defaulting the second from the first for
 *    everybody would hand a neighbour the medical interview.
 */

import type { ProfileContact } from './profileStore';
import type { NotifiableContact } from '../api/client';

export function toNotifiableContacts(contacts: readonly ProfileContact[]): readonly NotifiableContact[] {
  return contacts.map((contact, index) => ({
    id: contact.id,
    name: contact.name,
    relationship: contact.relationship,
    phoneE164: contact.phone,
    whatsappEnabled: true,
    smsEnabled: false,
    // Primary first, so the server's priority ordering matches what the card
    // shows. A list that notifies in a different order than it displays is a
    // small thing that reads as a bug at exactly the wrong moment.
    priority: contact.isPrimary ? 0 : index + 1,
    canRelay: contact.isPrimary,
  }));
}
