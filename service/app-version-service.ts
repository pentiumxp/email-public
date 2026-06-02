import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

export interface AppVersionInfo {
  version: string;
  checkedAt: string;
}

export class AppVersionService {
  constructor(private readonly staticRoot: string, private readonly now = () => new Date()) {}

  current(): AppVersionInfo {
    return {
      version: process.env.EMAIL_PLUGIN_BUILD_VERSION || versionFromStaticRoot(this.staticRoot),
      checkedAt: this.now().toISOString()
    };
  }
}

function versionFromStaticRoot(staticRoot: string): string {
  try {
    const indexFile = join(staticRoot, "index.html");
    const index = readFileSync(indexFile, "utf8");
    const assets = Array.from(index.matchAll(/assets\/([^"']+)/g)).map((match) => match[1]).sort();
    const stats = assets.map((asset) => {
      const path = join(staticRoot, "assets", asset);
      const stat = statSync(path);
      return `${asset}:${stat.size}:${Math.floor(stat.mtimeMs)}`;
    });
    if (stats.length > 0) {
      return stableHash(stats.join("|"));
    }
    return stableHash(index);
  } catch {
    try {
      return stableHash(readdirSync(staticRoot).sort().join("|"));
    } catch {
      return "development";
    }
  }
}

function stableHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `v-${(hash >>> 0).toString(16)}`;
}
