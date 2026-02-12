const { createChildLogger } = require('../../lib/logger');
const db = require('../../lib/database');
const hubspot = require('../../lib/hubspot-client');
const rentman = require('../../lib/rentman-client');
const { sanitizeEmail, formatContactName, retry, getFormatedRentmanAdress } = require('../../lib/utils');

const logger = createChildLogger('rentman-contact');

async function createContact(webhook) {
    const item = webhook.items[0];
    const itemType = webhook.itemType;

    try {
        if (itemType === 'Contact') {
            await createCompanyFromRentman(item);
        } else if (itemType === 'ContactPerson') {
            await createContactPersonFromRentman(item);
        } else {
            logger.warn('Ukendt itemType', { itemType });
        }
    } catch (error) {
        logger.error('Fejl ved oprettelse af contact', {
            error: error.message,
            stack: error.stack,
            itemType,
            itemRef: item.ref
        });
        throw error;
    }
}

async function updateContact(webhook) {
    const item = webhook.items[0];
    const itemType = webhook.itemType;

    try {
        if (itemType === 'Contact') {
            await updateCompanyFromRentman(item);
        } else if (itemType === 'ContactPerson') {
            await updateContactPersonFromRentman(item);
        } else {
            logger.warn('Ukendt itemType', { itemType });
        }
    } catch (error) {
        logger.error('Fejl ved opdatering af contact', {
            error: error.message,
            stack: error.stack,
            itemType,
            itemRef: item.ref
        });
        throw error;
    }
}

async function deleteContact(webhook) {
    const items = webhook.items;
    const itemType = webhook.itemType;

    try {
        if (itemType === 'Contact') {
            for (const item of items) {
                await deleteCompanyFromRentman(item);
            }
        } else if (itemType === 'ContactPerson') {
            for (const item of items) {
                await deleteContactPersonFromRentman(item);
            }
        } else {
            logger.warn('Ukendt itemType', { itemType });
        }
    } catch (error) {
        logger.error('Fejl ved sletning af contact', {
            error: error.message,
            stack: error.stack,
            itemType
        });
        throw error;
    }
}

async function createCompanyFromRentman(item) {
    const contactData = await rentman.get(item.ref);
    if (!contactData) {
        logger.warn('Kunne ikke hente contact data fra Rentman', { ref: item.ref });
        return;
    }

    logger.info('Opretter virksomhed', { name: contactData.displayname });

    const companyAdress = getFormatedRentmanAdress(contactData.visit_street, contactData.invoice_city)

    const companyResult = await hubspot.createCompany({
        name: contactData.displayname,
        cvrnummer: contactData.VAT_code || '',
        city: contactData.visit_city || contactData.invoice_city || '',
        country: contactData.country || '',
        address: companyAdress || '',
        state: contactData.invoice_state || contactData.visit_state || '',
        hs_state_code: contactData.invoice_postalcode || contactData.invoice_postalcode || ''
    });

    await db.upsertSyncedCompany(contactData.displayname, contactData.id, companyResult.id);

    logger.syncOperation('create', 'company', {
        rentmanId: contactData.id,
        hubspotId: companyResult.id
    }, true);
}

async function createContactPersonFromRentman(item) {
    const personData = await rentman.get(item.ref);
    if (!personData) {
        logger.warn('Kunne ikke hente person data fra Rentman', { ref: item.ref });
        return;
    }

    const parentId = item.parent?.id;
    if (!parentId) {
        logger.warn('Ingen parent fundet for ContactPerson');
        return;
    }

    const companyDb = await retry(
        () => db.findSyncedCompanyByRentmanId(parentId),
        { maxAttempts: 3, delayMs: 5000 }
    );

    if (!companyDb?.hubspot_id) {
        logger.warn('Ingen virksomhed fundet i database', { rentmanId: parentId });
        return;
    }

    logger.info('Opretter kontaktperson', { name: personData.displayname });

    const email = sanitizeEmail(personData.email);
    const contactResult = await hubspot.createContact({
        email: email,
        lastname: formatContactName(null, personData.middle_name, personData.lastname),
        firstname: personData.firstname || ''
    }, companyDb.hubspot_id);

    if (contactResult?.id) {
        await db.upsertSyncedContact(
            personData.displayname,
            personData.id,
            contactResult.id,
            companyDb.hubspot_id
        );

        logger.syncOperation('create', 'contact_person', {
            rentmanId: personData.id,
            hubspotId: contactResult.id
        }, true);
    }
}

