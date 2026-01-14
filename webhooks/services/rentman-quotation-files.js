const { createChildLogger } = require('../../lib/logger');
const db = require('../../lib/database');
const hubspot = require('../../lib/hubspot-client');
const rentman = require('../../lib/rentman-client');
const { retry } = require('../../lib/utils');

const logger = createChildLogger('rentman-files');

async function linkFileToDeal(event) {
    try {
        const fileInfo = await rentman.get(event.items[0].ref);
        if (!fileInfo) {
            logger.warn('Kunne ikke hente fil info', { ref: event.items[0].ref });
            return;
        }

        const isQuote = fileInfo.file_itemtype === 'Offerte';
        const isContract = fileInfo.file_itemtype === 'Contract';

        if (!isQuote && !isContract) {
            logger.debug('Fil er hverken tilbud eller kontrakt - ignorerer', {
                fileType: fileInfo.file_itemtype
            });
            return;
        }

        let quotation;
        if (isQuote) {
            quotation = await rentman.getQuote(fileInfo.file_item);
        } else {
            quotation = await rentman.getContract(fileInfo.file_item);
        }

        if (!quotation) {
            logger.warn('Kunne ikke hente quotation/contract', {
                itemId: fileInfo.file_item,
                type: fileInfo.file_itemtype
            });
            return;
        }

        const project = await rentman.get(quotation.project);
        if (!project) {
            logger.warn('Kunne ikke hente projekt', { projectRef: quotation.project });
            return;
        }

        const hubspotDeal = await retry(
            () => db.findSyncedDealByRentmanId(project.id),
            { maxAttempts: 3, delayMs: 3000 }
        );

        if (!hubspotDeal) {
            logger.warn('Ingen HubSpot deal fundet', { projectId: project.id });
            return;
        }

        const fileType = isQuote ? 'Tilbud vedr.' : 'Ordrebekraeftelse for';
        const fileName = `${fileType} ${project.displayname}`;

        logger.info('Uploader fil til HubSpot', {
            fileName,
            projectName: project.displayname,
            dealId: hubspotDeal.hubspot_project_id
        });

        const uploadTask = await hubspot.uploadFileFromUrl(fileInfo.url, fileName);

        let fileId;
        try {
            fileId = await hubspot.waitForFileUpload(uploadTask.id, 12, 5000);
        } catch (uploadError) {
            logger.error('Fil upload timeout eller fejl', {
                error: uploadError.message,
                taskId: uploadTask.id
            });
            return;
        }

        await hubspot.createNote(
            hubspotDeal.hubspot_project_id,
            fileId,
            `${fileType} ${project.displayname}`
        );

        logger.syncOperation('link', 'file_to_deal', {
            fileId,
            dealId: hubspotDeal.hubspot_project_id,
            fileName
        }, true);
    } catch (error) {
        logger.error('Fejl ved linking af fil til deal', {
            error: error.message,
            stack: error.stack,
            eventRef: event.items[0]?.ref
        });
    }
}

module.exports = {
    linkFileToDeal
};
