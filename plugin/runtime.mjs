import {join} from 'node:path';
import {SessionState} from './session-state.mjs';
import {loadPersona, personaSection} from './prompt.mjs';
import {createRpcHandler} from './rpc.mjs';
import {GitUpdater} from './update.mjs';
import {registerRoutes} from './routes.mjs';
import {PersonaStore} from './persona-store.mjs';

export const name = 'dsh-persona-runtime';
export const inject = ['systemPrompt', 'connection', 'profileContext', 'sessionProjections'];

export async function apply(ctx, {coordinator}) {
  const dataDirectory = join(ctx.profileContext.dir, '.dsh-persona-switcher');
  const state = await new SessionState(join(dataDirectory, 'conversation-state.json')).load();
  const store = await new PersonaStore(join(dataDirectory,'personas')).init(await loadPersona());
  const updater = new GitUpdater({dataDirectory, coordinator});
  ctx.effect(() => () => state.flush());
  ctx.systemPrompt.section(personaSection(state, store));
  registerRoutes(ctx, createRpcHandler({state, updater, store}));
}
