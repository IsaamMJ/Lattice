// None of these should be flagged.
console.log("token refresh failed: " + e.message);   // word-in-message, value is e
console.log(`FCM permission: ${settings.authorizationStatus}`); // authorizationStatus != a secret
if (__DEV__) console.log(`token=${accessToken}`);    // dev-guarded
const tokenLabel = "Access Token";                    // not a log sink
console.log("user logged in");                        // benign
// console.log(apiKey)                                 // commented out
