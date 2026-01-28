/**
 * Rentman API Client
 *
 * Håndterer al kommunikation med Rentman API.
 * Inkluderer automatisk retry ved rate limiting (429).
 *
 * Hovedfunktioner:
 * - Projekter: getProject, getProjectSubprojects
 * - Kontakter: getContact, createContact, updateContact
 * - Kontaktpersoner: getContactPerson, createContactPerson
 * - Projekt requests: createProjectRequest, deleteProjectRequest
 * - Filer: getFile, getQuote, getContract
 *
 * Finansdata funktioner (til HubSpot line items sync):
 * - getProjectEquipment/Costs/Functions/Vehicles
 * - getProjectFinancials (samlet funktion)
 * - getSubprojectEquipment/Costs/Functions/Vehicles
 * - getSubprojectFinancials (samlet funktion)
 *
 * Retry strategi: Exponential backoff ved rate limit (429)
 */

const config = require('../config');
const { createChildLogger } = require('./logger');

const logger = createChildLogger('rentman-client');

// =============================================================================
// Base API funktioner
// =============================================================================

/**
 * Udfører HTTP request til Rentman API med authentication og retry.
 * Ved 429 (rate limit) retries med exponential backoff.
 *
 * @param {string} method - HTTP metode
 * @param {string} endpoint - API endpoint
 * @param {Object} body - Request body
 * @param {number} attempt - Nuværende forsøg nummer (intern)
 */
