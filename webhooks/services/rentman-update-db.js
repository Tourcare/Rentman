const dbConfig = {
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DASH_DB_NAME,
};

const pool = mysql.createPool(dbConfig);

// Rentman API konfiguration
const RENTMAN_API_BASE = "https://api.rentman.net";
const RENTMAN_API_TOKEN = process.env.RENTMAN_ACCESS_TOKEN;

/**
 * Henter subproject data fra Rentman API
 */
async function getSubproject(subprojectId) {
    const response = await fetch(`${RENTMAN_API_BASE}/subprojects/${subprojectId}`, {
        headers: {
            'Authorization': `Bearer ${RENTMAN_API_TOKEN}`,
            'Content-Type': 'application/json'
        }
    });

    if (!response.ok) {
        throw new Error(`Failed to fetch subproject ${subprojectId}: ${response.statusText}`);
    }

    const data = await response.json();
    return data;
}

/**
 * Henter project data fra Rentman API
 */
async function getProject(projectId) {
    const response = await fetch(`${RENTMAN_API_BASE}/projects/${projectId}`, {
        headers: {
            'Authorization': `Bearer ${RENTMAN_API_TOKEN}`,
            'Content-Type': 'application/json'
        }
    });

    if (!response.ok) {
        throw new Error(`Failed to fetch project ${projectId}: ${response.statusText}`);
    }

    const data = await response.json();
    return data;
}

/**
 * Formaterer dato til MySQL datetime format
 */
function formatDateTime(dateString) {
    if (!dateString) return null;
    const date = new Date(dateString);
    return date.toISOString().slice(0, 19).replace('T', ' ');
}

/**
 * Opretter eller opdaterer subproject i databasen
 */
async function upsertSubproject(subprojectData, projectData) {
    const sp = subprojectData.data;
    const proj = projectData.data;

    const query = `
    INSERT INTO project_with_sp (
      project_name,
      project_id,
      mp_start_pp,
      mp_end_pp,
      subproject_name,
      subproject_id,
      sp_start_pp,
      sp_end_pp,
      sp_start_up,
      sp_end_up,
      sp_status,
      is_planning,
      wh_out,
      wh_in
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      project_name = VALUES(project_name),
      mp_start_pp = VALUES(mp_start_pp),
      mp_end_pp = VALUES(mp_end_pp),
      subproject_name = VALUES(subproject_name),
      sp_start_pp = VALUES(sp_start_pp),
      sp_end_pp = VALUES(sp_end_pp),
      sp_start_up = VALUES(sp_start_up),
      sp_end_up = VALUES(sp_end_up),
      sp_status = VALUES(sp_status),
      is_planning = VALUES(is_planning),
      wh_out = VALUES(wh_out),
      wh_in = VALUES(wh_in)
  `;

    const values = [
        proj.name || '',
        proj.id,
        formatDateTime(proj.planperiod_start),
        formatDateTime(proj.planperiod_end),
        sp.name || '',
        sp.id,
        formatDateTime(sp.planperiod_start),
        formatDateTime(sp.planperiod_end),
        formatDateTime(sp.usageperiod_start),
        formatDateTime(sp.usageperiod_end),
        sp.status || 0,
        sp.in_planning ? 1 : 0,
        sp.custom?.custom_11 || null,
        sp.custom?.custom_12 || null
    ];

    await pool.execute(query, values);
}

/**
 * Sletter subproject fra databasen
 */
async function deleteSubproject(subprojectId) {
    const query = 'DELETE FROM project_with_sp WHERE subproject_id = ?';
    await pool.execute(query, [subprojectId]);
}

/**
 * Håndterer webhook
 */
async function handleWebhook(webhookData) {
    try {
        const { eventType, itemType, items } = webhookData;

        // Verificer at det er et Subproject event
        if (itemType !== 'Subproject') {
            console.log(`Ignoring event for itemType: ${itemType}`);
            return;
        }

        for (const item of items) {
            const subprojectId = item.id;
            console.log(`Processing ${eventType} for subproject ${subprojectId}`);

            if (eventType === 'delete') {
                // Slet subproject fra database
                await deleteSubproject(subprojectId);
                console.log(`Deleted subproject ${subprojectId}`);

            } else if (eventType === 'create' || eventType === 'update') {
                // Hent subproject data fra API
                const subprojectData = await getSubproject(subprojectId);

                // Udtræk project ID fra subproject.project reference
                const projectRef = subprojectData.data.project;
                const projectId = projectRef.split('/').pop();

                // Hent project data fra API
                const projectData = await getProject(projectId);

                // Opret eller opdater i database
                await upsertSubproject(subprojectData, projectData);
                console.log(`${eventType === 'create' ? 'Created' : 'Updated'} subproject ${subprojectId}`);
            }
        }

    } catch (error) {
        console.error('Error handling webhook:', error);
        throw error;
    }
}

// Express server eksempel
const express = require('express');
const app = express();

app.use(express.json());

app.post('/webhook', async (req, res) => {
    try {
        console.log('Received webhook:', JSON.stringify(req.body, null, 2));
        await handleWebhook(req.body);
        res.status(200).json({ success: true });
    } catch (error) {
        console.error('Webhook processing failed:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Webhook server listening on port ${PORT}`);
});

// Eksport til test/direkte brug
module.exports = { handleWebhook };