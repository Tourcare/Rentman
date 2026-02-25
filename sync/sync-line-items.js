const db = require('../lib/database');
const hubspot = require('../lib/hubspot-client');
const rentman = require('../lib/rentman-client');
const { createChildLogger } = require('../lib/logger');
const { SyncLogger } = require('./sync-logger');
const { sanitizeNumber, previousWeekday, nextWeekday, extractIdFromRef, capitalize } = require('../lib/utils');
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
        SELECT o.id, o.subproject_name, o.rentman_subproject_id, o.hubspot_order_id, d.project_name, d.hubspot_project_id, d.rentman_project_id
        FROM synced_order as o
        INNER JOIN synced_deals as d
            ON o.synced_deals_id = d.id
    `)

    const hubspotProductMap = {
        "insurance": "394858376380",
        "rental": "327017330935",
        "sale": "327017331952",
        "transport": "327784937682",
        "crew": "327784217802",
        "additional": "395307780315"
    }
    
    //console.log(ordersFromSql)

    for (const order of ordersFromSql) {
        const subprojectIdInRentman = order.rentman_subproject_id
        const subprojectInfoFromRentman = await rentman.getSubproject(subprojectIdInRentman)

        if (!subprojectIdInRentman) continue;

        async function createLineItems() {
            const priceData = [
                { type: "rental", value: sanitizeNumber(subprojectInfoFromRentman?.project_rental_price ?? 0) },
                { type: "sale", value: sanitizeNumber(subprojectInfoFromRentman?.project_sale_price ?? 0) },
                { type: "crew", value: sanitizeNumber(subprojectInfoFromRentman?.project_crew_price ?? 0) },
                { type: "transport", value: sanitizeNumber(subprojectInfoFromRentman?.project_transport_price ?? 0) },
                { type: "additional", value: sanitizeNumber(subprojectInfoFromRentman?.project_other_price ?? 0) },
                { type: "insurance", value: sanitizeNumber(subprojectInfoFromRentman?.project_insurance_price ?? 0) }
            ];

            for (const item of priceData) {
                if (item.value > 0) {
                    const productId = hubspotProductMap[item.name];
                    const formattedName = capitalize(item.type)
                    const properties = {
                        "name": formattedName,
                        "quantity": 1,
                        "price": item.value,
                        "hs_product_id": productId
                    };

                    try {
                        const { id } = await hubspot.createLineItemForOrder(properties, order.hubspot_order_id);
                        await db.insertLineItemForOrder(item.type, id, order.id)
                        console.log(`Oprettet line item for: ${item.type} ${item.value} | Order: ${subprojectInfoFromRentman.displayname}`);
                    } catch (error) {
                        console.warn(`Fejl ved oprettelse af ${item.type}:`, error);
                    }
                }

            }

        }

        createLineItems();

        await new Promise(res => setTimeout(res, 150))
    }
    console.log("Færdig med at oprette alle Line Items")
    
}

syncOrdersToLineItems();

async function deleteLineItemsFromAllOrders() {
    const listOfLineItems = await db.query("SELECT * FROM order_line_items")

    for (lineItem of listOfLineItems) {
        const id = lineItem.hubspot_line_item_id
        const result = await hubspot.deleteLineItem(id)
        db.deleteLineItemFromOrder(id)
        console.log(`Har slettet lineitem med id ${id}`)

    }
    console.log("Færdig med at slette line items fra database")
    return false;
}

//deleteLineItemsFromAllOrders();