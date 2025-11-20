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


/* ###############################################################

   CONTACTS | CONTACTS | CONTACTS | CONTACTS | CONTACTS | CONTACTS

   ############################################################### */

// HUBSPOT | HUBSPOT | HUBSPOT | HUBSPOT | HUBSPOT | HUBSPOT | HUBSPOT | HUBSPOT | HUBSPOT | HUBSPOT | 

async function hubspotCreateCompany(data) {
    const url = `${HUBSPOT_ENDPOINT}companies`
    const body = {
        "properties": {
            name: data.displayname,
            cvrnummer: data.VAT_code
        }
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
        let errJson;

        try {
            errJson = JSON.parse(errText);
        } catch (e) {
            errJson = null;
        }

        if (response.status === 400 && errJson?.category === "VALIDATION_ERROR") {
            // Forsøg at finde ID'et af den virksomhed som allerede har værdien
            const match = errJson.message.match(/(\d+) already has that value/);

            if (match) {
                const existingCompanyId = match[1];
                console.log(`Virksomhed med ID ${existingCompanyId} har allerede denne værdi.`);
                return existingCompanyId;
            } else {
                console.warn("Kunne ikke finde eksisterende virksomhed ID i fejlmeddelelsen:", errJson.message);
            }
        } else {
            throw new Error(`HTTP error! status: ${response.status}, message: ${errText}`);
        }
    }

    const output = await response.json();
    return output.id;
}

async function hubspotLinkContact(contact, company) {
    const url = `${HUBSPOT_ENDPOINT_v4}contacts/${contact}/associations/companies/${company}`
    const body = [{
        "associationCategory": "HUBSPOT_DEFINED",
        "associationTypeId": 1

    }]
    const response = await fetch(url, {
        method: "PUT",
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

    return true;
}

async function hubspotCreateContact(data, companyID) {
    const url = `${HUBSPOT_ENDPOINT}contacts`
    let email = data.email.trim().replace(/\s+/g, '')
    if (email) {
        const [localPart, domainPart] = email.split('@');
        if (!/\.[a-zA-Z]{2,}$/.test(domainPart)) {
            email = `${localPart}@${domainPart}.dk`
        }
    }

    const body = {
        "properties": {
            email: email,
            lastname: `${data.firstname}`,
            firstname: `${data.lastname}`
        },
        "associations": [{
            "to": {
                "id": companyID.toString()  // Sørg for det er en string
            },
            "types": [{
                "associationCategory": "HUBSPOT_DEFINED",
                "associationTypeId": 1
            }]
        }]
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
        let errJson;

        try {
            errJson = JSON.parse(errText); // prøv at parse til JSON
        } catch (e) {
            errJson = null; // hvis det ikke er JSON
        }

        if (response.status === 409 && errJson) {
            // Forsøg at finde det eksisterende ID i beskeden
            const match = errJson.message.match(/Existing ID:\s*(\d+)/);

            if (match) {
                const existingId = match[1];
                console.log(`Kontakt findes allerede i HubSpot med ID: ${existingId}`);

                // Her kan du fx kalde din link-funktion:
                await hubspotLinkContact(existingId, companyID);
                return existingId;
            } else {
                console.warn("Kunne ikke finde Existing ID i fejlbeskeden:", errJson.message);
                return null;
            }
        }
        throw new Error(`HTTP error! status: ${response.status}, message: ${errText}`);

    }

    const output = await response.json();
    return output.id
}

// RENTMAN | RENTMAN | RENTMAN | RENTMAN | RENTMAN | RENTMAN | RENTMAN | RENTMAN | RENTMAN | RENTMAN | RENTMAN | 

async function rentmanGetContacts() {
    const limit = 50;
    let offset = 0;
    let allContacts = [];

    while (true) {
        const url = `${RENTMAN_API_BASE}/contacts?limit=${limit}&offset=${offset}`;

        const response = await fetch(url, {
            headers: {
                "Accept": "application/json",
                "Authorization": `Bearer ${RENTMAN_API_TOKEN}`,
            },
        });

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`HTTP error fra Rentman: ${response.status}, ${errText}`);
        }

        const output = await response.json();

        if (output.data && output.data.length > 0) {
            allContacts = allContacts.concat(output.data);
            offset += limit;
        } else {
            break;
        }
    }

    return allContacts;
}

