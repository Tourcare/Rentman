const db = require('../lib/database');
const hubspot = require('../lib/hubspot-client');
const rentman = require('../lib/rentman-client');
const { createChildLogger } = require('../lib/logger');
const { SyncLogger } = require('./sync-logger');
const { sanitizeNumber, sanitizeEmail } = require('../lib/utils');

const logger = createChildLogger('sync-companies');

// Country name to ISO code mapping (common countries)
const COUNTRY_NAME_TO_CODE = {
    'afghanistan': 'af', 'albania': 'al', 'algeria': 'dz', 'argentina': 'ar',
    'australia': 'au', 'austria': 'at', 'belgium': 'be', 'brazil': 'br',
    'bulgaria': 'bg', 'canada': 'ca', 'chile': 'cl', 'china': 'cn',
    'colombia': 'co', 'croatia': 'hr', 'czech republic': 'cz', 'czechia': 'cz',
    'denmark': 'dk', 'egypt': 'eg', 'estonia': 'ee', 'finland': 'fi',
    'france': 'fr', 'germany': 'de', 'greece': 'gr', 'hong kong': 'hk',
    'hungary': 'hu', 'iceland': 'is', 'india': 'in', 'indonesia': 'id',
    'ireland': 'ie', 'israel': 'il', 'italy': 'it', 'japan': 'jp',
    'latvia': 'lv', 'lithuania': 'lt', 'luxembourg': 'lu', 'malaysia': 'my',
    'mexico': 'mx', 'netherlands': 'nl', 'new zealand': 'nz', 'norway': 'no',
    'pakistan': 'pk', 'peru': 'pe', 'philippines': 'ph', 'poland': 'pl',
    'portugal': 'pt', 'romania': 'ro', 'russia': 'ru', 'saudi arabia': 'sa',
    'singapore': 'sg', 'slovakia': 'sk', 'slovenia': 'si', 'south africa': 'za',
    'south korea': 'kr', 'spain': 'es', 'sweden': 'se', 'switzerland': 'ch',
    'taiwan': 'tw', 'thailand': 'th', 'turkey': 'tr', 'ukraine': 'ua',
    'united arab emirates': 'ae', 'uae': 'ae', 'united kingdom': 'gb', 'uk': 'gb',
    'great britain': 'gb', 'united states': 'us', 'usa': 'us', 'vietnam': 'vn'
};

function convertCountryToCode(country) {
    if (!country) return '';

    // Already a 2-letter code
    if (country.length === 2) {
        return country.toLowerCase();
    }

    const normalized = country.toLowerCase().trim();
    return COUNTRY_NAME_TO_CODE[normalized] || '';
}

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
        // rentman.get() returnerer data direkte (array), ikke { data: [...] }
        const contacts = await rentman.get(`/contacts?limit=${batchSize}&offset=${offset}`);

        if (!contacts || !Array.isArray(contacts) || contacts.length === 0) {
            hasMore = false;
            break;
        }

        await syncLogger.updateProgress(syncLogger.getStats().processedItems, null);

        for (const rentmanCompany of contacts) {
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
        hasMore = contacts.length === batchSize;
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
        // Brug upsertSyncedCompany med navn - samme som webhook service
        await db.upsertSyncedCompany(
            rentmanCompany.displayname || rentmanCompany.name,
            rentmanCompany.id,
            result.id
        );

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

        // Sync tilhørende contactpersons
        await syncCompanyContactPersons(rentmanCompany.id, result.id, syncLogger);
    }
}

async function updateHubspotCompany(rentmanCompany, existingSync, syncLogger) {
    const properties = mapRentmanToHubspotCompany(rentmanCompany);

    await hubspot.updateCompany(existingSync.hubspot_id, properties);

    // Opdater navn i database - samme som webhook service
    await db.updateSyncedCompanyName(
        existingSync.hubspot_id,
        rentmanCompany.displayname || rentmanCompany.name
    );

    await syncLogger.logItem(
        'company',
        existingSync.hubspot_id,
        String(rentmanCompany.id),
        'update',
        'success',
        { dataAfter: properties }
    );

    logger.debug('Updated HubSpot company from Rentman', {
        rentmanId: rentmanCompany.id,
        hubspotId: existingSync.hubspot_id
    });

    // Sync tilhørende contactpersons
    await syncCompanyContactPersons(rentmanCompany.id, existingSync.hubspot_id, syncLogger);
}

/**
 * Syncer alle contactpersons for en company.
 * Kaldes efter company create/update.
 */
