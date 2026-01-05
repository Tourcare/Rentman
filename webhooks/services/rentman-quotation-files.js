const pool = require('../../db');

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
    if (endpoint === null) {
        return false;
    }
    const maxRetries = 5;
    const baseDelay = 5000; // Start med 1 sekund
    const retryDelay = baseDelay * (2 ** (attempt - 1)); // Eksponentiel backoff: 1s, 2s, 4s, 8s, 16s

    const url = `${RENTMAN_API_BASE}${endpoint}`;

    try {
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'Accept': 'application/json',
                'Authorization': `Bearer ${RENTMAN_API_TOKEN}`
            }
        });

        if (response.status === 429) {
            if (attempt >= maxRetries) {
                throw new Error(`Rate limit ramt og max retries (${maxRetries}) nået for ${endpoint}`);
            }
            console.error(`Rate limit ramt (forsøg ${attempt}). Venter ${retryDelay / 1000} sekunder...`);
            const start = Date.now();
            await new Promise(res => setTimeout(res, retryDelay));
            console.log(`Ventetid slut efter ${(Date.now() - start) / 1000} sekunder. Prøver igen...`);
            return rentmanGetFromEndpoint(endpoint, attempt + 1);
        }

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`HTTP error! status: ${response.status}, message: ${errText}`);
        }

        const output = await response.json();
        return output.data;
    } catch (error) {
        console.error(`Fejl i rentmanGetFromEndpoint for ${endpoint} (forsøg ${attempt}):`, error);
        throw error;
    }
}

async function hubspotUploadFile(link, projectName, type) {
    let url = `https://api.hubapi.com/files/v3/files/import-from-url/async`

    const body = {
        access: "PUBLIC_NOT_INDEXABLE",
        url: link,
        folderId: "308627103977",
        name: `${type} ${projectName}`
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
        throw new Error(`HTTP error! status: ${response.status}, message: ${errText}`);
    }

    const output = await response.json();
    return output;
}

async function hubspotCheckFile(id) {
    let url = `https://api.hubapi.com/files/v3/files/import-from-url/async/tasks/${id}/status`

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

    const output = await response.json();
    return output;
}

async function hubspotCreateNote(deal, file) {
    let url = `${HUBSPOT_ENDPOINT}notes`
    const today = Date.now()

    const body = {
        properties: {
            hs_attachment_ids: file,
            hs_note_body: "<div style=\"\" dir=\"auto\" data-top-level=\"true\"><p style=\"margin:0;\">Tilbud lavet i rentman</p></div>",
            hs_timestamp: Date.now()
        },
        associations: [{
            to: { id: deal },
            types: [{
                associationCategory: "HUBSPOT_DEFINED",
                associationTypeId: 214
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
        throw new Error(`HTTP error! status: ${response.status}, message: ${errText}`);
    }

    const output = await response.json();
    return output;
}

async function linkFileToDeal(event) {
    const fileInfo = await rentmanGetFromEndpoint(event.items[0].ref);

    const fileLink = fileInfo.url

    if (fileInfo.file_itemtype == "Offerte" || fileInfo.file_itemtype == "Contract") {
        let quotation;
        if (fileInfo.file_itemtype == "Offerte") quotation = await rentmanGetFromEndpoint(`/quotes/${fileInfo.file_item}`)
        if (fileInfo.file_itemtype == "Contract") quotation = await rentmanGetFromEndpoint(`/contracts/${fileInfo.file_item}`)
        const project = await rentmanGetFromEndpoint(quotation.project)
        let hubspotDeal;
        for (let i = 0; i < 3; i++) {
            const [rows] = await pool.execute(
                `SELECT * FROM synced_deals WHERE rentman_project_id = ?`,
                [project.id]
            );
            hubspotDeal = rows[0];
            if (hubspotDeal) break;
            console.log(`Ingen HubSpot deal endnu for projekt ${project.id}. Venter og prøver igen...`);
            await new Promise(r => setTimeout(r, 3000));
        }

        if (!hubspotDeal) {
            console.warn(`STOPPER → Fandt stadig ingen HubSpot ID for projekt ${project.id}`);
            return;
        }
        let fileType;
        if (fileInfo.file_itemtype == "Offerte") fileType = "Tilbud vedr."
        if (fileInfo.file_itemtype == "Contract") fileType = "Ordrebekræftelse for"
        const file = await hubspotUploadFile(fileLink, project.displayname, fileType)
        const status = await hubspotCheckFile(file.id)

        let fileId;
        for (let i = 0; i < 12; i++) {
            const status = await hubspotCheckFile(file.id)
            if (status.status === "COMPLETE") {
                fileId = status.result.id
                break;
            }
            console.log(`Filen er ved at uploade. Prøver igen om 5 sekunder.`);
            await new Promise(r => setTimeout(r, 5000));
        }

        if (!fileId) {
            console.log(`Filen nåede ikke at uploade indenfor 1 minut. `);
            return false;
        }

        await hubspotCreateNote(hubspotDeal.hubspot_project_id, fileId)
    }

}

module.exports = { linkFileToDeal }