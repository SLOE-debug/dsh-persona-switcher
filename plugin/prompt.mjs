import {readFile} from 'node:fs/promises';

export async function loadPersona(url = new URL('../personas/无法拒绝.md', import.meta.url)) {
  const bytes = await readFile(url);
  if (bytes.length > 65536) throw new Error('人格文件超过 64 KiB。');
  const text = new TextDecoder('utf-8', {fatal: true}).decode(bytes).replace(/^\uFEFF/, '');
  if (!text.trim()) throw new Error('人格文件为空。');
  return text;
}

export function personaSection(state, store) {
  return {
    name: 'dsh-persona-switcher:session-persona',
    order: 10300,
    interpolate: false,
    text({agent} = {}) {
      if (!agent || !state.enabled(agent.session?.id)) return '';
      if (agent.session.header?.origin === 'subagent') return '';
      const projections = agent.ctx?.get?.('sessionProjections');
      if (projections?.stateOf(agent.session, 'agentPreset') !== 'standard') return '';
      const text = store.text(state.selection(agent.session.id));
      if(!text) return '';
      return `<local-response-style>\n${text}\n</local-response-style>`;
    },
  };
}
