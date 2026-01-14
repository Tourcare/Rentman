const config = require('../../config');
const { createChildLogger } = require('../../lib/logger');
const db = require('../../lib/database');
const hubspot = require('../../lib/hubspot-client');
const rentman = require('../../lib/rentman-client');
const { sanitizeEmail, formatContactName, randomSleep, retry, findAssociationId, sleep } = require('../../lib/utils');

const logger = createChildLogger('hubspot-contact');

async function handleHubSpotContactWebhook(events) {
    logger.info('Behandler HubSpot contact webhook', { eventCount: events.length });

    for (const event of events) {
        await randomSleep(500, 2000);

        if (event.changeSource === 'OBJECT_MERGE') {
            logger.info('Ignorerer OBJECT_MERGE event');
            break;
        }

        try {
            if (event.objectId) {
                await handleObjectEvent(event);
            } else if (event.associationType) {
                await handleAssociationEvent(event);
            }
        } catch (error) {
            logger.error('Fejl ved behandling af contact event', {
                error: error.message,
                stack: error.stack,
                event
            });
        }
    }
}

async function handleObjectEvent(event) {
    const { objectTypeId, subscriptionType, objectId } = event;

    if (subscriptionType === 'object.deletion') {
        return;
    }

    if (objectTypeId === config.hubspot.objectTypes.contacts) {
        await handleContactEvent(event);
    } else if (objectTypeId === config.hubspot.objectTypes.companies) {
        await handleCompanyEvent(event);
    }
}

async function handleContactEvent(event) {
    const { subscriptionType, objectId } = event;
    const contact = await hubspot.getContact(objectId, ['firstname', 'lastname', 'email']);

    if (!contact) {
        logger.warn('Kontakt ikke fundet i HubSpot', { objectId });
        return;
    }

    if (subscriptionType === 'object.creation') {
        await handleContactCreation(contact);
    } else if (subscriptionType === 'object.propertyChange') {
        await handleContactUpdate(contact);
    }
}

async function handleContactCreation(contact) {
    const companyAssociations = contact.associations?.companies?.results;

    if (!companyAssociations || companyAssociations.length === 0) {
        logger.info('Kontakt har ingen tilknyttet virksomhed', { contactId: contact.id });
        return;
    }

    const primaryCompanyId = findAssociationId(companyAssociations, 'contact_to_company');

    if (!primaryCompanyId) {
        logger.info('Kontakt har ingen primary company association', { contactId: contact.id });
        return;
    }

    const dbCompany = await retry(
        () => db.findSyncedCompanyByHubspotId(primaryCompanyId),
        { maxAttempts: 3, delayMs: 3000 }
    );

    if (!dbCompany?.rentman_id) {
        logger.warn('Ingen Rentman virksomhed fundet', { hubspotCompanyId: primaryCompanyId });
        return;
    }

    const contactData = buildRentmanContactData(contact);
    const rentmanPerson = await rentman.createContactPerson(dbCompany.rentman_id, contactData);

    const name = formatContactName(
        contact.properties.firstname,
        null,
        contact.properties.lastname
    );

    await db.upsertSyncedContact(name, rentmanPerson.id, contact.id, dbCompany.hubspot_id);

    logger.syncOperation('create', 'contact_person', {
        rentmanId: rentmanPerson.id,
        hubspotId: contact.id,
        companyId: dbCompany.rentman_id
    }, true);
}

async function handleContactUpdate(contact) {
    const dbContact = await retry(
        () => db.findSyncedContactByHubspotId(contact.id),
        { maxAttempts: 3, delayMs: 3000 }
    );

    if (!dbContact?.rentman_id) {
        logger.warn('Ingen Rentman kontakt fundet', { hubspotId: contact.id });
        return;
    }

    const contactData = buildRentmanContactData(contact);
    await rentman.updateContactPerson(dbContact.rentman_id, contactData);

    const name = formatContactName(
        contact.properties.firstname,
        null,
        contact.properties.lastname
    );

    await db.updateSyncedContactName(dbContact.rentman_id, name);

    logger.syncOperation('update', 'contact_person', {
        rentmanId: dbContact.rentman_id,
        hubspotId: contact.id
    }, true);
}

async function handleCompanyEvent(event) {
    const { subscriptionType, objectId } = event;
    const company = await hubspot.getCompany(objectId);

    if (!company) {
        logger.warn('Virksomhed ikke fundet i HubSpot', { objectId });
        return;
    }

    if (subscriptionType === 'object.creation') {
        await handleCompanyCreation(company);
    } else if (subscriptionType === 'object.propertyChange') {
        await handleCompanyUpdate(company);
    }
}

async function handleCompanyCreation(company) {
    const rentmanContact = await rentman.createContact(
        company.properties.name,
        company.properties.cvrnummer || ''
    );

    await db.upsertSyncedCompany(
        company.properties.name,
        rentmanContact.id,
        company.id
    );

    logger.syncOperation('create', 'company', {
        rentmanId: rentmanContact.id,
        hubspotId: company.id
    }, true);
}