async function updateCompanyFromRentman(item) {
    const contactData = await rentman.get(item.ref);
    if (!contactData) {
        logger.warn('Kunne ikke hente contact data fra Rentman', { ref: item.ref });
        return;
    }

    const companyDb = await db.findSyncedCompanyByRentmanId(contactData.id);
    if (!companyDb?.hubspot_id) {
        logger.warn('Ingen virksomhed fundet i database', { rentmanId: contactData.id });
        return;
    }

    logger.info('Opdaterer virksomhed', { name: contactData.displayname });

    const companyAdress = getFormatedRentmanAdress(contactData.visit_street, contactData.invoice_city)

    await hubspot.updateCompany(companyDb.hubspot_id, {
        name: contactData.displayname,
        cvrnummer: contactData.VAT_code || '',
        city: contactData.visit_city || contactData.invoice_city || '',
        country: contactData.country || '',
        address: companyAdress || '',
        state: contactData.invoice_state || contactData.visit_state || '',
        hs_state_code: contactData.invoice_postalcode || contactData.invoice_postalcode || ''
    });

    await db.updateSyncedCompanyName(companyDb.hubspot_id, contactData.displayname);

    logger.syncOperation('update', 'company', {
        rentmanId: contactData.id,
        hubspotId: companyDb.hubspot_id
    }, true);
}

async function updateContactPersonFromRentman(item) {
    const personData = await rentman.get(item.ref);
    if (!personData) {
        logger.warn('Kunne ikke hente person data fra Rentman', { ref: item.ref });
        return;
    }

    const contactDb = await db.findSyncedContactByRentmanId(personData.id);
    if (!contactDb?.hubspot_id) {
        logger.warn('Ingen kontaktperson fundet i database', { rentmanId: personData.id });
        return;
    }

    logger.info('Opdaterer kontaktperson', { name: personData.displayname });

    const email = sanitizeEmail(personData.email);

    await hubspot.updateContact(contactDb.hubspot_id, {
        email: email,
        lastname: formatContactName(null, personData.middle_name, personData.lastname),
        firstname: personData.firstname || ''
    });

    if (item.parent?.id) {
        const newCompanyDb = await db.findSyncedCompanyByRentmanId(item.parent.id);
        if (newCompanyDb?.hubspot_id) {
            await hubspot.addAssociation(
                'contacts',
                contactDb.hubspot_id,
                'companies',
                newCompanyDb.hubspot_id,
                1
            );
        }
    }

    await db.updateSyncedContactName(personData.id, personData.displayname);

    logger.syncOperation('update', 'contact_person', {
        rentmanId: personData.id,
        hubspotId: contactDb.hubspot_id
    }, true);
}

async function deleteCompanyFromRentman(rentmanId) {
    const companyDb = await db.findSyncedCompanyByRentmanId(rentmanId);
    if (!companyDb?.hubspot_id) {
        logger.warn('Ingen virksomhed fundet i database', { rentmanId });
        return;
    }

    logger.info('Sletter virksomhed', { hubspotId: companyDb.hubspot_id });

    await hubspot.deleteCompany(companyDb.hubspot_id);
    await db.deleteSyncedCompany(rentmanId);

    logger.syncOperation('delete', 'company', {
        rentmanId,
        hubspotId: companyDb.hubspot_id
    }, true);
}

async function deleteContactPersonFromRentman(rentmanId) {
    const contactDb = await retry(
        () => db.findSyncedContactByRentmanId(rentmanId),
        { maxAttempts: 3, delayMs: 5000 }
    );

    if (!contactDb) {
        logger.warn('Ingen kontaktperson fundet i database', { rentmanId });
        return;
    }

    if (contactDb.hubspot_company_conntected) {
        logger.info('Fjerner association for kontaktperson', {
            contactId: contactDb.hubspot_id,
            companyId: contactDb.hubspot_company_conntected
        });

        await hubspot.removeAssociation(
            'contacts',
            contactDb.hubspot_id,
            'companies',
            contactDb.hubspot_company_conntected,
            1
        );

        await db.deleteSyncedContact(rentmanId);

        logger.syncOperation('delete', 'contact_person', {
            rentmanId,
            hubspotId: contactDb.hubspot_id
        }, true);
    } else {
        logger.warn('Kunne ikke finde virksomhed for kontaktperson', { rentmanId });
    }
}

module.exports = {
    createContact,
    updateContact,
    deleteContact
};
