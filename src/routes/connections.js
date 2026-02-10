const express = require('express');
const connections = require('../services/connections');

const router = express.Router();

router.get('/', (req, res) => {
  res.json(connections.list());
});

router.post('/:platform/enable', async (req, res) => {
  const { platform } = req.params;
  const config = req.body || {};
  try {
    await connections.enable(platform, config);
    res.json({ enabled: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:platform/disable', async (req, res) => {
  const { platform } = req.params;
  try {
    await connections.disable(platform);
    res.json({ disabled: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:platform', async (req, res) => {
  const { platform } = req.params;
  try {
    await connections.remove(platform);
    res.json({ removed: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
