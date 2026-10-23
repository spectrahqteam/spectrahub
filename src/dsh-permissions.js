// A per-process DSH plugin, loaded only by SpectraHub's temporary ACP overlay.
// Required by the ACP row: if the guard cannot mount, no prompt transport activates.
export const name = 'spectrahub-permissions';
export const inject = ['permissionPresets', 'sandboxPolicy', 'approval', 'tools'];
const MODES = ['read-only', 'workspace-write', 'danger-full-access'];
const READ_TOOLS = new Set(['read', 'read_file', 'list_directory', 'glob', 'grep']);

export function apply(ctx, config) {
  const mode = config?.mode;
  if (!MODES.includes(mode)) throw new Error('SpectraHub: invalid permission mode');
  if (ctx.permissionPresets.resolve(mode).approval !== 'ask') throw new Error('SpectraHub: interactive approval service is required');
  // A resumed session's durable permissions override deployment defaults. Reset them through
  // the public preset service before the agent is published or accepts any queued work.
  ctx.on('agent/created', ({ agent }) => {
    // Delegated agents retain any stricter permissions imposed by their parent. The tool
    // guard below still applies; unavailable child approval channels fail closed in DSH.
    if (agent.session.header?.parentSession) return;
    ctx.permissionPresets.set(agent.session, mode);
    if (ctx.permissionPresets.current(agent.session) !== mode || ctx.sandboxPolicy.resolve({ session: agent.session }).mode !== mode) {
      throw new Error('SpectraHub: could not enforce session permissions');
    }
  });
  ctx.on('tools/pre-execute', async (exec, next) => {
    const decision = await next();
    if (decision.kind !== 'allow' || READ_TOOLS.has(exec.name)) return decision;
    // Unknown tools, shell/code, file writes and integrations all require a concrete decision.
    // A previous denial cannot be changed back to an allow by this guard.
    if (mode === 'read-only') return { kind: 'deny', reason: 'SpectraHub: this session permits read-only tools only.' };
    return { kind: 'ask', reason: `SpectraHub: approve one call to ${exec.name}.` };
  });
  ctx.provide('spectrahubPermissions', { ready: true });
}
