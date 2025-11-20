// logger.js
const winston = require('winston');
const WinstonCloudWatch = require('winston-cloudwatch');
const Transport = require('winston-transport');

// AWS SDK v3
const { SNSClient, PublishCommand } = require("@aws-sdk/client-sns");

// SNS Client
const snsClient = new SNSClient({
    region: process.env.AWS_REGION || 'eu-central-1'
});

// Custom SNS transport
class SnsTransport extends Transport {
    constructor(opts) {
        super(opts);
        this.snsClient = opts.snsClient;
        this.topicArn = opts.topicArn;
        this.level = opts.level || 'error';
    }

    log(info, callback) {
        setImmediate(() => this.emit('logged', info));

        if (!this.snsClient || !this.topicArn) return callback();

        const params = {
            TopicArn: this.topicArn,
            Message: JSON.stringify(info)
        };

        this.snsClient.send(new PublishCommand(params))
            .catch(err => console.error('SNS Publish Error:', err));

        callback();
    }
}

// CloudWatch konfiguration
const logConfig = {
    logGroupName: 'RentmanIntegrationWatch',
    logStreamName: `${process.env.NODE_ENV || 'development'}-${new Date().toISOString().split('T')[0]}`,
    awsRegion: process.env.AWS_REGION || 'eu-central-1',
    jsonMessage: true,
    uploadRate: 10000,
    errorHandler: (err) => {
        console.error('CloudWatch Logger Error:', err);
    }
};

// Opret logger
const logger = winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.errors({ stack: true }),
        winston.format.json()
    ),
    defaultMeta: {
        service: 'RentmanIntegrationWatch',
        environment: process.env.NODE_ENV
    },
    transports: []
});

// CloudWatch transport (kun i production)
if (process.env.NODE_ENV === 'production') {
    logger.add(new WinstonCloudWatch(logConfig));
}

// Console transport (altid)
logger.add(new winston.transports.Console({
    format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
    )
}));

// File transports
logger.add(new winston.transports.File({
    filename: 'logs/error.log',
    level: 'error',
    maxsize: 5242880,
    maxFiles: 5
}));

logger.add(new winston.transports.File({
    filename: 'logs/combined.log',
    maxsize: 5242880,
    maxFiles: 5
}));

// SNS transport (kun i production og hvis SNS_TOPIC_ARN er sat)
if (process.env.NODE_ENV === 'production' && process.env.SNS_TOPIC_ARN) {
    logger.add(new SnsTransport({
        snsClient,
        topicArn: process.env.SNS_TOPIC_ARN,
        level: 'error'
    }));
}

module.exports = logger;
