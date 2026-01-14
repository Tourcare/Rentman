const db = require('../lib/database');
const hubspot = require('../lib/hubspot-client');
const rentman = require('../lib/rentman-client');
const { createChildLogger } = require('../lib/logger');
const { SyncLogger } = require('./sync-logger');
const { sanitizeEmail, formatContactName, extractIdFromRef } = require('../lib/utils');

const logger = createChildLogger('sync-contacts');

async function syncContacts(options = {}) {
    const {
        direction = 'bidirectional',
        batchSize = 100,
        triggeredBy = 'system'
    } = options;

    const syncLogger = new SyncLogger('contact', direction, triggeredBy);
    await syncLogger.start({ batchSize, options });

    try {
        if (direction === 'rentman_to_hubspot' || direction === 'bidirectional') {
            await syncRentmanToHubspot(syncLogger, batchSize);
        }

        if (direction === 'hubspot_to_rentman' || direction === 'bidirectional') {
            await syncHubspotToRentman(syncLogger, batchSize);
        }

        await syncLogger.complete();
        return syncLogger.getStats();
    } catch (error) {
        await syncLogger.logError(
            'unknown',
            'critical',
            'internal',
            error.message,
            { stackTrace: error.stack }
        );
        await syncLogger.fail(error.message);
        throw error;
    }
}

async function syncRentmanToHubspot(syncLogger, batchSize) {
    logger.info('Starting Rentman to HubSpot contact sync');

    let offset = 0;
    let hasMore = true;

    while (hasMore) {
        const contactPersons = await rentman.get(`/contactpersons?limit=${batchSize}&offset=${offset}`);

        if (!contactPersons?.data || contactPersons.data.length === 0) {
            hasMore = false;
            break;
        }

        await syncLogger.updateProgress(syncLogger.getStats().processedItems, null);

        for (const rentmanContact of contactPersons.data) {
            try {
                const existingSync = await db.findSyncedContactByRentmanId(rentmanContact.id);

                if (existingSync) {
                    await updateHubspotContact(rentmanContact, existingSync, syncLogger);
                } else {
                    await createHubspotContact(rentmanContact, syncLogger);
                }
            } catch (error) {
                await handleItemError(syncLogger, 'contact', null, rentmanContact.id, error, 'rentman');
            }
        }

        offset += batchSize;
        hasMore = contactPersons.data.length === batchSize;
    }
}

async function syncHubspotToRentman(syncLogger, batchSize) {
    logger.info('Starting HubSpot to Rentman contact sync');

    let after = undefined;
    let hasMore = true;

    while (hasMore) {
        const response = await hubspot.searchContacts({
            limit: batchSize,
            after,
            properties: ['firstname', 'lastname', 'email', 'phone', 'mobilephone', 'jobtitle']
        });

        if (!response?.results || response.results.length === 0) {
            hasMore = false;
            break;
        }

        for (const hubspotContact of response.results) {
            try {
                const existingSync = await db.findSyncedContactByHubspotId(hubspotContact.id);

                if (existingSync) {
                    await updateRentmanContact(hubspotContact, existingSync, syncLogger);
                } else {
                    await createRentmanContact(hubspotContact, syncLogger);
                }
            } catch (error) {
                await handleItemError(syncLogger, 'contact', hubspotContact.id, null, error, 'hubspot');
            }
        }

        after = response.paging?.next?.after;
        hasMore = !!after;
    }
}

async function createHubspotContact(rentmanContact, syncLogger) {
    const email = sanitizeEmail(rentmanContact.email);
    if (!email) {
        await syncLogger.logItem(
            'contact',
            null,
            String(rentmanContact.id),
            'skip',
            'skipped',
            { errorMessage: 'No valid email address' }
        );
        return;
    }

    const properties = mapRentmanToHubspotContact(rentmanContact);

    const existingByEmail = await hubspot.findContactByEmail(email);
    if (existingByEmail) {
        await db.addSyncedContact(rentmanContact.id, existingByEmail.id);
        await updateHubspotContact(rentmanContact, { hubspot_contact_id: existingByEmail.id }, syncLogger);
        return;
    }

    const result = await hubspot.createContact(properties);

    if (result?.id) {
        await db.addSyncedContact(rentmanContact.id, result.id);

        const parentContactId = extractIdFromRef(rentmanContact.contact);
        if (parentContactId) {
            const parentSync = await db.findSyncedCompanyByRentmanId(parentContactId);
            if (parentSync?.hubspot_company_id) {
                await hubspot.associateContactToCompany(result.id, parentSync.hubspot_company_id);
            }
        }

        await syncLogger.logItem(
            'contact',
            result.id,
            String(rentmanContact.id),
            'create',
            'success',
            { dataAfter: properties }
        );

        logger.info('Created HubSpot contact from Rentman', {
            rentmanId: rentmanContact.id,
            hubspotId: result.id
        });
    }
}

async function updateHubspotContact(rentmanContact, existingSync, syncLogger) {
    const properties = mapRentmanToHubspotContact(rentmanContact);

    await hubspot.updateContact(existingSync.hubspot_contact_id, properties);

    await syncLogger.logItem(
        'contact',
        existingSync.hubspot_contact_id,
        String(rentmanContact.id),
        'update',
        'success',
        { dataAfter: properties }
    );

    logger.debug('Updated HubSpot contact from Rentman', {
        rentmanId: rentmanContact.id,
        hubspotId: existingSync.hubspot_contact_id
    });
}

