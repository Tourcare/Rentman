const { createChildLogger } = require('../../lib/logger');
const db = require('../../lib/database');
const rentman = require('../../lib/rentman-client');

const logger = createChildLogger('rentman-dashboard');

async function handleDashboardWebhook(webhookData) {
    try {
        const { eventType, itemType, items } = webhookData;

        if (itemType !== 'Subproject') {
            logger.debug('Ignorerer non-Subproject event', { itemType });
            return;
        }

        for (const item of items) {
            const subprojectId = item.id;

            logger.debug('Behandler dashboard event', { eventType, subprojectId });

            if (eventType === 'delete') {
                await db.deleteDashboardSubproject(subprojectId);
                logger.info('Slettede subproject fra dashboard', { subprojectId });
            } else if (eventType === 'create' || eventType === 'update') {
                const subprojectData = await rentman.getSubproject(subprojectId);

                if (!subprojectData?.data) {
                    logger.warn('Kunne ikke hente subproject data', { subprojectId });
                    continue;
                }

                const projectRef = subprojectData.data.project;
                const projectId = projectRef.split('/').pop();

                const projectData = await rentman.getProject(projectId);

                if (!projectData) {
                    logger.warn('Kunne ikke hente project data', { projectId });
                    continue;
                }

                await db.upsertDashboardSubproject(subprojectData, { data: projectData });

                logger.info(`${eventType === 'create' ? 'Oprettede' : 'Opdaterede'} subproject i dashboard`, {
                    subprojectId,
                    projectId
                });
            }
        }
    } catch (error) {
        logger.error('Fejl ved behandling af dashboard webhook', {
            error: error.message,
            stack: error.stack
        });
    }
}

module.exports = {
    handleDashboardWebhook
};
