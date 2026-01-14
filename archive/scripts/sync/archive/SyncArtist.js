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

async function hubspotCreateCompany(name, image, link, retries = 5, delay = 1000) {
    const url = `${HUBSPOT_ENDPOINT}companies`;
    const body = {
        "properties": {
            name: name,
            hs_logo_url: image,
            type: "Artist"
        },
        "associations": [{
            "to": {
                "id": link.toString()
            },
            "types": [{
                "associationCategory": "HUBSPOT_DEFINED",
                "associationTypeId": 14
            }]
        }]
    };

    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            const response = await fetch(url, {
                method: "POST",
                headers: {
                    'Content-Type': 'application/json',
                    "Accept": "application/json",
                    "Authorization": `Bearer ${HUBSPOT_TOKEN}`,
                },
                body: JSON.stringify(body),
            });

            if (response.ok) {
                const output = await response.json();
                return output.id;
            } else if (response.status === 429) { // Rate limit
                const retryAfter = response.headers.get("Retry-After");
                const waitTime = retryAfter ? parseInt(retryAfter) * 1000 : delay * (2 ** attempt);
                console.warn(`Rate limited. Retrying in ${waitTime}ms...`);
                await new Promise(res => setTimeout(res, waitTime));
            } else {
                const errText = await response.text();
                throw new Error(`HTTP error! status: ${response.status}, message: ${errText}`);
            }
        } catch (err) {
            if (attempt === retries) throw err; // Giv op efter sidste forsøg
            const waitTime = delay * (2 ** attempt);
            console.warn(`Error occurred: ${err.message}. Retrying in ${waitTime}ms...`);
            await new Promise(res => setTimeout(res, waitTime));
        }
    }
    return output.properties.hs_object_id;
}

async function hubspotLinkContact(artist, company) {
    const url = `${HUBSPOT_ENDPOINT_v4}companies/${artist}/associations/companies/${company}`
    const body = [{
        "associationCategory": "HUBSPOT_DEFINED",
        "associationTypeId": 14

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
        console.log(`HTTP error! status: ${response.status}, message: ${errText}`);
    }

    return true;
}


async function syncArtists() {
    [listOfArtist] = await pool.execute(`SELECT * FROM scraped_artists`)
    for (artist of listOfArtist) {
        let name = artist.name.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
        [crossCheck] = await pool.execute(`SELECT * FROM synced_companies WHERE name LIKE '%${name} %'`)

        let link;

        if (artist.booking === "AllThingsLive") { link = "269421762774" }
        if (artist.booking === "Helter Skelter") { link = "267532101843" }
        if (artist.booking === "Luger") { link = "269340890325" }
        if (artist.booking === "PDH") { link = "268712478915" }
        if (artist.booking === "Prime Music") { link = "269421762774" }
        if (artist.booking === "Smash!Bang!Pow") { link = "269421762774" }
        if (artist.booking === "The Artist") { link = "269360987334" }
        if (artist.booking === "United Stage") { link = "269428934882" }

        if (crossCheck[0]) {
            console.log(`Linker ${crossCheck[0].name} med ${name}`);
            console.log(`${crossCheck[0].hubspot_id} ${link}`);

            await hubspotLinkContact(crossCheck[0].hubspot_id, link);
            await pool.query(
                'UPDATE scraped_artists SET hubspot_id = ? WHERE id = ?',
                [crossCheck[0].hubspot_id, artist.id]
            );
            console.log(`Link for ${name} færdig`);
        } else {
            const hubspotId = await hubspotCreateCompany(name, artist.image_url, link);
            await pool.query(
                'UPDATE scraped_artists SET hubspot_id = ? WHERE id = ?',
                [hubspotId, artist.id]
            );
            console.log(`Oprettet ${name}`);
        }
    }
}

syncArtists();