async function rentmanGetContactPersons(id) {
    const url = `${RENTMAN_API_BASE}/contacts/${id}/contactpersons`;

    const response = await fetch(url, {
        method: 'GET',
        headers: {
            'Accept': 'application/json',
            'Authorization': `Bearer ${RENTMAN_API_TOKEN}`
        }
    });

    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`HTTP error! status: ${response.status}, message: ${errText}`);
    }

    const output = await response.json();
    return output.data;  // Returnerer listen af kontaktpersoner
}

// SYNC FUNCTION | SYNC FUNCTION | SYNC FUNCTION | SYNC FUNCTION | SYNC FUNCTION | SYNC FUNCTION | SYNC FUNCTION | SYNC FUNCTION | SYNC FUNCTION | 

async function syncContactsToCompanies() {
    const rentmanAllContacts = await rentmanGetContacts();
    const [sqlRentmanID] = await pool.query('SELECT rentman_id FROM synced_companies')
    let i = 0;
    for (const contact of rentmanAllContacts) {
        const sql = sqlRentmanID.find(row => row.rentman_id.toString() === contact.id.toString())
        if (!sql) {
            i++
            console.log(`IN PROGESS | Opretter virksomhed ${contact.displayname}`);
            const companyId = await hubspotCreateCompany(contact)
            const rentmanLinkedPersons = await rentmanGetContactPersons(contact.id);

            await pool.query(
                'INSERT INTO synced_companies (name, rentman_id, hubspot_id) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE name=VALUES(name), hubspot_id=VALUES(hubspot_id)',
                [contact.displayname, contact.id, companyId]
            );

            if (!rentmanLinkedPersons) continue;

            for (const person of rentmanLinkedPersons) {
                console.log(`IN PROGESS | Opretter kontaktperson: ${person.displayname}`);
                const hsPersonId = await hubspotCreateContact(person, companyId)
                if (hsPersonId) {
                    await pool.query(
                        'INSERT INTO synced_contacts (name, rentman_id, hubspot_id, hubspot_company_conntected) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE name=VALUES(name), hubspot_id=VALUES(hubspot_id)',
                        [person.displayname, person.id, hsPersonId, companyId]
                    );
                }
            }
            console.log(`SUCCESS | Færdig oprettet ${contact.displayname}`);
        }
    }
    console.log(`---> Opdatering færdig. Fandt ${i} virksomheder <---`);
}

//syncContactsToCompanies();

/* ###############################################################

   PROJECTS | PROJECTS | PROJECTS | PROJECTS | PROJECTS | PROJECTS

   ############################################################### */

// RENTMAN | RENTMAN | RENTMAN | RENTMAN | RENTMAN | RENTMAN | RENTMAN | RENTMAN | RENTMAN | RENTMAN | RENTMAN |

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

// HUBSPOT | HUBSPOT | HUBSPOT | HUBSPOT | HUBSPOT | HUBSPOT | HUBSPOT | HUBSPOT | HUBSPOT | HUBSPOT | HUBSPOT

