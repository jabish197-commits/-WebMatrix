import "dotenv/config";
import app from "./app.js";
import { connectDatabase } from "./config/database.js";

if (!process.env.JWT_SECRET) throw new Error("JWT_SECRET is required");
await connectDatabase();
const port = process.env.PORT || 5000;
app.listen(port, "0.0.0.0", () => console.log(`WebMatrix API running on port ${port}`));