async function handleCompanyUpdate(company) {
    const dbCompany = await retry(
        () => db.findSyncedCompanyByHubspotId(company.id),
        { maxAttempts: 3, delayMs: 3000 }
    );

    if (!dbCompany?.rentman_id) {
        logger.warn('Ingen Rentman virksomhed fundet', { hubspotId: company.id });
        return;
    }

    await rentman.updateContact(dbCompany.rentman_id, {
        name: company.properties.name,
        VAT_code: company.properties.cvrnummer || ''
    });

    await db.updateSyncedCompanyName(company.id, company.properties.name);

    logger.syncOperation('update', 'company', {
        rentmanId: dbCompany.rentman_id,
        hubspotId: company.id
    }, true);
}

async function handleAssociationEvent(event) {
    const { associationType, associationRemoved, fromObjectId, toObjectId } = event;

    if (associationType !== 'CONTACT_TO_COMPANY' && associationType !== 'COMPANY_TO_CONTACT') {
        return;
    }

    const isContactToCompany = associationType === 'CONTACT_TO_COMPANY';
    const companyId = isContactToCompany ? toObjectId : fromObjectId;
    const contactId = isContactToCompany ? fromObjectId : toObjectId;

    const company = await hubspot.getCompany(companyId);
    const contact = await hubspot.getContact(contactId, ['firstname', 'lastname', 'email']);

    if (!company || !contact) {
        logger.warn('Kunne ikke hente company eller contact', { companyId, contactId });
        return;
    }

    const dbCompany = await retry(
        () => db.findSyncedCompanyByHubspotId(company.id),
        { maxAttempts: 3, delayMs: 3000 }
    );

    if (!dbCompany?.rentman_id) {
        logger.warn('Ingen Rentman virksomhed fundet for association', {
            hubspotCompanyId: company.id
        });
        return;
    }

    if (associationRemoved) {
        await handleAssociationRemoval(contact, dbCompany);
    } else {
        await handleAssociationCreation(contact, dbCompany);
    }
}

async function handleAssociationRemoval(contact, dbCompany) {
    const dbContact = await retry(
        () => db.findSyncedContactByHubspotIdAndCompany(contact.id, dbCompany.hubspot_id),
        { maxAttempts: 3, delayMs: 3000 }
    );

    if (!dbContact) {
        logger.warn('Ingen synced contact fundet for fjernelse', {
            hubspotContactId: contact.id,
            hubspotCompanyId: dbCompany.hubspot_id
        });
        return;
    }

    await rentman.deleteContactPerson(dbContact.rentman_id);
    await db.deleteSyncedContactByHubspotIdAndCompany(contact.id, dbCompany.hubspot_id);

    const name = formatContactName(
        contact.properties.firstname,
        null,
        contact.properties.lastname
    );

    logger.syncOperation('delete', 'contact_person', {
        rentmanId: dbContact.rentman_id,
        hubspotId: contact.id,
        name
    }, true);
}

async function handleAssociationCreation(contact, dbCompany) {
    const existingContact = await db.findSyncedContactByHubspotIdAndCompany(
        contact.id,
        dbCompany.hubspot_id
    );

    if (existingContact) {
        logger.info('Kontakt allerede synced til denne virksomhed', {
            contactId: contact.id,
            companyId: dbCompany.hubspot_id
        });
        return;
    }

    for (let attempt = 0; attempt < 2; attempt++) {
        const duplicateCheck = await db.findSyncedContactByHubspotIdAndCompany(
            contact.id,
            dbCompany.hubspot_id
        );

        if (duplicateCheck) {
            logger.info('Duplikat fundet efter retry', { contactId: contact.id });
            return;
        }

        await randomSleep(500, 2000);
    }

    const contactData = buildRentmanContactData(contact);
    const rentmanPerson = await rentman.createContactPerson(dbCompany.rentman_id, contactData);

    const finalCheck = await db.findSyncedContactByHubspotIdAndCompany(
        contact.id,
        dbCompany.hubspot_id
    );

    if (finalCheck) {
        logger.warn('Race condition opdaget - sletter nyoprettet Rentman kontakt', {
            rentmanId: rentmanPerson.id
        });
        await rentman.deleteContactPerson(rentmanPerson.id);
        return;
    }

    const name = formatContactName(
        contact.properties.firstname,
        null,
        contact.properties.lastname
    );

    await db.insertSyncedContact(name, rentmanPerson.id, contact.id, dbCompany.hubspot_id);

    logger.syncOperation('create', 'contact_person', {
        rentmanId: rentmanPerson.id,
        hubspotId: contact.id,
        companyId: dbCompany.rentman_id
    }, true);
}

function buildRentmanContactData(contact) {
    const email = sanitizeEmail(contact.properties.email);

    const data = {
        firstname: contact.properties.firstname || '',
        lastname: contact.properties.lastname || ''
    };

    if (email) {
        data.email = email;
    }

    return data;
}

module.exports = {
    handleHubSpotContactWebhook
};
