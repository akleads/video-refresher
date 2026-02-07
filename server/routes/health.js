import { Router } from 'express';
import fs from 'node:fs';

export const healthRouter = Router();

healthRouter.get('/', (req, res) => {
  const dataDir = process.env.DATA_DIR || '/data';
  const volumeMounted = fs.existsSync(dataDir);

  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    volumeMounted,
    nodeVersion: process.version,
    uptime: Math.floor(process.uptime())
  });
});
