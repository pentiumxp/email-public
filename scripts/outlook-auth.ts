import { MicrosoftGraphClient } from "../connectors/outlook-graph/microsoft-graph-client";
import { loadOutlookRuntimeConfig } from "../connectors/outlook-graph/outlook-config";

const command = process.argv[2] || "status";
const client = new MicrosoftGraphClient(loadOutlookRuntimeConfig());

if (command === "start") {
  const pending = await client.startDeviceLogin();
  console.log(JSON.stringify({
    verificationUri: pending.verification_uri,
    userCode: pending.user_code,
    expiresAt: pending.expires_at,
    message: pending.message
  }, null, 2));
} else if (command === "finish") {
  const status = await client.finishDeviceLogin();
  console.log(JSON.stringify(status, null, 2));
} else if (command === "status") {
  console.log(JSON.stringify(client.authStatus(), null, 2));
} else if (command === "clear") {
  client.clearAuth();
  console.log(JSON.stringify({ cleared: true }, null, 2));
} else {
  throw new Error(`Unknown command: ${command}`);
}

