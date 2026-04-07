/**
 * Kør fuld sync af alle Rentman data til rentman_data databasen.
 *
 * Brug:
 *   node run-rentman-sync.js                          # Sync alt
 *   node run-rentman-sync.js Project                  # Sync kun én item type
 *   node run-rentman-sync.js Project 123              # Sync ét item by ID
 *   node run-rentman-sync.js --from Equipment         # Fortsæt fra en bestemt type
 *   node run-rentman-sync.js --from children          # Spring top-level over, kør kun project children
 *   node run-rentman-sync.js --from children --from-project 360  # Fortsæt children fra projekt 360
 */

require('dotenv').config();

const { syncAll, syncItemType, syncItemById } = require('./sync/sync-rentman-db');
const rentmanDb = require('./lib/rentman-db');

function parseArgs(argv) {
    const args = argv.slice(2);
    const opts = {};
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--from' && args[i + 1]) {
            opts.from = args[++i];
        } else if (args[i] === '--from-project' && args[i + 1]) {
            opts.fromProject = parseInt(args[++i], 10);
        } else if (!opts.itemType) {
            opts.itemType = args[i];
        } else if (!opts.itemId) {
            opts.itemId = args[i];
        }
    }
    return opts;
}

async function main() {
    const opts = parseArgs(process.argv);

    try {
        if (opts.from) {
            console.log(`Fortsætter fuld sync fra ${opts.from}${opts.fromProject ? ` (projekt ${opts.fromProject})` : ''}...`);
            const result = await syncAll({ from: opts.from, fromProject: opts.fromProject });
            console.log(`\nFærdig: ${result.totalSynced} synket, ${result.totalErrors} fejl (${Math.round(result.duration / 1000)}s)`);
        } else if (opts.itemType && opts.itemId) {
            console.log(`Synker ${opts.itemType} id=${opts.itemId}...`);
            const ok = await syncItemById(opts.itemType, parseInt(opts.itemId, 10));
            console.log(ok ? 'OK' : 'Ikke fundet');
        } else if (opts.itemType) {
            console.log(`Synker alle ${opts.itemType}...`);
            const result = await syncItemType(opts.itemType);
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
