import { getStats } from '../models/dashboard.model.js';

export async function stats(req, res) {
  res.json(await getStats());
}