async function syncCompanyContactPersons(rentmanCompanyId, hubspotCompanyId, syncLogger) {
    try {
        // Hent alle contactpersons for denne company
        const contactPersons = await rentman.get(`/contacts/${rentmanCompanyId}/contactpersons`);

        if (!contactPersons || !Array.isArray(contactPersons) || contactPersons.length === 0) {
            logger.debug('Ingen contactpersons fundet for company', { companyId: rentmanCompanyId });
            return;
        }

        logger.info('Syncer contactpersons for company', {
            companyId: rentmanCompanyId,
            count: contactPersons.length
        });

        for (const person of contactPersons) {
            try {
                const existingContactSync = await db.findSyncedContactByRentmanId(person.id);

                if (existingContactSync) {
                    // Opdater eksisterende contact
                    await updateContactPerson(person, existingContactSync, hubspotCompanyId, syncLogger);
                } else {
                    // Opret ny contact
                    await createContactPerson(person, rentmanCompanyId, hubspotCompanyId, syncLogger);
                }
            } catch (error) {
                logger.error('Fejl ved sync af contactperson', {
                    personId: person.id,
                    error: error.message
                });
                await syncLogger.logItem(
                    'contact',
                    null,
                    String(person.id),
                    'error',
                    'failed',
                    { errorMessage: error.message }
                );
            }
        }
    } catch (error) {
        logger.error('Fejl ved hentning af contactpersons', {
            companyId: rentmanCompanyId,
            error: error.message
        });
    }
}

async function createContactPerson(person, rentmanCompanyId, hubspotCompanyId, syncLogger) {
    const email = sanitizeEmail(person.email);

    if (!email) {
        await syncLogger.logItem(
            'contact',
            null,
            String(person.id),
            'skip',
            'skipped',
            { errorMessage: 'No valid email address' }
        );
        return;
    }

    // Tjek om contact allerede eksisterer i HubSpot via email
    const existingByEmail = await hubspot.findContactByEmail(email);
    if (existingByEmail) {
        await db.upsertSyncedContact(
            person.displayname,
            person.id,
            existingByEmail.id,
            hubspotCompanyId
        );
        logger.info('Contact fundet via email - linket', {
            rentmanId: person.id,
            hubspotId: existingByEmail.id
        });
        return;
    }

    const properties = {
        firstname: person.firstname || '',
        lastname: person.lastname || '',
        email: email,
        phone: person.phone || '',
        mobilephone: person.mobilephone || '',
        jobtitle: person.function || ''
    };

    const result = await hubspot.createContact(properties, hubspotCompanyId);

    if (result?.id) {
        await db.upsertSyncedContact(
            person.displayname,
            person.id,
            result.id,
            hubspotCompanyId
        );

        await syncLogger.logItem(
            'contact',
            result.id,
            String(person.id),
            'create',
            'success',
            { dataAfter: properties }
        );

        logger.info('Created HubSpot contact from contactperson', {
            rentmanId: person.id,
            hubspotId: result.id,
            companyId: hubspotCompanyId
        });
    }
}

async function updateContactPerson(person, existingSync, hubspotCompanyId, syncLogger) {
    const email = sanitizeEmail(person.email);

    const properties = {
        firstname: person.firstname || '',
        lastname: person.lastname || '',
        email: email || '',
        phone: person.phone || '',
        mobilephone: person.mobilephone || '',
        jobtitle: person.function || ''
    };

    await hubspot.updateContact(existingSync.hubspot_id, properties);
    await db.updateSyncedContactName(person.id, person.displayname);

    await syncLogger.logItem(
        'contact',
        existingSync.hubspot_id,
        String(person.id),
        'update',
        'success',
        { dataAfter: properties }
    );

    logger.debug('Updated HubSpot contact from contactperson', {
        rentmanId: person.id,
        hubspotId: existingSync.hubspot_id
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
    if (!existingSync?.rentman_id) {
        logger.warn('Ingen rentman_id fundet for company', { hubspotId: hubspotCompany.id });
        await syncLogger.logItem(
            'company',
            hubspotCompany.id,
            null,
            'skip',
            'skipped',
            { errorMessage: 'No rentman_id in sync record' }
        );
        return;
    }

    const contactData = mapHubspotToRentmanCompany(hubspotCompany);

    await rentman.put(`/contacts/${existingSync.rentman_id}`, contactData);

    await syncLogger.logItem(
        'company',
        hubspotCompany.id,
        String(existingSync.rentman_id),
        'update',
        'success',
        { dataAfter: contactData }
    );

    logger.debug('Updated Rentman contact from HubSpot', {
        hubspotId: hubspotCompany.id,
        rentmanId: existingSync.rentman_id
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
    const countryCode = convertCountryToCode(props.country);

    // displayname er read-only i Rentman - brug 'name' i stedet
    const data = {
        name: props.name || 'Unknown'
    };

    // Only include fields with actual values - Rentman rejects empty strings for enum fields like country
    if (props.address) data.street = props.address;
    if (props.city) data.city = props.city;
    if (props.zip) data.postalcode = props.zip;
    if (countryCode) data.country = countryCode;
    if (props.phone) data.phone = props.phone;
    if (props.website || props.domain) data.website = props.website || props.domain;

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
