const db = require('../lib/database');
const hubspot = require('../lib/hubspot-client');
const rentman = require('../lib/rentman-client');
const { createChildLogger } = require('../lib/logger');
const { SyncLogger } = require('./sync-logger');
const { sanitizeNumber, previousWeekday, nextWeekday, extractIdFromRef } = require('../lib/utils');
const config = require('../config');

const logger = createChildLogger('sync-deals');

async function syncOrdersToLineItems(options = {}) {
    /*
    const {
        batchSize = 50,
        triggeredBy = 'system'
    } = options;

    const direction = 'rentman_to_hubspot';

    const syncLogger = new SyncLogger('deal', direction, triggeredBy);
    await syncLogger.start({ batchSize, options });
    */

    const ordersFromSql = await db.query(`
        SELECT o.subproject_name, o.rentman_subproject_id, d.project_name, d.hubspot_project_id, d.rentman_project_id
        FROM synced_order as o
        INNER JOIN synced_deals as d
            ON o.synced_deals_id = d.id
    `)
    
    //console.log(ordersFromSql)

    for (const order of ordersFromSql) {
        const subprojectIdInRentman = order.rentman_subproject_id
        const subprojectInfoFromRentman = await rentman.getSubproject(subprojectIdInRentman)
        console.log(subprojectInfoFromRentman.displayname)

        const totalPrice = sanitizeNumber(subprojectInfoFromRentman.project_total_price)

        if (totalPrice > 0) console.log('Total:', totalPrice)

        await new Promise(res => setTimeout(res, 200))
    }
    
}

syncOrdersToLineItems();