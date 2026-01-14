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

async function linkDealToArtist() {
    const listOfDeals = await hubspotGetAllDeals();
    for (const deal of listOfDeals) {
        const dealArray = deal.properties.dealname.split(" ")
        for (arrayItem of dealArray) {
            if ([" ", "", "-"].includes(arrayItem)) {continue;}
            [crossCheck] = await pool.execute(`SELECT * FROM scraped_artists WHERE name LIKE '%${arrayItem} %' COLLATE utf8mb4_bin;`)
            if (crossCheck?.[0]?.name) {
                console.log(`Deal ${deal.properties.dealname} matcher med artist ${crossCheck[0].name} på baggrund af ${arrayItem}`)
                break;
            }
        }       
    }
}

linkDealToArtist();