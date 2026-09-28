const mongoose = require('mongoose');
const app = require('../server');

// Cache the connection promise across warm invocations
let connPromise = null;

module.exports = async (req, res) => {
  if (!connPromise) {
    connPromise = mongoose.connect(process.env.MONGO_URI);
  }
  await connPromise;
  return app(req, res);
};
