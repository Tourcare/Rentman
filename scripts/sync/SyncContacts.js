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

async function getRentmanContacts() {
    const limit = 50;
    let offset = 0;
    let allContacts = [];

    while (true) {
        const url = `${RENTMAN_API_BASE}/contacts?limit=${limit}&offset=${offset}`;

        const response = await fetch(url, {
            headers: {
                "Accept": "application/json",
                "Authorization": `Bearer ${RENTMAN_API_TOKEN}`,
            },
        });

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`HTTP error fra Rentman: ${response.status}, ${errText}`);
        }

        const output = await response.json();

        if (output.data && output.data.length > 0) {
            allContacts = allContacts.concat(output.data);
            offset += limit;
        } else {
            break;
        }
    }

    return allContacts;
}

async function rentmanGetContactPersons(id) {
    const url = `${RENTMAN_API_BASE}/contacts/${id}/contactpersons`;

    const response = await fetch(url, {
        method: 'GET',
        headers: {
            'Accept': 'application/json',
            'Authorization': `Bearer ${RENTMAN_API_TOKEN}`
        }
    });

    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`HTTP error! status: ${response.status}, message: ${errText}`);
    }

    const output = await response.json();
    return output.data;  // Returnerer listen af kontaktpersoner
}

async function hubspotCreateCompany(data) {
    const url = `${HUBSPOT_ENDPOINT}companies`
    const body = {
        "properties": {
            name: data.displayname,
            cvrnummer: data.VAT_code
        }
    }
    const response = await fetch(url, {
        method: "POST",
        headers: {
            'Content-Type': 'application/json',
            "Accept": "application/json",
            "Authorization": `Bearer ${HUBSPOT_TOKEN}`,
        },
        body: JSON.stringify(body),
    });

    if (!response.ok) {
        const errText = await response.text();
        let errJson;

        try {
            errJson = JSON.parse(errText);
        } catch (e) {
            errJson = null;
        }

        if (response.status === 400 && errJson?.category === "VALIDATION_ERROR") {
            // Forsøg at finde ID'et af den virksomhed som allerede har værdien
            const match = errJson.message.match(/(\d+) already has that value/);

            if (match) {
                const existingCompanyId = match[1];
                console.log(`Virksomhed med ID ${existingCompanyId} har allerede denne værdi.`);
                return existingCompanyId;
            } else {
                console.warn("Kunne ikke finde eksisterende virksomhed ID i fejlmeddelelsen:", errJson.message);
            }
        } else {
            throw new Error(`HTTP error! status: ${response.status}, message: ${errText}`);
        }
    }

    const output = await response.json();
    return output.id;
}

async function hubspotLinkContact(contact, company) {
    const url = `${HUBSPOT_ENDPOINT_v4}contacts/${contact}/associations/companies/${company}`
    const body = [{
        "associationCategory": "HUBSPOT_DEFINED",
        "associationTypeId": 1

    }]
    const response = await fetch(url, {
        method: "PUT",
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

    return true;
}

async function hubspotCreateContact(data, companyID) {
    const url = `${HUBSPOT_ENDPOINT}contacts`
    let email = data.email.trim().replace(/\s+/g, '')
    if (email) {
        const [localPart, domainPart] = email.split('@');
        if (!/\.[a-zA-Z]{2,}$/.test(domainPart)) {
            email = `${localPart}@${domainPart}.dk`
        }
    }

    const body = {
        "properties": {
            email: email,
            lastname: `${data.firstname}`,
            firstname: `${data.lastname}`
        },
        "associations": [{
            "to": {
                "id": companyID.toString()  // Sørg for det er en string
            },
            "types": [{
                "associationCategory": "HUBSPOT_DEFINED",
                "associationTypeId": 1
            }]
        }]
    }
    const response = await fetch(url, {
        method: "POST",
        headers: {
            'Content-Type': 'application/json',
            "Accept": "application/json",
            "Authorization": `Bearer ${HUBSPOT_TOKEN}`,
        },
        body: JSON.stringify(body),
    });

    if (!response.ok) {
        const errText = await response.text();
        let errJson;

        try {
            errJson = JSON.parse(errText); // prøv at parse til JSON
        } catch (e) {
            errJson = null; // hvis det ikke er JSON
        }

        if (response.status === 409 && errJson) {
            // Forsøg at finde det eksisterende ID i beskeden
            const match = errJson.message.match(/Existing ID:\s*(\d+)/);

            if (match) {
                const existingId = match[1];
                console.log(`Kontakt findes allerede i HubSpot med ID: ${existingId}`);

                // Her kan du fx kalde din link-funktion:
                await hubspotLinkContact(existingId, companyID);
                return existingId;
            } else {
                console.warn("Kunne ikke finde Existing ID i fejlbeskeden:", errJson.message);
                return null;
            }
        }
        throw new Error(`HTTP error! status: ${response.status}, message: ${errText}`);

    }

    const output = await response.json();
    return output.id
}

async function getContacts() {
    const contacts = await getRentmanContacts();
    for (const contact of contacts) {
        console.log(`Opretter virksomhed: ${contact.displayname}`)
        const company = await hubspotCreateCompany(contact)
        const persons = await rentmanGetContactPersons(contact.id)
        await pool.query(
            'INSERT INTO synced_companies (name, rentman_id, hubspot_id) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE name=VALUES(name), hubspot_id=VALUES(hubspot_id)',
            [contact.displayname, contact.id, company]
        );
        for (const person of persons) {
            console.log(`   - Opretter person: ${person.displayname}`)
            const hsPersonId = await hubspotCreateContact(person, company)
            if (hsPersonId) {
                await pool.query(
                    'INSERT INTO synced_contacts (name, rentman_id, hubspot_id) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE name=VALUES(name), hubspot_id=VALUES(hubspot_id)',
                    [person.displayname, person.id, hsPersonId]
                );
            }

            continue;
        }
        console.log(" ")
    }
}

getContacts();
