const config = require('../../config');
const { createChildLogger } = require('../../lib/logger');
const db = require('../../lib/database');
const hubspot = require('../../lib/hubspot-client');
const rentman = require('../../lib/rentman-client');
const { sanitizeNumber, retry, extractIdFromRef, sleep } = require('../../lib/utils');
const { ensureOrder } = require('./rentman-update-order');

const logger = createChildLogger('rentman-deal');

// In-memory lock map to prevent concurrent syncDeal calls for the same project
const pendingDeals = new Map();

async function syncDeal(webhook) {
    const projectRef = webhook.items[0].ref;

    // If another call is already creating this deal, wait for it
    if (pendingDeals.has(projectRef)) {
        logger.info('Venter på igangværende deal oprettelse', { projectRef });
        return pendingDeals.get(projectRef);
    }

    const promise = _syncDealImpl(webhook);
    pendingDeals.set(projectRef, promise);

    try {
        return await promise;
    } finally {
        pendingDeals.delete(projectRef);
    }
}

async function _syncDealImpl(webhook) {
    logger.info('syncDeal funktion kaldet');

    try {
        const projectRef = webhook.items[0].ref;
        const project = await rentman.getProjectByRef(projectRef);

        if (!project) {
            logger.error('Kunne ikke hente projekt fra Rentman', { ref: projectRef });
            return;
        }

        // Tjek om deal allerede eksisterer (f.eks. oprettet af et andet webhook lige inden)
        const existingDeal = await db.findSyncedDealByRentmanId(project.id);
        if (existingDeal) {
            logger.info('Deal eksisterer allerede - springer oprettelse over', {
                rentmanId: project.id,
                hubspotId: existingDeal.hubspot_project_id
            });
            return;
        }

        const [contactInfo, customerInfo] = await Promise.all([
            rentman.getContactByRef(project.customer),
            rentman.getContactPersonByRef(project.cust_contact)
        ]);

        let companyDb = null;
        let contactDb = null;
        let dealId;

        if (contactInfo?.id) {
            companyDb = await db.findSyncedCompanyByRentmanId(contactInfo.id);

            if (customerInfo?.id) {
                contactDb = await db.findSyncedContactByRentmanId(customerInfo.id);

                logger.info('Opretter deal med virksomhed og kontaktperson', {
                    dealname: project.displayname
                });

                dealId = await createHubSpotDeal(project, companyDb?.hubspot_id, contactDb?.hubspot_id);

                await db.insertSyncedDeal(
                    project.displayname,
                    project.id,
                    dealId,
                    companyDb?.id || 0,
                    contactDb?.id || 0
                );
            } else {
                logger.info('Opretter deal uden kontaktperson', {
                    dealname: project.displayname
                });

                dealId = await createHubSpotDeal(project, companyDb?.hubspot_id);

                await db.insertSyncedDeal(
                    project.displayname,
                    project.id,
                    dealId,
                    companyDb?.id || 0,
                    0
                );
            }
        } else {
            logger.info('Opretter deal uden virksomhed', {
                dealname: project.displayname
            });

            dealId = await createHubSpotDeal(project);

            await db.insertSyncedDeal(
                project.displayname,
                project.id,
                dealId,
                0,
                0
            );
        }

        logger.syncOperation('create', 'deal', {
            rentmanId: project.id,
            hubspotId: dealId
        }, true);

        // Sync eksisterende subprojects - ensureOrder er idempotent og forhindrer dubletter
        const subProjects = await rentman.getProjectSubprojects(projectRef);
        if (subProjects?.length > 0) {
            for (const sub of subProjects) {
                try {
                    await ensureOrder(sub);
                } catch (err) {
                    logger.error('Fejl ved sync af subproject i syncDeal', {
                        subprojectId: sub.id,
                        error: err.message
                    });
                }
            }
        }
    } catch (error) {
        logger.error('Fejl i syncDeal', {
            error: error.message,
            stack: error.stack
        });
        throw error;
    }
}

