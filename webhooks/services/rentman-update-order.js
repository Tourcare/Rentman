const dotenv = require('dotenv');

const pool = require('../../db');

const HUBSPOT_TOKEN = process.env.HUBSPOT_API_TOKEN;
const HUBSPOT_ENDPOINT = "https://api.hubapi.com/crm/v3/objects/"
const HUBSPOT_ENDPOINT_v4 = "https://api.hubapi.com/crm/v4/objects/"

const RENTMAN_API_BASE = "https://api.rentman.net";
const RENTMAN_API_TOKEN = process.env.RENTMAN_ACCESS_TOKEN;

function sanitizeNumber(value, decimals = 2) {
    const EPSILON = 1e-6;

    // Hvis værdien er ekstremt tæt på nul, sæt til 0
    if (Math.abs(value) < EPSILON) return 0;

    // Fjern floating-point-støj ved at runde
    const rounded = Number(value.toFixed(decimals));

    return rounded;
}

async function rentmanGetFromEndpoint(endpoint, attempt = 1) {
    if (endpoint === null) {
        return false;
    }
    const maxRetries = 5;
    const baseDelay = 5000; // Start med 1 sekund
    const retryDelay = baseDelay * (2 ** (attempt - 1)); // Eksponentiel backoff: 1s, 2s, 4s, 8s, 16s

    const url = `${RENTMAN_API_BASE}${endpoint}`;

    try {
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'Accept': 'application/json',
                'Authorization': `Bearer ${RENTMAN_API_TOKEN}`
            }
        });

        if (response.status === 429) {
            if (attempt >= maxRetries) {
                throw new Error(`Rate limit ramt og max retries (${maxRetries}) nået for ${endpoint}`);
            }
            console.error(`Rate limit ramt (forsøg ${attempt}). Venter ${retryDelay / 1000} sekunder...`);
            const start = Date.now();
            await new Promise(res => setTimeout(res, retryDelay));
            console.log(`Ventetid slut efter ${(Date.now() - start) / 1000} sekunder. Prøver igen...`);
            return rentmanGetFromEndpoint(endpoint, attempt + 1);
        }

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`HTTP error! status: ${response.status}, message: ${errText}`);
        }

        const output = await response.json();
        return output.data;
    } catch (error) {
        console.error(`Fejl i rentmanGetFromEndpoint for ${endpoint} (forsøg ${attempt}):`, error);
        throw error;
    }
}




// ###############################################################################################################





async function hubspotPatchOrder(order, current) {

    const url = `${HUBSPOT_ENDPOINT}orders/${current}`

    const status = await rentmanGetFromEndpoint(order.status)

    console.log(`     / Opdateret order ${order.displayname}`)

    const total_price = sanitizeNumber(order.project_total_price)

    const dealStageMap = {
        1: "937ea84d-0a4f-4dcf-9028-3f9c2aafbf03",        // Pending
        2: "3725360f-519b-4b18-a593-494d60a29c9f",        // Cancelled
        3: "aa99e8d0-c1d5-4071-b915-d240bbb1aed9",        // Confirmed
        4: "aa99e8d0-c1d5-4071-b915-d240bbb1aed9",        // Prepped
        5: "aa99e8d0-c1d5-4071-b915-d240bbb1aed9",        // On Location
        6: "aa99e8d0-c1d5-4071-b915-d240bbb1aed9",        // On Location (duplicate if needed)
        7: "4b27b500-f031-4927-9811-68a0b525cbae",        // Inquiry
        8: "4b27b500-f031-4927-9811-68a0b525cbae",        // Concept
        9: "3531598027",                                  // To be invoiced
        11: "3c85a297-e9ce-400b-b42e-9f16853d69d6",       // Invoiced
        12: "3531598027"                                  // To be invoiced
    };

    const dealstage = dealStageMap[status.id];

    const body = {
        properties: {
            hs_order_name: order.displayname,
            hs_total_price: total_price,
            hs_pipeline: "14a2e10e-5471-408a-906e-c51f3b04369e",
            hs_pipeline_stage: dealstage,
            start_projekt_period: order.usageperiod_end,
            slut_projekt_period: order.usageperiod_start
        },
        associations: []
    };

    const response = await fetch(url, {
        method: "PATCH",
        headers: {
            'Content-Type': 'application/json',
            "Accept": "application/json",
            "Authorization": `Bearer ${HUBSPOT_TOKEN}`,
        },
        body: JSON.stringify(body),
    });

    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`HTTP error! status: ${response.status}, message: ${errText}`);
    }

    const output = await response.json();
    return output.properties.hs_object_id;
}

async function updateOrders(webhook) {
    console.log('updateOrders funktion er kaldet!');
    for (const item of webhook.items) {
        
        const subProjectInfo = await rentmanGetFromEndpoint(item.ref)

        let orderInfo;

        for (let i = 0; i < 3; i++) {
            const [orderRows] = await pool.execute(
                `SELECT * FROM synced_order WHERE rentman_subproject_id = ?`,
                [subProjectInfo.id]
            );

            orderInfo = orderRows;

            if (orderInfo?.[0]) break;

            console.log(`Ingen order endnu for subproject ${subProjectInfo.displayname}. Venter og prøver igen...`);
            await new Promise(r => setTimeout(r, 3000)); // vent 3 sek
        }

        if (!orderInfo?.[0]) {
            console.warn(`STOPPER Fandt stadig ingen order for ${subProjectInfo.displayname}`);
            continue;
        }

        await hubspotPatchOrder(subProjectInfo, orderInfo[0].hubspot_order_id)

        await pool.query(
            `UPDATE synced_order SET subproject_name = ? WHERE rentman_subproject_id = ?`, [subProjectInfo.displayname, subProjectInfo.id]
        );

    }
}




