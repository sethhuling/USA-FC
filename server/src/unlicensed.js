// Master kill switch for every unlicensed data path (currently just the auto
// streaming lookup, which honors it unless/until it is backed by a properly
// licensed source; any future scraper must check it too). Individual adapters
// keep their own enable flags, but none of them may run unless
// ENABLE_UNLICENSED_SOURCES=1 as well — so one flag turns them all off, and
// off is the default.
//
// IMPORTANT: this MUST be off (unset or 0) in any public release. These
// sources are not licensed for redistribution; they exist only for private,
// personal experimentation.
function unlicensedAllowed() {
  return process.env.ENABLE_UNLICENSED_SOURCES === '1';
}

module.exports = { unlicensedAllowed };
