require('dotenv').config();
const path = require('path');
const app = require('./index');

// Serve the modern frontend from /public
app.use(require('express').static(path.join(__dirname, '../public')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Beltah PAY running at http://localhost:${PORT}`);
});
