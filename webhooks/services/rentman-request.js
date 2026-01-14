const { createChildLogger } = require('../../lib/logger');
const db = require('../../lib/database');
const rentman = require('../../lib/rentman-client');

const logger = createChildLogger('rentman-request');

async function rentmanCrossCheckRental(projectRef) {
    try {
        const allRequests = await rentman.getAllProjectRequests();

        if (!allRequests || allRequests.length === 0) {
            return false;
        }

        for (const request of allRequests) {
            if (request.linked_project === projectRef) {
                logger.info('Fandt matching rental request', {
                    requestId: request.id,
                    projectRef
                });

                const hubspotData = await db.findSyncedRequestByRentmanId(request.id);

                await db.deleteSyncedRequest(request.id);
                await rentman.deleteProjectRequest(request.id);

                logger.info('Slettede rental request', { requestId: request.id });

                const projectInfo = await rentman.get(projectRef);
                if (!projectInfo) {
                    logger.warn('Kunne ikke hente projekt info', { projectRef });
                    return false;
                }

                const companyInfo = await rentman.get(projectInfo.customer);
                const contactInfo = await rentman.get(projectInfo.cust_contact);

                let companyDb = null;
                let contactDb = null;

                if (companyInfo?.id) {
                    companyDb = await db.findSyncedCompanyByRentmanId(companyInfo.id);
                }

                if (contactInfo?.id) {
                    contactDb = await db.findSyncedContactByRentmanId(contactInfo.id);
                }

                await db.insertSyncedDeal(
                    projectInfo.displayname,
                    projectInfo.id,
                    hubspotData?.hubspot_deal_id,
                    companyDb?.id || 0,
                    contactDb?.id || 0
                );

                logger.syncOperation('convert', 'request_to_deal', {
                    rentmanProjectId: projectInfo.id,
                    hubspotDealId: hubspotData?.hubspot_deal_id
                }, true);

                return true;
            }
        }

        return false;
    } catch (error) {
        logger.error('Fejl i rentmanCrossCheckRental', {
            error: error.message,
            stack: error.stack,
            projectRef
        });
        return false;
    }
}

module.exports = {
    rentmanCrossCheckRental
};
