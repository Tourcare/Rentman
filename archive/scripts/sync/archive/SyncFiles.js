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

async function rentmanGetFiles() {
    const limit = 50;
    let offset = 0;
    let allFiles = [];

    while (true) {
        const url = `${RENTMAN_API_BASE}/files?limit=${limit}&offset=${offset}`;

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

        if (output.data && output.data.length > 0) {
            allFiles = allFiles.concat(output.data);
            offset += limit;
        } else {
            break;
        }
    }

    return allFiles;
}

async function getFiles() {
    const listOfFiles = await rentmanGetFiles();
    for (const file of listOfFiles) {
        if (file.path.includes("projects/") && !file.path.includes("subprojects/")) {
            const path = file.path.split("_")
            const projectid = path[0].split("/")
            //const [rows] = await pool.execute(`SELECT * FROM synced_deals WHERE rentman_project_id = ?`, [projectid[1]])

            console.log(`${file.displayname} Tilhører ${projectid[1]}`)
        }
    }
}

getFiles();