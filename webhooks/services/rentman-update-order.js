const dotenv = require('dotenv');

const pool = require('../../db');

const HUBSPOT_TOKEN = process.env.HUBSPOT_API_TOKEN;
const HUBSPOT_ENDPOINT = "https://api.hubapi.com/crm/v3/objects/"
const HUBSPOT_ENDPOINT_v4 = "https://api.hubapi.com/crm/v4/objects/"

const RENTMAN_API_BASE = "https://api.rentman.net";
const RENTMAN_API_TOKEN = process.env.RENTMAN_ACCESS_TOKEN;

let userFromSql
async function loadSqlUsers() {
    [userFromSql] = await pool.execute(`SELECT * FROM synced_users`)
}

loadSqlUsers();

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

async function getOrderStatus(order) {
    const url = `${HUBSPOT_ENDPOINT}0-123/${order.id}?properties=hs_pipeline_stage`
    const response = await fetch(url, {
        method: "GET",
        headers: {
            'Content-Type': 'application/json',
            "Accept": "application/json",
            "Authorization": `Bearer ${HUBSPOT_TOKEN}`,
        }
    });
    const output = await response.json();
    return output.properties.hs_pipeline_stage
}

async function hubspotGetDealInfo(order) {
    const url = `${HUBSPOT_ENDPOINT}0-3/${order}?associations=0-123`
    const response = await fetch(url, {
        method: "GET",
        headers: {
            'Content-Type': 'application/json',
            "Accept": "application/json",
            "Authorization": `Bearer ${HUBSPOT_TOKEN}`,
        }
    });
    const output = await response.json();
    return output
}

const dealStageMap = {
    "937ea84d-0a4f-4dcf-9028-3f9c2aafbf03": "Afventer kunde",
    "3725360f-519b-4b18-a593-494d60a29c9f": "Aflyst",
    "aa99e8d0-c1d5-4071-b915-d240bbb1aed9": "Bekræftet",
    "3852081363": "Afsluttet",
    "4b27b500-f031-4927-9811-68a0b525cbae": "Koncept",
    "3531598027": "Skal faktureres",
    "3c85a297-e9ce-400b-b42e-9f16853d69d6": "Faktureret",
    "3986020540": "Retur",
    "4012316916": "Mangler udstyr"
};

const setStageMap = {
    "Koncept": "appointmentscheduled",
    "Afventer kunde": "qualifiedtobuy",
    "Aflyst": "decisionmakerboughtin",
    "Bekræftet": "presentationscheduled",
    "Afsluttet": "3851496691",
    "Skal faktureres": "3852552384",
    "Faktureret": "3852552385",
    "Retur": "3986019567",
    "Mangler udstyr": "4003784908"
}

