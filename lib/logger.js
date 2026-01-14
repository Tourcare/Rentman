/**
 * Logger Module
 *
 * Centraliseret logging med Winston.
 * Integrerer med CloudWatch i produktion og database fejllogning.
 *
 * Transports:
 * - Console: Farvet output til terminal
 * - File: error.log og combined.log med rotation
 * - CloudWatch: Kun i produktion (LOG_GROUP: RentmanIntegration)
 * - SNS: Alerts ved kritiske fejl (kun i produktion)
 *
 * Child logger metoder:
 * - debug/info/warn/error: Standard logging
 * - apiCall/apiResponse/apiError: API kommunikation
 * - webhookReceived/webhookProcessed/webhookError: Webhook tracking
 * - syncOperation: Sync operationer
 * - dbQuery/dbError: Database operationer
 *
 * Alle error metoder logger automatisk til database via error-logger.
 */

const winston = require('winston');
const WinstonCloudWatch = require('winston-cloudwatch');
const Transport = require('winston-transport');
const { SNSClient, PublishCommand } = require('@aws-sdk/client-sns');
const config = require('../config');

// =============================================================================
// Custom SNS Transport - sender alerts ved kritiske fejl
// =============================================================================

class SnsAlertTransport extends Transport {
    constructor(opts) {
        super(opts);
        this.snsClient = opts.snsClient;
        this.topicArn = opts.topicArn;
        this.level = opts.level || 'error';
        this.serviceName = opts.serviceName || 'RentmanIntegration';
    }

    async log(info, callback) {
        setImmediate(() => this.emit('logged', info));

        if (!this.snsClient || !this.topicArn) {
            callback();
            return;
        }

        try {
            const message = this.formatMessage(info);
            await this.snsClient.send(new PublishCommand({
                TopicArn: this.topicArn,
                Subject: `[${info.level.toUpperCase()}] ${this.serviceName}`,
                Message: message
            }));
        } catch (err) {
            console.error('SNS alert fejl:', err.message);
        }

        callback();
    }

    formatMessage(info) {
        const parts = [
            `Tidspunkt: ${info.timestamp || new Date().toISOString()}`,
            `Level: ${info.level}`,
            `Besked: ${info.message}`
        ];

        if (info.error) {
            parts.push(`Fejl: ${info.error}`);
        }

        if (info.stack) {
            parts.push(`Stack trace:\n${info.stack}`);
        }

        if (info.context) {
            parts.push(`Kontekst: ${JSON.stringify(info.context, null, 2)}`);
        }

        return parts.join('\n\n');
    }
}

// =============================================================================
// Logger oprettelse
// =============================================================================

/**
 * Opretter Winston logger med alle transports.
 */
function createLogger() {
    const logFormat = winston.format.combine(
        winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        winston.format.errors({ stack: true }),
        winston.format.metadata({ fillExcept: ['message', 'level', 'timestamp'] })
    );

    const logger = winston.createLogger({
        level: config.logging.level,
        format: logFormat,
        defaultMeta: {
            service: 'RentmanIntegration',
            environment: config.env
        },
        transports: []
    });

    logger.add(new winston.transports.Console({
        format: winston.format.combine(
            winston.format.colorize(),
            winston.format.printf(({ level, message, timestamp, metadata }) => {
                let output = `${timestamp} [${level}]: ${message}`;
                if (metadata && Object.keys(metadata).length > 0) {
                    const meta = { ...metadata };
                    delete meta.service;
                    delete meta.environment;
                    if (Object.keys(meta).length > 0) {
                        output += ` ${JSON.stringify(meta)}`;
                    }
                }
                return output;
            })
        )
    }));

    logger.add(new winston.transports.File({
        filename: 'logs/error.log',
        level: 'error',
        maxsize: 5 * 1024 * 1024,
        maxFiles: 5,
        format: winston.format.combine(logFormat, winston.format.json())
    }));

    logger.add(new winston.transports.File({
        filename: 'logs/combined.log',
        maxsize: 5 * 1024 * 1024,
        maxFiles: 5,
        format: winston.format.combine(logFormat, winston.format.json())
    }));

    if (config.isProduction) {
        const cloudWatchConfig = {
            logGroupName: config.logging.cloudwatch.logGroupName,
            logStreamName: `${config.env}-${new Date().toISOString().split('T')[0]}-${process.pid}`,
            awsRegion: config.aws.region,
            jsonMessage: true,
            uploadRate: config.logging.cloudwatch.uploadRate,
            retentionInDays: 30,
            errorHandler: (err) => {
                console.error('CloudWatch logger fejl:', err.message);
            }
        };

        logger.add(new WinstonCloudWatch(cloudWatchConfig));

        if (config.aws.snsTopicArn) {
            const snsClient = new SNSClient({ region: config.aws.region });
            logger.add(new SnsAlertTransport({
                snsClient,
                topicArn: config.aws.snsTopicArn,
                level: 'error',
                serviceName: 'RentmanIntegration'
            }));
        }
    }

    return logger;
}

