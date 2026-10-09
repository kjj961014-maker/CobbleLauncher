# Launcher source and service research

Verified on 2026-10-09 (Asia/Seoul). ZIPs were inspected as archives without executing their contents. ZIP timestamps identify snapshots, not verified Git commits.

## Supplied archives

| Archive | Contents | License | Snapshot / version | Decision |
| --- | --- | --- | --- | --- |
| `MCP/MCP 1/EML-Lib-main.zip` | Minecraft launcher library source, no MCP transport/server | MIT | 127 entries, newest archive timestamp 2026-08-29; `eml-lib` 2.7.3 | API and installer reference |
| `MCP/MCP 2/EML-Template-main.zip` | Electron/Vite launcher template source, no MCP server | MIT | 77 entries, newest timestamp 2026-05-02; template 1.2.0, EML dependency `^2.3.5` | UI/IPC/packaging reference |
| `MCP/MCP 3/playwright-mcp-main.zip` | Actual browser-automation MCP source, stdio transport in `server.json` | Apache-2.0 | 51 entries, newest timestamp 2026-10-08; `@playwright/mcp` 0.0.83 | Optional development/testing tool |

The current tool inventory exposes no matching EML, Helios, or Playwright MCP tool. A scoped read of MCP table names in local Codex configuration likewise found no registration under these names; no environment values or credentials were read. Placing ZIPs in an `MCP` folder does not register a server. [Playwright MCP](https://github.com/microsoft/playwright-mcp) automates browsers and does not install or authenticate Minecraft.

Archive SHA-256 hashes:

- EML Lib: `68552617efe85091d3bfe3dcc26b743143ccd3a8ecc7d8dee2caee175ef38c0c`
- EML Template: `5b87f743d2fefeb7a081d132bf6ed9aeab9d20f7a5d1790911b05a93818fe648`
- Playwright MCP: `ac9717971ecd386e577c1656fde04b3368eb99920debd7a0cde6ddb20b653a73`

## Library choice and current maintenance

[EML Lib](https://github.com/Electron-Minecraft-Launcher/EML-Lib) includes Vanilla, Forge, NeoForge, Fabric, Quilt, Java download and integrity management. The inspected source explicitly supports NeoForge. Its Microsoft authentication defaults to an unrelated client ID and uses an embedded browser authorization-code flow without PKCE/state; do not reuse this default. Its cleaner can delete files absent from its manifest, so adopting it requires explicit preservation of user mods, saves and configuration. Use its MIT source as a reference and retain attribution for copied code. [EML Template](https://github.com/Electron-Minecraft-Launcher/EML-Template) already places launcher work in Electron main and bridges progress through IPC.

[HeliosLauncher](https://github.com/dscalzi/HeliosLauncher) is a complete Electron launcher with distribution manifests, validation and Microsoft authentication. Its [LICENSE.txt](https://github.com/dscalzi/HeliosLauncher/blob/master/LICENSE.txt) is MIT even though the current package metadata says `UNLICENSED`. Current upstream README does not explicitly promise NeoForge 1.21.1 compatibility; community forks are not proof of upstream support. Treat Helios as an architectural reference rather than the installation dependency.

GitHub API `pushed_at` observed: EML Lib 2026-10-08, EML Template 2026-06-28, HeliosLauncher 2026-05-04, Playwright MCP 2026-10-08. These are repository activity indicators, not release-quality guarantees.

Recommended runtime dependencies are `@xmcl/core` 2.16.2 and `@xmcl/installer` 6.3.5, both MIT. NPM publish dates: 2026-09-15 and 2026-10-03 respectively. The [old core repository](https://github.com/Voxelum/minecraft-launcher-core-node) was archived on 2026-05-06; current packages point to the active [XMCL monorepo](https://github.com/Voxelum/x-minecraft-launcher). They let the application own authentication, storage, cancellation, instance boundaries and content updates.

Important API change: installer 6.3.5 has manifest/workflow executors rather than older `installTask` / `installNeoForgedTask` APIs. Verified package declarations export `resolveNeoForgedInstallerFile`, `createModernForgeInstallWorkflow`, `executeInstallWorkflow`, `createDefaultNodeInstallRuntime` and `resolveVersionInstallManifest`. Core exports `launch` with explicit game/resource/Java paths and access token. Download through official Mojang/NeoForged URLs and enforce checksums; never enable shell spawning from user input. NeoForge's [version-specific 1.21.1 documentation](https://docs.neoforged.net/docs/1.21.1/gettingstarted/) requires 64-bit Java 21.

`@xmcl/unzip` 2.2.0 has a publishing defect: its `@xmcl/yauzl` dependency is `workspace:^*`, which npm rejects. The published `@xmcl/yauzl` 2.10.0 is also installer 6.3.5's direct dependency. A scoped npm override fixes this without changing APIs:

```json
{ "overrides": { "@xmcl/unzip": { "@xmcl/yauzl": "2.10.0" } } }
```

Verified in an isolated temporary package using npm lock-only installation with scripts disabled: success, 0 reported vulnerabilities. Pin versions and retain the generated lockfile.

Two additional pinned-package defects were found during integration: unzip 2.2.0 points `main/module/types` at unpublished root files despite containing `dist`, and installer 6.3.5 imports the omitted `@xmcl/core/utils` subpath for `isNotNull`. `scripts/fix-xmcl.cjs` reproducibly repairs the entry-point metadata and rebuilds that single helper from core 2.16.2's published source map. This workaround must be reviewed when either dependency is upgraded; preserve their MIT notices in packaged distributions.

## Microsoft authentication

Use the operator's own public-client Microsoft Entra app registration, support personal accounts, and register `http://localhost/callback` as a mobile/desktop loopback redirect. Open the system browser, use S256 PKCE, a cryptographic state value, a short-lived loopback listener, and no client secret. Microsoft explicitly recommends PKCE for desktop applications and prohibits relying on an embedded native-app secret. [Official authorization-code documentation](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow)

Exchange Microsoft access token → Xbox user token → XSTS token for the Minecraft relying party → Minecraft Services token. Verify Java entitlement and fetch the actual Minecraft profile before allowing launch. Store refresh/access tokens using the operating system's protected credential mechanism; return only profile/status to the renderer and redact credentials from logs. Authentication with Minecraft requires an authorized application ID, not merely a syntactically valid Entra client ID. Helios documents the Minecraft [app review form](https://aka.ms/mce-reviewappid) and [setup steps](https://github.com/dscalzi/HeliosLauncher/blob/master/docs/MicrosoftAuth.md). The form currently resolves to Microsoft Forms; the linked Minecraft help article returned unavailable during research, so approval timing and acceptance cannot be independently confirmed. Do not borrow another launcher's application ID. Operator registration/approval and a licensed user's interactive login are external completion requirements.

## CurseForge and mod distribution

Third-party services must apply for their own API key; requests use `x-api-key`. Resolve manifest project/file IDs with the official API and validate file hashes and loader/game compatibility. [Official CurseForge API](https://docs.curseforge.com/rest-api/)

Authors control third-party distribution using a project toggle; the API honors this toggle regardless of the selected license. When access/download URLs are unavailable, present the official project/file page for manual download and verify the user's selected file. Do not synthesize blocked CDN URLs or circumvent the setting. [Official distribution-toggle explanation](https://support.curseforge.com/support/solutions/articles/9000207877-project-distribution-toggle)

A modpack manifest normally references individual project/file IDs plus overrides; possession of that ZIP does not grant unrestricted rehosting of all referenced JARs. Rehosting/copying mods needs permission under each mod's license or explicit author authorization. A launcher updater needs operator hosting, signed manifests, hashes, version/loader constraints and a public verification key. [CurseForge content copyright/modpack moderation policy](https://support.curseforge.com/support/solutions/articles/9000197279-moderation-policies)

The supplied pack archive is a usable local source subject to its licenses. Production configuration still requires operator Microsoft client ID/approval, optional CurseForge API key, actual server endpoint and update-host/signing-key deployment. These service values must not be invented or borrowed from templates.
