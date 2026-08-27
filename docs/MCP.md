# MCP server

## Registering it

Build the repository once before registering the server:

```bash
git clone https://github.com/matheusbgodoi/local-photo-ai-m5.git
cd local-photo-ai-m5
npm ci
npm run build
```

The full `./scripts/install.sh` flow also installs Draw Things, the model and
all integrations. The commands below assume the repository is already built.

### Claude Code

```bash
claude mcp add local-photo -- node /abs/path/to/local-photo-ai-m5/dist/mcp/server.js
```

`scripts/install.sh` does this for you when the Claude Code CLI is present.

### Codex

Add this to `~/.codex/config.toml`:

```toml
[mcp_servers.local-photo]
command = "node"
args = ["/abs/path/to/local-photo-ai-m5/dist/mcp/server.js"]
```

### OpenCode

Add the stdio server to the `mcp` object in the active OpenCode config:

```json
{
  "mcp": {
    "local-photo": {
      "type": "local",
      "command": [
        "node",
        "/abs/path/to/local-photo-ai-m5/dist/mcp/server.js"
      ],
      "enabled": true
    }
  }
}
```

OpenCode schemas can differ by release; keep the same `node` command and
absolute server path if the installed version nests local servers elsewhere.

### Generic MCP client

For any other client, the stdio command is:

```json
{
  "mcpServers": {
    "local-photo": {
      "command": "node",
      "args": ["/abs/path/to/local-photo-ai-m5/dist/mcp/server.js"]
    }
  }
}
```

**stdio, deliberately.** No port, no daemon, no service to forget you left
running. The client spawns the process when it wants a photograph and the
process exits afterwards, which is the same on-demand discipline the rest of
the project follows.

Use an absolute path. `~`, `$HOME` and a relative path are not expanded by
every MCP client.

## Tools

| tool | returns |
| --- | --- |
| `image_generate` | absolute paths, plus the brief that was used and the seed |
| `image_upscale` | absolute path of the enlarged image |
| `image_health` | readiness of engine, model, LoRA, upscaler, disk |
| `image_prompt_preview` | the brief, without generating |

That is the complete list, and it is complete on purpose. There is no
`image_edit`: instruction-based editing on the Z-Image family needs a second
large checkpoint that this build does not install, and a tool that fails at
call time is worse than a tool that was never advertised.

### `image_generate`

```jsonc
{
  "prompt": "médica conversando com paciente idosa em uma clínica",
  "preset": "clinical",        // natural | professional | lifestyle | clinical | product | smartphone
  "size": "post-portrait",     // square | portrait | landscape | wide | hero | post | post-portrait | story
  "count": 1,                  // 1-4
  "seed": 1837462,             // optional, for reproducibility
  "output": "./public/assets/hero.jpg",
  "upscale": "final"           // final (default: Lanczos 1.5x) | off | auto
}
```

`output` names the **final** artifact. By default the model's own frame is also
kept, as `hero.raw.jpg` next to it — never overwritten, and always at the size
the model generated. With a `size` that carries delivery dimensions (`hero`,
`post`, `post-portrait`, `story`) only the final file is resized to them; the
raw stays at the generation size.

Response is text: the absolute paths, then the preset, seed and dimensions, the
raw render's path when there is one, then the enhanced brief. The brief is
included so the calling model can see what was actually asked of the image
model and correct course if the scene was misread.

## Verifying it works

```bash
printf '%s\n%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"probe","version":"1"}}}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' \
  | node dist/mcp/server.js
```

You should see the server identify itself as `local-photo-ai-m5` and list four
tools.

## Implementation notes

- **stdout belongs to the protocol.** Everything this server says to a human
  goes to stderr. A single stray `console.log` would corrupt the JSON-RPC
  stream — this is the most common way stdio MCP servers break.
- **The server holds no state.** Each tool call constructs a fresh
  `LocalPhotoService`, which reads the current config. Changing a setting with
  `local-photo lora enable` takes effect on the next call, with no restart.
- **Paths are always absolute** in responses, so the calling agent can hand
  them straight to a file write without resolving anything.
- **Same core as everything else.** `src/mcp/server.ts` contains no
  photography logic — see [ARCHITECTURE.md](ARCHITECTURE.md).

## Pi does not use this

Pi has no built-in MCP client, so it gets a native extension instead. See
[PI.md](PI.md). The two integrations share the core, not the transport.
