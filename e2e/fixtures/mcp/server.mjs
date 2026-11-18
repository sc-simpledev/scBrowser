// A tiny MCP server for the tests: one tool that says back what it was given.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'

const server = new McpServer({ name: 'fake', version: '1.0.0' })
server.registerTool('shout', { description: 'Says the words back in capitals', inputSchema: { words: z.string() } }, async ({ words }) => ({ content: [{ type: 'text', text: `${words.toUpperCase()}!` }] }))
await server.connect(new StdioServerTransport())