const logger = createLogger();

// =============================================================================
// Database error logging integration
// =============================================================================

let errorLogger = null;

/**
 * Lazy-loader for error-logger modulet.
 * Undgår cirkulær dependency ved at loade on-demand.
 */
function getErrorLogger() {
    if (!errorLogger) {
        try {
            errorLogger = require('./error-logger');
        } catch (err) {
            console.error('Could not load error-logger:', err.message);
        }
    }
    return errorLogger;
}

// =============================================================================
// Child Logger Factory
// =============================================================================

/**
 * Opretter en child logger med modul-specifik kontekst.
 * Alle log metoder inkluderer automatisk modul navn.
 *
 * @param {string} module - Modul navn (f.eks. 'hubspot-client', 'rentman-route')
 * @returns {Object} - Logger objekt med alle metoder
 */
function createChildLogger(module) {
    return {
        debug: (message, meta = {}) => logger.debug(message, { module, ...meta }),
        info: (message, meta = {}) => logger.info(message, { module, ...meta }),
        warn: (message, meta = {}) => logger.warn(message, { module, ...meta }),

        /**
         * Logger en fejl og gemmer automatisk til database.
         */
        error: (message, meta = {}) => {
            logger.error(message, { module, ...meta });

            // Automatisk database logging
            const errLog = getErrorLogger();
            if (errLog) {
                const errorObj = meta.error ? new Error(meta.error) : new Error(message);
                if (meta.stack) errorObj.stack = meta.stack;

                errLog.logError(errorObj, {
                    module,
                    sourceModule: module,
                    hubspotId: meta.hubspotId || meta.dealId || meta.companyId || meta.contactId,
                    rentmanId: meta.rentmanId || meta.projectId || meta.subprojectId,
                    extra: meta
                }).catch(() => {});
            }
        },

        /**
         * Logger et udgående API kald.
         */
        apiCall: (api, endpoint, method, meta = {}) => {
            logger.debug(`API kald: ${method} ${endpoint}`, { module, api, endpoint, method, ...meta });
        },

        /**
         * Logger et API svar med status og varighed.
         */
        apiResponse: (api, endpoint, status, duration, meta = {}) => {
            const level = status >= 400 ? 'warn' : 'debug';
            logger[level](`API svar: ${status} fra ${endpoint} (${duration}ms)`, {
                module, api, endpoint, status, duration, ...meta
            });
        },

        /**
         * Logger en API fejl og gemmer til database.
         */
        apiError: (api, endpoint, error, meta = {}) => {
            logger.error(`API fejl: ${endpoint}`, {
                module,
                api,
                endpoint,
                error: error.message,
                stack: error.stack,
                ...meta
            });

            const errLog = getErrorLogger();
            if (errLog) {
                errLog.logError(error, {
                    module,
                    sourceModule: module,
                    sourceSystem: api === 'hubspot' ? 'hubspot' : api === 'rentman' ? 'rentman' : 'internal',
                    endpoint,
                    method: meta.method,
                    responseStatus: meta.status,
                    hubspotId: meta.hubspotId,
                    rentmanId: meta.rentmanId,
                    extra: meta
                }).catch(() => {});
            }
        },

        /**
         * Logger modtagelse af en webhook.
         */
        webhookReceived: (source, eventType, meta = {}) => {
            logger.info(`Webhook modtaget: ${source} - ${eventType}`, { module, source, eventType, ...meta });

            const errLog = getErrorLogger();
            if (errLog && meta.logEvent !== false) {
                errLog.logWebhookEvent(source, {
                    eventType,
                    subscriptionType: meta.subscriptionType,
                    objectType: meta.objectType,
                    objectId: meta.objectId,
                    ...meta
                }, 'received').then(eventId => {
                    if (meta.setEventId) meta.setEventId(eventId);
                }).catch(() => {});
            }
        },

        /**
         * Logger færdigbehandling af en webhook med success/failure.
         */
        webhookProcessed: (source, eventType, success, duration, meta = {}) => {
            const level = success ? 'info' : 'error';
            logger[level](`Webhook behandlet: ${source} - ${eventType} (${success ? 'succes' : 'fejl'}, ${duration}ms)`, {
                module, source, eventType, success, duration, ...meta
            });

            if (!success) {
                const errLog = getErrorLogger();
                if (errLog) {
                    const error = meta.error || new Error(`Webhook processing failed: ${eventType}`);
                    errLog.logError(error, {
                        module,
                        sourceModule: module,
                        sourceSystem: 'webhook',
                        isWebhook: true,
                        webhookEventId: meta.webhookEventId,
                        extra: { source, eventType, duration, ...meta }
                    }).catch(() => {});
                }
            }
        },

        /**
         * Logger en webhook fejl og gemmer til database.
         */
        webhookError: (source, eventType, error, meta = {}) => {
            logger.error(`Webhook fejl: ${source} - ${eventType}`, {
                module, source, eventType, error: error.message, stack: error.stack, ...meta
            });

            const errLog = getErrorLogger();
            if (errLog) {
                errLog.logError(error, {
                    module,
                    sourceModule: module,
                    sourceSystem: 'webhook',
                    isWebhook: true,
                    webhookEventId: meta.webhookEventId,
                    extra: { source, eventType, ...meta }
                }).catch(() => {});
            }
        },

        /**
         * Logger en sync operation (create/update/delete).
         */
        syncOperation: (operation, entity, ids, success, meta = {}) => {
            const level = success ? 'info' : 'error';
            logger[level](`Sync ${operation}: ${entity}`, {
                module, operation, entity, ids, success, ...meta
            });

            if (!success) {
                const errLog = getErrorLogger();
                if (errLog) {
                    const error = meta.error || new Error(`Sync operation failed: ${operation} ${entity}`);
                    errLog.logError(error, {
                        module,
                        sourceModule: module,
                        isSync: true,
                        hubspotId: ids?.hubspotId,
                        rentmanId: ids?.rentmanId,
                        extra: { operation, entity, ...meta }
                    }).catch(() => {});
                }
            }
        },

        /**
         * Logger en database query med varighed.
         */
        dbQuery: (operation, table, duration, meta = {}) => {
            logger.debug(`Database ${operation}: ${table} (${duration}ms)`, { module, operation, table, duration, ...meta });
        },

        /**
         * Logger en database fejl og gemmer til database.
         */
        dbError: (operation, table, error, meta = {}) => {
            logger.error(`Database fejl: ${operation} ${table}`, {
                module, operation, table, error: error.message, stack: error.stack, ...meta
            });

            const errLog = getErrorLogger();
            if (errLog) {
                errLog.logError(error, {
                    module,
                    sourceModule: module,
                    sourceSystem: 'database',
                    isDatabase: true,
                    extra: { operation, table, ...meta }
                }).catch(() => {});
            }
        }
    };
}

module.exports = logger;
module.exports.createChildLogger = createChildLogger;
