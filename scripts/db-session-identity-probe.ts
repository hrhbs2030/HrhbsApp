import { pool } from "../lib/db/src/index";

try {
  await pool.query("SELECT 1");
  if (process.env.HBS_PROBE_SWITCH_URL) {
    // Hold the verified session so the next checkout must open a new one.
    const first = await pool.connect();
    try {
      pool.options.connectionString = process.env.HBS_PROBE_SWITCH_URL;
      try {
        await pool.query("SELECT 1");
        throw new Error("A redirected test session was accepted");
      } catch (error) {
        if (!(error instanceof Error) ||
            !error.message.includes("Refusing DB tests: test connection identity changed")) {
          throw error;
        }
      }
    } finally {
      first.release();
    }
  }
} finally {
  await pool.end();
}