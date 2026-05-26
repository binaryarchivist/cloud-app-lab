import { Pool } from "pg";

const pool = new Pool({
  host: process.env.DB_HOST || "localhost",
  port: Number(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME || "myappdb",
  user: process.env.DB_USER || "myappuser",
  password: process.env.DB_PASSWORD || "dbpassword",
});

export default pool;
