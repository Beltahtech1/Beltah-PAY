const express = require('express');
const axios = require('axios');

const app = express();
app.use(express.json());

// Helper function to generate access token
async function getAccessToken() {
  const consumerKey = process.env.MPESA_CONSUMER_KEY;
  const consumerSecret = process.env.MPESA_CONSUMER_SECRET;
  const auth = Buffer.from(`${consumerKey}:${consumerSecret}`).toString('base64');

  const response = await axios.get(
    'https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials',
    { headers: { Authorization: `Basic ${auth}` } }
  );
  return response.data.access_token;
}

// Health check endpoint
app.get('/api', (req, res) => {
  res.status(200).json({ status: 'M-Pesa API is running' });
});

// STK Push Initiation Endpoint
app.post('/api/stkpush', async (req, res) => {
  try {
    const { phone, amount } = req.body;

    if (!phone || !amount) {
      return res.status(400).json({ error: 'Phone and amount are required' });
    }

    const shortCode = process.env.MPESA_SHORTCODE;
    const passkey = process.env.MPESA_PASSKEY;
    const callbackUrl = process.env.MPESA_CALLBACK_URL;

    const token = await getAccessToken();
    
    // Format timestamp (YYYYMMDDHHmmss)
    const timestamp = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14);
    const password = Buffer.from(`${shortCode}${passkey}${timestamp}`).toString('base64');

    // Format phone: strip + or leading 0 to 254XXXXXXXXX
    let formattedPhone = phone.replace(/\+/g, '');
    if (formattedPhone.startsWith('0')) {
      formattedPhone = `254${formattedPhone.slice(1)}`;
    }

    const payload = {
      BusinessShortCode: shortCode,
      Password: password,
      Timestamp: timestamp,
      TransactionType: 'CustomerPayBillOnline', // Change to CustomerBuyGoodsOnline for Till Numbers
      Amount: amount,
      PartyA: formattedPhone,
      PartyB: shortCode,
      PhoneNumber: formattedPhone,
      CallBackURL: callbackUrl,
      AccountReference: 'Payment',
      TransactionDesc: 'STK Push Payment'
    };

    const response = await axios.post(
      'https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest',
      payload,
      { headers: { Authorization: `Bearer ${token}` } }
    );

    return res.status(200).json(response.data);
  } catch (error) {
    const errorDetails = error.response ? error.response.data : error.message;
    return res.status(500).json({ error: errorDetails });
  }
});

// Webhook Callback Endpoint for Safaricom verification
app.post('/api/stk-callback', (req, res) => {
  try {
    const callbackData = req.body?.Body?.stkCallback;

    if (!callbackData) {
      return res.status(400).json({ error: 'Invalid callback payload' });
    }

    if (callbackData.ResultCode === 0) {
      const items = callbackData.CallbackMetadata.Item;
      const amount = items.find(i => i.Name === 'Amount')?.Value;
      const receipt = items.find(i => i.Name === 'MpesaReceiptNumber')?.Value;
      const phone = items.find(i => i.Name === 'PhoneNumber')?.Value;

      console.log(`[SUCCESS] Received KES ${amount} from ${phone}. Receipt: ${receipt}`);
      // TODO: Update database record here
    } else {
      console.log(`[FAILED] Code: ${callbackData.ResultCode} - ${callbackData.ResultDesc}`);
    }

    return res.status(200).json({ ResultCode: 0, ResultDesc: 'Accepted' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = app;
