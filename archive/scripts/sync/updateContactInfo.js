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
            console.error(`HTTP error! status: ${response.status}, message: ${errText}`);
            return false
        }

        const output = await response.json();
        return output.data;

    } catch (error) {
        console.error(`Fejl i rentmanGetFromEndpoint for ${endpoint} (forsøg ${attempt}):`, error);
        return false
    }
}

async function hubspotUpdateContact(id, data) {
    const url = `${HUBSPOT_ENDPOINT}contacts/${id}`;
    let email = data.email ? data.email.trim().replace(/\s+/g, '') : '';
    if (email) {
        const [localPart, domainPart] = email.split('@');
        if (domainPart && !/\.[a-zA-Z]{2,}$/.test(domainPart)) {
            email = `${localPart}@${domainPart}.dk`;
        }
    }

    const body = {
        "properties": {
            email: email,
            lastname: `${data.middle_name ? data.middle_name + " " : ""}${data.lastname || ""}`,
            firstname: `${data.firstname || ''}`
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
        console.warn(`HTTP error! status: ${response.status}, message: ${errText}`);
    }
}

async function crossCheckContacts() {
    const [contacts] = await pool.query('SELECT * FROM synced_contacts')
    let i = 0
    for (const contact of contacts) {
        i++
        const rentmanData = await rentmanGetFromEndpoint(`/contactpersons/${contact.rentman_id}`)
        await hubspotUpdateContact(contact.hubspot_id, rentmanData)
        console.log(`DONE | Færdig opdateret ${rentmanData.displayname} (${i}/${contacts.length})`);
    }
    console.log(`Færdig med alle`);
    
}
crossCheckContacts();