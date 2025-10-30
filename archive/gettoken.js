const express = require('express');
const axios = require('axios'); // For making HTTP requests
const app = express();
const port = 3000;
const dotenv = require('dotenv');

dotenv.config();

// Replace with your HubSpot app credentials
const CLIENT_ID = process.env.HUBSPOT_CLIENT_ID;
const CLIENT_SECRET = process.env.HUBSPOT_CLIENT_SECRET;
const REDIRECT_URI = process.env.HUBSPOT_REDIRECT_URI;

// Step 1: Redirect user to HubSpot for authorization
app.get('/install', (req, res) => {
  const scopes = 'oauth crm.objects.contacts.read'; // Adjust scopes as needed
  const authUrl = `https://app.hubspot.com/oauth/authorize?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&scope=${encodeURIComponent(scopes)}`;
  res.redirect(authUrl);
});

// Step 2: Handle the OAuth callback and exchange code for tokens
app.get('/oauth/callback', async (req, res) => {
  const { code } = req.query;
  if (!code) {
    return res.status(400).send('Authorization code not provided');
  }

  try {
    // Exchange code for access and refresh tokens
    const response = await axios.post('https://api.hubapi.com/oauth/v1/token', new URLSearchParams({
      grant_type: 'authorization_code',
      code: code,
      redirect_uri: REDIRECT_URI,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET
    }), {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    });

    const { access_token, refresh_token, expires_in } = response.data;
    
    // Store tokens securely (e.g., in a database or session). For demo, log them.
    console.log('Access Token:', access_token);
    console.log('Refresh Token:', refresh_token);
    console.log('Expires In:', expires_in, 'seconds');

    // Redirect to a success page or use the token for API calls
    res.send(`OAuth successful! Access token: ${access_token.substring(0, 50)}... (check console for full details)`);
  } catch (error) {
    console.error('Error exchanging code:', error.response?.data || error.message);
    res.status(500).send('Failed to exchange code for tokens');
  }
});

// Step 3: Refresh the access token (call this when access token expires)
app.post('/refresh-token', async (req, res) => {
  const refreshToken = req.body.refresh_token; // Pass refresh token in request body
  if (!refreshToken) {
    return res.status(400).send('Refresh token required');
  }

  try {
    const response = await axios.post('https://api.hubapi.com/oauth/v1/token', new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET
    }), {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    });

    const { access_token, expires_in } = response.data;
    console.log('New Access Token:', access_token);
    res.json({ access_token, expires_in });
  } catch (error) {
    console.error('Error refreshing token:', error.response?.data || error.message);
    res.status(500).send('Failed to refresh token');
  }
});

// Optional: Get token metadata
app.get('/token-metadata/:token', async (req, res) => {
  const token = req.params.token;
  try {
    const response = await axios.get(`https://api.hubapi.com/oauth/v1/access-tokens/${token}`);
    res.json(response.data);
  } catch (error) {
    res.status(500).send('Failed to retrieve token metadata');
  }
});

// Optional: Delete refresh token (e.g., on app uninstall)
app.delete('/delete-refresh-token/:token', async (req, res) => {
  const token = req.params.token;
  try {
    await axios.delete(`https://api.hubapi.com/oauth/v1/refresh-tokens/${token}`);
    res.send('Refresh token deleted');
  } catch (error) {
    res.status(500).send('Failed to delete refresh token');
  }
});

app.listen(port, () => {
  console.log(`App running at http://localhost:${port}`);
  console.log(`Go to http://localhost:${port}/install to start OAuth`);
});