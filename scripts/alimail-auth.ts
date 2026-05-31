import { AliMailImapClient } from "../connectors/alimail/alimail-imap-client";
import { ensureAliMailConfigFiles, loadAliMailRuntimeConfig } from "../connectors/alimail/alimail-config";

const command = process.argv[2] || "status";
if (command !== "status") {
  throw new Error(`Unknown command: ${command}`);
}

const files = ensureAliMailConfigFiles();
const config = loadAliMailRuntimeConfig();
const diagnostic = await new AliMailImapClient(config).authDiagnostic();
console.log(JSON.stringify({ ...diagnostic, configFile: files.configFile, credentialsFile: files.credentialsFile, createdConfig: files.createdConfig, createdCredentialsTemplate: files.createdCredentialsTemplate }, null, 2));
