// Cluster-unsafe: a process-local limiter. Breaks the moment you run 2 pods.
const { RateLimiter } = require("limiter");

const limiter = new RateLimiter({ tokensPerInterval: 100, interval: "minute" });

module.exports = limiter;