async function hubspotCreateDeal(deal, company, contact) {
    const url = `${HUBSPOT_ENDPOINT}0-3`;
    const total_price = sanitizeNumber(deal.project_total_price);
    const usageStart = new Date(deal.usageperiod_start);
    const usageEnd = new Date(deal.usageperiod_end || deal.usageperiod_start);
    const todayDate = new Date();

    const dealstage = usageStart < todayDate ? "presentationscheduled" : "appointmentscheduled";

    const associations = [];
    if (company) associations.push({ to: { id: company }, types: [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: 5 }] })
    if (contact) associations.push({ to: { id: contact }, types: [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: 3 }] });


    const body = {
        properties: {
            dealname: deal.displayname,
            dealstage,
            createdate: usageStart,
            closedate: usageEnd,
            usage_period: usageStart,
            slut_projekt_period: usageEnd,
            amount: total_price
        },
        associations
    };

    let accountManager;

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
        method: "POST",
        headers: {
            'Content-Type': 'application/json',
            "Accept": "application/json",
            "Authorization": `Bearer ${HUBSPOT_TOKEN}`,
        },
        body: JSON.stringify(body),
    });

    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}, message: ${await response.text()}`);

    return (await response.json()).properties.hs_object_id;
}

async function hubspotCreateOrder(data, deal, company, contact) {
    const order = await rentmanGetFromEndpoint(`/subprojects/${data.id}`);
    const status = await rentmanGetFromEndpoint(order.status);
    const url = `${HUBSPOT_ENDPOINT}orders`;
    console.log(`     + Order ${order.displayname}`);

    const total_price = sanitizeNumber(order.project_total_price);

    const stageMap = {
        1: "937ea84d-0a4f-4dcf-9028-3f9c2aafbf03",
        2: "3725360f-519b-4b18-a593-494d60a29c9f",
        3: "aa99e8d0-c1d5-4071-b915-d240bbb1aed9",
        4: "aa99e8d0-c1d5-4071-b915-d240bbb1aed9",
        5: "aa99e8d0-c1d5-4071-b915-d240bbb1aed9",
        6: "aa99e8d0-c1d5-4071-b915-d240bbb1aed9",
        7: "4b27b500-f031-4927-9811-68a0b525cbae",
        8: "4b27b500-f031-4927-9811-68a0b525cbae",
        9: "3531598027",
        11: "3c85a297-e9ce-400b-b42e-9f16853d69d6",
        12: "3531598027"
    };

    const dealstage = stageMap[status.id];

    const associations = [
        { to: { id: deal }, types: [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: 512 }] }
    ];
    if (company) associations.push({ to: { id: company }, types: [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: 509 }] })
    if (contact) associations.splice(1, 0, { to: { id: contact }, types: [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: 507 }] });

    const body = {
        properties: {
            hs_order_name: order.displayname,
            hs_total_price: total_price,
            hs_pipeline: "14a2e10e-5471-408a-906e-c51f3b04369e",
            hs_pipeline_stage: dealstage,
            start_projekt_period: order.usageperiod_end,
            slut_projekt_period: order.usageperiod_start
        },
        associations
    };

    const response = await fetch(url, {
        method: "POST",
        headers: {
            'Content-Type': 'application/json',
            "Accept": "application/json",
            "Authorization": `Bearer ${HUBSPOT_TOKEN}`,
        },
        body: JSON.stringify(body),
    });

    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}, message: ${await response.text()}`);

    return (await response.json()).properties.hs_object_id;
}


