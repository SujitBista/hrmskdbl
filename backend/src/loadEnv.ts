import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

const dir = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(dir, "../.env") });