async function createRentmanContact(hubspotContact, syncLogger) {
    const props = hubspotContact.properties || {};
    const email = sanitizeEmail(props.email);

    if (!email) {
        await syncLogger.logItem(
            'contact',
            hubspotContact.id,
            null,
            'skip',
            'skipped',
            { errorMessage: 'No valid email address' }
        );
        return;
    }

    const associations = await hubspot.getContactAssociations(hubspotContact.id, 'companies');
    let parentContactId = null;

    if (associations?.results?.length > 0) {
        const hubspotCompanyId = associations.results[0].id;
        const companySync = await db.findSyncedCompanyByHubspotId(hubspotCompanyId);
        parentContactId = companySync?.rentman_contact_id;
    }

    if (!parentContactId) {
        await syncLogger.logItem(
            'contact',
            hubspotContact.id,
            null,
            'skip',
            'skipped',
            { errorMessage: 'No associated company found in Rentman' }
        );
        return;
    }

    const contactData = mapHubspotToRentmanContact(hubspotContact, parentContactId);

    const result = await rentman.post('/contactpersons', contactData);

    if (result?.data?.id) {
        await db.addSyncedContact(result.data.id, hubspotContact.id);

        await syncLogger.logItem(
            'contact',
            hubspotContact.id,
            String(result.data.id),
            'create',
            'success',
            { dataAfter: contactData }
        );

        logger.info('Created Rentman contact person from HubSpot', {
            hubspotId: hubspotContact.id,
            rentmanId: result.data.id
        });
    }
}

async function updateRentmanContact(hubspotContact, existingSync, syncLogger) {
    const contactData = mapHubspotToRentmanContact(hubspotContact);

    await rentman.put(`/contactpersons/${existingSync.rentman_contact_id}`, contactData);

    await syncLogger.logItem(
        'contact',
        hubspotContact.id,
        String(existingSync.rentman_contact_id),
        'update',
        'success',
        { dataAfter: contactData }
    );

    logger.debug('Updated Rentman contact person from HubSpot', {
        hubspotId: hubspotContact.id,
        rentmanId: existingSync.rentman_contact_id
    });
}

function mapRentmanToHubspotContact(rentmanContact) {
    const nameParts = formatContactName(rentmanContact.displayname || '');

    return {
        firstname: rentmanContact.firstname || nameParts.firstname || '',
        lastname: rentmanContact.lastname || nameParts.lastname || '',
        email: sanitizeEmail(rentmanContact.email) || '',
        phone: rentmanContact.phone || '',
        mobilephone: rentmanContact.mobilephone || '',
        jobtitle: rentmanContact.function || ''
    };
}

function mapHubspotToRentmanContact(hubspotContact, parentContactId = null) {
    const props = hubspotContact.properties || {};

    const data = {
        firstname: props.firstname || '',
        lastname: props.lastname || '',
        email: sanitizeEmail(props.email) || '',
        phone: props.phone || '',
        mobilephone: props.mobilephone || '',
        function: props.jobtitle || ''
    };

    if (parentContactId) {
        data.contact = `/contacts/${parentContactId}`;
    }

    return data;
}

async function handleItemError(syncLogger, itemType, hubspotId, rentmanId, error, sourceSystem) {
    const errorType = categorizeError(error);
    const severity = error.response?.status >= 500 ? 'high' : 'medium';

    const itemLogId = await syncLogger.logItem(
        itemType,
        hubspotId,
        rentmanId ? String(rentmanId) : null,
        'error',
        'failed',
        {
            errorMessage: error.message,
            errorCode: error.response?.status?.toString()
        }
    );

    await syncLogger.logError(
        errorType,
        severity,
        sourceSystem,
        error.message,
        {
            errorCode: error.response?.status?.toString(),
            stackTrace: error.stack,
            context: { hubspotId, rentmanId },
            syncItemLogId: itemLogId
        }
    );

    logger.error('Contact sync error', {
        hubspotId,
        rentmanId,
        error: error.message
    });
}

function categorizeError(error) {
    if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
        return 'connection_error';
    }
    if (error.code === 'ETIMEDOUT' || error.code === 'ESOCKETTIMEDOUT') {
        return 'timeout';
    }
    if (error.response?.status === 429) {
        return 'rate_limit';
    }
    if (error.response?.status >= 400 && error.response?.status < 500) {
        return 'validation_error';
    }
    if (error.response?.status >= 500) {
        return 'api_error';
    }
    return 'unknown';
}

async function syncSingleContact(rentmanId = null, hubspotId = null) {
    const syncLogger = new SyncLogger('contact', 'bidirectional', 'manual');
    await syncLogger.start({ rentmanId, hubspotId, singleItem: true });
    syncLogger.stats.totalItems = 1;

    try {
        if (rentmanId) {
            const rentmanContact = await rentman.get(`/contactpersons/${rentmanId}`);
            if (rentmanContact?.data) {
                const existingSync = await db.findSyncedContactByRentmanId(rentmanId);
                if (existingSync) {
                    await updateHubspotContact(rentmanContact.data, existingSync, syncLogger);
                } else {
                    await createHubspotContact(rentmanContact.data, syncLogger);
                }
            }
        } else if (hubspotId) {
            const hubspotContact = await hubspot.getContact(hubspotId);
            if (hubspotContact) {
                const existingSync = await db.findSyncedContactByHubspotId(hubspotId);
                if (existingSync) {
                    await updateRentmanContact(hubspotContact, existingSync, syncLogger);
                } else {
                    await createRentmanContact(hubspotContact, syncLogger);
                }
            }
        }

        await syncLogger.complete();
        return syncLogger.getStats();
    } catch (error) {
        await syncLogger.fail(error.message);
        throw error;
    }
}

module.exports = {
    syncContacts,
    syncSingleContact
};
