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

async function rentmanGetFromEndpoint(endpoint) {
    const url = `${RENTMAN_API_BASE}${endpoint}`;
    const response = await fetch(url, {
        headers: {
            "Accept": "application/json",
            "Authorization": `Bearer ${RENTMAN_API_TOKEN}`,
        },
    });

    if (!response.ok) {
        const errText = await response.text();
        console.log(`Fejl ved hentning fra Rentman: ${response.status}, ${errText}`);
        return false;
    }

    const output = await response.json();
    return output.data;
}

async function updateSQLWithCompany() {
    const [contacts] = await pool.query(
        'SELECT * FROM synced_contacts'
    )
    for (const contact of contacts) {
        const contactInfo = await rentmanGetFromEndpoint(`/contactpersons/${contact.rentman_id}`)
        if (!contactInfo) continue;
        const companyInfo = await rentmanGetFromEndpoint(contactInfo.contact)
        if (!companyInfo) continue;
        const [SQLCompany] = await pool.query(
            'SELECT * FROM synced_companies WHERE rentman_id = ?', [companyInfo.id]
        )
        if (SQLCompany?.[0]?.hubspot_id) {
            await pool.query(
                'UPDATE synced_contacts SET hubspot_company_conntected = ? WHERE rentman_id = ?', [SQLCompany?.[0]?.hubspot_id || "", contact.rentman_id]
            )
            console.log(`Opdateret ${contact.name} with Company HubSpot_id: ${SQLCompany?.[0]?.hubspot_id}`);
            
        }
    }
}

updateSQLWithCompany();