import { checkCentralHealth } from "../server/central-health-diagnostics.mjs";

const result = await checkCentralHealth({ env: process.env });
console.info(JSON.stringify({ event: "central-health-check", ...result }));
if (result.errorType !== "health_ok") process.exitCode = 1;
