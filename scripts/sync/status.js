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
            console.log(`HTTP error! status: ${response.status}, message: ${errText}`);
        }

        const output = await response.json();
        return output.data;

    } catch (error) {
        console.log(`Fejl i rentmanGetFromEndpoint for ${endpoint} (forsøg ${attempt}):`, error);
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


async function hubspotGetAllDeals() {
    let limit = 25
    let output
    let url = `${HUBSPOT_ENDPOINT_v4}0-3?limit=${limit}&associations=0-123`
    let allDeals = []

    while (true) {
        const body = {}
        const response = await fetch(url, {
            method: "GET",
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

        output = await response.json();
        allDeals = allDeals.concat(output.results);
        if (!output.paging) {
            break;
        }
        url = output.paging.next.link
    }
    return allDeals;
}

async function getOrderStatus(order) {
    const url = `https://api.hubapi.com/crm/v3/objects/0-123/${order.id}?properties=hs_pipeline_stage`
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

async function hubspotUpdateDeal(deal, status) {
    let url = `${HUBSPOT_ENDPOINT}0-3/${deal.id}`
    const stage = setStageMap[status];
    const body = {
        properties: {
            dealstage: stage,
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

async function fixDealStatus() {
    const projects = await hubspotGetAllDeals();
    console.log(`Alle projecter hentet`);

    const priority = ["Skal faktureres", "Bekræftet", "Afsluttet", "Koncept", "Retur", "Faktureret","Aflyst"]
    let i = 0
    for (const project of projects) {
        i++
        const associations = project.associations?.orders?.results
        if (associations) {
            let totalStatus = [];
            console.log(`WAIT | Tjekker deal ${project.properties.dealname} (${i}/${projects.length})`);
            for (const order of associations) {
                const status = await getOrderStatus(order);
                const mapped = dealStageMap[status];
                if (mapped) totalStatus.push(mapped);
            }
            const allSame = totalStatus.length > 0 &&
                totalStatus.every(s => s === totalStatus[0]);

            if (allSame) {
                console.log(`FÆRDIG | Opdaterer ${project.properties.dealname} med status ${totalStatus[0]}`);
                await hubspotUpdateDeal(project, totalStatus[0])

            } else {
                const status = priority.find(p => totalStatus.includes(p)) || null;
                console.log(`FÆRDIG | Opdaterer ${project.properties.dealname} med status ${status}`);
                await hubspotUpdateDeal(project, status)
                
            }
        }
    }
}

fixDealStatus();