require('dotenv').config();
const express = require('express');
const axios = require('axios');
const path = require('path');

const app = express();

app.use(express.json());

// Serve static HTML files from the /html folder
app.use(express.static(path.join(__dirname, '../html')));

// Base URL helper
function getBaseUrl() {
  return process.env.MPESA_ENV === 'production'
    ? 'https://api.safaricom.co.ke'
    : 'https://sandbox.safaricom.co.ke';
}

// Generate OAuth Token
async function getAccessToken() {
  const auth = Buffer.from(
    `${process.env.MPESA_CONSUMER_KEY}:${process.env.MPESA_CONSUMER_SECRET}`
  ).toString('base64');

  const response = await axios.get(
    `${getBaseUrl()}/oauth/v1/generate?grant_type=client_credentials`,
    { headers: { Authorization: `Basic ${auth}` } }
  );

  return response.data.access_token;
}

// STK Push API Endpoint
app.post('/api/stkpush', async (req, res) => {
  try {
    const { phone, amount } = req.body;

    if (!phone || !amount) {
      return res.status(400).json({ error: 'Phone and amount are required' });
    }

    // Format phone to 254XXXXXXXXX
    let formattedPhone = phone.toString().trim().replace(/[\s+]/g, '');
    if (formattedPhone.startsWith('0')) {
      formattedPhone = `254${formattedPhone.slice(1)}`;
    } else if (formattedPhone.startsWith('7') || formattedPhone.startsWith('1')) {
      formattedPhone = `254${formattedPhone}`;
    }

    const token = await getAccessToken();

    const timestamp = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14);
    const password = Buffer.from(
      `${process.env.MPESA_SHORTCODE}${process.env.MPESA_PASSKEY}${timestamp}`
    ).toString('base64');

    const payload = {
      BusinessShortCode: process.env.MPESA_SHORTCODE,
      Password: password,
      Timestamp: timestamp,
      TransactionType: 'CustomerPayBillOnline',
      Amount: Math.round(amount),
      PartyA: formattedPhone,
      PartyB: process.env.MPESA_SHORTCODE,
      PhoneNumber: formattedPhone,
      CallBackURL: process.env.MPESA_CALLBACK_URL,
      AccountReference: 'Payment',
      TransactionDesc: 'STK Push Payment'
    };

    const response = await axios.post(
      `${getBaseUrl()}/mpesa/stkpush/v1/processrequest`,
      payload,
      { headers: { Authorization: `Bearer ${token}` } }
    );

    return res.status(200).json(response.data);
  } catch (error) {
    const errorData = error.response ? error.response.data : error.message;
    console.error('M-Pesa API Error:', errorData);
    return res.status(500).json({ error: errorData });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running at http://localhost:${PORT}`));