async function request(method, endpoint, body = null, attempt = 1) {
    const url = endpoint.startsWith('http')
        ? endpoint
        : `${config.rentman.baseUrl}${endpoint}`;

    const maxRetries = config.retry.maxAttempts;
    const baseDelay = config.retry.baseDelayMs;
    const retryDelay = Math.min(baseDelay * (2 ** (attempt - 1)), config.retry.maxDelayMs);

    logger.apiCall('rentman', endpoint, method, { attempt });

    const start = Date.now();

    try {
        const options = {
            method,
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${config.rentman.token}`
            }
        };

        if (body && method !== 'GET' && method !== 'DELETE') {
            options.body = JSON.stringify(body);
        }

        const response = await fetch(url, options);
        const duration = Date.now() - start;

        logger.apiResponse('rentman', endpoint, response.status, duration);

        if (response.status === 429) {
            if (attempt >= maxRetries) {
                const error = new Error(`Rate limit ramt og max retries (${maxRetries}) nået for ${endpoint}`);
                logger.apiError('rentman', endpoint, error, { attempts: attempt });
                throw error;
            }

            logger.warn(`Rate limit ramt (forsøg ${attempt}). Venter ${retryDelay / 1000} sekunder...`, { endpoint });
            await new Promise(res => setTimeout(res, retryDelay));
            return request(method, endpoint, body, attempt + 1);
        }

        if (response.status === 404) {
            return { success: false, notFound: true, status: 404, data: null };
        }

        if (!response.ok) {
            const errText = await response.text();
            logger.apiError('rentman', endpoint, new Error(errText), { status: response.status });
            throw new Error(`Rentman API fejl: ${response.status} - ${errText}`);
        }

        if (response.status === 204) {
            return { success: true, data: null };
        }

        const text = await response.text();
        if (!text) {
            return { success: true, data: null };
        }
        const responseData = JSON.parse(text);
        return { success: true, data: responseData?.data ?? null };
    } catch (error) {
        logger.apiError('rentman', endpoint, error, { attempt });
        throw error;
    }
}

/**
 * GET request til Rentman API.
 */
async function get(endpoint) {
    if (!endpoint) {
        return null;
    }

    const result = await request('GET', endpoint);
    return result.notFound ? null : result.data;
}

async function post(endpoint, body) {
    const result = await request('POST', endpoint, body);
    return result.data;
}

async function put(endpoint, body) {
    const result = await request('PUT', endpoint, body);
    return result.data;
}

async function del(endpoint) {
    const result = await request('DELETE', endpoint);
    return result.success;
}

// =============================================================================
// Projekt funktioner
// =============================================================================

async function getProject(projectId) {
    return get(`/projects/${projectId}`);
}

async function getProjectByRef(ref) {
    return get(ref);
}

async function getProjectSubprojects(projectRef) {
    return get(`${projectRef}/subprojects`);
}

async function getSubproject(subprojectId) {
    return get(`/subprojects/${subprojectId}`);
}

// =============================================================================
// Kontakt funktioner (Contact = virksomhed i Rentman)
// =============================================================================

async function getContact(contactId) {
    return get(`/contacts/${contactId}`);
}

async function getContactByRef(ref) {
    return get(ref);
}

async function createContact(name, vatCode = '') {
    return post('/contacts', { name, VAT_code: vatCode });
}

async function updateContact(contactId, data) {
    return put(`/contacts/${contactId}`, data);
}

async function deleteContact(contactId) {
    return del(`/contacts/${contactId}`);
}

// =============================================================================
// Kontaktperson funktioner (ContactPerson = person i Rentman)
// =============================================================================

async function getContactPerson(personId) {
    return get(`/contactpersons/${personId}`);
}

async function getContactPersonByRef(ref) {
    return get(ref);
}

async function createContactPerson(companyRentmanId, data) {
    return post(`/contacts/${companyRentmanId}/contactpersons`, data);
}

async function updateContactPerson(personId, data) {
    return put(`/contactpersons/${personId}`, data);
}

async function deleteContactPerson(personId) {
    return del(`/contactpersons/${personId}`);
}

// =============================================================================
// Diverse funktioner
// =============================================================================

async function getStatus(statusRef) {
    return get(statusRef);
}

/**
 * Opretter en rental request i Rentman.
 * Bruges når en deal oprettes i HubSpot.
 */
async function createProjectRequest(data) {
    const result = await request('POST', '/projectrequests', data);
    return result.data;
}

async function deleteProjectRequest(requestId) {
    return del(`/projectrequests/${requestId}`);
}

async function getAllProjectRequests() {
    const result = await request('GET', '/projectrequests');
    return result.data;
}

async function getFile(fileRef) {
    return get(fileRef);
}

async function getQuote(quoteId) {
    return get(`/quotes/${quoteId}`);
}

async function getContract(contractId) {
    return get(`/contracts/${contractId}`);
}

async function getEquipmentGroup(ref) {
    return get(ref);
}

async function getCost(ref) {
    return get(ref);
}

// =============================================================================
// Projekt finansdata funktioner
// Bruges til at hente data til HubSpot line items sync
// =============================================================================

/**
 * Henter udstyr på et projekt (til line items sync).
 */
async function getProjectEquipment(projectId) {
    const result = await request('GET', `/projects/${projectId}/projectequipment`);
    return result.success ? result.data : [];
}

/**
 * Henter udstyrsgrupper på et projekt.
 */
async function getProjectEquipmentGroups(projectId) {
    const result = await request('GET', `/projects/${projectId}/projectequipmentgroups`);
    return result.success ? result.data : [];
}

/**
 * Henter omkostninger på et projekt (til line items sync).
 */
async function getProjectCosts(projectId) {
    const result = await request('GET', `/projects/${projectId}/projectcosts`);
    return result.success ? result.data : [];
}

/**
 * Henter personale/crew på et projekt (til line items sync).
 */
async function getProjectFunctions(projectId) {
    const result = await request('GET', `/projects/${projectId}/projectfunctions`);
    return result.success ? result.data : [];
}

async function getProjectFunctionGroups(projectId) {
    const result = await request('GET', `/projects/${projectId}/projectfunctiongroups`);
    return result.success ? result.data : [];
}

/**
 * Henter transport/køretøjer på et projekt (til line items sync).
 */
async function getProjectVehicles(projectId) {
    const result = await request('GET', `/projects/${projectId}/projectvehicles`);
    return result.success ? result.data : [];
}

/**
 * Henter alle finansdata for et projekt parallelt.
 * Bruges til at generere komplet liste af line items til HubSpot.
 *
 * @param {number} projectId - Rentman projekt ID
 * @param {Object} options - Vælg hvilke typer der skal inkluderes
 * @param {boolean} options.includeEquipment - Inkluder udstyr (default: true)
 * @param {boolean} options.includeCosts - Inkluder omkostninger (default: true)
 * @param {boolean} options.includeCrew - Inkluder personale (default: true)
 * @param {boolean} options.includeTransport - Inkluder transport (default: true)
 * @returns {Object} - { equipment, equipmentGroups, costs, functions, functionGroups, vehicles }
 */
async function getProjectFinancials(projectId, options = {}) {
    const {
        includeEquipment = true,
        includeCosts = true,
        includeCrew = true,
        includeTransport = true
    } = options;

    const results = {
        equipment: [],
        equipmentGroups: [],
        costs: [],
        functions: [],
        functionGroups: [],
        vehicles: []
    };

    const promises = [];

    if (includeEquipment) {
        promises.push(
            getProjectEquipment(projectId).then(data => { results.equipment = data || []; }),
            getProjectEquipmentGroups(projectId).then(data => { results.equipmentGroups = data || []; })
        );
    }

    if (includeCosts) {
        promises.push(
            getProjectCosts(projectId).then(data => { results.costs = data || []; })
        );
    }

    if (includeCrew) {
        promises.push(
            getProjectFunctions(projectId).then(data => { results.functions = data || []; }),
            getProjectFunctionGroups(projectId).then(data => { results.functionGroups = data || []; })
        );
    }

    if (includeTransport) {
        promises.push(
            getProjectVehicles(projectId).then(data => { results.vehicles = data || []; })
        );
    }

    await Promise.all(promises);

    return results;
}

// =============================================================================
// Subprojekt finansdata funktioner
// =============================================================================

/**
 * Henter udstyr for et specifikt subprojekt.
 */
async function getSubprojectEquipment(subprojectId) {
    const result = await request('GET', `/subprojects/${subprojectId}/projectequipment`);
    return result.success ? result.data : [];
}

async function getSubprojectCosts(subprojectId) {
    const result = await request('GET', `/subprojects/${subprojectId}/projectcosts`);
    return result.success ? result.data : [];
}

async function getSubprojectFunctions(subprojectId) {
    const result = await request('GET', `/subprojects/${subprojectId}/projectfunctions`);
    return result.success ? result.data : [];
}

async function getSubprojectVehicles(subprojectId) {
    const result = await request('GET', `/subprojects/${subprojectId}/projectvehicles`);
    return result.success ? result.data : [];
}

/**
 * Henter alle finansdata for et subprojekt parallelt.
 */
async function getSubprojectFinancials(subprojectId, options = {}) {
    const {
        includeEquipment = true,
        includeCosts = true,
        includeCrew = true,
        includeTransport = true
    } = options;

    const results = {
        equipment: [],
        costs: [],
        functions: [],
        vehicles: []
    };

    const promises = [];

    if (includeEquipment) {
        promises.push(
            getSubprojectEquipment(subprojectId).then(data => { results.equipment = data || []; })
        );
    }

    if (includeCosts) {
        promises.push(
            getSubprojectCosts(subprojectId).then(data => { results.costs = data || []; })
        );
    }

    if (includeCrew) {
        promises.push(
            getSubprojectFunctions(subprojectId).then(data => { results.functions = data || []; })
        );
    }

    if (includeTransport) {
        promises.push(
            getSubprojectVehicles(subprojectId).then(data => { results.vehicles = data || []; })
        );
    }

    await Promise.all(promises);

    return results;
}

// =============================================================================
// Hjælpefunktioner
// =============================================================================

/**
 * Bygger en URL til Rentman app for et projekt.
 */
function buildProjectUrl(projectId, subprojectId = null) {
    let url = `${config.rentman.appUrl}/#/projects/${projectId}/details`;
    if (subprojectId) {
        url += `?subproject=${subprojectId}`;
    }
    return url;
}

function buildRequestUrl(requestId) {
    return `${config.rentman.appUrl}/#/requests/${requestId}/details`;
}

/**
 * Ekstraherer ID fra en Rentman ref string (f.eks. "/projects/123" → 123).
 */
function extractIdFromRef(ref) {
    if (!ref) return null;
    const parts = ref.split('/');
    return parseInt(parts[parts.length - 1], 10);
}

/**
 * Tjekker om et bruger ID er integrationens bruger.
 * Bruges til at ignorere webhooks fra vores egne ændringer.
 */
function isIntegrationUser(userId) {
    return userId === config.rentman.integrationUserId;
}

module.exports = {
    request,
    get,
    post,
    put,
    del,

    getProject,
    getProjectByRef,
    getProjectSubprojects,
    getSubproject,

    getContact,
    getContactByRef,
    createContact,
    updateContact,
    deleteContact,

    getContactPerson,
    getContactPersonByRef,
    createContactPerson,
    updateContactPerson,
    deleteContactPerson,

    getStatus,

    createProjectRequest,
    deleteProjectRequest,
    getAllProjectRequests,

    getFile,
    getQuote,
    getContract,

    getEquipmentGroup,
    getCost,

    getProjectEquipment,
    getProjectEquipmentGroups,
    getProjectCosts,
    getProjectFunctions,
    getProjectFunctionGroups,
    getProjectVehicles,
    getProjectFinancials,

    getSubprojectEquipment,
    getSubprojectCosts,
    getSubprojectFunctions,
    getSubprojectVehicles,
    getSubprojectFinancials,

    buildProjectUrl,
    buildRequestUrl,
    extractIdFromRef,
    isIntegrationUser
};
