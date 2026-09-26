import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RoleRuntime } from '@bughunters/core';
import { serveTools } from '../mcp-server.js';
import { firstLine } from './model.js';
import type { EventSink, RoleOutcome, RoleTask, Runtime } from '../types.js';

type CliUse = Extract<RoleRuntime, { runtime: 'cli' }>;

function quote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

/** A CLI gets the same tools over local MCP and a prompt on stdin and disk. */
export class CliRuntime implements Runtime {
  readonly label: string;

  constructor(private readonly use: CliUse) {
    this.label = `cli:${use.command.split(/\s+/)[0] ?? 'shell'}`;
  }

  async run(task: RoleTask, emit: EventSink): Promise<RoleOutcome> {
    const temp = await mkdtemp(join(tmpdir(), 'bughunters-agent-'));
    let summary = '';
    let steps = 0;
    let stderr = '';
    let stdout = '';
    let lastThought = 0;
    let pending = '';
    const onText = (text: string) => {
      pending += text;
      const now = Date.now();
      if (now - lastThought >= 500) {
        const lines = pending.trim().split('\n');
        const batch = lines.slice(-20).join('\n').slice(0, 300);
        if (batch) {
          emit({ kind: 'thought', summary: batch });
        }
        pending = '';
        lastThought = now;
      }
    };
    const mcp = await serveTools(task.tools, {
      maxCalls: task.maxSteps,
      onCall(name, input, result, ms) {
        steps++;
        emit({ kind: 'tool-call', summary: `Called ${name}.`, tool: name, input });
        const output = result.content
          .filter((part) => part.type === 'text')
          .map((part) => part.text)
          .join('\n');
        emit({
          kind: 'tool-result',
          summary: result.meta?.summary ?? `${name}: ${firstLine(output)}`,
          tool: name,
          output: output.slice(0, 500),
          screenshot: result.meta?.screenshot,
          screenId: result.meta?.screenId,
          durationMs: ms,
          costUsd: 0,
        });
        if (result.done) {
          summary = output;
        }
      },
    });
    try {
      const promptFile = join(temp, 'prompt.md');
      const mcpFile = join(temp, 'mcp.json');
      const prompt = `${task.system}\n\n${task.prompt}`;
      await writeFile(promptFile, prompt);
      await writeFile(mcpFile, JSON.stringify({ mcpServers: { bughunters: { type: 'http', url: mcp.url } } }));
      const workdir = task.workdir ?? process.cwd();
      const replacements = {
        prompt: promptFile,
        mcp: mcpFile,
        mcpUrl: mcp.url,
        workdir,
      };
      const command = this.use.command.replace(/\{(prompt|mcp|mcpUrl|workdir)\}/g, (_, name: string) => {
        return quote(replacements[name as keyof typeof replacements]);
      });
      const child = spawn('/bin/sh', ['-c', command], {
        cwd: workdir,
        detached: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      child.stdin.end(prompt);
      child.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk.toString();
        onText(chunk.toString());
      });
      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
        onText(chunk.toString());
      });
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        if (child.pid) {
          try {
            process.kill(-child.pid, 'SIGTERM');
          } catch {
            child.kill('SIGTERM');
          }
        }
      }, task.timeoutMs);
      let code: number | null;
      try {
        code = await new Promise<number | null>((done, reject) => {
          child.once('error', reject);
          child.once('exit', done);
        });
      } finally {
        clearTimeout(timer);
      }
      if (pending.trim()) {
        emit({ kind: 'thought', summary: pending.trim().slice(0, 300) });
      }
      if (timedOut) {
        return {
          stop: 'timeout',
          steps,
          costUsd: 0,
          summary: summary || stdout.trim().split('\n').slice(-20).join('\n'),
        };
      }
      if (code !== 0) {
        return {
          stop: 'error',
          steps,
          costUsd: 0,
          error: stderr.trim().split('\n').slice(-20).join('\n') || `CLI exited ${code}`,
        };
      }
      return {
        stop: 'done',
        steps,
        costUsd: 0,
        summary: summary || stdout.trim().split('\n').slice(-20).join('\n'),
      };
    } finally {
      await mcp.close();
      await rm(temp, { recursive: true, force: true });
    }
  }
}
