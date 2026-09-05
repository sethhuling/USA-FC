// Provider selection: real API when a key is configured, bundled demo data otherwise.
module.exports = process.env.API_FOOTBALL_KEY
  ? require('./apiFootball')
  : require('./demo');
