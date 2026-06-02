// Each line below SHOULD be flagged: a sensitive VALUE reaches a log sink.
const accessToken = getToken();
console.log(accessToken);                         // bare arg
console.log(`auth=${accessToken}`);               // interpolation
logger.info(`key=${apiKey}`);                     // interpolation
console.error("dump", { password });              // object shorthand
log.debug(refreshToken);                          // bare arg, debug level
console.log("client_secret=" + clientSecret);     // concat var
