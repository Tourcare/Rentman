const dotenv = require('dotenv');
const mysql = require('mysql2/promise');
const { log } = require('winston');

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


async function hubspotGetAllDeals() {
    let limit = 25
    let output
    let url = `${HUBSPOT_ENDPOINT_v4}0-3?limit=${limit}`
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

async function hubspotGetAllOrders() {
    let limit = 25
    let output
    let url = `${HUBSPOT_ENDPOINT_v4}0-123?limit=${limit}&properties=hs_order_name`
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

async function hubspotDealGetFromEndpoint(type, id) {
    const url = `${HUBSPOT_ENDPOINT}${type}/${id}`;

    const response = await fetch(url, {
        method: 'GET',
        headers: {
            'Accept': 'application/json',
            'Authorization': `Bearer ${HUBSPOT_TOKEN}`,
        }
    });

    const text = await response.text();

    if (!response.ok) {
        if (text.includes('not found') || response.status === 404) {
            return false;
        }
        console.log(`HTTP error! status: ${response.status}, message: ${text}`);
        return false;
    }

    const output = JSON.parse(text);
    return output;
}

async function hubspotDealRemoveFromEndpoint(type, id) {
    const url = `${HUBSPOT_ENDPOINT}${type}/${id}`;

    const response = await fetch(url, {
        method: 'DELETE',
        headers: {
            'Accept': 'application/json',
            'Authorization': `Bearer ${HUBSPOT_TOKEN}`,
        }
    });

    const text = await response.text();

    if (!response.ok) {
        if (text.includes('not found') || response.status === 404) {
            return false;
        }
        console.log(`HTTP error! status: ${response.status}, message: ${text}`);
        return false;
    }

    const output = JSON.parse(text);
    return output;
}


async function fixSQL() {
    const [projects, orders, [sqlProjectRows], [sqlOrderRows]] = await Promise.all([
        hubspotGetAllDeals(),
        hubspotGetAllOrders(),
        pool.query('SELECT * FROM synced_deals'),
        pool.query('SELECT * FROM synced_order')
    ]);
    /*for (const project of projects) {
        const checkSqlProject = sqlProjectRows.find(row => row.hubspot_project_id.toString() === project.id.toString())
        if (!checkSqlProject) {
            await hubspotDealRemoveFromEndpoint("0-3", projects.id);
            console.log(`SLETTEDE deal ${project.properties.dealname} fra hubspot.`);
        }
    }*/

    console.log(`Sletter orders`);
    
    for (const order of orders) {
        if(!order) {
            continue;
        }
        
        const checkSqlOrder = sqlOrderRows.find(row => row.hubspot_order_id.toString() === order.id.toString())
        if (!checkSqlOrder) {
            await hubspotDealRemoveFromEndpoint("0-123", order.id);
            console.log(`SLETTEDE order ${order.properties.hs_order_name} fra hubspot.`);
        }
    }

    console.log(`Færdig med alt`);

}

//fixSQL();

async function checkAss(params) {
    
}


async function checkSql() {
    const [sqlProjectId] = await pool.query('SELECT * FROM synced_order')
    for (const sql of sqlProjectId) {
        const check = await hubspotDealGetFromEndpoint("0-123", sql.hubspot_order_id)
        if (!check) {
            await pool.query(`DELETE FROM synced_order WHERE id = ?`, [sql.id])
            console.log(`SLETTEDE ${sql.subproject_name} fra database.`);

        }
    }
    console.log(`Done`);

}

//checkSql();