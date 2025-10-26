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

async function hubspotGetOrderInfo(id) {
    const url = `${HUBSPOT_ENDPOINT_v4}orders/${id}?properties=hs_order_name`
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
    return output
}

async function hubspotGetOrders(id) {
    const url = `${HUBSPOT_ENDPOINT_v4}deals/${id}/associations/orders`
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
    return output.results
}

async function rentmanGetFilesFromEndpoint(endpoint) {

    const url = `${RENTMAN_API_BASE}/${endpoint}`;

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
    return output.data;
}

async function updateDeals() {
    const listOfAllDeals = await hubspotGetAllDeals();
    for (const deal of listOfAllDeals) {
        const listOfOrders = await hubspotGetOrders(deal.id)
        const [dealRentmanId] = await pool.execute(`SELECT * FROM synced_deals WHERE hubspot_project_id = ?`, [deal.id]);
        const fileUrl = await rentmanGetFilesFromEndpoint(`quotes/${deal.id}`)
        console.log(`${deal.properties.dealname}  (Rentman ID: ${dealRentmanId[0].rentman_project_id} / File: ${fileUrl.proxy_url})`)
        console.log(fileUrl)
        for (const order of listOfOrders) {
            const orderInfo = await hubspotGetOrderInfo(order.toObjectId)
            const [orderRentmanId] = await pool.execute(`SELECT * FROM synced_order WHERE hubspot_order_id = ?`, [order.toObjectId]);
            console.log(`      - ${orderInfo.properties.hs_order_name}  (Rentman ID: ${orderRentmanId[0].rentman_subproject_id})`)
        }

    }
    console.log(`Total: ${listOfAllDeals.length}`)
}

updateDeals();