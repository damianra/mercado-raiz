import { getStats } from '../models/dashboard.model.js';

export function stats(req, res) {
  res.json(getStats());
}
