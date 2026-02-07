import { Router } from 'express';
import { checkPassword, generateToken } from '../lib/token.js';

export const authRouter = Router();

authRouter.post('/', (req, res) => {
  const { password } = req.body;
  if (!password) {
    return res.status(400).json({ error: 'Password required' });
  }
  if (!checkPassword(password)) {
    return res.status(401).json({ error: 'Invalid password' });
  }
  const token = generateToken();
  res.json({ token });
});
