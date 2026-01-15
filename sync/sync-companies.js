const db = require('../lib/database');
const hubspot = require('../lib/hubspot-client');
const rentman = require('../lib/rentman-client');
const { createChildLogger } = require('../lib/logger');
const { SyncLogger } = require('./sync-logger');
const { sanitizeNumber } = require('../lib/utils');

const logger = createChildLogger('sync-companies');

async function syncCompanies(options = {}) {
    const {
        direction = 'bidirectional',
        batchSize = 100,
        triggeredBy = 'system'
    } = options;

    const syncLogger = new SyncLogger('company', direction, triggeredBy);
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
    logger.info('Starting Rentman to HubSpot company sync');

    let offset = 0;
    let hasMore = true;

    while (hasMore) {
        const contacts = await rentman.get(`/contacts?limit=${batchSize}&offset=${offset}`);

        if (!contacts?.data || contacts.data.length === 0) {
            hasMore = false;
            break;
        }

        await syncLogger.updateProgress(syncLogger.getStats().processedItems, null);

        for (const rentmanCompany of contacts.data) {
            try {
                const existingSync = await db.findSyncedCompanyByRentmanId(rentmanCompany.id);

                if (existingSync) {
                    await updateHubspotCompany(rentmanCompany, existingSync, syncLogger);
                } else {
                    await createHubspotCompany(rentmanCompany, syncLogger);
                }
            } catch (error) {
                await handleItemError(syncLogger, 'company', null, rentmanCompany.id, error, 'rentman');
            }
        }

        offset += batchSize;
        hasMore = contacts.data.length === batchSize;
    }
}

async function syncHubspotToRentman(syncLogger, batchSize) {
    logger.info('Starting HubSpot to Rentman company sync');

    let after = undefined;
    let hasMore = true;

    while (hasMore) {
        const response = await hubspot.searchCompanies({
            limit: batchSize,
            after,
            properties: ['name', 'address', 'city', 'zip', 'country', 'phone', 'website', 'domain']
        });

        if (!response?.results || response.results.length === 0) {
            hasMore = false;
            break;
        }

        for (const hubspotCompany of response.results) {
            try {
                const existingSync = await db.findSyncedCompanyByHubspotId(hubspotCompany.id);

                if (existingSync) {
                    await updateRentmanCompany(hubspotCompany, existingSync, syncLogger);
                } else {
                    await createRentmanCompany(hubspotCompany, syncLogger);
                }
            } catch (error) {
                await handleItemError(syncLogger, 'company', hubspotCompany.id, null, error, 'hubspot');
            }
        }

        after = response.paging?.next?.after;
        hasMore = !!after;
    }
}

async function createHubspotCompany(rentmanCompany, syncLogger) {
    const properties = mapRentmanToHubspotCompany(rentmanCompany);

    const result = await hubspot.createCompany(properties);

    if (result?.id) {
        await db.addSyncedCompany(rentmanCompany.id, result.id);

        await syncLogger.logItem(
            'company',
            result.id,
            String(rentmanCompany.id),
            'create',
            'success',
            { dataAfter: properties }
        );

        logger.info('Created HubSpot company from Rentman', {
            rentmanId: rentmanCompany.id,
            hubspotId: result.id
        });
    }
}

async function updateHubspotCompany(rentmanCompany, existingSync, syncLogger) {
    const properties = mapRentmanToHubspotCompany(rentmanCompany);

    await hubspot.updateCompany(existingSync.hubspot_company_id, properties);

    await syncLogger.logItem(
        'company',
        existingSync.hubspot_company_id,
        String(rentmanCompany.id),
        'update',
        'success',
        { dataAfter: properties }
    );

    logger.debug('Updated HubSpot company from Rentman', {
        rentmanId: rentmanCompany.id,
        hubspotId: existingSync.hubspot_company_id
    });
}

async function createRentmanCompany(hubspotCompany, syncLogger) {
    const contactData = mapHubspotToRentmanCompany(hubspotCompany);

    const result = await rentman.post('/contacts', contactData);

    if (result?.data?.id) {
        await db.addSyncedCompany(result.data.id, hubspotCompany.id);

        await syncLogger.logItem(
            'company',
            hubspotCompany.id,
            String(result.data.id),
            'create',
            'success',
            { dataAfter: contactData }
        );

        logger.info('Created Rentman contact from HubSpot', {
            hubspotId: hubspotCompany.id,
            rentmanId: result.data.id
        });
    }
}

async function updateRentmanCompany(hubspotCompany, existingSync, syncLogger) {
    const contactData = mapHubspotToRentmanCompany(hubspotCompany);

    await rentman.put(`/contacts/${existingSync.rentman_contact_id}`, contactData);

    await syncLogger.logItem(
        'company',
        hubspotCompany.id,
        String(existingSync.rentman_contact_id),
        'update',
        'success',
        { dataAfter: contactData }
    );

    logger.debug('Updated Rentman contact from HubSpot', {
        hubspotId: hubspotCompany.id,
        rentmanId: existingSync.rentman_contact_id
    });
}

function mapRentmanToHubspotCompany(rentmanCompany) {
    return {
        name: rentmanCompany.displayname || rentmanCompany.name || 'Unknown',
        cvrnummer: rentmanCompany.VAT_code || '',
        address: rentmanCompany.street || '',
        city: rentmanCompany.city || '',
        zip: rentmanCompany.postalcode || '',
        country: rentmanCompany.country || '',
        phone: rentmanCompany.phone || '',
        website: rentmanCompany.website || ''
    };
}

function mapHubspotToRentmanCompany(hubspotCompany) {
    const props = hubspotCompany.properties || {};
    return {
        displayname: props.name || 'Unknown',
        street: props.address || '',
        city: props.city || '',
        postalcode: props.zip || '',
        country: props.country || '',
        phone: props.phone || '',
        website: props.website || props.domain || ''
    };
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

    logger.error('Company sync error', {
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

async function syncSingleCompany(rentmanId = null, hubspotId = null) {
    const syncLogger = new SyncLogger('company', 'bidirectional', 'manual');
    await syncLogger.start({ rentmanId, hubspotId, singleItem: true });
    syncLogger.stats.totalItems = 1;

    try {
        if (rentmanId) {
            const rentmanCompany = await rentman.get(`/contacts/${rentmanId}`);
            if (rentmanCompany?.data) {
                const existingSync = await db.findSyncedCompanyByRentmanId(rentmanId);
                if (existingSync) {
                    await updateHubspotCompany(rentmanCompany.data, existingSync, syncLogger);
                } else {
                    await createHubspotCompany(rentmanCompany.data, syncLogger);
                }
            }
        } else if (hubspotId) {
            const hubspotCompany = await hubspot.getCompany(hubspotId);
            if (hubspotCompany) {
                const existingSync = await db.findSyncedCompanyByHubspotId(hubspotId);
                if (existingSync) {
                    await updateRentmanCompany(hubspotCompany, existingSync, syncLogger);
                } else {
                    await createRentmanCompany(hubspotCompany, syncLogger);
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
    syncCompanies,
    syncSingleCompany
};
