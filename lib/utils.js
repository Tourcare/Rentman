function sanitizeNumber(value, decimals = 2) {
    if (value === null || value === undefined) return 0;

    const EPSILON = 1e-6;
    const num = Number(value);

    if (isNaN(num)) return 0;
    if (Math.abs(num) < EPSILON) return 0;

    return Number(num.toFixed(decimals));
}

function sanitizeEmail(email) {
    if (!email) return '';

    let cleaned = email.trim().replace(/\s+/g, '');

    if (!cleaned.includes('@')) return cleaned;

    const [localPart, domainPart] = cleaned.split('@');

    if (!domainPart) return cleaned;

    if (!/\.[a-zA-Z]{2,}$/.test(domainPart)) {
        cleaned = `${localPart}@${domainPart}.dk`;
    }

    return cleaned;
}

function previousWeekday(date) {
    const d = new Date(date);
    do {
        d.setDate(d.getDate() - 1);
    } while (d.getDay() === 0 || d.getDay() === 6);

    d.setHours(13, 0, 0, 0);
    return d;
}

function nextWeekday(date) {
    const d = new Date(date);
    do {
        d.setDate(d.getDate() + 1);
    } while (d.getDay() === 0 || d.getDay() === 6);

    d.setHours(11, 0, 0, 0);
    return d;
}

function formatDateTime(dateString) {
    if (!dateString) return null;
    const date = new Date(dateString);
    return date.toISOString().slice(0, 19).replace('T', ' ');
}

function formatContactName(firstnameOrFullName, middleName, lastname) {
    if (arguments.length === 1 && typeof firstnameOrFullName === 'string') {
        const parts = firstnameOrFullName.trim().split(/\s+/);
        if (parts.length === 0) {
            return { firstname: '', lastname: '' };
        }
        if (parts.length === 1) {
            return { firstname: parts[0], lastname: '' };
        }
        return {
            firstname: parts[0],
            lastname: parts.slice(1).join(' ')
        };
    }

    const parts = [];

    if (firstnameOrFullName) parts.push(firstnameOrFullName);
    if (middleName) parts.push(middleName);
    if (lastname) parts.push(lastname);

    return parts.join(' ').trim();
}

async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function retry(operation, options = {}) {
    const {
        maxAttempts = 3,
        delayMs = 3000,
        backoffMultiplier = 1,
        shouldRetry = () => true,
        onRetry = () => { }
    } = options;

    let lastError;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            const result = await operation();

            if (result !== null && result !== undefined) {
                return result;
            }

            if (attempt === maxAttempts) {
                return null;
            }
        } catch (error) {
            lastError = error;

            if (!shouldRetry(error, attempt)) {
                throw error;
            }

            if (attempt === maxAttempts) {
                throw error;
            }
        }

        onRetry(attempt, lastError);
        const delay = delayMs * Math.pow(backoffMultiplier, attempt - 1);
        await sleep(delay);
    }

    return null;
}

function randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomDelay(minMs = 500, maxMs = 2000) {
    return randomInt(minMs, maxMs);
}

async function randomSleep(minMs = 500, maxMs = 2000) {
    const delay = randomDelay(minMs, maxMs);
    return sleep(delay);
}

function extractIdFromRef(ref) {
    if (!ref) return null;
    const parts = ref.split('/');
    const id = parts[parts.length - 1];
    return parseInt(id, 10) || null;
}

function buildRef(type, id) {
    return `/${type}/${id}`;
}

function isValidAssociation(results, type) {
    if (!results || !Array.isArray(results)) return false;
    return results.some(r => r.type === type);
}

function findAssociationId(results, type) {
    if (!results || !Array.isArray(results)) return null;
    const association = results.find(r => r.type === type);
    return association?.id || null;
}

function deduplicate(array, keyFn = (item) => item) {
    const seen = new Set();
    return array.filter(item => {
        const key = keyFn(item);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

function filterDuplicateWebhookEvents(events) {
    if (!events || events.length === 0) return [];

    const first = events[0];

    if (first.changeSource === 'AUTO_ASSOCIATE_BY_DOMAIN') {
        return [];
    }

    if (first.subscriptionType === 'object.associationChange') {
        const objectId1 = first.fromObjectId;
        const objectId2 = first.toObjectId;
        const ids = [objectId1, objectId2];

        const allMatch = events.every(event =>
            ids.includes(event.fromObjectId) && ids.includes(event.toObjectId)
        );

        return allMatch ? [first] : events;
    }

    const firstObjectId = first.objectId;
    const allSameObjectId = events.every(e => e.objectId === firstObjectId);

    if (!allSameObjectId) {
        return events;
    }

    if (first.propertyName) {
        const firstPropertyName = first.propertyName;
        const allSameProperty = events.every(e => e.propertyName === firstPropertyName);

        if (allSameProperty) {
            const changeEvent = events.find(e => e.subscriptionType === 'object.propertyChange');
            return changeEvent ? [changeEvent] : events;
        }
    }

    const creationEvent = events.find(e => e.subscriptionType === 'object.creation');
    return creationEvent ? [creationEvent] : events;
}

function isIgnoredWebhookSource(source) {
    const ignoredSources = ['INTEGRATION', 'API', 'AUTO_ASSOCIATE_BY_DOMAIN'];
    return ignoredSources.includes(source);
}

function parseError(error) {
    if (!error) return { message: 'Unknown error', code: null };

    if (typeof error === 'string') {
        return { message: error, code: null };
    }

    return {
        message: error.message || String(error),
        code: error.code || error.status || null,
        stack: error.stack || null
    };
}

module.exports = {
    sanitizeNumber,
    sanitizeEmail,

    previousWeekday,
    nextWeekday,
    formatDateTime,
    formatContactName,

    sleep,
    retry,
    randomInt,
    randomDelay,
    randomSleep,

    extractIdFromRef,
    buildRef,

    isValidAssociation,
    findAssociationId,

    deduplicate,
    filterDuplicateWebhookEvents,
    isIgnoredWebhookSource,

    parseError
};
