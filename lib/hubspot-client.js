/**
 * HubSpot API Client
 *
 * Håndterer al kommunikation med HubSpot CRM API v3/v4.
 * Inkluderer CRUD operationer for alle objekttyper samt associationer.
 *
 * Hovedfunktioner:
 * - Deals: getDeal, createDeal, updateDeal
 * - Companies: getCompany, createCompany, updateCompany, deleteCompany
 * - Contacts: getContact, createContact, updateContact
 * - Orders: getOrder, createOrder, updateOrder, deleteOrder
 * - Line Items: createLineItem, getDealLineItems, syncDealLineItems
 * - Associations: addAssociation, removeAssociation
 * - Søgning: searchObjects, searchCompanies, searchContacts, etc.
 * - Filer: uploadFileFromUrl, createNote
 *
 * Status mappings til deal stages er defineret som konstanter.
 */

const config = require('../config');
const { createChildLogger } = require('./logger');

const logger = createChildLogger('hubspot-client');

/**
 * Ekstraherer ID fra enten en string eller et objekt.
 * Håndterer tilfælde hvor databasen indeholder JSON-objekter i stedet for bare IDs.
 */
function extractId(idOrObject) {
    if (!idOrObject) return null;
    if (typeof idOrObject === 'object') return idOrObject.id;
    if (typeof idOrObject === 'string' && idOrObject.startsWith('{')) {
        try {
            const parsed = JSON.parse(idOrObject);
            return parsed.id;
        } catch {
            return idOrObject;
        }
    }
    return idOrObject;
}

// =============================================================================
// Status Mappings
// =============================================================================

/**
 * Mapper Rentman status navne til HubSpot deal stage IDs.
 * Bruges ved oprettelse/opdatering af deals.
 */
const DEAL_STAGE_MAP = {
    'Koncept': 'appointmentscheduled',
    'Afventer kunde': 'qualifiedtobuy',
    'Aflyst': 'decisionmakerboughtin',
    'Bekraeftet': 'presentationscheduled',
    'Afsluttet': '3851496691',
    'Skal faktureres': '3852552384',
    'Faktureret': '3852552385',
    'Retur': '3986019567',
    'Mangler udstyr': '4003784908'
};

/**
 * Mapper HubSpot order stage IDs til danske status navne.
 * Bruges ved visning og sammenligning af order status.
 */
const ORDER_STAGE_ID_MAP = {
    '937ea84d-0a4f-4dcf-9028-3f9c2aafbf03': 'Afventer kunde',
    '3725360f-519b-4b18-a593-494d60a29c9f': 'Aflyst',
    'aa99e8d0-c1d5-4071-b915-d240bbb1aed9': 'Bekraeftet',
    '3852081363': 'Afsluttet',
    '4b27b500-f031-4927-9811-68a0b525cbae': 'Koncept',
    '3531598027': 'Skal faktureres',
    '3c85a297-e9ce-400b-b42e-9f16853d69d6': 'Faktureret',
    '3986020540': 'Retur',
    '4012316916': 'Mangler udstyr'
};

/**
 * Mapper Rentman status IDs til HubSpot order stage IDs.
 * Bruges ved sync af subprojekter til orders.
 */
const RENTMAN_STATUS_TO_ORDER_STAGE = {
    1: '937ea84d-0a4f-4dcf-9028-3f9c2aafbf03',   // Pending
    2: '3725360f-519b-4b18-a593-494d60a29c9f',   // Cancelled
    3: 'aa99e8d0-c1d5-4071-b915-d240bbb1aed9',   // Confirmed
    4: 'aa99e8d0-c1d5-4071-b915-d240bbb1aed9',   // Prepped
    5: 'aa99e8d0-c1d5-4071-b915-d240bbb1aed9',   // On Location
    6: '3986020540',                              // Retur
    7: '4b27b500-f031-4927-9811-68a0b525cbae',   // Inquiry
    8: '4b27b500-f031-4927-9811-68a0b525cbae',   // Concept
    9: '3531598027',                              // To be invoiced
    11: '3c85a297-e9ce-400b-b42e-9f16853d69d6',  // Invoiced
    12: '4012316916'                              // To be invoiced - missing items
};

