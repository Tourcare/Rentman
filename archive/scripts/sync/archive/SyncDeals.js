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

function sanitizeNumber(value, decimals = 2) {
  const EPSILON = 1e-6;

  // Hvis værdien er ekstremt tæt på nul, sæt til 0
  if (Math.abs(value) < EPSILON) return 0;

  // Fjern floating-point-støj ved at runde
  const rounded = Number(value.toFixed(decimals));

  return rounded;
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

    let body;


    if (!contact) {
        body = {
            "properties": {
                "dealname": deal.displayname,
                "dealstage": dealstage,
                "createdate": usageStart,
                "closedate": usageEnd,
                "usage_period": usageStart,
                "slut_projekt_period": usageEnd,
                "amount": total_price
            },
            "associations": [
                {
                    "to": { "id": company },
                    "types": [{
                        "associationCategory": "HUBSPOT_DEFINED",
                        "associationTypeId": 5
                    }]
                }
            ]
        }
    } else {
        body = {
            "properties": {
                "dealname": deal.displayname,
                "dealstage": dealstage,
                "createdate": deal.usageperiod_start,
                "closedate": deal.usageperiod_end,
                "usage_period": deal.usageperiod_start,
                "slut_projekt_period": deal.usageperiod_end,
                "amount": total_price
            },
            "associations": [
                {
                    "to": { "id": company },
                    "types": [{
                        "associationCategory": "HUBSPOT_DEFINED",
                        "associationTypeId": 5
                    }]
                },
                {
                    "to": { "id": contact },
                    "types": [{
                        "associationCategory": "HUBSPOT_DEFINED",
                        "associationTypeId": 3
                    }]
                }
            ]
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

    let body;

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

    if (!contact) {
        body = {
            "properties": {
                "hs_order_name": order.displayname,
                "hs_total_price": total_price,
                "hs_pipeline": "14a2e10e-5471-408a-906e-c51f3b04369e",
                "hs_pipeline_stage": dealstage,
                "start_projekt_period": order.usageperiod_end,
                "slut_projekt_period": order.usageperiod_start
            },
            "associations": [
                {
                    "to": { "id": company },
                    "types": [{
                        "associationCategory": "HUBSPOT_DEFINED",
                        "associationTypeId": 509
                    }]
                },
                {
                    "to": { "id": deal },
                    "types": [{
                        "associationCategory": "HUBSPOT_DEFINED",
                        "associationTypeId": 512
                    }]
                }
            ]
        }
    } else {
        body = {
            "properties": {
                "hs_order_name": order.displayname,
                "hs_total_price": total_price,
                "hs_pipeline": "14a2e10e-5471-408a-906e-c51f3b04369e",
                "hs_pipeline_stage": dealstage,
                "start_projekt_period": order.usageperiod_end,
                "slut_projekt_period": order.usageperiod_start
            },
            "associations": [
                {
                    "to": { "id": company },
                    "types": [{
                        "associationCategory": "HUBSPOT_DEFINED",
                        "associationTypeId": 509
                    }]
                },
                {
                    "to": { "id": contact },
                    "types": [{
                        "associationCategory": "HUBSPOT_DEFINED",
                        "associationTypeId": 507
                    }]
                },
                {
                    "to": { "id": deal },
                    "types": [{
                        "associationCategory": "HUBSPOT_DEFINED",
                        "associationTypeId": 512
                    }]
                }
            ]
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
        throw new Error(`HTTP error! status: ${response.status}, message: ${errText}`);
    }

    const output = await response.json();
    return output.properties.hs_object_id;
}



async function syncProjects() {
    const pool = mysql.createPool(dbConfig);
    const listOfProjects = await rentmanGetProjects();

    for (const project of listOfProjects) {

        const [projectInfo, subProjects, contactInfo, customerInfo] = await Promise.all([
            rentmanGetFromEndpoint(`/projects/${project.id}`),
            rentmanGetFromEndpoint(`/projects/${project.id}/subprojects`),
            rentmanGetFromEndpoint(project.customer),
            rentmanGetFromEndpoint(project.cust_contact)
        ]);
        let deal_id;
        let order_id;
        if (contactInfo.id) {
            const [companyRows] = await pool.execute(`SELECT * FROM synced_companies WHERE rentman_id = ?`, [contactInfo.id]);
            if (customerInfo.id) {
                const [contactRows] = await pool.execute(`SELECT * FROM synced_contacts WHERE rentman_id = ?`, [customerInfo.id]);
                console.log(`Opretter deal ${project.displayname}`);

                deal_id = await hubspotCreateDeal(projectInfo, companyRows[0].hubspot_id, contactRows[0].hubspot_id)
                await pool.query(
                    'INSERT INTO synced_deals (project_name, rentman_project_id, hubspot_project_id, synced_companies_id, synced_contact_id) VALUES (?, ?, ?, ?, ?)',
                    [project.displayname, projectInfo.id, deal_id, companyRows[0].id, contactRows[0].id]
                );
                const [dealRows] = await pool.execute(`SELECT * FROM synced_deals WHERE rentman_project_id = ?`, [projectInfo.id]);

                for (const subproject of subProjects) {
                    order_id = await hubspotCreateOrder(subproject, deal_id, companyRows[0].hubspot_id, contactRows[0].hubspot_id)
                    await pool.query(
                        'INSERT INTO synced_order (subproject_name, rentman_subproject_id, hubspot_order_id, synced_companies_id, synced_contact_id, synced_deals_id) VALUES (?, ?, ?, ?, ?, ?)',
                        [subproject.displayname, subproject.id, order_id, companyRows[0].id, contactRows[0].id, dealRows[0].id]
                    );
                }

                continue;
            }
            
            console.log(`Opretter deal ${project.displayname} uden kontaktperson`);

            deal_id = await hubspotCreateDeal(projectInfo, companyRows[0].hubspot_id)
            await pool.query(
                'INSERT INTO synced_deals (project_name, rentman_project_id, hubspot_project_id, synced_companies_id) VALUES (?, ?, ?, ?)',
                [project.displayname, projectInfo.id, deal_id, companyRows[0].id]
            );
            const [dealRows] = await pool.execute(`SELECT * FROM synced_deals WHERE rentman_project_id = ?`, [projectInfo.id]);

            for (const subproject of subProjects) {
                order_id = await hubspotCreateOrder(subproject, deal_id, companyRows[0].hubspot_id)
                await pool.query(
                    'INSERT INTO synced_order (subproject_name, rentman_subproject_id, hubspot_order_id, synced_companies_id, synced_deals_id) VALUES (?, ?, ?, ?, ?)',
                    [subproject.displayname, subproject.id, order_id, companyRows[0].id, dealRows[0].id]
                );
            }

            continue;
        }
        console.log(`Skipper ${project.displayname} da der mangler virksomhed`);
    }
}

syncProjects();