async function updateHubSpotDealStatus(order) {
    console.log(`Kalder updateHubSpotDealStatus`);

    const project = await hubspotGetDealInfo(order);

    const priority = ["Skal faktureres", "Bekræftet", "Faktureret", "Afsluttet", "Afventer kunde", "Koncept", "Aflyst"]
    const associations = project.associations?.orders?.results
    let newStatus;

    if (associations) {
        let totalStatus = [];

        for (const order of associations) {
            const status = await getOrderStatus(order);
            const mapped = dealStageMap[status];
            if (mapped) totalStatus.push(mapped);
        }
        const allSame = totalStatus.length > 0 &&
            totalStatus.every(s => s === totalStatus[0]);

        if (allSame) {
            newStatus = setStageMap[totalStatus[0]];
        } else {
            const status = priority.find(p => totalStatus.includes(p)) || null;
            newStatus = setStageMap[status];

        }
    }

    if (newStatus) {
        let url = `${HUBSPOT_ENDPOINT}0-3/${order}`

        const body = {
            properties: {
                dealstage: newStatus,
            }
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

    }


}


async function hubspotPatchOrder(order, current) {

    const url = `${HUBSPOT_ENDPOINT}orders/${current}`

    const status = await rentmanGetFromEndpoint(order.status)

    console.log(`     / Opdateret order ${order.displayname}`)

    const total_price = sanitizeNumber(order.project_total_price)
    const rabat = sanitizeNumber(order.discount_subproject)

    const dealStageMap = {
        1: "937ea84d-0a4f-4dcf-9028-3f9c2aafbf03",        // Pending
        2: "3725360f-519b-4b18-a593-494d60a29c9f",        // Cancelled
        3: "aa99e8d0-c1d5-4071-b915-d240bbb1aed9",        // Confirmed
        4: "aa99e8d0-c1d5-4071-b915-d240bbb1aed9",        // Prepped
        5: "aa99e8d0-c1d5-4071-b915-d240bbb1aed9",        // On Location
        6: "3986020540",                                    // Retur
        7: "4b27b500-f031-4927-9811-68a0b525cbae",        // Inquiry
        8: "4b27b500-f031-4927-9811-68a0b525cbae",        // Concept
        9: "3531598027",                                  // To be invoiced
        11: "3c85a297-e9ce-400b-b42e-9f16853d69d6",       // Invoiced
        12: "4012316916"                                  // To be invoiced - missing items
    };

    const dealstage = dealStageMap[status.id];

    const project = order.project;
    const projectArray = project.split("/").pop();
    const projectNumber = parseInt(projectArray, 10);
    
    const now = new Date();
    const isoDate = now.toISOString();
    const encodedDate = encodeURIComponent(isoDate);

    const body = {
        properties: {
            hs_order_name: order.displayname,
            hs_total_price: total_price,
            hs_pipeline: "14a2e10e-5471-408a-906e-c51f3b04369e",
            hs_pipeline_stage: dealstage,
            start_projekt_period: order.usageperiod_start,
            slut_projekt_period: order.usageperiod_end,
            slut_planning_period: order.planperiod_end,
            start_planning_period: order.planperiod_start,
            rabat: rabat,
            fixed_price: order.fixed_price,
            rental_price: order.project_rental_price,
            sale_price: order.project_sale_price,
            crew_price: order.project_crew_price,
            transport_price: order.project_transport_price,
            rentman_projekt: `https://tourcare2.rentmanapp.com/#/projects/${projectNumber}/details?subproject=${order.id}`
        }
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

async function updateHubSpotDealFinancial(deal) {
    const url = `${HUBSPOT_ENDPOINT}0-3/${deal}`
    const [sqlData] = await pool.query(`SELECT * FROM synced_deals WHERE hubspot_project_id = ?`, [deal])
    const rentmanData = await rentmanGetFromEndpoint(`/projects/${sqlData?.[0]?.rentman_project_id}`)
    if (!rentmanData) return false;

    const total_price = sanitizeNumber(rentmanData.project_total_price)

    const body = {
        properties: {
            amount: total_price
        }
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
    const [hubspotProjectId] = await pool.execute(`
        SELECT deals.hubspot_project_id
        FROM synced_order as od
        JOIN synced_deals as deals
        ON od.synced_deals_id = deals.id
        WHERE rentman_subproject_id = ?;`, [webhook.items?.[0].id]);
    console.log(`Main projekt: ${hubspotProjectId?.[0].hubspot_project_id}`)
    await updateHubSpotDealStatus(hubspotProjectId?.[0].hubspot_project_id)
    await updateHubSpotDealFinancial(hubspotProjectId?.[0].hubspot_project_id)
}




// ###############################################################################################################




async function hubspotCreateOrder(order, deal, company, contact) {
    const url = `${HUBSPOT_ENDPOINT}orders`
    const status = await rentmanGetFromEndpoint(order.status)

    console.log(`     + Order ${order.displayname}`)

    const total_price = sanitizeNumber(order.project_total_price)
    const rabat = sanitizeNumber(order.discount_subproject)

    const dealStageMap = {
        1: "937ea84d-0a4f-4dcf-9028-3f9c2aafbf03",        // Pending
        2: "3725360f-519b-4b18-a593-494d60a29c9f",        // Cancelled
        3: "aa99e8d0-c1d5-4071-b915-d240bbb1aed9",        // Confirmed
        4: "aa99e8d0-c1d5-4071-b915-d240bbb1aed9",        // Prepped
        5: "aa99e8d0-c1d5-4071-b915-d240bbb1aed9",        // On Location
        6: "3986020540",                                    // Retur
        7: "4b27b500-f031-4927-9811-68a0b525cbae",        // Inquiry
        8: "4b27b500-f031-4927-9811-68a0b525cbae",        // Concept
        9: "3531598027",                                  // To be invoiced
        11: "3c85a297-e9ce-400b-b42e-9f16853d69d6",       // Invoiced
        12: "4012316916"                                  // To be invoiced - missing items
    };

    const dealstage = dealStageMap[status.id];

    const project = order.project;
    const projectArray = project.split("/").pop();
    const projectNumber = parseInt(projectArray, 10);

    const now = new Date();
    const isoDate = now.toISOString();
    const encodedDate = encodeURIComponent(isoDate);

    const body = {
        properties: {
            hs_order_name: order.displayname,
            hs_total_price: total_price,
            hs_pipeline: "14a2e10e-5471-408a-906e-c51f3b04369e",
            hs_pipeline_stage: dealstage,
            start_projekt_period: order.usageperiod_start,
            slut_projekt_period: order.usageperiod_end,
            slut_planning_period: order.planperiod_end,
            start_planning_period: order.planperiod_start,
            rabat: rabat,
            fixed_price: order.fixed_price,
            rental_price: order.project_rental_price,
            sale_price: order.project_sale_price,
            crew_price: order.project_crew_price,
            transport_price: order.project_transport_price,
            rentman_projekt: `https://tourcare2.rentmanapp.com/#/projects/${projectNumber}/details?subproject=${order.id}`
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
    await updateHubSpotDealStatus(deal)
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
        for (let i = 0; i < 6; i++) {

            const [checkOrder] = await pool.execute(
                `SELECT * FROM synced_order WHERE rentman_subproject_id = ?`,
                [subProjectInfo.id]
            );

            if (checkOrder?.[0]) {
                console.log('Duplicate fundet')
                break;
            }

            [dealInfo] = await pool.execute(
                `SELECT * FROM synced_deals WHERE rentman_project_id = ?`,
                [projectInfo.id]
            );

            if (dealInfo?.[0]) break;

            console.log(`Ingen deal endnu for project ${projectInfo.id}. Venter og prøver igen...`);
            await new Promise(r => setTimeout(r, 5000)); // vent 5 sek
        }
        if (dealInfo?.[0]) {

            const order_id = await hubspotCreateOrder(subProjectInfo, dealInfo[0].hubspot_project_id, companyRows?.[0]?.hubspot_id ?? 0, contactRows?.[0]?.hubspot_id ?? 0)

            await pool.query(
                'INSERT INTO synced_order (subproject_name, rentman_subproject_id, hubspot_order_id, synced_companies_id, synced_contact_id, synced_deals_id) VALUES (?, ?, ?, ?, ?, ?)',
                [subProjectInfo.displayname, subProjectInfo.id, order_id, companyRows?.[0]?.id ?? 0, contactRows?.[0]?.id ?? 0, dealInfo[0].id]
            );
        } else console.log(`STOPPER Fandt ingen deal for project ${projectInfo.navn}`);



    }
}

async function hubspotDeleteOrder(order) {
    const url = `${HUBSPOT_ENDPOINT}0-123/${order}`
    await fetch(url, {
        method: "DELETE",
        headers: {
            'Content-Type': 'application/json',
            "Accept": "application/json",
            "Authorization": `Bearer ${HUBSPOT_TOKEN}`
        }
    });
}

async function deleteOrder(event) {
    console.log(`Starter sletning af ${event.items.length} orders`);
    const subprojects = event.items
    for (const sub of subprojects) {
        const [sqlSynced] = await pool.query(`SELECT * FROM synced_order WHERE rentman_subproject_id = ?`, [sub])
        if (sqlSynced) {
            await hubspotDeleteOrder(sqlSynced?.[0]?.hubspot_order_id)
            console.log(`Slettede ${sqlSynced?.[0]?.subproject_name}`);
        }
    }
}


module.exports = { createOrders, updateOrders, deleteOrder };