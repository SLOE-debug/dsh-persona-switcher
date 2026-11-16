import {RuntimeHost} from './host.mjs';
import {registerCoreRoutes} from './loader-routes.mjs';

export const name = 'dsh-persona-switcher';
export const inject = ['profileContext','connection','webServer'];
export async function apply(ctx) {
  const host = new RuntimeHost(ctx);
  registerCoreRoutes(ctx, host);
  ctx.effect(() => () => host.stop());
  await host.start();
}