async function updateDeal(webhook, isFromRequest = false) {
    logger.info('updateDeal funktion kaldet');

    try {
        const projectRef = webhook.items[0].ref;
        const project = await rentman.getProjectByRef(projectRef);

        if (!project) {
            logger.error('Kunne ikke hente projekt fra Rentman', { ref: projectRef });
            return;
        }

        const [subProjects, contactInfo, customerInfo] = await Promise.all([
            rentman.getProjectSubprojects(projectRef),
            rentman.getContactByRef(project.customer),
            rentman.getContactPersonByRef(project.cust_contact)
        ]);

        const hubspotDeal = await retry(
            () => db.findSyncedDealByRentmanId(project.id),
            { maxAttempts: 3, delayMs: 3000 }
        );

        if (!hubspotDeal) {
            logger.warn('Ingen HubSpot deal fundet i database - opretter projektet i stedet', { rentmanProjectId: project.id });
            await syncDeal(webhook);
            return;
        }

        logger.info('Fandt HubSpot deal', {
            rentmanId: project.id,
            hubspotId: hubspotDeal.hubspot_project_id
        });

        const oldCompanyDb = await db.findSyncedCompanyByRentmanId(hubspotDeal.synced_companies_id);
        const oldContactDb = await db.findSyncedContactByRentmanId(hubspotDeal.synced_contact_id);

        const isCustomerSame = oldCompanyDb?.rentman_id === contactInfo?.id;
        const isContactSame = oldContactDb?.rentman_id === customerInfo?.id;
        const shouldUpdateAssociations = !isCustomerSame || !isContactSame || isFromRequest;

        if (shouldUpdateAssociations) {
            await updateDealAssociations(
                hubspotDeal,
                contactInfo,
                customerInfo,
                subProjects || []
            );
        }

        await updateHubSpotDealProperties(hubspotDeal.hubspot_project_id, project);

        logger.syncOperation('update', 'deal', {
            rentmanId: project.id,
            hubspotId: hubspotDeal.hubspot_project_id
        }, true);
    } catch (error) {
        logger.error('Fejl i updateDeal', {
            error: error.message,
            stack: error.stack
        });
        throw error;
    }
}

async function createHubSpotDeal(project, companyId = null, contactId = null) {
    const users = await db.getSyncedUsers();
    let ownerId = null;

    if (project.account_manager) {
        const crewId = extractIdFromRef(project.account_manager);
        const user = users.find(u => u.rentman_id?.toString() === crewId?.toString());
        if (user) {
            ownerId = user.hubspot_id;
            logger.info('Tilfojet account manager til deal', {
                name: user.navn,
                dealname: project.displayname
            });
        }
    }

    const properties = {
        dealname: project.displayname,
        dealstage: 'appointmentscheduled',
        usage_period: new Date(project.usageperiod_start),
        slut_projekt_period: new Date(project.usageperiod_end),
        amount: sanitizeNumber(project.project_total_price),
        start_planning_period: new Date(project.planperiod_start),
        slut_planning_period: new Date(project.planperiod_end),
        rentman_database_id: project.number
    };

    if (ownerId) {
        properties.hubspot_owner_id = ownerId;
    }

    const result = await hubspot.createDeal(properties, companyId, contactId);
    return result.id;
}

async function updateHubSpotDealProperties(hubspotDealId, project) {
    const users = await db.getSyncedUsers();
    let ownerId = null;

    if (project.account_manager) {
        const crewId = extractIdFromRef(project.account_manager);
        const user = users.find(u => u.rentman_id?.toString() === crewId?.toString());
        if (user) {
            ownerId = user.hubspot_id;
        }
    }

    const properties = {
        dealname: project.displayname,
        usage_period: new Date(project.usageperiod_start),
        slut_projekt_period: new Date(project.usageperiod_end),
        amount: sanitizeNumber(project.project_total_price),
        start_planning_period: new Date(project.planperiod_start),
        slut_planning_period: new Date(project.planperiod_end),
        opret_i_rentam_request: 'Ja',
        hidden_rentman_request: true,
        rentman_projekt: rentman.buildProjectUrl(project.id),
        rentman_database_id: project.number
    };

    if (ownerId) {
        properties.hubspot_owner_id = ownerId;
    }

    const newStage = await calculateDealStage(hubspotDealId);
    if (newStage) {
        properties.dealstage = newStage;
    }

    await hubspot.updateDeal(hubspotDealId, properties);
}

