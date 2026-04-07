/**
 * Kør fuld sync af alle Rentman data til rentman_data databasen.
 *
 * Brug:
 *   node run-rentman-sync.js              # Sync alt
 *   node run-rentman-sync.js Project      # Sync kun én item type
 *   node run-rentman-sync.js Project 123  # Sync ét item by ID
 */

require('dotenv').config();

const { syncAll, syncItemType, syncItemById } = require('./sync/sync-rentman-db');
const rentmanDb = require('./lib/rentman-db');

async function main() {
    const [,, itemType, itemId] = process.argv;

    try {
        if (itemType && itemId) {
            console.log(`Synker ${itemType} id=${itemId}...`);
            const ok = await syncItemById(itemType, parseInt(itemId, 10));
            console.log(ok ? 'OK' : 'Ikke fundet');
        } else if (itemType) {
            console.log(`Synker alle ${itemType}...`);
            const result = await syncItemType(itemType);
            console.log(`Færdig: ${result.synced} synket, ${result.errors} fejl`);
        } else {
            console.log('Starter fuld Rentman DB sync...');
            const result = await syncAll();
            console.log(`\nFærdig: ${result.totalSynced} synket, ${result.totalErrors} fejl (${Math.round(result.duration / 1000)}s)`);
        }
    } catch (err) {
        console.error('Sync fejlede:', err.message);
        process.exitCode = 1;
    } finally {
        await rentmanDb.shutdown();
        process.exit();
    }
}

main();
