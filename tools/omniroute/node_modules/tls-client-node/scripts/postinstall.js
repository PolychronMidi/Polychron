const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");

const TLS_CLIENT_RELEASES =
    "https://api.github.com/repos/bogdanfinn/tls-client/releases";

function getReleaseConfig() {
    const platform = process.platform;
    const arch = process.arch;

    if (platform === "darwin" && arch === "arm64") {
        return {
            releaseBase: TLS_CLIENT_RELEASES,
            prefix: "tls-client-darwin-arm64-",
            suffix: ".dylib"
        };
    }
    if (platform === "darwin" && arch === "x64") {
        return {
            releaseBase: TLS_CLIENT_RELEASES,
            prefix: "tls-client-darwin-amd64-",
            suffix: ".dylib"
        };
    }
    if (platform === "linux" && arch === "x64") {
        return {
            releaseBase: TLS_CLIENT_RELEASES,
            prefix: "tls-client-linux-ubuntu-amd64-",
            suffix: ".so"
        };
    }
    if (platform === "linux" && arch === "arm64") {
        return {
            releaseBase: TLS_CLIENT_RELEASES,
            prefix: "tls-client-linux-arm64-",
            suffix: ".so"
        };
    }

    if (platform === "win32" && arch === "x64") {
        return {
            releaseBase: TLS_CLIENT_RELEASES,
            prefix: "tls-client-windows-64-",
            suffix: ".dll"
        };
    }
    if (platform === "win32" && arch === "ia32") {
        return {
            releaseBase: TLS_CLIENT_RELEASES,
            prefix: "tls-client-windows-32-",
            suffix: ".dll"
        };
    }

    throw new Error(`Unsupported platform for tls-client assets: ${platform}/${arch}`);
}

function normalizeVersion(version) {
    return version.replace(/^v/i, "");
}

async function fetchJson(url) {
    const response = await fetch(url, {
        headers: {
            Accept: "application/vnd.github+json",
            "User-Agent": "tls-client-node",
        },
    });

    if (!response.ok) {
        throw new Error(`GitHub API request failed: ${response.status} ${response.statusText}`);
    }

    return response.json();
}

async function download(url, destinationPath) {
    const response = await fetch(url, {
        headers: {
            "User-Agent": "tls-client-node",
        },
    });

    if (!response.ok) {
        throw new Error(`Download failed: ${response.status} ${response.statusText}`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    await fsp.writeFile(destinationPath, buffer);

    if (process.platform !== "win32") {
        await fsp.chmod(destinationPath, 0o755);
    }
}

async function main() {
    if (process.env.TLS_CLIENT_SKIP_DOWNLOAD === "1") {
        return;
    }

    const config = getReleaseConfig();
    const targetDir = path.join(__dirname, "..", "bin");
    await fsp.mkdir(targetDir, { recursive: true });

    const requestedVersion = process.env.TLS_CLIENT_VERSION || process.env.TLS_CLIENT_API_VERSION;
    const metadata = await fetchJson(
        requestedVersion
            ? `${config.releaseBase}/tags/v${normalizeVersion(requestedVersion)}`
            : `${config.releaseBase}/latest`
    );

    const version = normalizeVersion(metadata.tag_name || requestedVersion || "latest");
    const assetName = `${config.prefix}${version}${config.suffix}`;
    const destinationPath = path.join(targetDir, assetName);

    if (fs.existsSync(destinationPath)) {
        return;
    }

    const asset = metadata.assets.find((entry) => entry.name === assetName);
    if (!asset) {
        throw new Error(`No release asset found for ${assetName}`);
    }

    await download(asset.browser_download_url, destinationPath);
}

main().catch((error) => {
    console.warn(`[tls-client-node] postinstall skipped: ${error.message}`);
});