// =============================================================================
// Base API funktioner
// =============================================================================

/**
 * Udfører HTTP request til HubSpot API med authentication.
 * Håndterer 404, 409 (conflict) og andre fejl konsistent.
 *
 * @param {string} method - HTTP metode (GET, POST, PATCH, DELETE)
 * @param {string} endpoint - API endpoint (relative eller fuld URL)
 * @param {Object} body - Request body (kun for POST/PATCH)
 * @returns {Object} - { success, data, notFound, conflict, status }
 */
async function request(method, endpoint, body = null) {
    const url = endpoint.startsWith('http') ? endpoint : `${config.hubspot.baseUrl}${endpoint}`;
    const start = Date.now();

    logger.apiCall('hubspot', endpoint, method);

    const options = {
        method,
        headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${config.hubspot.token}`
        }
    };

    if (body && method !== 'GET') {
        options.body = JSON.stringify(body);
    }

    try {
        const response = await fetch(url, options);
        const duration = Date.now() - start;

        logger.apiResponse('hubspot', endpoint, response.status, duration);

        if (response.status === 404) {
            return { success: false, notFound: true, status: 404 };
        }

        if (response.status === 409) {
            const text = await response.text();
            let data;
            try {
                data = JSON.parse(text);
            } catch (e) {
                data = { message: text };
            }
            return { success: false, conflict: true, status: 409, data };
        }

        if (!response.ok) {
            const errText = await response.text();
            logger.apiError('hubspot', endpoint, new Error(errText), { status: response.status });
            throw new Error(`HubSpot API fejl: ${response.status} - ${errText}`);
        }

        if (response.status === 204) {
            return { success: true, data: null };
        }

        const data = await response.json();
        return { success: true, data };
    } catch (error) {
        logger.apiError('hubspot', endpoint, error);
        throw error;
    }
}

/**
 * Henter et CRM objekt med specificerede properties og associations.
 */
async function getObject(objectType, objectId, properties = [], associations = []) {
    let query = '';
    const params = [];

    if (properties.length > 0) {
        params.push(`properties=${properties.join(',')}`);
    }
    if (associations.length > 0) {
        params.push(`associations=${associations.join(',')}`);
    }
    if (params.length > 0) {
        query = '?' + params.join('&');
    }

    const result = await request('GET', `/crm/v3/objects/${objectType}/${objectId}${query}`);

    if (result.notFound) {
        return null;
    }

    return result.data;
}

/**
 * Opretter et CRM objekt med properties og valgfrie associations.
 */
async function createObject(objectType, properties, associations = []) {
    const body = { properties };
    if (associations.length > 0) {
        body.associations = associations;
    }

    const result = await request('POST', `/crm/v3/objects/${objectType}`, body);
    return result;
}

/**
 * Opdaterer et CRM objekt med nye properties.
 */
async function updateObject(objectType, objectId, properties) {
    const result = await request('PATCH', `/crm/v3/objects/${objectType}/${objectId}`, { properties });
    return result.data;
}

/**
 * Sletter et CRM objekt.
 */
async function deleteObject(objectType, objectId) {
    await request('DELETE', `/crm/v3/objects/${objectType}/${objectId}`);
}

// =============================================================================
// Deal funktioner
// =============================================================================

/**
 * Henter en deal med standard properties og valgfrie associations.
 */
async function getDeal(dealId, properties = [], associations = []) {
    const defaultProps = ['dealname', 'usage_period', 'slut_projekt_period'];
    const allProps = [...new Set([...defaultProps, ...properties])];
    return getObject(config.hubspot.objectTypes.deals, dealId, allProps, associations);
}

/**
 * Opretter en deal med automatisk association til company og contact.
 */
async function createDeal(properties, companyId = null, contactId = null) {
    const associations = [];

    if (companyId) {
        associations.push({
            to: { id: extractId(companyId) },
            types: [{
                associationCategory: 'HUBSPOT_DEFINED',
                associationTypeId: config.hubspot.associationTypes.dealToCompany
            }]
        });
    }

    if (contactId) {
        associations.push({
            to: { id: extractId(contactId) },
            types: [{
                associationCategory: 'HUBSPOT_DEFINED',
                associationTypeId: config.hubspot.associationTypes.dealToContact
            }]
        });
    }

    const result = await createObject('deals', properties, associations);
    const id = result.data?.id || result.data?.properties?.hs_object_id;
    return { id, ...result.data };
}

async function updateDeal(dealId, properties) {
    return updateObject(config.hubspot.objectTypes.deals, dealId, properties);
}

// =============================================================================
// Company funktioner
// =============================================================================

async function getCompany(companyId, properties = []) {
    const defaultProps = ['name', 'cvrnummer'];
    const allProps = [...new Set([...defaultProps, ...properties])];
    return getObject(config.hubspot.objectTypes.companies, companyId, allProps, ['contacts']);
}

/**
 * Opretter en virksomhed. Håndterer duplikat (409) ved at returnere eksisterende ID.
 */
async function createCompany(properties) {
    const result = await createObject('companies', { ...properties, type: 'Andet' });

    if (result.success) {
        return { id: result.data.id, ...result.data };
    }

    if (result.data?.category === 'VALIDATION_ERROR') {
        const match = result.data.message?.match(/(\d+) already has that value/);
        if (match) {
            logger.info(`Virksomhed findes allerede med ID: ${match[1]}`);
            return { id: match[1] };
        }
    }

    throw new Error(`Kunne ikke oprette virksomhed: ${JSON.stringify(result.data)}`);
}

async function updateCompany(companyId, properties) {
    return updateObject('companies', companyId, properties);
}

async function deleteCompany(companyId) {
    return deleteObject('companies', companyId);
}

// =============================================================================
// Contact funktioner
// =============================================================================

async function getContact(contactId, properties = []) {
    return getObject(config.hubspot.objectTypes.contacts, contactId, properties, ['companies']);
}

/**
 * Opretter en kontakt med valgfri company association.
 * Håndterer duplikat (409) ved at associere eksisterende kontakt til company.
 */
async function createContact(properties, companyId = null) {
    const associations = [];

    if (companyId) {
        const safeCompanyId = extractId(companyId);
        associations.push({
            to: { id: safeCompanyId.toString() },
            types: [{
                associationCategory: 'HUBSPOT_DEFINED',
                associationTypeId: config.hubspot.associationTypes.contactToCompany
            }]
        });
    }

    const result = await createObject('contacts', properties, associations);

    if (result.success) {
        return { id: result.data.id, ...result.data };
    }

    if (result.conflict) {
        const match = result.data.message?.match(/Existing ID:\s*(\d+)/);
        if (match) {
            const existingId = match[1];
            logger.info(`Kontakt findes allerede med ID: ${existingId}`);
            if (companyId) {
                await addAssociation('contacts', existingId, 'companies', companyId, config.hubspot.associationTypes.contactToCompany);
            }
            return { id: existingId };
        }
    }

    throw new Error(`Kunne ikke oprette kontakt: ${JSON.stringify(result.data)}`);
}

async function updateContact(contactId, properties) {
    return updateObject('contacts', contactId, properties);
}

// =============================================================================
// Order funktioner (Custom Object)
// =============================================================================

async function getOrder(orderId, properties = []) {
    const defaultProps = ['hs_pipeline_stage'];
    const allProps = [...new Set([...defaultProps, ...properties])];
    return getObject(config.hubspot.objectTypes.orders, extractId(orderId), allProps);
}

/**
 * Opretter en order med associations til deal, company og contact.
 * Orders er et custom object der repræsenterer Rentman subprojects.
 */
async function createOrder(properties, dealId = null, companyId = null, contactId = null) {
    const associations = [];

    if (dealId) {
        associations.push({
            to: { id: extractId(dealId) },
            types: [{
                associationCategory: 'HUBSPOT_DEFINED',
                associationTypeId: config.hubspot.associationTypes.orderToDeal
            }]
        });
    }

    if (companyId) {
        associations.push({
            to: { id: extractId(companyId) },
            types: [{
                associationCategory: 'HUBSPOT_DEFINED',
                associationTypeId: config.hubspot.associationTypes.orderToCompany
            }]
        });
    }

    if (contactId) {
        associations.push({
            to: { id: extractId(contactId) },
            types: [{
                associationCategory: 'HUBSPOT_DEFINED',
                associationTypeId: config.hubspot.associationTypes.orderToContact
            }]
        });
    }

    const result = await createObject('orders', properties, associations);
    const id = result.data?.properties?.hs_object_id || result.data?.id;
    return { id, ...result.data };
}

async function updateOrder(orderId, properties) {
    return updateObject('orders', extractId(orderId), properties);
}

async function deleteOrder(orderId) {
    return deleteObject(config.hubspot.objectTypes.orders, extractId(orderId));
}

// =============================================================================
// Association funktioner
// =============================================================================

/**
 * Opretter en association mellem to CRM objekter.
 * Association type IDs er defineret i config.hubspot.associationTypes.
 */
async function addAssociation(fromObjectType, fromId, toObjectType, toId, associationTypeId) {
    const safeFromId = extractId(fromId);
    const safeToId = extractId(toId);
    const url = `/crm/v3/objects/${fromObjectType}/${safeFromId}/associations/${toObjectType}/${safeToId}/${associationTypeId}`;
    return request('PUT', url);
}

/**
 * Fjerner en association mellem to CRM objekter.
 */
async function removeAssociation(fromObjectType, fromId, toObjectType, toId, associationTypeId) {
    const safeFromId = extractId(fromId);
    const safeToId = extractId(toId);
    const url = `/crm/v3/objects/${fromObjectType}/${safeFromId}/associations/${toObjectType}/${safeToId}/${associationTypeId}`;
    return request('DELETE', url);
}

// =============================================================================
// Fil upload funktioner
// =============================================================================

/**
 * Uploader en fil til HubSpot fra en URL (asynkron import).
 * Bruges til at uploade tilbud og kontrakter fra Rentman.
 */
async function uploadFileFromUrl(fileUrl, fileName, folderId = null) {
    const body = {
        access: 'PUBLIC_NOT_INDEXABLE',
        url: fileUrl,
        name: fileName,
        folderId: folderId || config.hubspot.folders.quotations
    };

    const result = await request('POST', '/files/v3/files/import-from-url/async', body);
    return result.data;
}

/**
 * Tjekker status på en asynkron fil upload.
 */
async function checkFileUploadStatus(taskId) {
    const result = await request('GET', `/files/v3/files/import-from-url/async/tasks/${taskId}/status`);
    return result.data;
}

/**
 * Venter på at fil upload er færdig med polling.
 * @returns {string} - File ID når upload er færdig
 */
async function waitForFileUpload(taskId, maxAttempts = 12, intervalMs = 5000) {
    for (let i = 0; i < maxAttempts; i++) {
        const status = await checkFileUploadStatus(taskId);

        if (status.status === 'COMPLETE') {
            return status.result.id;
        }

        if (status.status === 'FAILED') {
            throw new Error(`Fil upload fejlede: ${status.error || 'Ukendt fejl'}`);
        }

        logger.debug(`Fil upload i gang, venter ${intervalMs}ms...`, { attempt: i + 1, maxAttempts });
        await new Promise(r => setTimeout(r, intervalMs));
    }

    throw new Error(`Fil upload timeout efter ${maxAttempts} forsog`);
}

/**
 * Opretter en note på en deal med fil vedhæftet.
 * Bruges til at tilknytte tilbud/kontrakter til deals.
 */
async function createNote(dealId, attachmentId, body = 'Tilbud lavet i Rentman') {
    const properties = {
        hs_attachment_ids: attachmentId,
        hs_note_body: `<div style="" dir="auto" data-top-level="true"><p style="margin:0;">${body}</p></div>`,
        hs_timestamp: Date.now()
    };

    const associations = [{
        to: { id: extractId(dealId) },
        types: [{
            associationCategory: 'HUBSPOT_DEFINED',
            associationTypeId: config.hubspot.associationTypes.noteToDeal
        }]
    }];

    const result = await createObject('notes', properties, associations);
    return result.data;
}

// =============================================================================
// Status beregning
// =============================================================================

/**
 * Beregner deal stage baseret på tilhørende orders' stages.
 * Bruger prioriteret rækkefølge til at bestemme samlet status.
 */
function calculateDealStageFromOrders(orderStages) {
    const priority = ['Skal faktureres', 'Bekraeftet', 'Faktureret', 'Afsluttet', 'Afventer kunde', 'Koncept', 'Aflyst'];
    const statusNames = orderStages.map(stageId => ORDER_STAGE_ID_MAP[stageId]).filter(Boolean);

    if (statusNames.length === 0) {
        return null;
    }

    const allSame = statusNames.every(s => s === statusNames[0]);
    if (allSame) {
        return DEAL_STAGE_MAP[statusNames[0]];
    }

    const highestPriority = priority.find(p => statusNames.includes(p));
    return highestPriority ? DEAL_STAGE_MAP[highestPriority] : null;
}

/**
 * Mapper Rentman status ID til HubSpot order stage ID.
 */
function getOrderStageFromRentmanStatus(statusId) {
    return RENTMAN_STATUS_TO_ORDER_STAGE[statusId] || null;
}

// =============================================================================
// Søgefunktioner
// =============================================================================

/**
 * Søger efter CRM objekter med filtre, sortering og pagination.
 * Bruger HubSpot Search API.
 *
 * @param {string} objectType - Objekt type at søge i
 * @param {Object} options - Søgeparametre
 * @param {number} options.limit - Max antal resultater
 * @param {string} options.after - Pagination cursor
 * @param {Array} options.properties - Properties at returnere
 * @param {Array} options.filters - Filter objekter med propertyName, operator, value
 * @param {Array} options.sorts - Sort objekter med propertyName og direction
 */
async function searchObjects(objectType, options = {}) {
    const { limit = 100, after, properties = [], filters = [], sorts = [] } = options;

    const body = {
        limit,
        properties
    };

    if (after) {
        body.after = after;
    }

    if (filters.length > 0) {
        body.filterGroups = [{ filters }];
    }

    if (sorts.length > 0) {
        body.sorts = sorts;
    }

    const result = await request('POST', `/crm/v3/objects/${objectType}/search`, body);
    return result.data;
}

/**
 * Søger efter virksomheder med standard properties.
 */
async function searchCompanies(options = {}) {
    const defaultProps = ['name', 'address', 'city', 'zip', 'country', 'phone', 'website', 'domain'];
    return searchObjects('companies', {
        ...options,
        properties: [...new Set([...defaultProps, ...(options.properties || [])])]
    });
}

/**
 * Søger efter kontakter med standard properties.
 */
async function searchContacts(options = {}) {
    const defaultProps = ['firstname', 'lastname', 'email', 'phone', 'mobilephone', 'jobtitle'];
    return searchObjects('contacts', {
        ...options,
        properties: [...new Set([...defaultProps, ...(options.properties || [])])]
    });
}

/**
 * Søger efter deals med standard properties.
 */
async function searchDeals(options = {}) {
    const defaultProps = ['dealname', 'amount', 'dealstage', 'pipeline', 'hubspot_owner_id'];
    return searchObjects('deals', {
        ...options,
        properties: [...new Set([...defaultProps, ...(options.properties || [])])]
    });
}

/**
 * Søger efter orders med standard properties.
 */
async function searchOrders(options = {}) {
    const defaultProps = ['hs_order_name', 'hs_total_price', 'hs_pipeline_stage'];
    return searchObjects('orders', {
        ...options,
        properties: [...new Set([...defaultProps, ...(options.properties || [])])]
    });
}

/**
 * Finder en kontakt via email adresse.
 */
async function findContactByEmail(email) {
    const result = await searchContacts({
        filters: [{ propertyName: 'email', operator: 'EQ', value: email }],
        limit: 1
    });
    return result?.results?.[0] || null;
}

/**
 * Henter associations fra et objekt til en anden objekttype.
 */
async function getAssociations(objectType, objectId, toObjectType) {
    const result = await request('GET', `/crm/v3/objects/${objectType}/${objectId}/associations/${toObjectType}`);
    return result.data;
}

async function getContactAssociations(contactId, toObjectType) {
    return getAssociations('contacts', contactId, toObjectType);
}

async function getDealAssociations(dealId, toObjectType) {
    return getAssociations('deals', dealId, toObjectType);
}

async function getOrderAssociations(orderId, toObjectType) {
    return getAssociations('orders', extractId(orderId), toObjectType);
}

async function associateContactToCompany(contactId, companyId) {
    return addAssociation('contacts', contactId, 'companies', companyId, config.hubspot.associationTypes.contactToCompany);
}

async function associateDealToCompany(dealId, companyId) {
    return addAssociation('deals', dealId, 'companies', companyId, config.hubspot.associationTypes.dealToCompany);
}

async function associateDealToContact(dealId, contactId) {
    return addAssociation('deals', dealId, 'contacts', contactId, config.hubspot.associationTypes.dealToContact);
}

async function associateOrderToDeal(orderId, dealId) {
    return addAssociation('orders', orderId, 'deals', dealId, config.hubspot.associationTypes.orderToDeal);
}

async function associateOrderToCompany(orderId, companyId) {
    return addAssociation('orders', orderId, 'companies', companyId, config.hubspot.associationTypes.orderToCompany);
}

// =============================================================================
// Line Items funktioner
// Bruges til at synkronisere Rentman projekt-finanser til HubSpot deals
// =============================================================================

/**
 * Henter en line item med standard properties.
 */
async function getLineItem(lineItemId, properties = []) {
    const defaultProps = ['name', 'quantity', 'price', 'amount', 'discount', 'hs_sku', 'description'];
    const allProps = [...new Set([...defaultProps, ...properties])];
    return getObject('line_items', lineItemId, allProps);
}

/**
 * Opretter en line item med automatisk association til deal.
 */
async function createLineItem(properties, dealId = null) {
    const associations = [];

    if (dealId) {
        associations.push({
            to: { id: extractId(dealId).toString() },
            types: [{
                associationCategory: 'HUBSPOT_DEFINED',
                associationTypeId: config.hubspot.associationTypes.lineItemToDeal
            }]
        });
    }

    const result = await createObject('line_items', properties, associations);
    const id = result.data?.id || result.data?.properties?.hs_object_id;
    return { id, ...result.data };
}

async function updateLineItem(lineItemId, properties) {
    return updateObject('line_items', lineItemId, properties);
}

async function deleteLineItem(lineItemId) {
    return deleteObject('line_items', lineItemId);
}

/**
 * Henter alle line items tilknyttet en deal.
 */
async function getDealLineItems(dealId) {
    const associations = await getAssociations('deals', dealId, 'line_items');

    if (!associations?.results || associations.results.length === 0) {
        return [];
    }

    const lineItems = [];
    for (const assoc of associations.results) {
        const lineItem = await getLineItem(assoc.id);
        if (lineItem) {
            lineItems.push(lineItem);
        }
    }

    return lineItems;
}

/**
 * Sletter alle line items på en deal.
 * Bruges før sync for at erstatte med nye data.
 */
async function deleteDealLineItems(dealId) {
    const lineItems = await getDealLineItems(dealId);

    for (const lineItem of lineItems) {
        try {
            await deleteLineItem(lineItem.id);
        } catch (error) {
            logger.error('Kunne ikke slette line item', {
                lineItemId: lineItem.id,
                dealId,
                error: error.message
            });
        }
    }

    return lineItems.length;
}

/**
 * Opretter flere line items på en deal.
 * Fejl på enkelte items stopper ikke de andre.
 */
async function createLineItemsBatch(lineItemsData, dealId) {
    const results = [];

    for (const itemData of lineItemsData) {
        try {
            const result = await createLineItem(itemData, dealId);
            results.push({ success: true, id: result.id, data: itemData });
        } catch (error) {
            logger.error('Kunne ikke oprette line item', {
                dealId,
                itemData,
                error: error.message
            });
            results.push({ success: false, error: error.message, data: itemData });
        }
    }

    return results;
}

/**
 * Synkroniserer line items til en deal.
 * Sletter eksisterende items (default) og opretter nye.
 *
 * @param {string} dealId - HubSpot deal ID
 * @param {Array} lineItemsData - Array af line item properties
 * @param {boolean} deleteExisting - Slet eksisterende items først
 * @returns {Object} - { success, created, errors, results }
 */
async function syncDealLineItems(dealId, lineItemsData, deleteExisting = true) {
    logger.info('Synkroniserer line items til deal', {
        dealId,
        itemCount: lineItemsData.length,
        deleteExisting
    });

    if (deleteExisting) {
        const deletedCount = await deleteDealLineItems(dealId);
        logger.debug('Slettede eksisterende line items', { dealId, deletedCount });
    }

    const results = await createLineItemsBatch(lineItemsData, dealId);

    const successCount = results.filter(r => r.success).length;
    const errorCount = results.filter(r => !r.success).length;

    logger.info('Line items sync afsluttet', {
        dealId,
        successCount,
        errorCount,
        total: lineItemsData.length
    });

    return {
        success: errorCount === 0,
        created: successCount,
        errors: errorCount,
        results
    };
}

module.exports = {
    request,
    getObject,
    createObject,
    updateObject,
    deleteObject,

    searchObjects,
    searchCompanies,
    searchContacts,
    searchDeals,
    searchOrders,
    findContactByEmail,

    getDeal,
    createDeal,
    updateDeal,

    getCompany,
    createCompany,
    updateCompany,
    deleteCompany,

    getContact,
    createContact,
    updateContact,

    getOrder,
    createOrder,
    updateOrder,
    deleteOrder,

    addAssociation,
    removeAssociation,
    getAssociations,
    getContactAssociations,
    getDealAssociations,
    getOrderAssociations,
    associateContactToCompany,
    associateDealToCompany,
    associateDealToContact,
    associateOrderToDeal,
    associateOrderToCompany,

    getLineItem,
    createLineItem,
    updateLineItem,
    deleteLineItem,
    getDealLineItems,
    deleteDealLineItems,
    createLineItemsBatch,
    syncDealLineItems,

    uploadFileFromUrl,
    checkFileUploadStatus,
    waitForFileUpload,
    createNote,

    calculateDealStageFromOrders,
    getOrderStageFromRentmanStatus,

    DEAL_STAGE_MAP,
    ORDER_STAGE_ID_MAP,
    RENTMAN_STATUS_TO_ORDER_STAGE
};
