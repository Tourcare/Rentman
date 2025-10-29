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

async function hubspotUpdateDeal(id, pipeline, stage) {
    let url = `${HUBSPOT_ENDPOINT}deals/${id}`
    const body = {
        "properties": {
            "pipeline": pipeline,
            "dealstage": stage,
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
        throw new Error(`HTTP error! status: ${response.status}, message: ${errText}`);
    }
}

async function updateDeals() {
    let stage;
    const listOfCompanies = await hubspotGetAllDeals();
    for (const deal of listOfCompanies) {
        if (deal.properties.dealname.startsWith("*") || deal.properties.dealname.includes("Honorar")) {

            if (deal.properties.stage === "appointmentscheduled") {
                stage = "3589579973"
            } else {
                stage = "3589579975"
            }

            await hubspotUpdateDeal(deal.id, "2623033593", stage);
            console.log(`${deal.properties.dealname} Er blevet opdateret til Crew Hyre Pipeline`)
        } else if (deal.properties.dealname.includes("Opbevaring")) {
            if (deal.properties.stage === "appointmentscheduled") {
                stage = "3591124158"
            } else {
                stage = "3591124160"
            }

            await hubspotUpdateDeal(deal.id, "2623738080", stage);
            console.log(`${deal.properties.dealname} Er blevet opdateret til Opbevaring Pipeline`)
        }
    }
    console.log(`Total: ${listOfCompanies.length}`)
}

updateDeals();