async function syncProjectsToDeals() {
    const rentmanAllProjects = await rentmanGetProjects();
    const [sqlProjectId] = await pool.query('SELECT rentman_project_id FROM synced_deals')
    const [sqlSubId] = await pool.query('SELECT rentman_subproject_id FROM synced_order')
    let i = 0;
    for (const project of rentmanAllProjects) {
        const rentmanLinkedSubprojects = await rentmanGetFromEndpoint(`/projects/${project.id}/subprojects`)
        const checkSqlProject = sqlProjectId.find(row => row.rentman_project_id.toString() === project.id.toString())
        i++
        if (!checkSqlProject) {
            console.log(`WAIT | Opretter deal ${project.displayname}`);
            const [projectInfo, contactInfo, customerInfo] = await Promise.all([
                rentmanGetFromEndpoint(`/projects/${project.id}`),
                rentmanGetFromEndpoint(project.customer),
                rentmanGetFromEndpoint(project.cust_contact)
            ]);

            let contactRows = [];
            let companyRows = [];

            if (contactInfo) {
                [companyRows] = await pool.execute(`SELECT * FROM synced_companies WHERE rentman_id = ?`, [contactInfo.id]);
            }
            if (customerInfo) {
                [contactRows] = await pool.execute(`SELECT * FROM synced_contacts WHERE rentman_id = ?`, [customerInfo.id]);
            }

            const companyId = companyRows.length ? companyRows[0].hubspot_id : null;
            const contactId = contactRows[0] ? contactRows[0].hubspot_id : null;

            const deal_id = await hubspotCreateDeal(projectInfo, companyId, contactId)

            const sqlContactId = contactRows[0].id || 0
            const sqlCompanyId = companyRows[0].id || 0

            const [result] = await pool.query(
                'INSERT INTO synced_deals (project_name, rentman_project_id, hubspot_project_id, synced_companies_id, synced_contact_id) VALUES (?, ?, ?, ?, ?)',
                [project.displayname, projectInfo.id, deal_id, sqlCompanyId, sqlContactId]
            );

            const sqlDealId = result.insertId;
            for (const subproject of rentmanLinkedSubprojects) {
                console.log(`IN PROGRESS | Tilføjer subproject ${subproject.displayname}`);
                const order_id = await hubspotCreateOrder(subproject, deal_id, companyId, contactId)
                await pool.query(
                    'INSERT INTO synced_order (subproject_name, rentman_subproject_id, hubspot_order_id, synced_companies_id, synced_contact_id, synced_deals_id) VALUES (?, ?, ?, ?, ?, ?)',
                    [subproject.displayname, subproject.id, order_id, sqlCompanyId, sqlContactId, sqlDealId]
                );
            }
            console.log(`SUCCESS | Færdig oprettet ${project.displayname} med ${rentmanLinkedSubprojects.length} subprojects`);
        } else {
            if (!rentmanLinkedSubprojects) continue;
            for (const subproject of rentmanLinkedSubprojects) {
                const checkSqlSubproject = sqlSubId.find(row => row.rentman_subproject_id.toString() === subproject.id.toString())
                if (!checkSqlSubproject) {
                    console.log(`WAIT | Tilføjer subproject ${subproject.displayname} til ${project.displayname}`);
                    const [contactInfo, customerInfo] = await Promise.all([
                        rentmanGetFromEndpoint(project.customer),
                        rentmanGetFromEndpoint(project.cust_contact)
                    ]);
                    let contactRows = [];
                    let companyRows = [];

                    if (contactInfo) {
                        [companyRows] = await pool.execute(`SELECT * FROM synced_companies WHERE rentman_id = ?`, [contactInfo.id]);
                    }
                    if (customerInfo) {
                        [contactRows] = await pool.execute(`SELECT * FROM synced_contacts WHERE rentman_id = ?`, [customerInfo.id]);
                    }

                    const companyId = companyRows.length ? companyRows[0].hubspot_id : null;
                    const contactId = contactRows[0] ? contactRows[0].hubspot_id : null;

                    const sqlContactId = contactRows[0].id || 0
                    const sqlCompanyId = companyRows[0].id || 0

                    const [dealRows] = await pool.execute(`SELECT * FROM synced_deals WHERE rentman_project_id = ?`, [project.id]);

                    console.log(`IN PROGRESS | Tilføjer subproject ${subproject.displayname}`);

                    const order_id = await hubspotCreateOrder(subproject, dealRows[0].hubspot_project_id, companyId, contactId)

                    await pool.query(
                        'INSERT INTO synced_order (subproject_name, rentman_subproject_id, hubspot_order_id, synced_companies_id, synced_contact_id, synced_deals_id) VALUES (?, ?, ?, ?, ?, ?)',
                        [subproject.displayname, subproject.id, order_id, sqlCompanyId, sqlContactId, dealRows[0].id]
                    );
                    console.log(`SUCCESS | Færdig oprettet order ${subproject.displayname}`);
                }
            }

        }
    }
    console.log(i);

}

syncProjectsToDeals();