const express = require("express");
const { text } = require('body-parser');

const pool = require('./db')

const app = express();
app.use(express.json());

const hubspotRouter = require('./webhooks/routes/hubspot')
const seamRouter = require('./webhooks/routes/seam')
const rentmanRouter = require('./webhooks/routes/rentman')

app.use('/hubspot', hubspotRouter)
app.use('/seam', seamRouter)
app.use('/rentman', rentmanRouter)

app.listen(8080, () => console.log("Webhook API kører på port 8080"));