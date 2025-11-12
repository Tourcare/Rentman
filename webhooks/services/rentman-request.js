const dotenv = require('dotenv');

const pool = require('../../db');
const { rentmanDelRentalRequest } = require('./hubspot-deal');

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

async function rentmanGetProjectRequest() {
    const url = `${RENTMAN_API_BASE}/projectrequests`

    const response = await fetch(url, {
        method: 'GET',
        headers: {
            'Accept': 'application/json',
            'Authorization': `Bearer ${RENTMAN_API_TOKEN}`,
        }
    });

    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`HTTP error fra Rentman: ${response.status}, ${errText}`);
    }

    const output = await response.json();

    return output;
}

async function rentmanCrossCheckRental(ref) {
    const listOfRequest = await rentmanGetProjectRequest();
    for (const request of listOfRequest.data) {
        if (request.linked_project === ref) {

            const [hubspot] = await pool.execute(`SELECT * FROM synced_request WHERE rentman_request_id = ?`, [request.id])
            
            await pool.query(
                'DELETE FROM synced_request WHERE rentman_request_id = ?',
                [request.id]
            );

            await rentmanDelRentalRequest(request.id);

            console.log(`Slettede rental request med id ${request.id}`);


            const projectInfo = await rentmanGetFromEndpoint(ref)
            const companyInfo = await rentmanGetFromEndpoint(projectInfo.customer) || 0
            const contactInfo = await rentmanGetFromEndpoint(projectInfo.cust_contact) || 0

            let companyRows = 0;
            let contactRows = 0;

            if (companyInfo != 0) {[companyRows] = await pool.execute(`SELECT * FROM synced_companies WHERE rentman_id = ?`, [companyInfo.id])}
            if (contactInfo != 0) {[contactRows] = await pool.execute(`SELECT * FROM synced_contacts WHERE rentman_id = ?`, [contactInfo.id])}
            
            await pool.query(
                'INSERT INTO synced_deals (project_name, rentman_project_id, hubspot_project_id, synced_companies_id, synced_contact_id) VALUES (?, ?, ?, ?, ?)',
                [projectInfo.displayname, projectInfo.id, hubspot[0].hubspot_deal_id, companyRows?.[0]?.id ?? 0, contactRows?.[0]?.id ?? 0]
            );
            return true;
        }
        return false;
    }
}

module.exports = { rentmanCrossCheckRental };