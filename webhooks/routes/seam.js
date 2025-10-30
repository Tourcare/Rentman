const express = require("express");
const { text } = require('body-parser');
const dotenv = require('dotenv');

dotenv.config();

const pool = require('../../db');

const router = express.Router();
router.use(express.json());

router.post("/", async (req, res) => {
    const events = req.body;
    console.log(events)
    res.status(200).send("OK");
});


module.exports = router