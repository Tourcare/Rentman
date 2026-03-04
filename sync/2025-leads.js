const db = require('../lib/database');
const hubspot = require('../lib/hubspot-client');
const rentman = require('../lib/rentman-client');
const { createChildLogger } = require('../lib/logger');
const { SyncLogger } = require('./sync-logger');
const { sanitizeNumber, previousWeekday, nextWeekday, extractIdFromRef, capitalize } = require('../lib/utils');
const config = require('../config');

const logger = createChildLogger('sync-deals');

async function createLeadsFrom2025(options = {}) {
    /*
    const {
        batchSize = 50,
        triggeredBy = 'system'
    } = options;

    const direction = 'rentman_to_hubspot';

    const syncLogger = new SyncLogger('deal', direction, triggeredBy);
    await syncLogger.start({ batchSize, options });
    */

    const leadsFromSql = await db.query(`
        SELECT c.rentman_id as rentman_id, c.hubspot_id as hubspot_id, c.name as kontaktperson,  v.name as virksomhed
        FROM projects as p
        INNER JOIN synced_contacts as c
            ON SUBSTRING_INDEX(p.cust_contact, '/', -1) = c.rentman_id
        INNER JOIN synced_companies as v
            ON c.hubspot_company_conntected = v.hubspot_id
        WHERE p.cust_contact IS NOT NULL
            AND p.project_total_price > 4999
        GROUP BY kontaktperson
    `)

    
    for (const lead of leadsFromSql) {
        if (lead.kontaktperson) {
            const properties = {
                "hs_lead_name": lead.kontaktperson,
                "hs_lead_type": "Opfølgning",
                "hs_pipeline": "3616820458",
                "hs_pipeline_stage": "4972216525"
            }
            try {
                const { id } = await hubspot.createLead(properties, lead.hubspot_id)
                console.log(`Opretter lead ${lead.kontaktperson} med id ${id}`)
            } catch (error) {
                console.warn(`Fejl ved oprettelse af lead ${lead.kontaktperson}`, error)
            }
        } else continue;
        await new Promise(res => setTimeout(res, 200))
    }

}

createLeadsFrom2025();
