import { GmailApiClient } from "../connectors/gmail/gmail-api-client";
import { ensureGmailConfigFiles, loadGmailRuntimeConfig } from "../connectors/gmail/gmail-config";

ensureGmailConfigFiles();
const config = loadGmailRuntimeConfig();
const client = new GmailApiClient(config);
const command = process.argv[2] || "status";

if (command === "start") {
  try {
    const pending = await client.startDeviceLogin(process.env.EMAIL_GMAIL_OPEN_BROWSER !== "false");
    console.log(JSON.stringify({
      mode: "device",
      verificationUrl: pending.verification_url,
      userCode: pending.user_code,
      expiresAt: pending.expires_at,
      interval: pending.interval,
      configFile: config.configFile
    }, null, 2));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes("invalid_client")) {
      throw error;
    }
    const status = await client.runBrowserLogin(Number(process.env.EMAIL_GMAIL_BROWSER_AUTH_PORT || 53682));
    console.log(JSON.stringify({ mode: "browser", ...status, configFile: config.configFile }, null, 2));
  }
} else if (command === "browser") {
  const status = await client.runBrowserLogin(Number(process.env.EMAIL_GMAIL_BROWSER_AUTH_PORT || 53682));
  console.log(JSON.stringify({ mode: "browser", ...status, configFile: config.configFile }, null, 2));
} else if (command === "finish") {
  const status = await client.finishDeviceLogin();
  console.log(JSON.stringify(status, null, 2));
} else if (command === "clear") {
  client.clearAuth();
  console.log(JSON.stringify({ connected: false, cleared: true }, null, 2));
} else {
  console.log(JSON.stringify({ ...client.authStatus(), configFile: config.configFile }, null, 2));
}
