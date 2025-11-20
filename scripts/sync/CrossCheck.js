const dotenv = require('dotenv');
const mysql = require('mysql2/promise');

dotenv.config();

const dbConfig = {
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
};

const pool = mysql.createPool(dbConfig);

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

// RENTMAN | RENTMAN | RENTMAN | RENTMAN | RENTMAN | RENTMAN | RENTMAN | RENTMAN | RENTMAN | RENTMAN | RENTMAN | 

async function rentmanGetFromEndpoint(endpoint, attempt = 1) {
    if (!endpoint) return null;

    const maxRetries = 5;
    const baseDelay = 5000; // 5 sekunder
    const retryDelay = baseDelay * 2 ** (attempt - 1); // eksponentiel backoff

    const url = `${RENTMAN_API_BASE}${endpoint}`;

    try {
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'Accept': 'application/json',
                'Authorization': `Bearer ${RENTMAN_API_TOKEN}`
            }
        });

        if (response.status === 429) { // rate-limit
            if (attempt >= maxRetries) {
                throw new Error(`Rate limit ramt og max retries (${maxRetries}) nået for ${endpoint}`);
            }
            console.warn(`Rate limit ramt (forsøg ${attempt}). Venter ${retryDelay / 1000} sekunder...`);
            await new Promise(res => setTimeout(res, retryDelay));
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

async function rentmanGetProjects() {
    const limit = 50;
    let offset = 0;
    let allProjects = [];

    while (true) {
        const url = `${RENTMAN_API_BASE}/projects?project_type[neq]=projecttypes/109&limit=${limit}&offset=${offset}`;

        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'Accept': 'application/json',
                'Authorization': `Bearer ${RENTMAN_API_TOKEN}`,
            }
        });

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`HTTP error! status: ${response.status}, message: ${errText}`);
        }

        const output = await response.json();

        if (output.data && output.data.length > 0) {
            allProjects = allProjects.concat(output.data);
            offset += limit;
        } else {
            break;
        }
    }

    return allProjects;
}

// HUBSPOT | HUBSPOT | HUBSPOT | HUBSPOT | HUBSPOT | HUBSPOT | HUBSPOT | HUBSPOT | HUBSPOT | HUBSPOT | HUBSPOT | 

async function hubspotGetAllObjects(object, limit = 25) {
    let url = `${HUBSPOT_ENDPOINT_v4}${object}?limit=${limit}`;
    const allObjects = [];

    while (url) {
        const response = await fetch(url, {
            method: "GET",
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                'Authorization': `Bearer ${HUBSPOT_TOKEN}`,
            }
        });

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`HTTP error! status: ${response.status}, message: ${errText}`);
        }

        const { results, paging } = await response.json();
        allObjects.push(...results);
        url = paging?.next?.link || null;
    }

    return allObjects;
}

async function hubspotUpdateDealAssociation(object, id, association, type, sql) {
    if (association === null) { return false }
    let associationObject;
    if (type === 3 || type === 507) { associationObject = "contacts" }
    if (type === 5 || type === 509) { associationObject = "company" }
    //console.log(`TILFØJER ASSOCIATION deal ${id} med ${associationObject} med id ${association} type ${type}`)
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
    //console.log(`FJERNER ASSOCIATION deal ${id} med ${associationObject} med id ${association} type ${type}`)
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
            amount: total_price,
        }
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
        if (text.includes('not found') || response.status === 404) {
            return false;
        }
        console.log(`HTTP error! status: ${response.status}, message: ${text}`);
        return false;
    }

}



//               -----> Main Funktion <------



