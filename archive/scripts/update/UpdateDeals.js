const { text } = require('body-parser');
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

async function hubspotGetAllObjects(object) {
    let limit = 25
    let output
    let url = `${HUBSPOT_ENDPOINT_v4}${object}?limit=${limit}`
    let allObjects = []

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
            console.warn(`HTTP error! status: ${response.status}, message: ${errText}`);
        }

        output = await response.json();
        allObjects = allObjects.concat(output.results);
        if (!output.paging) {
            break;
        }
        url = output.paging.next.link
    }
    return allObjects;
}

async function hubspotUpdateDeal(id, rentmanid) {
    let url = `${HUBSPOT_ENDPOINT}deals/${id}`
    const link = `https://tourcare2.rentmanapp.com/#/projects/${rentmanid}/details`
    const body = {
        properties: {
            rentman_projekt: link,
            opret_i_rentam_request: "Ja",
            hidden_rentman_request: true
        },
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
        console.warn(`HTTP error! status: ${response.status}, message: ${errText}`);
    }
}

async function hubspotUpdateOrder(id, orderid, dealid) {
    let url = `${HUBSPOT_ENDPOINT}0-123/${id}`
    const body = {
        properties: {
            rentman_projekt: `https://tourcare2.rentmanapp.com/#/projects/${dealid}/details?subproject=${orderid}`
        },
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
        console.warn(`HTTP error! status: ${response.status}, message: ${errText}`);
    }
}

async function updateDeals() {
    console.log(`STARTER | Starter opdatering af alle deals og orders`);
    const [listOfDeals, listOfOrders, [sqlDeals], [sqlOrders]] = await Promise.all([
        hubspotGetAllObjects("0-3"),
        hubspotGetAllObjects("0-123"),
        pool.query(`SELECT * FROM synced_deals`),
        pool.query(`SELECT 
                        so.subproject_name        AS name,
                        so.rentman_subproject_id AS subid,
                        so.hubspot_order_id      AS hubid,
                        so.synced_deals_id       AS id,
                        sd.rentman_project_id    AS dealid
                    FROM synced_order so
                    JOIN synced_deals sd
                        ON sd.id = so.synced_deals_id;
                    `)
    ])
    console.log(`STARTER | Data hentet. Deals: ${listOfDeals.length} / Orders: ${listOfOrders.length}`);
    let i = 0
    for (const deal of listOfDeals) {
        i++
        const rentmanId = sqlDeals.find(row => row.hubspot_project_id.toString() === deal.id.toString())
        if (!rentmanId) continue;
        await hubspotUpdateDeal(deal.id, rentmanId?.rentman_project_id)
        console.log(`IGANG | Opdateret order med ID ${deal.id} (${i}/${listOfDeals.length})`);
    }
        /*
    i = 0
    for (const order of listOfOrders) {
        i++
        const rentmanId = sqlOrders.find(row => row.hubid.toString() === order.id.toString())
        if (!rentmanId) continue;
        await hubspotUpdateOrder(order.id, rentmanId?.subid, rentmanId?.dealid)
        console.log(`IGANG | Opdateret order med ID ${order.id} (${i}/${listOfOrders.length})`);
    }*/
    console.log(`Færdig!`)
}

updateDeals();