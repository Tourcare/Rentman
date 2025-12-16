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

async function hubspotUpdateOrderFinancial(rentmanSubID, hubspotid) {
    const rentmanData = await rentmanGetFromEndpoint(`/subprojects/${rentmanSubID}`)

    const url = `${HUBSPOT_ENDPOINT}0-123/${hubspotid}`

    const total_price = sanitizeNumber(rentmanData.project_total_price)

    const body = {
        properties: {
            hs_total_price: total_price
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

async function hubspotUpdateDealFinancial(rentmanMainId, hubspotid) {
    const rentmanData = await rentmanGetFromEndpoint(`/projects/${rentmanMainId}`)
    
    const url = `${HUBSPOT_ENDPOINT}0-3/${hubspotid}`

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

async function newUpdateOnEquipment(event) {
    for (const item of event.items) {
        if (!item.ref) continue;
        const rentmanData = await rentmanGetFromEndpoint(item.ref)
        const subprojectId = rentmanData.subproject.split("/").pop()
        const projectId = rentmanData.project.split("/").pop()

        if (!projectId) continue;

        const [syncedDeals] = await pool.query(`SELECT * FROM synced_deals WHERE rentman_project_id = ?`, [projectId])
        const [syncedOrder] = await pool.query(`SELECT * FROM synced_order WHERE rentman_subproject_id = ?`, [subprojectId])

        const hubspotDealId = syncedDeals?.[0]?.hubspot_project_id
        const hubspotOrderId = syncedOrder?.[0]?.hubspot_order_id

        if (!hubspotDealId) continue;

        await hubspotUpdateDealFinancial(projectId, hubspotDealId)

        if (!hubspotOrderId) continue;
        await hubspotUpdateOrderFinancial(subprojectId, hubspotOrderId)

    }
}

module.exports = { newUpdateOnEquipment };