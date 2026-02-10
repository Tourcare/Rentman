const { createChildLogger } = require('../../lib/logger');
const db = require('../../lib/database');
const hubspot = require('../../lib/hubspot-client');
const rentman = require('../../lib/rentman-client');
const { previousWeekday, nextWeekday, findAssociationId } = require('../../lib/utils');

const logger = createChildLogger('hubspot-deal');

async function handleHubSpotDealWebhook(events) {
    for (const event of events) {
        if (event.changeSource === 'INTEGRATION') {
            continue;
        }

        try {
            switch (event.subscriptionType) {
                case 'object.creation':
                    logger.info('Oprettelse af deal modtaget', { objectId: event.objectId });
                    const created = await handleDealCreation(event);
                    if (created === false) break;
                    if (created === true) continue;
                    break;

                case 'object.propertyChange':
                    await handleDealPropertyChange(event);
                    break;

                case 'object.deletion':
                    logger.info('Sletning af deal modtaget', { objectId: event.objectId });
                    await handleDealDeletion(event);
                    break;
            }
        } catch (error) {
            logger.error('Fejl ved behandling af deal event', {
                error: error.message,
                stack: error.stack,
                objectId: event.objectId,
                subscriptionType: event.subscriptionType
            });
        }
    }
}

async function handleDealCreation(event) {
    const deal = await hubspot.getDeal(event.objectId, [], ['companies', 'contacts']);

    if (!deal) {
        logger.warn('Deal ikke fundet i HubSpot', { objectId: event.objectId });
        return true;
    }

    logger.info('Deal hentet', { dealname: deal.properties.dealname });

    await hubspot.updateDeal(deal.id, { hidden_rentman_request: true });

    const usagePeriod = deal.properties.usage_period;
    const endPeriod = deal.properties.slut_projekt_period;

    if (!usagePeriod || !endPeriod) {
        logger.info('Deal mangler projektperiode', { dealname: deal.properties.dealname });
        return true;
    }

    logger.info('Deal har en projektperiode', { dealname: deal.properties.dealname });

    const companyAssociations = deal.associations?.companies?.results;
    let companyDbRecord = null;
    let rentmanContactId = null;

    if (companyAssociations && companyAssociations.length > 0) {
        const primaryCompanyId = findAssociationId(companyAssociations, 'deal_to_company');

        if (primaryCompanyId) {
            logger.info('Deal har tilknyttet virksomhed', {
                dealname: deal.properties.dealname,
                companyId: primaryCompanyId
            });

            companyDbRecord = await db.findSyncedCompanyByHubspotId(primaryCompanyId);

            if (!companyDbRecord) {
                companyDbRecord = await db.findSyncedCompanyByName('Mangler Virksomhed');
            }

            rentmanContactId = companyDbRecord?.rentman_id;
        }
    }

    const requestData = await createRentalRequest(deal, rentmanContactId);

    if (!requestData) {
        logger.error('Kunne ikke oprette rental request i Rentman', {
            dealname: deal.properties.dealname
        });
        return false;
    }

    const rentmanRequest = requestData.rentman;

    await hubspot.updateDeal(deal.id, {
        hidden_rentman_request: true,
        opret_i_rentam_request: 'Ja',
        start_planning_period: requestData.startPeriod,
        slut_planning_period: requestData.slutPeriod,
        rentman_projekt: rentman.buildRequestUrl(rentmanRequest.id)
    });

    await db.insertSyncedRequest(
        rentmanRequest.id,
        event.objectId,
        companyDbRecord?.id || 0
    );

    logger.syncOperation('create', 'rental_request', {
        rentmanId: rentmanRequest.id,
        hubspotId: event.objectId
    }, true);

    return false;
}

async function handleDealPropertyChange(event) {
    if (event.propertyName !== 'opret_i_rentam_request') {
        return;
    }

    if (event.propertyValue !== 'Proev Igen') {
        return;
    }

    const existingRequest = await db.findSyncedRequestByHubspotDealId(event.objectId);
    const existingDeal = await db.findSyncedDealByHubspotId(event.objectId);

    if (!existingRequest?.rentman_request_id && !existingDeal?.id) {
        await handleDealCreation(event);
    } else {
        await hubspot.updateDeal(event.objectId, { hidden_rentman_request: true });
    }
}

async function handleDealDeletion(event) {
    const request = await db.findSyncedRequestByHubspotDealId(event.objectId);

    if (request?.rentman_request_id) {
        await rentman.deleteProjectRequest(request.rentman_request_id);
        await db.deleteSyncedRequest(request.rentman_request_id);

        logger.syncOperation('delete', 'rental_request', {
            rentmanId: request.rentman_request_id,
            hubspotId: event.objectId
        }, true);
    } else {
        logger.warn('Kunne ikke finde rental request i Rentman', {
            hubspotDealId: event.objectId
        });
    }
}

async function createRentalRequest(deal, rentmanContactId) {
    const start = new Date(deal.properties.usage_period);
    const end = new Date(deal.properties.slut_projekt_period);

    const planningPeriodStart = previousWeekday(start);
    const planningPeriodEnd = nextWeekday(end);

    const body = {
        name: deal.properties.dealname,
        usageperiod_end: end,
        usageperiod_start: start,
        planperiod_end: planningPeriodEnd,
        planperiod_start: planningPeriodStart
    };

    if (rentmanContactId) {
        body.linked_contact = `/contacts/${rentmanContactId}`;
    }

    try {
        const rentmanData = await rentman.createProjectRequest(body);

        return {
            rentman: rentmanData,
            startPeriod: planningPeriodStart,
            slutPeriod: planningPeriodEnd
        };
    } catch (error) {
        logger.error('Fejl ved oprettelse af rental request', {
            error: error.message,
            dealname: deal.properties.dealname
        });
        return null;
    }
}

module.exports = {
    handleHubSpotDealWebhook
};
