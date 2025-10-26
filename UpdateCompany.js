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

async function getInfoFromCVR(cvr) {
    const url = `https://cvrapi.dk/api?country=dk&vat=${cvr}`
    const response = await fetch(url, {
        method: "GET",
        headers: {
            "User-agent": "Tourcare ApS - CRM-System - Sylvester +4551686106",
            'Content-Type': 'application/json',
            "Accept": "application/json",
            "Authorization": `Bearer ${HUBSPOT_TOKEN}`,
        }
    });

    if (!response.ok) {
        const errText = await response.text();
        if (response.status = 404) {
            return null;
        }
        throw new Error(`HTTP error! status: ${response.status}, message: ${errText}`);
    }

    output = await response.json();
    return output;
}

async function hubspotGetAllCompanys() {
    let limit = 25
    let output
    let url = `${HUBSPOT_ENDPOINT_v4}companies?limit=${limit}&properties=name,domain,cvrnummer`
    let allCompanies = []

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
        allCompanies = allCompanies.concat(output.results);
        if (!output.paging) {
            break;
        }
        url = output.paging.next.link
    }
    return allCompanies;
}

async function updateCompany() {
    const listOfCompanies = await hubspotGetAllCompanys();
    for (const company of listOfCompanies) {
        if (company.properties.cvrnummer) {
            const cvrOuput = await getInfoFromCVR(company.properties.cvrnummer)
            if (cvrOuput) {
                console.log(`${company.properties.name} - ${company.properties.cvrnummer} - ${cvrOuput.name}`)
                continue;
            }
            console.log(`${company.properties.name} - Er gået konkurs`)
        }
        
    }
    console.log(`Total: ${listOfCompanies.length}`)
}

updateCompany();