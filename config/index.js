/**
 * Centraliseret konfiguration for HubSpot-Rentman integrationen.
 *
 * Alle værdier hentes fra miljøvariabler (.env fil eller system environment).
 * Se .env.example for en komplet liste af påkrævede variabler.
 */

const dotenv = require('dotenv');

dotenv.config();

const config = {
    // ==========================================================================
    // Generelle indstillinger
    // ==========================================================================
    env: process.env.NODE_ENV || 'development',
    isProduction: process.env.NODE_ENV === 'production',

    // ==========================================================================
    // Server konfiguration
    // ==========================================================================
    server: {
        port: parseInt(process.env.PORT, 10) || 8080,
        secret: process.env.SECRET  // Bruges til session encryption
    },

    // ==========================================================================
    // Database konfiguration
    // ==========================================================================
    database: {
        // Hovedatabase til sync tracking (synced_companies, synced_deals, etc.)
        main: {
            host: process.env.DB_HOST,
            user: process.env.DB_USER,
            password: process.env.DB_PASSWORD,
            database: process.env.DB_NAME,
            waitForConnections: true,
            connectionLimit: 10,
            queueLimit: 0
        },
        // Dashboard database til planlægningsoversigt (project_with_sp tabel)
        dashboard: {
            host: process.env.DB_HOST,
            user: process.env.DB_USER,
            password: process.env.DB_PASSWORD,
            database: process.env.DASH_DB_NAME,
            waitForConnections: true,
            connectionLimit: 5,
            queueLimit: 0
        }
    },

    // ==========================================================================
    // HubSpot API konfiguration
    // ==========================================================================
    hubspot: {
        token: process.env.HUBSPOT_API_TOKEN,
        baseUrl: 'https://api.hubapi.com',
        endpoints: {
            v3: 'https://api.hubapi.com/crm/v3/objects',
            v4: 'https://api.hubapi.com/crm/v4/objects',
            files: 'https://api.hubapi.com/files/v3/files'
        },
        // HubSpot object type IDs brugt til webhook filtrering
        objectTypes: {
            contacts: '0-1',
            companies: '0-2',
            deals: '0-3',
            orders: '0-123'  // Custom object
        },
        // Association type IDs til at linke objekter sammen
        // Se: https://developers.hubspot.com/docs/api/crm/associations
        associationTypes: {
            dealToCompany: 5,
            dealToContact: 3,
            orderToCompany: 509,
            orderToContact: 507,
            orderToDeal: 512,
            contactToCompany: 1,
            noteToDeal: 214,
            lineItemToDeal: 20  // Tilføjet til line items sync
        },
        pipelines: {
            deals: 'default',  // Brug 'default' eller indsæt specifik pipeline ID
            orders: '14a2e10e-5471-408a-906e-c51f3b04369e'
        },
        folders: {
            quotations: '308627103977'  // Folder ID til uploaded tilbud
        }
    },

    // ==========================================================================
    // Rentman API konfiguration
    // ==========================================================================
    rentman: {
        token: process.env.RENTMAN_ACCESS_TOKEN,
        baseUrl: 'https://api.rentman.net',
        // Bruger ID for integrationen - webhooks fra denne bruger ignoreres
        // for at undgå uendelige loops
        integrationUserId: 235,
        appUrl: 'https://tourcare2.rentmanapp.com'
    },

    // ==========================================================================
    // AWS konfiguration (CloudWatch logging og SNS alerts)
    // ==========================================================================
    aws: {
        region: process.env.AWS_REGION || 'eu-central-1',
        snsTopicArn: process.env.SNS_TOPIC_ARN  // Til fejl-notifikationer
    },

    // ==========================================================================
    // Logging konfiguration
    // ==========================================================================
    logging: {
        level: process.env.LOG_LEVEL || 'info',
        cloudwatch: {
            logGroupName: 'RentmanIntegration',
            uploadRate: 10000  // ms mellem uploads til CloudWatch
        }
    },

    // ==========================================================================
    // Retry konfiguration for API kald
    // ==========================================================================
    retry: {
        maxAttempts: 5,
        baseDelayMs: 5000,   // Start delay (fordobles ved hver retry)
        maxDelayMs: 80000    // Max delay mellem retries
    },

    // ==========================================================================
    // Feature flags - slå funktioner til/fra uden code deploy
    // ==========================================================================
    features: {
        /**
         * Line Items Sync
         * Synkroniserer Rentman projekt-finanser til HubSpot line items på deals.
         *
         * Miljøvariabler:
         * - FEATURE_LINE_ITEMS=true           Aktivér funktionen
         * - FEATURE_LINE_ITEMS_WEBHOOK=true   Auto-sync ved webhooks
         * - FEATURE_LINE_ITEMS_EQUIPMENT=true Inkluder udstyr
         * - FEATURE_LINE_ITEMS_COSTS=true     Inkluder omkostninger
         * - FEATURE_LINE_ITEMS_CREW=true      Inkluder personale
         * - FEATURE_LINE_ITEMS_TRANSPORT=true Inkluder transport
         * - FEATURE_LINE_ITEMS_DELETE_EXISTING=true  Slet gamle før sync
         */
        lineItems: {
            enabled: process.env.FEATURE_LINE_ITEMS === 'true',
            syncOnWebhook: process.env.FEATURE_LINE_ITEMS_WEBHOOK === 'true',
            includeEquipment: process.env.FEATURE_LINE_ITEMS_EQUIPMENT !== 'false',
            includeCosts: process.env.FEATURE_LINE_ITEMS_COSTS !== 'false',
            includeCrew: process.env.FEATURE_LINE_ITEMS_CREW !== 'false',
            includeTransport: process.env.FEATURE_LINE_ITEMS_TRANSPORT !== 'false',
            deleteExisting: process.env.FEATURE_LINE_ITEMS_DELETE_EXISTING !== 'false'
        }
    },

    // ==========================================================================
    // Brugere til web login (JSON array fra miljøvariabel)
    // Format: [{"username": "admin", "password": "secret"}]
    // ==========================================================================
    users: parseUsers(process.env.USERS)
};

function parseUsers(usersJson) {
    try {
        return JSON.parse(usersJson || '[]');
    } catch (err) {
        console.error('Kunne ikke parse USERS fra miljovariabel:', err.message);
        return [];
    }
}

function validateConfig() {
    const required = [
        ['hubspot.token', config.hubspot.token],
        ['rentman.token', config.rentman.token],
        ['database.main.host', config.database.main.host],
        ['database.main.user', config.database.main.user],
        ['database.main.database', config.database.main.database],
        ['server.secret', config.server.secret]
    ];

    const missing = required.filter(([name, value]) => !value);

    if (missing.length > 0) {
        const names = missing.map(([name]) => name).join(', ');
        console.warn(`Advarsel: Manglende konfiguration: ${names}`);
    }

    return missing.length === 0;
}

config.validate = validateConfig;

module.exports = config;
