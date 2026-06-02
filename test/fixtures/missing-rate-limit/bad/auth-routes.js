const express = require("express");
const router = express.Router();

// Auth surface, no rate-limit middleware token anywhere in the file.
router.post("/login", async (req, res) => {
  const user = await authenticate(req.body);
  res.json({ user });
});

async function authenticate(_body) {
  return { id: 1 };
}

module.exports = router;
