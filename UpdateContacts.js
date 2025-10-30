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

async function hubspotGetAllCompanies() {
    let limit = 25
    let output
    let url = `${HUBSPOT_ENDPOINT}Companies?limit=${limit}&associations=contacts`
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

async function hubspotGetFromEndpoint(type, id) {
    let parameter = "";
    if (type === "0-3") {
        parameter = "?properties=dealname,usage_period,slut_projekt_period&associations=companies,contacts"
    }
    const url = `${HUBSPOT_ENDPOINT}${type}/${id}`;

    const response = await fetch(url, {
        method: 'GET',
        headers: {
            'Accept': 'application/json',
            'Authorization': `Bearer ${HUBSPOT_TOKEN}`,
        }
    });

    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`HTTP error! status: ${response.status}, message: ${errText}`);
    }

    const output = await response.json();
    return output
}


async function hubspotUpdateCompany(id, domain) {
    const url = `${HUBSPOT_ENDPOINT}companies/${id}`;

    body = {
        "properties": {
            "domain": domain
        }
    }

    const response = await fetch(url, {
        method: 'PATCH',
        headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'Authorization': `Bearer ${HUBSPOT_TOKEN}`,
        },
        body: JSON.stringify(body),
    });

    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`HTTP error! status: ${response.status}, message: ${errText}`);
    }

    const output = await response.json();
    return output
}

async function printCompanies() {
    const allCompanies = await hubspotGetAllCompanies();
    for (const company of allCompanies) {

        if (company.properties.email) { break; }

        if (company.associations) {
            if (company.associations.contacts) {
                for (const association of company.associations.contacts.results) {
                    if (association.type === "company_to_contact") {
                        const user = await hubspotGetFromEndpoint("contacts", association.id)
                        if (!user.properties.email) { break; }

                        const email = user.properties.email.split("@")

                        if (email[1] === "gmail.com") { break; }
                        if (email[1] === "outlook.com") { break; }
                        if (email[1] === "hotmail.com") { break; }

                        console.log(`${company.properties.name} har domænet: ${email[1]}`)

                        await hubspotUpdateCompany(company.id, email[1])

                        break;
                    }
                }
            } else {
                console.log("Ingen kontakts")
            }
        }
    }
}

printCompanies();