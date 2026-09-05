const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
app.use(cors());
app.use(express.json());

// ---- Helpers -------------------------------------------------------------

function getBaseUrl() {
  return process.env.MPESA_ENV === 'production'
    ? 'https://api.safaricom.co.ke'
    : 'https://sandbox.safaricom.co.ke';
}

function requiredEnvPresent() {
  return [
    'MPESA_CONSUMER_KEY',
    'MPESA_CONSUMER_SECRET',
    'MPESA_SHORTCODE',
    'MPESA_PASSKEY',
    'MPESA_CALLBACK_URL'
  ].every((key) => !!process.env[key]);
}

// Normalizes any Kenyan phone format (07.., 01.., 254.., +254..) to 2547XXXXXXXX / 2541XXXXXXXX
function formatPhoneNumber(rawPhone) {
  const digits = String(rawPhone).trim().replace(/[\s+-]/g, '');
  let formatted = digits;

  if (formatted.startsWith('0')) {
    formatted = `254${formatted.slice(1)}`;
  } else if (formatted.startsWith('7') || formatted.startsWith('1')) {
    formatted = `254${formatted}`;
  }

  return formatted;
}

function isValidKenyanPhone(phone) {
  // 254 followed by 7 or 1, then 8 more digits = 12 digits total
  return /^254(7|1)\d{8}$/.test(phone);
}

let cachedToken = null;
let cachedTokenExpiry = 0;

async function getAccessToken() {
  const now = Date.now();
  if (cachedToken && now < cachedTokenExpiry) {
    return cachedToken;
  }

  const auth = Buffer.from(
    `${process.env.MPESA_CONSUMER_KEY}:${process.env.MPESA_CONSUMER_SECRET}`
  ).toString('base64');

  const response = await axios.get(
    `${getBaseUrl()}/oauth/v1/generate?grant_type=client_credentials`,
    { headers: { Authorization: `Basic ${auth}` }, timeout: 10000 }
  );

  cachedToken = response.data.access_token;
  // Safaricom tokens are valid for 3600s; refresh a minute early.
  cachedTokenExpiry = now + (Number(response.data.expires_in || 3599) - 60) * 1000;

  return cachedToken;
}

// ---- Routes ---------------------------------------------------------------

app.get('/api', (req, res) => {
  res.status(200).json({
    status: 'ok',
    message: 'Beltah PAY M-Pesa API is running',
    env: process.env.MPESA_ENV || 'sandbox',
    configured: requiredEnvPresent()
  });
});

app.post('/api/stkpush', async (req, res) => {
  try {
    if (!requiredEnvPresent()) {
      return res.status(500).json({
        error: 'Server is missing M-Pesa credentials. Check environment variables.'
      });
    }

    const { phone, amount } = req.body || {};

    if (!phone || !amount) {
      return res.status(400).json({ error: 'Phone and amount are required.' });
    }

    const formattedPhone = formatPhoneNumber(phone);

    if (!isValidKenyanPhone(formattedPhone)) {
      return res.status(400).json({
        error: 'Enter a valid Kenyan phone number, e.g. 0712345678.'
      });
    }

    const numericAmount = Math.round(Number(amount));
    if (!Number.isFinite(numericAmount) || numericAmount < 1) {
      return res.status(400).json({ error: 'Amount must be a whole number of at least 1.' });
    }

    const shortCode = process.env.MPESA_SHORTCODE;
    const passkey = process.env.MPESA_PASSKEY;
    const callbackUrl = process.env.MPESA_CALLBACK_URL;

    const token = await getAccessToken();

    const timestamp = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14);
    const password = Buffer.from(`${shortCode}${passkey}${timestamp}`).toString('base64');

    const payload = {
      BusinessShortCode: shortCode,
      Password: password,
      Timestamp: timestamp,
      TransactionType: 'CustomerPayBillOnline',
      Amount: numericAmount,
      PartyA: formattedPhone,
      PartyB: shortCode,
      PhoneNumber: formattedPhone,
      CallBackURL: callbackUrl,
      AccountReference: 'BeltahPay',
      TransactionDesc: 'STK Push Payment'
    };

    const response = await axios.post(
      `${getBaseUrl()}/mpesa/stkpush/v1/processrequest`,
      payload,
      { headers: { Authorization: `Bearer ${token}` }, timeout: 15000 }
    );

    return res.status(200).json(response.data);
  } catch (error) {
    const errorDetails = error.response ? error.response.data : { message: error.message };
    console.error('STK push error:', errorDetails);
    return res.status(502).json({ error: errorDetails });
  }
});

// Webhook callback endpoint Safaricom calls once the customer responds on their phone.
app.post('/api/stk-callback', (req, res) => {
  try {
    const callbackData = req.body?.Body?.stkCallback;

    if (!callbackData) {
      return res.status(400).json({ error: 'Invalid callback payload' });
    }

    if (callbackData.ResultCode === 0) {
      const items = callbackData.CallbackMetadata?.Item || [];
      const amount = items.find((i) => i.Name === 'Amount')?.Value;
      const receipt = items.find((i) => i.Name === 'MpesaReceiptNumber')?.Value;
      const phone = items.find((i) => i.Name === 'PhoneNumber')?.Value;

      console.log(`[SUCCESS] Received KES ${amount} from ${phone}. Receipt: ${receipt}`);
      // TODO: persist this to a database/order record.
    } else {
      console.log(`[FAILED] Code: ${callbackData.ResultCode} - ${callbackData.ResultDesc}`);
    }

    return res.status(200).json({ ResultCode: 0, ResultDesc: 'Accepted' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = app;
