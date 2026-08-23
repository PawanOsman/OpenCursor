# Pair a phone with Build Remote Agent

OpenCursor can use **Build Remote Agent** as a pairing device: the paid
iOS/Android app spectates (and can inject into) this desktop agent through the
free MIT `gbr-agent`. Phone and PC never open ports to each other.

Website: https://grokbuildremote.com/
Agent: https://github.com/LinespottingOrg/GrokBuildRemote-Agents (MIT)
Protocol: `gbr/1` · need agent **v0.6.0+**

Independent product by Linespotting AB. Not affiliated with xAI or SpaceX.

OpenCursor's MCP client currently implements **stdio** only. Use stdio
`gbr-mcp` below. HTTP `127.0.0.1:8788` is for `curl` / other Bot API clients
on the same machine, not for OpenCursor's SSE transport.

## Install + pair

```bash
# macOS / Linux
curl -fsSL https://grokbuildremote.com/install.sh | bash
gbr-agent version          # must print v0.6.0 or newer
gbr-agent pair             # QR in browser + printed 8-char code
gbr-agent run              # leave running
```

```powershell
# Windows
irm https://grokbuildremote.com/install.ps1 | iex
gbr-agent version
gbr-agent pair
gbr-agent run
```

Phone: open Build Remote Agent → **Scan QR from computer** (or type the 8-char
code). Sessions appear in the app. **Unpair** in Settings before changing PCs.
Force-close is not enough.

## MCP (stdio)

In the OpenCursor MCP panel, add a **stdio** server:

- Name: `gbr`
- Command: `node`
- Args: `GrokBuildRemote-Agents/mcp/gbr-mcp/bin/gbr-mcp.js` (absolute path to
  your clone)

```bash
git clone https://github.com/LinespottingOrg/GrokBuildRemote-Agents.git
cd GrokBuildRemote-Agents/mcp/gbr-mcp && npm install
node bin/gbr-mcp.js --diagnose
```

```json
{
  "mcpServers": {
    "gbr": {
      "command": "node",
      "args": [
        "GrokBuildRemote-Agents/mcp/gbr-mcp/bin/gbr-mcp.js"
      ],
      "description": "Build Remote Agent Bot API (loopback). Requires gbr-agent run. Never put mailbox keys here."
    }
  }
}
```

## Attach

```bash
curl -sS http://127.0.0.1:8788/health
curl -sS http://127.0.0.1:8788/v1/sessions
```

Phone is spectator + veto. Orchestration stays in OpenCursor.

Do not commit mailbox keys. Phone **Settings → Bot API** is the only place the
relay key is copied.
