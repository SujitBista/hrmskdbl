import "./loadEnv.js";
import { assertDepreciationProductionEnv } from "./config/depreciationEnv.js";
import { createApp } from "./app.js";

assertDepreciationProductionEnv();

const app = createApp();
const port = Number(process.env.PORT ?? 4000);

app.listen(port, () => {
  console.log(`API listening on http://localhost:${port}`);
});