async function updateDealAssociations(hubspotDeal, contactInfo, customerInfo, subProjects) {
    if (!hubspotDeal.hubspot_project_id) {
        logger.warn('Deal har ingen hubspot_project_id - kan ikke opdatere associations', {
            rentmanId: hubspotDeal.rentman_project_id
        });
        return;
    }

    const oldCompanyDb = hubspotDeal.synced_companies_id
        ? await db.query('SELECT * FROM synced_companies WHERE id = ?', [hubspotDeal.synced_companies_id]).then(rows => rows[0])
        : null;
    const oldContactDb = hubspotDeal.synced_contact_id
        ? await db.query('SELECT * FROM synced_contacts WHERE id = ?', [hubspotDeal.synced_contact_id]).then(rows => rows[0])
        : null;

    if (oldCompanyDb?.hubspot_id) {
        await hubspot.removeAssociation('deals', hubspotDeal.hubspot_project_id, 'company', oldCompanyDb.hubspot_id, 5);
    }
    if (oldContactDb?.hubspot_id) {
        await hubspot.removeAssociation('deals', hubspotDeal.hubspot_project_id, 'contacts', oldContactDb.hubspot_id, 3);
    }

    if (contactInfo?.id) {
        const newCompanyDb = await db.findSyncedCompanyByRentmanId(contactInfo.id);
        if (newCompanyDb?.hubspot_id) {
            await hubspot.addAssociation('deals', hubspotDeal.hubspot_project_id, 'company', newCompanyDb.hubspot_id, 5);
            await db.updateSyncedDealCompany(hubspotDeal.hubspot_project_id, newCompanyDb.id);
        }
    }

    if (customerInfo?.id) {
        const newContactDb = await db.findSyncedContactByRentmanId(customerInfo.id);
        if (newContactDb?.hubspot_id) {
            await hubspot.addAssociation('deals', hubspotDeal.hubspot_project_id, 'contacts', newContactDb.hubspot_id, 3);
            await db.updateSyncedDealContact(hubspotDeal.hubspot_project_id, newContactDb.id);
        }
    }

    for (const sub of subProjects) {
        const hubSub = await ensureOrder(sub);

        if (!hubSub?.hubspot_order_id) {
            logger.warn('Kunne ikke finde eller oprette order', { subprojectName: sub.displayname });
            continue;
        }

        if (contactInfo?.id) {
            const companyDb = await db.findSyncedCompanyByRentmanId(contactInfo.id);
            if (companyDb?.hubspot_id) {
                await hubspot.addAssociation('orders', hubSub.hubspot_order_id, 'company', companyDb.hubspot_id, 509);
            }
        }

        if (customerInfo?.id) {
            const contactDb = await db.findSyncedContactByRentmanId(customerInfo.id);
            if (contactDb?.hubspot_id) {
                await hubspot.addAssociation('orders', hubSub.hubspot_order_id, 'contacts', contactDb.hubspot_id, 507);
            }
        }
    }
}

async function calculateDealStage(hubspotDealId) {
    const deal = await hubspot.getObject('deals', hubspotDealId, [], ['orders']);
    const orderAssociations = deal?.associations?.orders?.results;

    if (!orderAssociations || orderAssociations.length === 0) {
        return null;
    }

    const orderStages = [];

    for (const orderAssoc of orderAssociations) {
        const order = await hubspot.getOrder(orderAssoc.id);
        if (order?.properties?.hs_pipeline_stage) {
            orderStages.push(order.properties.hs_pipeline_stage);
        }
    }

    return hubspot.calculateDealStageFromOrders(orderStages);
}

module.exports = {
    syncDeal,
    updateDeal
};
