const twilio = require('twilio');
const config = require('../config');

let client;
function getClient() {
  if (!client) client = twilio(config.twilio.accountSid, config.twilio.authToken);
  return client;
}

module.exports = { getClient };
