const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(express.static(path.join(__dirname, '..')));

app.listen(PORT, '0.0.0.0', () => {
  console.log(`INYATHI serving on port ${PORT}`);
});