async function crossCheckDeals() {

    console.log(`####### STARTER MED AT KRYDS TJEK INFORMATION #######`);

    const rentmanAllProjects = await rentmanGetProjects();
    const [sqlProjectId] = await pool.query('SELECT * FROM synced_deals')
    console.log(`STATUS | Rentman projekter hentet fra Rentman og SQL`);

    // Hjælpe funktion

    for (const project of rentmanAllProjects) {
        const [projectInfo, rentmanLinkedSubprojects] = await Promise.all([
            rentmanGetFromEndpoint(`/projects/${project.id}`),
            rentmanGetFromEndpoint(`/projects/${project.id}/subprojects`)
        ]);

        const checkSqlProject = sqlProjectId.find(row => row.rentman_project_id.toString() === project.id.toString())
        console.log(`IGANG | Tjekker project ${project.displayname}`);

        if (checkSqlProject) {
            const [contactInfo, customerInfo] = await Promise.all([
                rentmanGetFromEndpoint(project.customer),
                rentmanGetFromEndpoint(project.cust_contact)
            ]);

            const updateAssociations = async (objectType, objectId, syncedCompanyId, syncedContactId, companyAssocId, contactAssocId) => {
                // Slet gamle associationer
                const [oldCompany] = await pool.execute(`SELECT * FROM synced_companies WHERE id = ?`, [syncedCompanyId]);
                await hubspotDeleteDealAssociation(objectType, objectId, oldCompany?.[0]?.hubspot_id ?? null, companyAssocId);

                const [oldContact] = await pool.execute(`SELECT * FROM synced_contacts WHERE id = ?`, [syncedContactId]);
                await hubspotDeleteDealAssociation(objectType, objectId, oldContact?.[0]?.hubspot_id ?? null, contactAssocId);

                // Tilføj nye associationer hvis data findes
                if (contactInfo) {
                    const [companyRows] = await pool.execute(`SELECT * FROM synced_companies WHERE rentman_id = ?`, [contactInfo.id]);
                    await hubspotUpdateDealAssociation(objectType, objectId, companyRows?.[0]?.hubspot_id ?? null, companyAssocId, companyRows?.[0]?.id ?? 0);
                }

                if (customerInfo) {
                    const [contactRows] = await pool.execute(`SELECT * FROM synced_contacts WHERE rentman_id = ?`, [customerInfo.id]);
                    await hubspotUpdateDealAssociation(objectType, objectId, contactRows?.[0]?.hubspot_id ?? null, contactAssocId, contactRows?.[0]?.id ?? 0);
                }
            };

            const [oldCompany] = await pool.execute(`SELECT * FROM synced_companies WHERE id = ?`, [checkSqlProject.synced_companies_id]);
            const [oldContact] = await pool.execute(`SELECT * FROM synced_contacts WHERE id = ?`, [checkSqlProject.synced_contact_id]);

            const isCustomerUpdated = oldCompany[0]?.rentman_id == contactInfo?.id;
            const isContactUpdated = oldContact[0]?.rentman_id == customerInfo?.id;

            const associationsUpdated = isCustomerUpdated || isContactUpdated;

            if (!associationsUpdated) {
                console.log(`IGANG | Opdaterer associations for deal ${project.displayname}`);

                await updateAssociations("deals", checkSqlProject.hubspot_project_id, checkSqlProject.synced_companies_id, checkSqlProject.synced_contact_id, 5, 3);

                for (const sub of rentmanLinkedSubprojects) {
                    const [rows] = await pool.execute(`SELECT * FROM synced_order WHERE rentman_subproject_id = ?`, [sub.id]);
                    const hubSub = rows[0];
                    console.log(`IGANG | Opdaterer associations for order ${sub.displayname}`);

                    if (!hubSub?.hubspot_order_id) {
                        console.warn(`Fandt  ingen hubSub order for ${sub.displayname}`);
                        continue;
                    }

                    await updateAssociations("orders", hubSub.hubspot_order_id, hubSub.synced_companies_id, hubSub.synced_contact_id, 509, 507);
                }
            } else {
                console.log(`IGANG | Fandt ingen nye associations for ${project.displayname}`);
            }
            
            await hubspotUpdateDeal(checkSqlProject.hubspot_project_id, projectInfo)
            console.log(`IGANG | Opdaterer information på deal ${project.displayname}`)

        } else {
            console.log(`FEJL | Fandt ingen SQL record for ${project.displayname}`);

        }
    }
}

crossCheckDeals();