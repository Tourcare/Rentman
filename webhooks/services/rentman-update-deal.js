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

async function hubspotCreateDeal(deal, company, contact) {
    const url = `${HUBSPOT_ENDPOINT}0-3`

    let dealstage;
    const total_price = sanitizeNumber(deal.project_total_price)

    const usageStart = new Date(deal.usageperiod_start);
    const usageEnd = new Date(deal.usageperiod_start);
    const todayDate = new Date(); // dags dato

    if (usageStart < todayDate) {
        dealstage = "presentationscheduled";
    } else {
        dealstage = "appointmentscheduled";
    }

    const body = {
        properties: {
            dealname: deal.displayname,
            dealstage,
            usage_period: contact ? deal.usageperiod_start : usageStart,
            slut_projekt_period: contact ? deal.usageperiod_end : usageEnd,
            amount: total_price
        },
        associations: []
    };

    if (company) {
        body.associations.push({
            to: { id: company },
            types: [{
                associationCategory: "HUBSPOT_DEFINED",
                associationTypeId: 5
            }]
        });
    }
    if (contact) {
        body.associations.push({
            to: { id: contact },
            types: [{
                associationCategory: "HUBSPOT_DEFINED",
                associationTypeId: 3
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


async function hubspotCreateOrder(data, deal, company, contact) {
    const order = await rentmanGetFromEndpoint(`/subprojects/${data.id}`)
    const status = await rentmanGetFromEndpoint(order.status)
    const url = `${HUBSPOT_ENDPOINT}orders`
    console.log(`     + Order ${order.displayname}`)

    const total_price = sanitizeNumber(order.project_total_price)

    let dealstage;

    if ([7, 8].includes(status.id)) { // Status 7 = Inquiry, 8 = Concept
        dealstage = "4b27b500-f031-4927-9811-68a0b525cbae"
    } else if (status.id === 1) { // Status 1 = pending, 
        dealstage = "937ea84d-0a4f-4dcf-9028-3f9c2aafbf03"
    } else if ([3, 4, 5, 6].includes(status.id)) { // Status 3 = Confirmed, Status 4 = Prepped, Status 5 = On Location
        dealstage = "aa99e8d0-c1d5-4071-b915-d240bbb1aed9"
    } else if (status.id === 2) { // Status 2 = Cancled, 
        dealstage = "3725360f-519b-4b18-a593-494d60a29c9f"
    } else if ([9, 12].includes(status.id)) { // To be invoiced
        dealstage = "3531598027"
    } else if (status.id === 11) { // Invoiced
        dealstage = "3c85a297-e9ce-400b-b42e-9f16853d69d6"
    }

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

    // Tilføj company association (kun hvis company findes)
    if (company) {
        body.associations.push({
            to: { id: company },
            types: [{
                associationCategory: "HUBSPOT_DEFINED",
                associationTypeId: 509
            }]
        });
    }

    // Tilføj deal association (kun hvis deal findes)
    if (deal) {
        body.associations.push({
            to: { id: deal },
            types: [{
                associationCategory: "HUBSPOT_DEFINED",
                associationTypeId: 512
            }]
        });
    }

    // Tilføj contact association (kun hvis contact findes)
    if (contact) {
        body.associations.push({
            to: { id: contact },
            types: [{
                associationCategory: "HUBSPOT_DEFINED",
                associationTypeId: 507
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


async function syncDeal(webhook) {
    console.log('SyncDeal funktion kaldet!')
    const project = await rentmanGetFromEndpoint(webhook.items[0].ref)
    const [projectInfo, contactInfo, customerInfo] = await Promise.all([
        rentmanGetFromEndpoint(`${webhook.items[0].ref}`),
        rentmanGetFromEndpoint(project.customer),
        rentmanGetFromEndpoint(project.cust_contact)
    ]);
    let deal_id;

    if (contactInfo.id) {
        const [companyRows] = await pool.execute(`SELECT * FROM synced_companies WHERE rentman_id = ?`, [contactInfo.id]);
        if (customerInfo.id) {
            const [contactRows] = await pool.execute(`SELECT * FROM synced_contacts WHERE rentman_id = ?`, [customerInfo.id]);
            console.log(`Opretter deal ${project.displayname} med virksomhed og kontaktperson`);

            deal_id = await hubspotCreateDeal(projectInfo, companyRows[0].hubspot_id, contactRows[0].hubspot_id)
            await pool.query(
                'INSERT INTO synced_deals (project_name, rentman_project_id, hubspot_project_id, synced_companies_id, synced_contact_id) VALUES (?, ?, ?, ?, ?)',
                [project.displayname, projectInfo.id, deal_id, companyRows[0].id, contactRows[0].id]
            );

        } else {
            console.log(`Opretter deal ${project.displayname} uden kontaktperson`);

            deal_id = await hubspotCreateDeal(projectInfo, companyRows[0].hubspot_id)
            await pool.query(
                'INSERT INTO synced_deals (project_name, rentman_project_id, hubspot_project_id, synced_companies_id) VALUES (?, ?, ?, ?)',
                [project.displayname, projectInfo.id, deal_id, companyRows[0].id]
            );
        }

    } else {
        console.log(`Opretter deal ${project.displayname} uden virksomhed`);

        deal_id = await hubspotCreateDeal(projectInfo)

        await pool.query(
            'INSERT INTO synced_deals (project_name, rentman_project_id, hubspot_project_id) VALUES (?, ?, ?)',
            [project.displayname, projectInfo.id, deal_id]
        );
    }


}

async function hubspotUpdateDealAssociation(object, id, association, type, sql) {
    if (association === null) { return false }
    let associationObject;
    if (type === 3 || type === 507) { associationObject = "contacts" }
    if (type === 5 || type === 509) { associationObject = "company" }
    console.log(`TILFØJER ASSOCIATION deal ${id} med ${associationObject} med id ${association} type ${type}`)
    let url = `${HUBSPOT_ENDPOINT}${object}/${id}/associations/${associationObject}/${association}/${type}`

    const response = await fetch(url, {
        method: "PUT",
        headers: {
            'Content-Type': 'application/json',
            "Accept": "application/json",
            "Authorization": `Bearer ${HUBSPOT_TOKEN}`,
        }
    });

    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`HTTP error! status: ${response.status}, message: ${errText}`);
    }
    let database;
    if (type === 3 || type === 507) {
        if (object === "deals") { database = "synced_deals" }
        if (object === "orders") { database = "synced_order" }
        await pool.query(
            'UPDATE synced_deals SET synced_contact_id = ? WHERE hubspot_project_id = ?',
            [sql, id]
        );
    }

    if (type === 5 || type === 509) {
        if (object === "deals") { database = "synced_deals" }
        if (object === "orders") { database = "synced_order" }
        await pool.query(
            'UPDATE synced_deals SET synced_companies_id = ? WHERE hubspot_project_id = ?',
            [sql, id]
        );
    }

}

async function hubspotDeleteDealAssociation(object, id, association, type) {
    if (association === null) { return false }
    let associationObject;
    if (type === 3 || type === 507) { associationObject = "contacts" }
    if (type === 5 || type === 509) { associationObject = "company" }
    console.log(`FJERNER ASSOCIATION deal ${id} med ${associationObject} med id ${association} type ${type}`)
    let url = `${HUBSPOT_ENDPOINT}${object}/${id}/associations/${associationObject}/${association}/${type}`

    const response = await fetch(url, {
        method: "DELETE",
        headers: {
            'Content-Type': 'application/json',
            "Accept": "application/json",
            "Authorization": `Bearer ${HUBSPOT_TOKEN}`,
        }
    });

    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`HTTP error! status: ${response.status}, message: ${errText}`);
    }
}

async function hubspotUpdateDeal(id, deal) {

    let url = `${HUBSPOT_ENDPOINT}0-3/${id}`

    let dealstage;
    const total_price = sanitizeNumber(deal.project_total_price)

    const usageStart = new Date(deal.usageperiod_start);
    const usageEnd = new Date(deal.usageperiod_start);
    const todayDate = new Date(); // dags dato

    if (usageStart < todayDate) {
        dealstage = "presentationscheduled";
    } else {
        dealstage = "appointmentscheduled";
    }

    const body = {
        properties: {
            dealname: deal.displayname,
            dealstage,

            usage_period: usageStart,
            slut_projekt_period: usageEnd,
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

async function updateDeal(webhook) {
    console.log('updateDeal funktion kaldet!');

    // Hent projekt og relaterede data
    const project = await rentmanGetFromEndpoint(webhook.items[0].ref);
    const [projectInfo, subProjects, contactInfo, customerInfo] = await Promise.all([
        rentmanGetFromEndpoint(`${webhook.items[0].ref}`),
        rentmanGetFromEndpoint(`${webhook.items[0].ref}/subprojects`),
        rentmanGetFromEndpoint(project.customer),
        rentmanGetFromEndpoint(project.cust_contact)
    ]);

    // Find HubSpot deal ID med retry
    let hubspotDeal;
    for (let i = 0; i < 3; i++) {
        const [rows] = await pool.execute(
            `SELECT * FROM synced_deals WHERE rentman_project_id = ?`,
            [project.id]
        );
        hubspotDeal = rows[0];
        if (hubspotDeal) break;
        console.log(`Ingen HubSpot deal endnu for projekt ${project.id}. Venter og prøver igen...`);
        await new Promise(r => setTimeout(r, 3000));
    }

    if (!hubspotDeal) {
        console.warn(`STOPPER → Fandt stadig ingen HubSpot ID for projekt ${project.id}`);
        return;
    }

    console.log(`Fandt HubSpot ID for ${webhook.items[0].id} - HubSpot ID: ${hubspotDeal.hubspot_project_id}`);

    // Tjek om customer eller cust_contact er opdateret
    const [oldCompany] = await pool.execute(`SELECT rentman_id FROM synced_companies WHERE id = ?`, [hubspotDeal.synced_companies_id]);
    const [oldContact] = await pool.execute(`SELECT rentman_id FROM synced_contacts WHERE id = ?`, [hubspotDeal.synced_contact_id]);
    const isCustomerUpdated = oldCompany[0]?.rentman_id !== project.customer;
    const isContactUpdated = oldContact[0]?.rentman_id !== project.cust_contact;
    const associationsUpdated = isCustomerUpdated || isContactUpdated;

    // Hjælpefunktion til at opdatere associationer
    const updateAssociations = async (objectType, objectId, syncedCompanyId, syncedContactId, companyAssocId, contactAssocId) => {
        // Slet gamle associationer
        const [oldCompany] = await pool.execute(`SELECT * FROM synced_companies WHERE id = ?`, [syncedCompanyId]);
        await hubspotDeleteDealAssociation(objectType, objectId, oldCompany?.[0]?.hubspot_id ?? null, companyAssocId);

        const [oldContact] = await pool.execute(`SELECT * FROM synced_contacts WHERE id = ?`, [syncedContactId]);
        await hubspotDeleteDealAssociation(objectType, objectId, oldContact?.[0]?.hubspot_id ?? null, contactAssocId);

        // Tilføj nye associationer hvis data findes
        if (contactInfo.id) {
            const [companyRows] = await pool.execute(`SELECT * FROM synced_companies WHERE rentman_id = ?`, [contactInfo.id]);
            await hubspotUpdateDealAssociation(objectType, objectId, companyRows?.[0]?.hubspot_id ?? null, companyAssocId, companyRows?.[0]?.id ?? 0);
            console.log(`Fandt virksomhed for ${webhook.items[0].id}`);
        }

        if (customerInfo.id) {
            const [contactRows] = await pool.execute(`SELECT * FROM synced_contacts WHERE rentman_id = ?`, [customerInfo.id]);
            await hubspotUpdateDealAssociation(objectType, objectId, contactRows?.[0]?.hubspot_id ?? null, contactAssocId, contactRows?.[0]?.id ?? 0);
            console.log(`Fandt kontaktperson for ${webhook.items[0].id}`);
        }
    };

    // Opdater deal associationer kun hvis opdateret
    if (associationsUpdated) {
        await updateAssociations("deals", hubspotDeal.hubspot_project_id, hubspotDeal.synced_companies_id, hubspotDeal.synced_contact_id, 5, 3);

        // Opdater subprojekter (orders)
        for (const sub of subProjects) {
            let hubSub;
            for (let i = 0; i < 3; i++) {
                const [rows] = await pool.execute(`SELECT * FROM synced_order WHERE rentman_subproject_id = ?`, [sub.id]);
                hubSub = rows[0];
                if (hubSub?.hubspot_order_id) break;
                console.log(`Kunne ikke finde ${sub.displayname} i synced_order endnu. Venter 8 sek og prøver igen...`);
                await new Promise(r => setTimeout(r, 8000));
            }

            if (!hubSub?.hubspot_order_id) {
                console.warn(`Fandt stadig ingen hubSub for ${sub.displayname} efter retry`);
                continue;
            }

            await updateAssociations("orders", hubSub.hubspot_order_id, hubSub.synced_companies_id, hubSub.synced_contact_id, 509, 507);
        }
    } else {
        console.log(`Ingen ændringer i customer eller cust_contact - springer association updates over.`);
    }

    // Opdater dealen selv altid
    if (hubspotDeal.hubspot_project_id) {
        console.log(`Opdaterer deal ${webhook.items[0].id}`);
        await hubspotUpdateDeal(hubspotDeal.hubspot_project_id, projectInfo);
    }
}


module.exports = { syncDeal, updateDeal };