// ###############################################################################################################




async function hubspotCreateOrder(order, deal, company, contact) {
    const url = `${HUBSPOT_ENDPOINT}orders`
    const status = await rentmanGetFromEndpoint(order.status)

    console.log(`     + Order ${order.displayname}`)

    const total_price = sanitizeNumber(order.project_total_price)

    const dealStageMap = {
        1: "937ea84d-0a4f-4dcf-9028-3f9c2aafbf03",        // Pending
        2: "3725360f-519b-4b18-a593-494d60a29c9f",        // Cancelled
        3: "aa99e8d0-c1d5-4071-b915-d240bbb1aed9",        // Confirmed
        4: "aa99e8d0-c1d5-4071-b915-d240bbb1aed9",        // Prepped
        5: "aa99e8d0-c1d5-4071-b915-d240bbb1aed9",        // On Location
        6: "aa99e8d0-c1d5-4071-b915-d240bbb1aed9",        // On Location (duplicate if needed)
        7: "4b27b500-f031-4927-9811-68a0b525cbae",        // Inquiry
        8: "4b27b500-f031-4927-9811-68a0b525cbae",        // Concept
        9: "3531598027",                                  // To be invoiced
        11: "3c85a297-e9ce-400b-b42e-9f16853d69d6",       // Invoiced
        12: "3531598027"                                  // To be invoiced
    };

    const dealstage = dealStageMap[status.id];

    const body = {
        properties: {
            hs_order_name: order.displayname,
            hs_total_price: total_price,
            hs_pipeline: "14a2e10e-5471-408a-906e-c51f3b04369e",
            hs_pipeline_stage: dealstage,
            start_projekt_period: order.usageperiod_end,
            slut_projekt_period: order.usageperiod_start
        },
        associations: []
    };

    if (company) {
        body.associations.push({
            to: { id: company },
            types: [{
                associationCategory: "HUBSPOT_DEFINED",
                associationTypeId: 509
            }]
        });
    }

    if (contact) {
        body.associations.push({
            to: { id: contact },
            types: [{
                associationCategory: "HUBSPOT_DEFINED",
                associationTypeId: 507
            }]
        });
    }

    if (deal) {
        body.associations.push({
            to: { id: deal },
            types: [{
                associationCategory: "HUBSPOT_DEFINED",
                associationTypeId: 512
            }]
        });
    }

    const response = await fetch(url, {
        method: "POST",
        headers: {
            'Content-Type': 'application/json',
            "Accept": "application/json",
            "Authorization": `Bearer ${HUBSPOT_TOKEN}`,
        },
        body: JSON.stringify(body),
    });

    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`HTTP error! status: ${response.status}, message: ${errText}`);
    }

    const output = await response.json();
    return output.properties.hs_object_id;
}



async function createOrders(webhook) {
    console.log('createOrders funktion kaldet!')
    for (const item of webhook.items) {
        const subProjectInfo = await rentmanGetFromEndpoint(item.ref)
        const projectInfo = await rentmanGetFromEndpoint(subProjectInfo.project)
        const companyInfo = await rentmanGetFromEndpoint(projectInfo.customer)
        const contactInfo = await rentmanGetFromEndpoint(projectInfo.cust_contact)

        let companyRows;
        let contactRows;

        if (companyInfo.id) {
            [companyRows] = await pool.execute(`SELECT * FROM synced_companies WHERE rentman_id = ?`, [companyInfo.id]);
        }

        if (contactInfo.id) {
            [contactRows] = await pool.execute(`SELECT * FROM synced_contacts WHERE rentman_id = ?`, [contactInfo.id]);
        }

        let dealInfo;
        for (let i = 0; i < 3; i++) {

            const [checkOrder] = await pool.execute(
                `SELECT * FROM synced_order WHERE rentman_subproject_id = ?`,
                [subProjectInfo.id]
            );

            if (checkOrder?.[0]) {
                console.log('Duplicate fundet')
                break;
            }

            const [rows] = await pool.execute(
                `SELECT * FROM synced_deals WHERE rentman_project_id = ?`,
                [projectInfo.id]
            );
            dealInfo = rows;

            if (dealInfo?.[0]) break;

            console.log(`Ingen deal endnu for project ${projectInfo.id}. Venter og prøver igen...`);
            await new Promise(r => setTimeout(r, 3000)); // vent 3 sek
        }

        const order_id = await hubspotCreateOrder(subProjectInfo, dealInfo[0].hubspot_project_id, companyRows?.[0]?.hubspot_id ?? 0, contactRows?.[0]?.hubspot_id ?? 0)

        await pool.query(
            'INSERT INTO synced_order (subproject_name, rentman_subproject_id, hubspot_order_id, synced_companies_id, synced_contact_id, synced_deals_id) VALUES (?, ?, ?, ?, ?, ?)',
            [subProjectInfo.displayname, subProjectInfo.id, order_id, companyRows?.[0]?.id ?? 0, contactRows?.[0]?.id ?? 0, dealInfo[0].id]
        );

    }
}


module.exports = { createOrders, updateOrders };