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

async function getOrderStatus(order) {
    const url = `${HUBSPOT_ENDPOINT}0-123/${order}?properties=hs_pipeline_stage`
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

async function hubspotGetDealInfo(deal) {
    const url = `${HUBSPOT_ENDPOINT}0-3/${deal}?associations=0-123`
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
    "937ea84d-0a4f-4dcf-9028-3f9c2aafbf03": "Afventer Kunde",
    "3725360f-519b-4b18-a593-494d60a29c9f": "Aflyst",
    "aa99e8d0-c1d5-4071-b915-d240bbb1aed9": "Bekræftet",
    "3852081363": "Afsluttet",
    "4b27b500-f031-4927-9811-68a0b525cbae": "Koncept",
    "3531598027": "Skal faktureres",
    "3c85a297-e9ce-400b-b42e-9f16853d69d6": "Faktureret",
    "3986020540": "Retur"
};

const setStageMap = {
    "Koncept": "appointmentscheduled",
    "Afventer kunde": "qualifiedtobuy",
    "Aflyst": "decisionmakerboughtin",
    "Bekræftet": "presentationscheduled",
    "Afsluttet": "3851496691",
    "Skal faktureres": "3852552384",
    "Faktureret": "3852552385",
    "Retur": "3986019567"
}

async function updateHubSpotDealStatus(deal) {
    const project = await hubspotGetDealInfo(deal);

    const priority = ["Skal faktureres", "Bekræftet", "Faktureret", "Afsluttet", "Afventer Kunde", "Koncept", "Aflyst"]
    const associations = project.associations?.orders?.results

    if (associations) {
        let totalStatus = [];

        for (const order of associations) {
            const status = await getOrderStatus(order.id);
            const mapped = dealStageMap[status];
            if (mapped) totalStatus.push(mapped);
        }
        const allSame = totalStatus.length > 0 &&
            totalStatus.every(s => s === totalStatus[0]);

        if (allSame) {
            return setStageMap[totalStatus[0]];
        } else {
            const status = priority.find(p => totalStatus.includes(p)) || null;
            return setStageMap[status];

        }
    }

}

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
    const plannedStart = new Date(deal.planperiod_start);
    const plannedEnd = new Date(deal.planperiod_end);
    const createDate = new Date(deal.created)
    const todayDate = new Date(); // dags dato

    const body = {
        properties: {
            dealname: deal.displayname,
            dealstage: "appointmentscheduled",
            usage_period: usageStart,
            slut_projekt_period: usageEnd,
            amount: total_price,
            start_planning_period: plannedStart,
            slut_planning_period: plannedEnd,
        },
        createdAt: createDate,
        associations: []
    };

    if (deal.account_manager) {
        const crewSplit = deal.account_manager.split("/").pop();
        const crewId = Number(crewSplit);

        accountManager = userFromSql.find(
            row => row.rentman_id.toString() === crewId.toString()
        );

        if (accountManager) {
            body.properties.hubspot_owner_id = accountManager.hubspot_id;
            console.log(`IGANG | Tilføjet ${accountManager.navn} til deal ${deal.displayname}`);
        }
    }

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

            deal_id = await hubspotCreateDeal(projectInfo, companyRows?.[0]?.hubspot_id, contactRows?.[0]?.hubspot_id)
            
            await pool.query(
                'INSERT INTO synced_deals (project_name, rentman_project_id, hubspot_project_id, synced_companies_id, synced_contact_id) VALUES (?, ?, ?, ?, ?)',
                [project.displayname, projectInfo.id, deal_id, companyRows[0].id, contactRows[0].id]
            );

        } else {
            console.log(`Opretter deal ${project.displayname} uden kontaktperson`);

            deal_id = await hubspotCreateDeal(projectInfo, companyRows?.[0]?.hubspot_id)
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
    const usageEnd = new Date(deal.usageperiod_end);
    const plannedStart = new Date(deal.planperiod_start);
    const plannedEnd = new Date(deal.planperiod_end);
    const createDate = new Date(deal.created)
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
            amount: total_price,
            start_planning_period: plannedStart,
            slut_planning_period: plannedEnd,
        },
        createdAt: createDate,
    };

    const status = await updateHubSpotDealStatus(id);
    if (status) body.properties.dealstage = status;

    if (deal.account_manager) {
        const crewSplit = deal.account_manager.split("/").pop();
        const crewId = Number(crewSplit);

        accountManager = userFromSql.find(
            row => row.rentman_id.toString() === crewId.toString()
        );

        if (accountManager) {
            body.properties.hubspot_owner_id = accountManager.hubspot_id;
            console.log(`IGANG | Tilføjet ${accountManager.navn} til deal ${deal.displayname}`);
        }
    }

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
    const [oldCompany] = await pool.execute(`SELECT * FROM synced_companies WHERE id = ?`, [hubspotDeal.synced_companies_id]);
    const [oldContact] = await pool.execute(`SELECT * FROM synced_contacts WHERE id = ?`, [hubspotDeal.synced_contact_id]);
    const isCustomerUpdated = oldCompany[0]?.rentman_id == contactInfo?.id;
    const isContactUpdated = oldContact[0]?.rentman_id == customerInfo?.id;
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
    if (!associationsUpdated) {
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